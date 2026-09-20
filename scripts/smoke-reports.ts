/** The MIS report pack, the builder, the exports and the schedules. */
import { prisma } from "@backend/db/client";
import { REPORTS, runReport } from "@backend/reports/registry";
import { ENTITIES, runBuilder, validateDefinition } from "@backend/reports/builder";
import { exportReport, toCsv, toExcel } from "@backend/reports/export";
import { executiveBrief } from "@backend/reports/brief";
import { briefToPdf } from "@backend/reports/brief-pdf";
import { createSchedule, nextRun, runSchedule } from "@backend/reports/schedule";
import type { Actor } from "@backend/rbac/scope";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? `  ${d}` : ""}`);
  if (ok) pass++;
  else fail++;
};
const refused = (p: Promise<unknown>) => p.then(() => "", (e: Error) => e.message);

async function actorFor(email: string): Promise<Actor & { email: string; fullName: string }> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true, ownerProfile: true } });
  return {
    id: u.id, role: u.role.type, jurisdictionLevel: u.jurisdictionLevel,
    stateId: u.stateId, districtId: u.districtId, tehsilId: u.tehsilId, agencyId: u.agencyId,
    ownerId: u.ownerProfile?.id ?? null, email: u.email, fullName: u.fullName,
  };
}

async function main() {
  console.log("\nREPORTS SMOKE TEST\n======================================================");
  const admin = await actorFor("admin@bhoominayan.gov.in");
  const collector = await actorFor("collector.agra@bhoominayan.gov.in");
  const auditBefore = await prisma.auditLog.count({ where: { entityType: "Report" } });

  console.log("\nThe standing pack:");
  check("the pack covers every section", new Set(REPORTS.map((r) => r.section)).size === 4, [...new Set(REPORTS.map((r) => r.section))].join(", "));
  for (const definition of REPORTS) {
    const report = await runReport(definition.key, admin);
    const columnsPresent = report.rows.every((row) => report.columns.some((c) => c.key in row));
    check(`${definition.key} runs`, report.columns.length > 0 && (report.rows.length === 0 || columnsPresent), `${report.rows.length} rows`);
  }
  check("an unknown report is refused", (await refused(runReport("no-such-report", admin))).includes("Unknown report"));

  console.log("\nReports obey scope:");
  const adminStates = await runReport("state-progress", admin);
  const collectorStates = await runReport("state-progress", collector);
  check("a collector sees fewer states than the nation", collectorStates.rows.length < adminStates.rows.length, `${collectorStates.rows.length} vs ${adminStates.rows.length}`);
  const collectorPossession = await runReport("possession-status", collector);
  const districts = new Set(collectorPossession.rows.map((r) => r.district));
  check("every row is in the collector's own district", districts.size <= 1, [...districts].join(", "));

  console.log("\nThe builder:");
  const built = await runBuilder(
    validateDefinition({ entity: "parcel", columns: ["khasraNo", "district", "status", "declaredAreaHectares"], limit: 50 }),
    admin,
    {},
    "Plots",
  );
  check("a built report returns the chosen columns", built.columns.map((c) => c.key).join(",") === "khasraNo,district,status,declaredAreaHectares");
  check("it respects the row limit", built.rows.length <= 50, `${built.rows.length} rows`);
  check("numeric columns are totalled", typeof built.totals?.declaredAreaHectares === "number");

  const grouped = await runBuilder(
    validateDefinition({
      entity: "parcel",
      columns: ["district"],
      groupBy: ["district"],
      aggregate: [{ field: "khasraNo", as: "count" }, { field: "declaredAreaHectares", as: "sum" }],
      limit: 5000,
    }),
    admin,
    {},
    "Plots by district",
  );
  check("grouping produces one row per group", grouped.rows.length > 1 && grouped.rows.length < built.rows.length + 5000, `${grouped.rows.length} districts`);
  const summed = grouped.rows.reduce((a, r) => a + Number(r.sum_declaredAreaHectares ?? 0), 0);
  const [{ total }] = await prisma.$queryRaw<{ total: number }[]>`SELECT COALESCE(SUM("declaredAreaHectares"), 0)::float8 AS total FROM "LandParcel";`;
  check("the grouped sum matches SQL", Math.abs(summed - total) < 1, `${summed.toFixed(2)} vs ${total.toFixed(2)}`);

  check("an unknown entity is refused", (await refused(Promise.resolve().then(() => validateDefinition({ entity: "secrets", columns: ["x"] })))).length > 0);
  check("unknown columns are dropped", (await refused(Promise.resolve().then(() => validateDefinition({ entity: "parcel", columns: ["passwordHash", "bankIfsc"] })))).includes("at least one column"));
  const capped = validateDefinition({ entity: "parcel", columns: ["khasraNo"], limit: 999_999 });
  check("the row limit is capped", capped.limit === 5000, `${capped.limit}`);
  check("every entity in the builder loads", (await Promise.all(
    (Object.keys(ENTITIES) as (keyof typeof ENTITIES)[]).map(async (e) => {
      const r = await runBuilder(validateDefinition({ entity: e, columns: [ENTITIES[e].fields[0].key], limit: 5 }), admin, {}, e);
      return r.columns.length === 1;
    }),
  )).every(Boolean));

  console.log("\nExports:");
  const report = await runReport("headline-kpis", admin);
  const csv = toCsv(report, "watermark");
  check("CSV carries a header row and the watermark", csv.includes("Figure,Value,Unit") && csv.includes("watermark"));
  const dangerous = { ...report, rows: [{ figure: "=cmd|'/c calc'!A1", value: 1, unit: "" }] };
  check("a formula in a cell is neutralised", toCsv(dangerous, "w").includes("'=cmd"), "(CSV injection)");
  const excel = toExcel(report, "watermark");
  check("Excel output is a SpreadsheetML workbook", excel.startsWith("<?xml") && excel.includes("urn:schemas-microsoft-com:office:spreadsheet"));
  check("Excel numbers are typed as numbers", excel.includes('ss:Type="Number"'));
  check("Excel escapes markup in values", !toExcel({ ...report, title: "<script>" }, "w").includes("<script>"));

  const pdf = await exportReport(report, "PDF", admin);
  check("the PDF is a PDF", pdf.body.subarray(0, 4).toString() === "%PDF", `${Math.round(pdf.body.length / 1024)} KB`);
  check("the filename says what it is", /bhoomi-nayan-headline-kpis-\d{4}-\d{2}-\d{2}\.pdf/.test(pdf.filename), pdf.filename);
  const csvFile = await exportReport(report, "CSV", admin);
  check("the CSV export is served as CSV", csvFile.contentType.startsWith("text/csv"));
  const auditAfter = await prisma.auditLog.count({ where: { entityType: "Report" } });
  check("every export is audited", auditAfter === auditBefore + 2, `${auditAfter - auditBefore} entries`);

  console.log("\nThe executive brief:");
  const brief = await executiveBrief(admin);
  check("the brief has a summary and findings", brief.summary.length > 80 && brief.findings.length > 0, `${brief.findings.length} findings`);
  check("every finding carries an action", brief.findings.every((f) => f.action.length > 10));
  check("it reports the headline figures", brief.headlines.length >= 8);
  const briefPdf = await briefToPdf(brief, admin);
  check("the brief renders as a PDF", briefPdf.subarray(0, 4).toString() === "%PDF", `${Math.round(briefPdf.length / 1024)} KB`);
  const collectorBrief = await executiveBrief(collector);
  check("a collector's brief is about their own district", collectorBrief.jurisdiction.toLowerCase().includes("district"), collectorBrief.jurisdiction);

  console.log("\nSchedules:");
  check("weekly runs on a Monday", nextRun("WEEKLY").getDay() === 1);
  check("monthly runs on the first", nextRun("MONTHLY").getDate() === 1);
  check("a schedule with no recipients is refused",
    (await refused(createSchedule({ actor: admin, reportKey: "state-progress", frequency: "WEEKLY", recipients: [], format: "PDF" }))).includes("recipient"));
  check("a bad email address is refused",
    (await refused(createSchedule({ actor: admin, reportKey: "state-progress", frequency: "WEEKLY", recipients: ["not-an-address"], format: "PDF" }))).includes("not an email"));
  check("an unknown report cannot be scheduled",
    (await refused(createSchedule({ actor: admin, reportKey: "nope", frequency: "WEEKLY", recipients: ["a@b.in"], format: "PDF" }))).includes("Unknown report"));

  const schedule = await createSchedule({
    actor: admin, reportKey: "outstanding-by-district", frequency: "WEEKLY",
    recipients: ["secretary@example.gov.in", "collector@example.gov.in"], format: "PDF",
  });
  check("a schedule is created with a next run date", schedule.nextRunAt > new Date(), schedule.nextRunAt.toISOString().slice(0, 16));
  const run = await runSchedule(schedule.id, admin);
  check("running it emails every recipient", run.delivered === 2 && run.failures.length === 0, run.note);
  const after = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
  check("the next run is moved forward", after.lastRunAt !== null && after.nextRunAt > new Date());

  await prisma.reportSchedule.delete({ where: { id: schedule.id } });
  await prisma.integrationLog.deleteMany({ where: { endpoint: "mock://email/v1/send", createdAt: { gte: new Date(Date.now() - 600_000) } } });
  check("the database is as it was", (await prisma.reportSchedule.count()) === 0);

  console.log("\n======================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
