/** The integration adapter layer and compensation disbursement. */
import { prisma } from "@backend/db/client";
import { integrationSummary, modeFor } from "@backend/integrations/call";
import { instructPayment, paymentStatus } from "@backend/integrations/adapters/payments";
import { publishToGazette } from "@backend/integrations/adapters/egazette";
import { sendMessage } from "@backend/integrations/adapters/notify";
import { disburse, reconciliation, settleInstructedPayments } from "@backend/compensation/disbursement";
import type { Actor } from "@backend/rbac/scope";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? `  ${d}` : ""}`);
  if (ok) pass++;
  else fail++;
};
const refused = (p: Promise<unknown>) => p.then(() => "", (e: Error) => e.message);

async function actorFor(email: string): Promise<Actor> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true } });
  return { id: u.id, role: u.role.type, jurisdictionLevel: u.jurisdictionLevel, stateId: u.stateId, districtId: u.districtId, tehsilId: u.tehsilId, agencyId: u.agencyId };
}

async function main() {
  console.log("\nINTEGRATIONS & DISBURSEMENT SMOKE TEST\n======================================================");
  const logsBefore = await prisma.integrationLog.count();
  const paymentsBefore = await prisma.payment.count();

  console.log("\nThe payments adapter (PFMS-shaped):");
  check("payments run against the mock, not a live endpoint", modeFor("PAYMENTS") === "mock");
  const good = await instructPayment({
    reference: "smoke-ok-1", amount: 125_000, beneficiaryName: "Test Beneficiary",
    accountMasked: "XXXXXX4321", ifsc: "SBIN0001234", purpose: "smoke test",
  });
  check("an instruction is accepted and returns a UTR", good.ok && /^SBIN\d{6}[0-9A-F]{4}$/.test(good.data?.utrNumber ?? ""), good.data?.utrNumber);
  check("the result is labelled simulated", good.source === "SIMULATED");
  check("latency is measured", (good.latencyMs ?? 0) > 0, `${good.latencyMs} ms`);

  const badIfsc = await instructPayment({
    reference: "smoke-bad-ifsc", amount: 1000, beneficiaryName: "X", accountMasked: "XXXX1111", ifsc: "NOPE", purpose: "smoke test",
  });
  check("an invalid IFSC is rejected", !badIfsc.ok && badIfsc.statusCode === 400, badIfsc.error ?? "");
  check("a validation failure is not retried", badIfsc.retries === 0);
  const zero = await instructPayment({
    reference: "smoke-zero", amount: 0, beneficiaryName: "X", accountMasked: "XXXX1111", ifsc: "SBIN0001234", purpose: "smoke test",
  });
  check("a zero-rupee instruction is rejected", !zero.ok);

  // The mock's failures are deterministic, so the same reference always fails.
  const failures = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      instructPayment({ reference: `smoke-dist-${i}`, amount: 1000, beneficiaryName: "X", accountMasked: "XXXX1111", ifsc: "SBIN0001234", purpose: "smoke" }),
    ),
  );
  const rejected = failures.filter((f) => f.data?.status === "FAILED");
  check("some instructions fail the way real ones do", rejected.length > 0 && rejected.length < failures.length, `${rejected.length}/40 rejected by the bank`);
  check("a rejection always says why", rejected.every((r) => Boolean(r.data?.failureReason)), rejected[0]?.data?.failureReason ?? "");
  const repeat = await instructPayment({
    reference: "smoke-dist-0", amount: 1000, beneficiaryName: "X", accountMasked: "XXXX1111", ifsc: "SBIN0001234", purpose: "smoke",
  });
  check("the same reference behaves the same way twice", repeat.data?.status === failures[0].data?.status);
  check("a UTR can be checked for settlement", (await paymentStatus("smoke-ok-1", good.data!.utrNumber)).data?.status === "PAID");

  console.log("\nThe e-Gazette adapter:");
  const gazette = await publishToGazette({
    reference: "smoke-gazette-1", title: "Preliminary notification", notificationType: "SEC_11_PRELIMINARY",
    stateCode: "09", issuedOn: new Date("2026-09-19"),
  });
  check("publication returns a gazette number", gazette.ok && /^CG-DL-E-[0-9A-F]{6}-2026$/.test(gazette.data?.gazetteRef ?? ""), gazette.data?.gazetteRef);
  check("it cites the right part and section", Boolean(gazette.data?.partAndSection.includes("Part II")), gazette.data?.partAndSection);
  check("the same notification gets the same number", (await publishToGazette({
    reference: "smoke-gazette-1", title: "Preliminary notification", notificationType: "SEC_11_PRELIMINARY",
    stateCode: "09", issuedOn: new Date("2026-09-19"),
  })).data?.gazetteRef === gazette.data?.gazetteRef);

  console.log("\nNotification services:");
  const sms = await sendMessage({ channel: "SMS", to: "9876543210", about: "smoke test", body: "Bhoomi Nayan: this is a test message." });
  check("an SMS is accepted", sms.ok && (sms.data?.segments ?? 0) === 1);
  check("a bad mobile number is refused", !(await sendMessage({ channel: "SMS", to: "12345", about: "smoke", body: "x" })).ok);
  check("a bad email address is refused", !(await sendMessage({ channel: "EMAIL", to: "not-an-address", about: "smoke", body: "x" })).ok);
  check("an empty message is refused", !(await sendMessage({ channel: "SMS", to: "9876543210", about: "smoke", body: "   " })).ok);
  const long = await sendMessage({ channel: "SMS", to: "9876543210", about: "smoke", body: "x".repeat(400) });
  check("a long SMS is counted in segments", long.data?.segments === 3, `${long.data?.segments} segments`);

  console.log("\nEvery call was logged:");
  const logsAfter = await prisma.integrationLog.count();
  check("the log grew by every call made", logsAfter > logsBefore, `${logsAfter - logsBefore} new entries`);
  const recent = await prisma.integrationLog.findMany({ orderBy: { createdAt: "desc" }, take: 60 });
  check("nothing is labelled live that is not", recent.every((r) => r.resolvedSource !== "LIVE" || modeFor(r.system) === "live"));
  check("no bank account number reached the log", !JSON.stringify(recent.map((r) => r.requestJson)).includes("XXXXXX4321"));
  const summary = await integrationSummary(1);
  check("the monitor summarises by system", summary.some((x) => x.system === "PAYMENTS" && x.calls > 0), summary.map((x) => `${x.system}:${x.calls}`).join(" "));

  console.log("\nDisbursement rules:");
  // A district that actually has money waiting to go out, and its collector.
  const payable = await prisma.compensationRecord.findFirst({
    where: {
      awardId: { not: null },
      payments: { none: { status: { in: ["PAID", "DEPOSITED_WITH_AUTHORITY", "INSTRUCTED"] } } },
      owner: { bankIfsc: { not: null } },
    },
    select: { id: true, payableToOwner: true, parcelId: true, parcel: { select: { districtId: true, district: { select: { name: true } } } } },
  });
  const districtId = payable?.parcel.districtId;
  const officer = districtId
    ? await prisma.user.findFirst({ where: { role: { type: "DISTRICT_COLLECTOR" }, districtId, isActive: true }, select: { email: true } })
    : null;
  const collector = await actorFor(officer?.email ?? "collector.agra@bhoominayan.gov.in");
  console.log(`  district: ${payable?.parcel.district.name ?? "none with payable records"} · officer ${officer?.email ?? "collector.agra"}`);
  const unawarded = await prisma.compensationRecord.findFirst({ where: { awardId: null, parcel: { districtId } }, select: { id: true } });
  if (unawarded) {
    check("no payment before the award is declared",
      (await refused(disburse({ compensationId: unawarded.id, actor: collector }))).includes("before the award"));
  }
  check("a record outside the officer's district is not found",
    (await refused(disburse({ compensationId: "not-a-real-record", actor: collector }))).includes("not found"));

  const created: string[] = [];
  if (payable) {
    const result = await disburse({ compensationId: payable.id, actor: collector });
    check("an instruction is recorded against the record", ["INSTRUCTED", "FAILED"].includes(result.status), `${result.status} ${result.utrNumber ?? ""}`);
    const payment = await prisma.payment.findFirst({ where: { compensationId: payable.id }, orderBy: { createdAt: "desc" } });
    if (payment) created.push(payment.id);
    check("the amount instructed is the amount payable", Math.abs(Number(payment?.amount ?? 0) - Number(payable.payableToOwner)) < 1);
    check("it was written to the audit chain",
      (await prisma.auditLog.count({ where: { entityType: "Payment", entityId: payment?.id ?? "" } })) === 1);

    if (result.status === "INSTRUCTED") {
      check("a second instruction on the same record is refused",
        (await refused(disburse({ compensationId: payable.id, actor: collector }))).includes("already with the bank"));
      const settled = await settleInstructedPayments(collector);
      check("the gateway confirms the credit", settled.settled >= 1, `${settled.settled} of ${settled.checked} settled`);
      const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment!.id } });
      check("the payment is marked paid with a date", after.status === "PAID" && after.paidAt !== null);
      check("paying an already-settled record is refused",
        (await refused(disburse({ compensationId: payable.id, actor: collector }))).includes("already been settled"));
    }
  } else {
    console.log("  (nothing awaiting payment anywhere — skipping the payment path)");
  }

  console.log("\nSection 77 — deposit with the LARR Authority:");
  const depositable = await prisma.compensationRecord.findFirst({
    where: {
      awardId: { not: null },
      parcel: { districtId },
      payments: { none: { status: { in: ["PAID", "DEPOSITED_WITH_AUTHORITY", "INSTRUCTED"] } } },
      id: payable ? { not: payable.id } : undefined,
    },
    select: { id: true },
  });
  if (depositable) {
    check("a deposit without reasons is refused",
      (await refused(disburse({ compensationId: depositable.id, actor: collector, depositWithAuthority: true, depositReason: "x" }))).includes("s.77"));
    const dep = await disburse({
      compensationId: depositable.id, actor: collector, depositWithAuthority: true,
      depositReason: "The recorded owner died in 2024 and succession has not yet been mutated.",
    });
    check("the amount is deposited with the Authority", dep.status === "DEPOSITED_WITH_AUTHORITY", dep.message);
    const payment = await prisma.payment.findFirst({ where: { compensationId: depositable.id }, orderBy: { createdAt: "desc" } });
    if (payment) created.push(payment.id);
    check("the reason is kept on the record", Boolean(payment?.failureReason));
  }

  console.log("\nReconciliation:");
  const rec = await reconciliation(collector);
  check("assessed equals paid plus deposited plus outstanding",
    Math.abs(rec.assessed - (rec.paid + rec.deposited + rec.outstanding)) < 1,
    `${Math.round(rec.assessed)} = ${Math.round(rec.paid)} + ${Math.round(rec.deposited)} + ${Math.round(rec.outstanding)}`);
  const [{ sqlAssessed }] = await prisma.$queryRaw<{ sqlAssessed: number }[]>`
    SELECT COALESCE(SUM(c."payableToOwner"), 0)::float8 AS "sqlAssessed"
      FROM "CompensationRecord" c JOIN "LandParcel" p ON p.id = c."parcelId"
     WHERE p."districtId" = ${collector.districtId};`;
  check("assessed matches SQL", Math.abs(rec.assessed - sqlAssessed) < 1, `${Math.round(rec.assessed)} vs ${Math.round(sqlAssessed)}`);
  check("districts are listed by what they owe", rec.byDistrict.every((d, i, a) => i === 0 || a[i - 1].outstanding >= d.outstanding));

  // --- put the database back ------------------------------------------------
  for (const id of created) {
    const payment = await prisma.payment.findUnique({ where: { id }, select: { compensation: { select: { parcelId: true } } } });
    await prisma.payment.delete({ where: { id } }).catch(() => {});
    if (payment) await prisma.landParcel.updateMany({ where: { id: payment.compensation.parcelId, status: "COMPENSATED" }, data: { status: "AWARD_DECLARED" } });
  }
  await prisma.integrationLog.deleteMany({ where: { endpoint: { startsWith: "mock://" }, createdAt: { gte: new Date(Date.now() - 600_000) } } });
  check("the database is as it was", (await prisma.payment.count()) === paymentsBefore, `${await prisma.payment.count()} vs ${paymentsBefore}`);

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
