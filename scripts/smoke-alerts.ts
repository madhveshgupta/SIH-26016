/** Smoke test — automated alerts (PS 26016 "Monitoring & Alerts"). */
import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { RULES, runAlertSweep } from "@backend/alerts/sweep";
import { SUPERIOR } from "@backend/alerts/recipients";
import { scopeForProposal, type Actor } from "@backend/rbac/scope";
import { pendingBeyondSla } from "@backend/alerts/rules/cases";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? `  — ${d}` : ""}`);
};

async function main() {
  console.log("\nAUTOMATED ALERTS\n======================================================");

  // --- the rules -------------------------------------------------------------
  const now = new Date();
  const statutory = await RULES.statutoryDeadlines(now);
  check("statutory rule finds cases near or past a deadline", statutory.length > 0, `${statutory.length}`);
  check(
    "a fatal deadline (lapse / rescission) is raised at lapse-risk severity",
    statutory.some((f) => f.severity === "STATUTORY_LAPSE_RISK"),
  );
  const pay = await RULES.compensationUnpaid(now);
  check("unpaid compensation 60+ days after the award is found", pay.length > 0, `${pay.length} cases`);
  check("unpaid compensation past 90 days goes up to the State", pay.filter((f) => f.severity === "CRITICAL").every((f) => f.escalateTo === "STATE_GOVERNMENT"));

  // SLA bands, against a clock moved forward — no rows are written for this.
  const open = await prisma.proposalStage.findFirst({
    where: { exitedAt: null, slaDays: { gt: 0 }, statutoryDeadline: null, proposal: { status: { in: ["DISTRICT_SCRUTINY", "SIA_ORDERED", "STATE_APPROVAL"] } } },
    select: { id: true, enteredAt: true, slaDays: true },
  });
  if (open?.slaDays) {
    const at = (x: number) => new Date(open.enteredAt.getTime() + (open.slaDays! * x + 1) * 86_400_000);
    const band1 = (await pendingBeyondSla(at(1.2))).find((f) => f.key.startsWith(`SLA:${open.id}:`));
    const band2 = (await pendingBeyondSla(at(2.5))).find((f) => f.key.startsWith(`SLA:${open.id}:`));
    check("past the service standard: a warning to the desk holder", band1?.severity === "WARNING" && !band1.escalateTo, band1?.key);
    check("past twice the standard: critical, and escalated one rung up", band2?.severity === "CRITICAL" && Boolean(band2.escalateTo), `${band2?.key} → ${band2?.escalateTo}`);
    check("the two bands carry different keys, so each is sent once", Boolean(band1 && band2 && band1.key !== band2.key));
  } else {
    check("an open stage with a service standard exists to test SLA bands", false);
  }

  // --- the sweep ---------------------------------------------------------------
  const first = await runAlertSweep();
  console.log(`  (sweep: ${first.findings} findings, ${first.created} raised, ${first.escalations} escalations, ${first.alreadySent} already sent)`);
  check("the sweep runs and every finding is accounted for", first.findings > 0);

  const again = await runAlertSweep();
  check("running it again raises nothing new", again.created === 0, `${again.created} raised`);
  check("…because everything was already sent", again.alreadySent >= first.created, `${again.alreadySent} skipped`);

  const swept = await prisma.alert.findMany({
    where: { dedupeKey: { not: null } },
    select: {
      id: true, type: true, proposalId: true, dedupeKey: true, escalatedFromId: true, channels: true, severity: true,
      recipient: { select: { id: true, jurisdictionLevel: true, stateId: true, districtId: true, tehsilId: true, agencyId: true, role: { select: { type: true } } } },
    },
  });
  check("swept alerts exist", swept.length > 0, `${swept.length}`);

  // 1. Routing agrees with scope: nobody is alerted about a case they cannot open.
  let outOfScope = 0;
  for (const a of swept) {
    if (!a.proposalId) continue;
    const r = a.recipient;
    const actor: Actor = { id: r.id, role: r.role.type, jurisdictionLevel: r.jurisdictionLevel, stateId: r.stateId, districtId: r.districtId, tehsilId: r.tehsilId, agencyId: r.agencyId };
    const visible = await prisma.proposal.count({ where: { AND: [{ id: a.proposalId }, scopeForProposal(actor)] } });
    if (!visible) outOfScope++;
  }
  check("every alert reaches only an officer who may open that case", outOfScope === 0, `${outOfScope} outside jurisdiction`);
  check("no alert goes to the administrator or a landowner", swept.every((a) => a.recipient.role.type !== "SUPER_ADMIN" && a.recipient.role.type !== "LANDOWNER"));

  // 2. Escalations go exactly one rung up.
  const escalated = swept.filter((a) => a.type.endsWith("_ESCALATED"));
  check("some alerts were escalated", escalated.length > 0, `${escalated.length}`);
  const originals = new Map(swept.map((a) => [a.id, a]));
  const wrongRung = escalated.filter((e) => {
    const from = e.escalatedFromId ? originals.get(e.escalatedFromId) : null;
    return from ? SUPERIOR[from.recipient.role.type] !== e.recipient.role.type : false;
  });
  check("an escalation goes to the superior of whoever held the case", wrongRung.length === 0, `${wrongRung.length} wrong`);
  check("an escalation's key is its original's key plus :ESC", escalated.every((e) => e.dedupeKey?.endsWith(":ESC")));

  // 3. Channels follow severity.
  check("critical alerts go by SMS as well", swept.filter((a) => a.severity === "CRITICAL" || a.severity === "STATUTORY_LAPSE_RISK").every((a) => a.channels.includes("SMS")));
  check("warnings go by email, not SMS", swept.filter((a) => a.severity === "WARNING").every((a) => a.channels.includes("EMAIL") && !a.channels.includes("SMS")));

  // The database, not just the code, refuses a duplicate.
  const any = swept[0];
  let refused = false;
  try {
    await prisma.alert.create({ data: { type: "SMOKE", title: "dup", message: "dup", recipientId: any.recipient.id, dedupeKey: any.dedupeKey } });
  } catch (e) {
    refused = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
  }
  check("the database refuses the same key twice for one person", refused);

  const audited = await prisma.auditLog.count({ where: { entityType: "AlertSweep" } });
  check("sweeps that raise alerts are written to the audit chain", first.created === 0 || audited > 0);

  console.log(`\n  ${pass} passed · ${fail} failed\n`);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
