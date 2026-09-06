/** Put the demonstration back to a known state, in one command. */
import { prisma } from "@backend/db/client";
import { recomputeAllConflicts } from "@backend/gis/postgis";
import { verifyChain } from "@backend/audit/chain";
import { runAlertSweep } from "@backend/alerts/sweep";

async function main() {
  console.log("\nRESETTING THE DEMONSTRATION\n======================================================");

  // 1. Anything a test or a walkthrough left behind.
  const testProjects = await prisma.project.deleteMany({
    where: { OR: [{ name: { startsWith: "ADVERSARIAL TEST" } }, { name: { contains: "SMOKE" } }, { name: { startsWith: "HTTP TEST" } }, { name: { startsWith: "Race test" } }] },
  });
  const surveys = await prisma.fieldSurvey.deleteMany({ where: { clientId: { startsWith: "smoke-device-" } } });
  const schedules = await prisma.reportSchedule.deleteMany({ where: { recipients: { hasSome: ["secretary@example.gov.in", "collector@example.gov.in", "a@b.in"] } } });
  const templates = await prisma.reportTemplate.deleteMany({ where: { name: { startsWith: "SMOKE" } } });
  console.log(`  cleared   : ${testProjects.count} test projects · ${surveys.count} test surveys · ${schedules.count} schedules · ${templates.count} saved reports`);

  // 2. Integration noise from repeated demos.
  const logs = await prisma.integrationLog.deleteMany({ where: { endpoint: { startsWith: "mock://" }, createdAt: { lt: new Date(Date.now() - 86_400_000) } } });
  console.log(`  pruned    : ${logs.count} integration log entries older than a day`);

  // 3. Plot statuses that no longer match reality.
  const orphaned = await prisma.landParcel.updateMany({
    where: { status: "OBJECTED", objections: { none: { decidedAt: null, status: { not: "WITHDRAWN" } } } },
    data: { status: "NOTIFIED" },
  });
  const conflicts = await recomputeAllConflicts();
  console.log(`  corrected : ${orphaned.count} plots marked "under objection" with no objection on file`);
  console.log(`  conflicts : ${conflicts} plots claimed by two projects (expected: the Agra crossing)`);

  // 4. Dashboards back to their default arrangement.
  const layouts = await prisma.dashboardLayout.deleteMany({});
  console.log(`  reset     : ${layouts.count} customised dashboards`);

  // 5. Alerts for the cases as they stand now.
  const alerts = await runAlertSweep();
  console.log(`  alerts    : ${alerts.created} raised (${alerts.escalations} escalated) · ${alerts.alreadySent} already on officers' desks`);

  // 6. The evidence chain must be sound before anyone is shown anything.
  const chain = await verifyChain();
  console.log(`  audit     : ${chain.intact ? `intact over ${chain.recordsChecked} records` : `BROKEN — ${chain.reason}`}`);

  const [projects, parcels, proposals, objections, families] = await Promise.all([
    prisma.project.count(), prisma.landParcel.count(), prisma.proposal.count(),
    prisma.objection.count(), prisma.affectedFamily.count(),
  ]);
  console.log("\n  ready: " +
    `${projects} projects · ${parcels} parcels · ${proposals} cases · ${objections} objections · ${families} families`);

  if (!chain.intact) {
    console.log("\n  Fix the audit chain before demonstrating: npx tsx scripts/repair-audit-chain.ts");
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
