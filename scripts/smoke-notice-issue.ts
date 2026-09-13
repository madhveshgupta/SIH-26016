/** Smoke test — issuing statutory notifications from an officer's desk. */
import { prisma } from "@backend/db/client";
import {
  awaitingNotification, issueFromDesk, objectionWindow, recordPublication,
} from "@backend/statutory/notifications";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? `  — ${d}` : ""}`);
};
const refused = async (l: string, f: () => Promise<unknown>, match: RegExp) => {
  try {
    await f();
    check(l, false, "was accepted");
  } catch (e) {
    const m = (e as Error).message;
    check(l, match.test(m), m);
  }
};
const DAY = 86_400_000;

async function main() {
  console.log("\nISSUING NOTIFICATIONS\n======================================================");

  const collector = await prisma.user.findFirstOrThrow({
    where: { role: { type: "DISTRICT_COLLECTOR" }, districtId: { not: null }, isActive: true },
    select: { id: true, districtId: true, district: { select: { stateId: true } } },
  });
  const cala = await prisma.user.findFirst({ where: { role: { type: "LAND_ACQUIRING_AUTHORITY" }, isActive: true }, select: { id: true } });
  const agency = await prisma.agency.findFirstOrThrow({ where: { isRequiringBody: true } });

  const entered = new Date(Date.now() - 10 * DAY);
  const fixture = async (n: number) => {
    const project = await prisma.project.create({
      data: {
        referenceNo: `SMOKE-NOTICE-${Date.now()}-${n}`,
        name: `SMOKE notice issue ${n}`,
        type: "IRRIGATION",
        governingAct: "LARR_2013",
        agencyId: agency.id,
        states: { create: { stateId: collector.district!.stateId } },
        districts: { create: { districtId: collector.districtId! } },
      },
    });
    return prisma.proposal.create({
      data: {
        referenceNo: `SMOKE/NOTICE/${Date.now()}/${n}`,
        projectId: project.id,
        status: "SEC_11_PRELIM_NOTIFICATION",
        currentHolderRole: "DISTRICT_COLLECTOR",
        createdById: collector.id,
        stages: { create: { stage: "SEC_11_PRELIM_NOTIFICATION", enteredAt: entered, slaDays: 30 } },
      },
    });
  };
  const a = await fixture(1);
  const b = await fixture(2);

  try {
    // --- what is due --------------------------------------------------------
    const due = (await awaitingNotification({ id: a.id }))[0];
    check("a case at s.11 is listed as awaiting its preliminary notification", due?.type === "SEC_11_PRELIMINARY", due?.label);
    check("…and issuing it would move the case on to objections", /objection/i.test(due?.advancesToLabel ?? ""), due?.advancesToLabel ?? "");

    const base = { proposalId: a.id, type: "SEC_11_PRELIMINARY" as const, issuedOn: new Date(), publish: false, channels: [], advance: false, actorId: collector.id, actorRole: "DISTRICT_COLLECTOR" as const };

    // --- what is refused ------------------------------------------------------
    await refused("the wrong notification for the stage is refused", () => issueFromDesk({ ...base, type: "SEC_19_DECLARATION" }), /publishes the Preliminary/);
    await refused("a date in the future is refused", () => issueFromDesk({ ...base, issuedOn: new Date(Date.now() + 3 * DAY) }), /future/);
    await refused("a date before the case reached the stage is refused", () => issueFromDesk({ ...base, issuedOn: new Date(entered.getTime() - 5 * DAY) }), /cannot be dated before/);

    // --- issued by an officer who cannot move the case on ---------------------
    if (cala) {
      const r = await issueFromDesk({ ...base, advance: true, actorId: cala.id, actorRole: "LAND_ACQUIRING_AUTHORITY", gazetteRef: "GZT/SMOKE/1", channels: ["publishedGazette", "publishedWebsite"] });
      check("issued with the gazette number the officer typed", r.gazetteRef === "GZT/SMOKE/1");
      check("an officer who may not act at the stage leaves it where it is", r.advancedTo === null);
      check("…and is told why, rather than it failing silently", r.warnings.some((w) => /stays at/.test(w)), r.warnings.join(" | "));
    } else {
      await issueFromDesk({ ...base, gazetteRef: "GZT/SMOKE/1", channels: ["publishedGazette", "publishedWebsite"] });
    }
    const issued = await prisma.notification.findFirstOrThrow({ where: { proposalId: a.id } });
    check("the clock to the s.19 declaration starts from the date of issue", Boolean(issued.startsDeadlineAt && issued.startsDeadlineAt.getTime() - issued.issuedOn.getTime() === 365 * DAY));
    check("a preliminary notification is filed as a PDF document", Boolean(issued.documentId));

    await refused("the same notification cannot be issued twice", () => issueFromDesk(base), /already issued/);
    check("once issued, the case is no longer listed as awaiting it", (await awaitingNotification({ id: a.id })).length === 0);

    // --- publication recorded later ------------------------------------------
    const pub = await recordPublication(issued.id, ["publishedNewspaper1", "publishedPanchayat"], collector.id);
    check("later publication is recorded channel by channel", pub.status.done === 4, `${pub.status.done}/${pub.status.total}`);
    await refused("a channel already recorded is not recorded again", () => recordPublication(issued.id, ["publishedWebsite"], collector.id), /already recorded/);

    // --- issued by the Collector, published through the e-Gazette -------------
    const r = await issueFromDesk({ ...base, proposalId: b.id, publish: true, advance: true });
    check("the e-Gazette returns the gazette number", Boolean(r.gazetteRef), r.gazetteRef ?? "");
    check("the Collector's issue moves the case on to objections", r.advancedTo === "OBJECTIONS");
    const moved = await prisma.proposal.findUniqueOrThrow({ where: { id: b.id }, select: { status: true, stages: { where: { exitedAt: null }, select: { remarks: true, stage: true } } } });
    check("the case record agrees", moved.status === "OBJECTIONS" && moved.stages[0]?.stage === "OBJECTIONS");
    const win = await objectionWindow(b.id);
    check("the objection window is now open to landowners", win.open, win.closesAt?.toISOString().slice(0, 10) ?? "");
    const trail = await prisma.auditLog.count({ where: { entityType: "Notification", entityId: { in: [issued.id, r.notificationId] } } });
    check("issue and publication are on the audit chain", trail >= 3, `${trail} entries`);
  } finally {
    const ids = [a.id, b.id];
    await prisma.document.deleteMany({ where: { proposalId: { in: ids } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: "SMOKE notice issue" } } });
  }

  console.log(`\n  ${pass} passed · ${fail} failed\n`);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
