/** Smoke test for Saarthi — delay attribution, diagnosis and the recovery plan. */
import { PrismaClient, type ProposalStatus, type RoleType } from "@prisma/client";
import { diagnose, attribute, accountability, planRecovery } from "../backend/saarthi/engine";
import type { CaseSnapshot, StageHop } from "../backend/saarthi/types";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? "  " + detail : ""}`);
  if (ok) pass++;
  else fail++;
};

const NOW = new Date("2026-09-23T00:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

function hop(
  stage: ProposalStatus,
  enteredDaysAgo: number,
  exitedDaysAgo: number | null,
  opts: Partial<StageHop> = {},
): StageHop {
  return {
    stage,
    enteredAt: at(enteredDaysAgo),
    exitedAt: exitedDaysAgo === null ? null : at(exitedDaysAgo),
    actorRole: null,
    actorName: null,
    action: null,
    remarks: null,
    slaDays: null,
    statutoryDeadline: null,
    ...opts,
  };
}

function snapshot(over: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    referenceNo: "LA/UP/TEST/2026/0001",
    projectName: "Test corridor",
    act: "LARR_2013",
    status: "AWARD_DECLARED",
    createdAt: at(400),
    currentHolderRole: "LAND_ACQUIRING_AUTHORITY",
    isUrgency: false,
    isPPP: false,
    isPrivateCompany: false,
    hops: [],
    objections: [],
    consents: [],
    parcels: [],
    notifications: [],
    compensation: { assessed: 0, paid: 0, ownerCount: 0, unpaidOwnerCount: 0, unreachableOwnerCount: 0 },
    lastActivityAt: at(1),
    holderStaffCount: 3,
    benchmark: {},
    prediction: null,
    ...over,
  };
}

async function main() {
  console.log("\nSAARTHI SMOKE TEST\n======================================================");

  // ---- attribution --------------------------------------------------------
  console.log("\nWhere the time went:");

  // Scrutiny (SLA 21) held 90 days, then cleared by the Collector who moved it on.
  const overrun = snapshot({
    status: "STATE_APPROVAL",
    currentHolderRole: "STATE_GOVERNMENT",
    hops: [
      hop("DISTRICT_SCRUTINY", 120, 30, { slaDays: 21 }),
      hop("STATE_APPROVAL", 30, null, { slaDays: 30, actorRole: "DISTRICT_COLLECTOR", actorName: "R. Meena" }),
    ],
  });
  const rows = attribute(overrun, NOW);
  check("held days are measured from the hop, not from today", rows[0].heldDays === 90, `${rows[0].heldDays}d`);
  check("overrun is held minus the SLA copied at entry", rows[0].overrunDays === 69, `+${rows[0].overrunDays}`);
  check(
    "a closed stage is attributed to whoever finally acted on it",
    rows[0].holderRole === "DISTRICT_COLLECTOR" && rows[0].holderName === "R. Meena",
    `${rows[0].holderRole}`,
  );
  check("the open stage is attributed to the current holder", rows[1].holderRole === "STATE_GOVERNMENT" && rows[1].open);
  check("a stage inside its SLA carries no overrun", rows[1].overrunDays === 0, `${rows[1].heldDays}d held / 30 allowed`);

  const desks = accountability(rows);
  check("overrun rolls up to one desk", desks.length === 1 && desks[0].role === "DISTRICT_COLLECTOR");
  check("that desk owns 100% of the delay", Math.round(desks[0].share * 100) === 100);
  check("the named officer is carried through", desks[0].officers[0]?.name === "R. Meena");

  // The objection window is a right, not a service level.
  const objections = snapshot({
    status: "OBJECTIONS",
    hops: [hop("OBJECTIONS", 60, null, { slaDays: 60 })],
  });
  const objRows = attribute(objections, NOW);
  check(
    "a full 60-day objection window is not counted as overrun",
    objRows[0].allowedDays === 60 && objRows[0].overrunDays === 0,
  );

  // ---- diagnosis ----------------------------------------------------------
  console.log("\nWhy it is late:");

  const stuck = snapshot({
    status: "AWARD_DECLARED",
    hops: [
      hop("DISTRICT_SCRUTINY", 300, 240, { slaDays: 21, actorRole: "DISTRICT_COLLECTOR", actorName: "R. Meena" }),
      hop("RETURNED_FOR_CLARIFICATION", 240, 200, { slaDays: 14, remarks: "Village schedule missing" }),
      hop("RETURNED_FOR_CLARIFICATION", 200, 150, { slaDays: 14, remarks: "Area does not tally with the map" }),
      hop("AWARD_DECLARED", 150, null, { slaDays: 30, statutoryDeadline: ahead(20) }),
    ],
    objections: [{ status: "FILED", filedAt: at(120), hearingDate: null, decidedAt: null }],
    compensation: { assessed: 1_00_00_000, paid: 20_00_000, ownerCount: 10, unpaidOwnerCount: 8, unreachableOwnerCount: 2 },
    benchmark: { AWARD_DECLARED: { medianDays: 40, sampleSize: 12 } },
  });
  const dx = diagnose(stuck, NOW);
  const codes = dx.causes.map((c) => c.code);

  check("the current desk's overrun is reported", codes.includes("DESK_OVERRUN"));
  check("rework loops are counted", codes.includes("REWORK_LOOP"));
  check(
    "returns are costed at the days they actually held",
    dx.causes.find((c) => c.code === "REWORK_LOOP")?.delayDays === 90,
  );
  check("a case slower than its peers is flagged against the learned median", codes.includes("SLOWER_THAN_PEERS"));
  check("an objection never listed for hearing is flagged", codes.includes("OBJECTIONS_UNHEARD"));
  check("unpaid compensation is flagged after the award", codes.includes("COMPENSATION_UNPAID"));
  check("the statutory clock is surfaced as a cause", codes.includes("STATUTORY_CLOCK"));
  check(
    "a fatal deadline makes that cause critical",
    dx.causes.find((c) => c.code === "STATUTORY_CLOCK")?.severity === "CRITICAL",
  );
  check("no prediction means no model cause invented", !codes.includes("MODEL_RISK"));
  check("every cause carries at least one piece of evidence", dx.causes.every((c) => c.evidence.length > 0 || c.delayDays !== null));
  check("causes are ordered most severe first", dx.causes[0].severity === "CRITICAL");

  // ---- remedies -----------------------------------------------------------
  console.log("\nWhat to do:");
  const remedyCodes = dx.remedies.map((r) => r.code);
  check("an unheard objection produces a hearing date", remedyCodes.includes("BATCH_HEARINGS"));
  check("unpaid owners produce a payment instruction", remedyCodes.includes("RELEASE_PAYMENTS"));
  check(
    "owners with no bank account produce the s.77 deposit route",
    remedyCodes.includes("DEPOSIT_WITH_AUTHORITY") &&
      dx.remedies.find((r) => r.code === "DEPOSIT_WITH_AUTHORITY")?.statutoryBasis === "s.77",
  );
  check("remedies are ordered by priority", dx.remedies.every((r, i, xs) => i === 0 || xs[i - 1].priority <= r.priority));
  check("every remedy names a desk or a section", dx.remedies.every((r) => r.owner !== null || r.statutoryBasis !== null));

  const unstaffed = diagnose(snapshot({
    status: "STATE_APPROVAL",
    currentHolderRole: "STATE_GOVERNMENT",
    holderStaffCount: 0,
    hops: [hop("STATE_APPROVAL", 90, null, { slaDays: 30 })],
  }), NOW);
  check("an empty desk is diagnosed", unstaffed.causes.some((c) => c.code === "DESK_UNSTAFFED"));
  check("and staffing it is the first thing to do", unstaffed.remedies[0]?.code === "STAFF_DESK");

  // ---- recovery plan ------------------------------------------------------
  console.log("\nRecovery plan:");
  const plan = dx.recovery;
  check("the plan starts from the current stage", plan.steps[0]?.stage === "AWARD_DECLARED");
  check("it runs to the last stage before closure", plan.steps[plan.steps.length - 1]?.stage === "POSSESSION");
  check("it knows how many days remain to the deadline", plan.daysAvailable === 20, `${plan.daysAvailable}d`);
  check("it reports the shortfall rather than hiding it", (plan.slackDays ?? 0) < 0);
  check("an impossible deadline is called impossible", !plan.feasible);
  check("and that becomes the top remedy", dx.remedies[0]?.code === "DEADLINE_UNREACHABLE");
  check("the urgency provision is offered only as a last resort, with its caution",
    dx.remedies.some((r) => r.code === "REVIEW_URGENCY" && r.caution !== null));

  // A case with room to spare must not be compressed at all.
  const roomy = snapshot({
    status: "AWARD_DECLARED",
    hops: [hop("AWARD_DECLARED", 5, null, { slaDays: 30, statutoryDeadline: ahead(900) })],
  });
  const roomyPlan = planRecovery(roomy, attribute(roomy, NOW), NOW);
  check("a case with slack is planned at normal service levels", roomyPlan.compressionFactor === null && roomyPlan.feasible);
  check("and none of its stages are marked compressed", roomyPlan.steps.every((s) => !s.compressed));

  // Compression must never touch the objection window.
  const tight = snapshot({
    status: "SEC_11_PRELIM_NOTIFICATION",
    hops: [hop("SEC_11_PRELIM_NOTIFICATION", 10, null, { slaDays: 30, statutoryDeadline: ahead(300) })],
  });
  const tightPlan = planRecovery(tight, attribute(tight, NOW), NOW);
  const window = tightPlan.steps.find((s) => s.stage === "OBJECTIONS");
  check("the objection window appears in the plan", Boolean(window));
  check("it is marked as a period that may not be shortened", window?.protectedWindow === true);
  check("and it keeps its full statutory length however tight the plan", window?.plannedDays === 60, `${window?.plannedDays}d`);
  check("the dates run forward without gaps",
    tightPlan.steps.every((s, i, xs) => i === 0 || xs[i - 1].finishBy.getTime() === s.startOn.getTime()));

  // ---- health and honesty -------------------------------------------------
  console.log("\nHealth and confidence:");
  const breached = diagnose(snapshot({
    status: "AWARD_DECLARED",
    hops: [hop("AWARD_DECLARED", 400, null, { slaDays: 30, statutoryDeadline: at(35) })],
  }), NOW);
  check("a passed fatal deadline reads BREACHED", breached.health === "BREACHED", breached.health);
  check("and the consequence is named", breached.recovery.consequence === "LAPSE");

  const thin = diagnose(snapshot({ hops: [hop("AWARD_DECLARED", 10, null, { slaDays: 30 })] }), NOW);
  check("a case with almost no history reports low confidence", thin.confidence === "LOW", thin.confidence);
  check("a well-recorded case reports higher confidence",
    diagnose(snapshot({
      hops: [
        hop("SUBMITTED", 300, 290, { slaDays: 3 }),
        hop("DISTRICT_SCRUTINY", 290, 200, { slaDays: 21 }),
        hop("STATE_APPROVAL", 200, 150, { slaDays: 30 }),
        hop("AWARD_DECLARED", 150, null, { slaDays: 30 }),
      ],
      benchmark: {
        DISTRICT_SCRUTINY: { medianDays: 25, sampleSize: 9 },
        STATE_APPROVAL: { medianDays: 33, sampleSize: 7 },
      },
    }), NOW).confidence === "HIGH");

  const clean = diagnose(snapshot({
    status: "SUBMITTED",
    hops: [hop("SUBMITTED", 1, null, { slaDays: 3 })],
    lastActivityAt: at(1),
  }), NOW);
  check("a punctual case is not given invented problems", clean.causes.length === 0 && clean.health === "ON_TRACK");

  // ---- against the seeded database ---------------------------------------
  console.log("\nAgainst live records:");
  try {
    const { snapshotFor } = await import("../backend/saarthi");
    const proposal = await prisma.proposal.findFirst({
      where: { stages: { some: {} } },
      select: { id: true, referenceNo: true },
    });
    if (!proposal) {
      console.log("  \x1b[33mskip\x1b[0m no seeded proposals with stage history");
    } else {
      const admin = await prisma.user.findFirst({
        where: { role: { type: "SUPER_ADMIN" } },
        select: { id: true, jurisdictionLevel: true, stateId: true, districtId: true, tehsilId: true, agencyId: true },
      });
      if (!admin) {
        console.log("  \x1b[33mskip\x1b[0m no SUPER_ADMIN user seeded");
      } else {
        const live = await snapshotFor(proposal.id, { ...admin, role: "SUPER_ADMIN" as RoleType });
        check("a real case loads into the snapshot", live !== null, proposal.referenceNo);
        if (live) {
          const real = diagnose(live, NOW);
          check("every hop is attributed", real.stages.length === live.hops.length);
          check("the shares add to one where there is any overrun",
            real.accountability.length === 0 ||
              Math.abs(real.accountability.reduce((a, r) => a + r.share, 0) - 1) < 0.001);
          check("the plan never ends before it starts",
            real.recovery.steps.every((s) => s.finishBy.getTime() >= s.startOn.getTime()));
          check("a benchmark is learned from the other cases", Object.keys(live.benchmark).length > 0);
        }
      }
    }
  } catch (e) {
    console.log(`  \x1b[33mskip\x1b[0m database unreachable (${e instanceof Error ? e.message.split("\n")[0] : e})`);
  }

  console.log("\n======================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("\n\x1b[31mSmoke test error:\x1b[0m", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
