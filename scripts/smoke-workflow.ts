/**
 * Smoke test for Phases 3 and 4: validation, the multi-Act workflow engine, and the Statutory
 * Compliance Clock.
 */
import { PrismaClient } from "@prisma/client";
import { projectSchema, proposalSchema, khasraNo, areaHectares } from "../backend/validation/schemas";
import { parseParcelCsv } from "../backend/validation/csv";
import { transition, stageFor, definitionFor, routeTo, allowedTransitions } from "../backend/workflow/engine";
import { computeClock } from "../backend/statutory/clock";
import { nextProposalReference } from "../backend/proposals/reference";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? "  " + detail : ""}`);
  if (ok) pass++;
  else fail++;
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function main() {
  console.log("\nWORKFLOW / VALIDATION / CLOCK SMOKE TEST\n======================================================");

  // ---- validation ---------------------------------------------------------
  console.log("\nData standardisation:");
  check("area accepts 4dp hectares", areaHectares.safeParse(12.3456).success);
  check("area rejects 5dp", !areaHectares.safeParse(12.34567).success);
  check("area rejects zero/negative", !areaHectares.safeParse(0).success);
  check("khasra accepts survey/subdivision", khasraNo.safeParse("347/8").success);
  check("khasra rejects free text", !khasraNo.safeParse("north field").success);

  const highwayUnderLarr = projectSchema.safeParse({
    name: "Some highway project", type: "HIGHWAY", governingAct: "LARR_2013",
    agencyId: "x", stateIds: ["s"], isPPP: false, isPrivateCompany: false, districtIds: [],
  });
  check(
    "highway under LARR 2013 is REJECTED",
    !highwayUnderLarr.success,
    "(highways use the NH Act 1956)",
  );
  const highwayUnderNh = projectSchema.safeParse({
    name: "Some highway project", type: "HIGHWAY", governingAct: "NH_ACT_1956",
    agencyId: "x", stateIds: ["s"], isPPP: false, isPrivateCompany: false, districtIds: [],
  });
  check("highway under NH Act 1956 is accepted", highwayUnderNh.success);

  const urgencyWithSia = proposalSchema.safeParse({
    projectId: "p", purpose: "Acquisition for a canal",
    publicInterestNote: "A sufficiently long public purpose statement for validation.",
    proposedAreaHectares: 10, requiresSIA: true, isUrgency: true,
  });
  check("urgency + SIA is rejected as contradictory", !urgencyWithSia.success);

  // ---- bulk import --------------------------------------------------------
  console.log("\nBulk parcel import:");
  const csv = [
    "khasraNo,villageLgdCode,declaredAreaHectares,landUse",
    "347/8,124649,1.2500,IRRIGATED",
    "348,124649,0.8000,DRY",
    "bad-khasra,124649,1.0,DRY",
    "349,124649,not-a-number,DRY",
    "347/8,124649,1.2500,IRRIGATED",
  ].join("\n");
  const imported = parseParcelCsv(csv);
  check("valid rows imported", imported.rows.length === 2, `${imported.rows.length} rows`);
  check("bad rows reported with line numbers", imported.errors.length === 2,
    imported.errors.map((e) => `line ${e.line}`).join(", "));
  check("duplicate khasra caught", imported.duplicates.length === 1,
    `line ${imported.duplicates[0]?.line}`);
  const missingCol = parseParcelCsv("khasraNo,villageLgdCode\n1,2");
  check("missing required column is reported", missingCol.errors.length === 1);

  // ---- workflow definitions ----------------------------------------------
  console.log("\nMulti-Act workflow:");
  const larr = definitionFor("LARR_2013");
  const nh = definitionFor("NH_ACT_1956");
  check("LARR 2013 definition loads", larr.stages.length >= 15, `${larr.stages.length} stages`);
  check("NH Act 1956 definition loads", nh.stages.length >= 12, `${nh.stages.length} stages`);
  check(
    "the two Acts differ at the notification stage",
    stageFor("LARR_2013", "SEC_11_PRELIM_NOTIFICATION")?.section === "s.11" &&
      stageFor("NH_ACT_1956", "SEC_11_PRELIM_NOTIFICATION")?.section === "s.3A",
    "LARR s.11 vs NH s.3A",
  );
  check(
    "LARR has an SIA stage; the NH Act does not",
    larr.stages.some((x) => x.status === "SIA_STUDY") &&
      !nh.stages.some((x) => x.status === "SIA_STUDY"),
  );
  check(
    "objection windows differ (60d LARR vs 21d NH)",
    stageFor("LARR_2013", "OBJECTIONS")?.statutoryDays === 60 &&
      stageFor("NH_ACT_1956", "OBJECTIONS")?.statutoryDays === 21,
  );
  check(
    "award breach is LAPSE under both Acts",
    stageFor("LARR_2013", "AWARD_DECLARED")?.onBreach === "LAPSE" &&
      stageFor("NH_ACT_1956", "AWARD_DECLARED")?.onBreach === "LAPSE",
  );

  // Cost-based escalation.
  const stateStage = stageFor("LARR_2013", "STATE_APPROVAL")!;
  check(
    "projects over ₹100cr escalate to the Central Ministry",
    routeTo(stateStage, { estimatedCostCrore: 4120 }) === "CENTRAL_MINISTRY",
  );
  check(
    "smaller projects stay with the State",
    routeTo(stateStage, { estimatedCostCrore: 40 }) === "STATE_GOVERNMENT",
  );

  // ---- the compliance clock ----------------------------------------------
  console.log("\nStatutory Compliance Clock:");
  const near = computeClock("LARR_2013", "AWARD_DECLARED", daysAgo(353));
  check("case 12 days from lapse is CRITICAL", near.severity === "CRITICAL",
    `${near.daysRemaining}d, ${near.severity}`);
  check("its message names the consequence", /LAPSES/.test(near.message));

  const breached = computeClock("LARR_2013", "AWARD_DECLARED", daysAgo(402));
  check("overdue case is BREACHED", breached.severity === "BREACHED",
    `${breached.daysRemaining}d`);
  check("breached message says the acquisition is void", /void|LAPSED/.test(breached.message));

  const healthy = computeClock("LARR_2013", "AWARD_DECLARED", daysAgo(10));
  check("fresh case is SAFE", healthy.severity === "SAFE", `${healthy.daysRemaining}d`);
  check("fatal deadlines escalate a band earlier",
    computeClock("LARR_2013", "AWARD_DECLARED", daysAgo(300)).severity === "URGENT",
    "65d out is already URGENT because breach = lapse");
  const noDeadline = computeClock("LARR_2013", "DRAFT", daysAgo(5));
  check("stages without a statutory limit report none", noDeadline.deadline === null);

  // ---- live transition ----------------------------------------------------
  console.log("\nLive transition against the database:");
  const draft = await prisma.proposal.findFirst({
    where: { status: "DRAFT" },
    include: { project: true },
  });
  const lrb = await prisma.user.findUnique({ where: { email: "nhai.officer@bhoominayan.gov.in" } });
  const collector = await prisma.user.findUnique({ where: { email: "collector.agra@bhoominayan.gov.in" } });

  if (!draft || !lrb || !collector) {
    check("seed data present for transition test", false, "run db:setup first");
  } else {
    const wrongRole = await transition({
      proposalId: draft.id, to: "SUBMITTED", action: "APPROVE",
      actorId: collector.id, actorRole: "DISTRICT_COLLECTOR",
    });
    check("a collector cannot submit someone else's draft",
      !wrongRole.ok && wrongRole.error === "ROLE_NOT_PERMITTED");

    const illegal = await transition({
      proposalId: draft.id, to: "AWARD_DECLARED", action: "APPROVE",
      actorId: lrb.id, actorRole: "LAND_REQUIRING_BODY",
    });
    check("cannot skip straight from DRAFT to AWARD",
      !illegal.ok && illegal.error === "ILLEGAL_TRANSITION");

    const ok = await transition({
      proposalId: draft.id, to: "SUBMITTED", action: "APPROVE",
      actorId: lrb.id, actorRole: "LAND_REQUIRING_BODY",
    });
    check("valid transition succeeds", ok.ok, `${ok.from} → ${ok.to}`);

    const noReasons = await transition({
      proposalId: draft.id, to: "REJECTED", action: "REJECT",
      actorId: lrb.id, actorRole: "LAND_REQUIRING_BODY",
    });
    check("rejection without written reasons is refused",
      !noReasons.ok && noReasons.error === "REMARKS_REQUIRED");

    const moved = await prisma.proposal.findUnique({ where: { id: draft.id } });
    check("status persisted", moved?.status === "SUBMITTED");

    const t = await allowedTransitions(draft.id, "LAND_REQUIRING_BODY");
    check("next steps are offered for the holder", (t?.targets.length ?? 0) > 0,
      t?.targets.join(", "));

    // Put it back so the demo data stays as seeded.
    await prisma.proposalStage.deleteMany({ where: { proposalId: draft.id, stage: "SUBMITTED" } });
    await prisma.proposal.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
    await prisma.proposalStage.updateMany({
      where: { proposalId: draft.id, stage: "DRAFT" },
      data: { exitedAt: null, action: null, remarks: null },
    });
  }

  // ---- reference numbers --------------------------------------------------
  console.log("\nReference numbers:");
  const district = await prisma.district.findFirst({
    where: { state: { lgdCode: "09" } },
    include: { state: true },
  });
  if (district) {
    const ref = await nextProposalReference(district.id);
    check("reference uses the official state code", /^LA\/UP\//.test(ref), ref);
    check("reference carries district, year and sequence",
      /^LA\/[A-Z]{2}\/[A-Z0-9]{2,3}\/\d{4}\/\d{4}$/.test(ref), ref);
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
