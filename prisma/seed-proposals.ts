/**
 * Demo proposals, deliberately spread across the workflow — including cases that are already
 * near or past their statutory deadline.
 */
import { PrismaClient, Prisma, type ProposalStatus } from "@prisma/client";
import { definitionFor, stageFor } from "../backend/workflow/engine";
import { NATIONAL_PROJECTS } from "./data/national-projects";
import { appendAudit } from "../backend/audit/chain";
import { nextProposalReference } from "../backend/proposals/reference";

const prisma = new PrismaClient();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

interface Spec {
  projectRef: string;
  districtLgd: string; // "stateLgd:districtLgd"
  status: ProposalStatus;
  /** How long ago the case entered its current stage. */
  enteredDaysAgo: number;
  areaHa: number;
  purpose: string;
  publicInterest: string;
  requiresSIA?: boolean;
  isUrgency?: boolean;
}

/** One case per registry project, plus two extra cases that exercise edge states. */
const SPECS: Spec[] = [
  ...NATIONAL_PROJECTS.map((p) => ({
    projectRef: p.ref,
    districtLgd: `${p.stateLgd}:${p.district.lgdCode}`,
    status: p.proposal.status,
    enteredDaysAgo: p.proposal.enteredDaysAgo,
    areaHa: p.estAreaHa,
    purpose: p.proposal.purpose,
    publicInterest: p.proposal.publicInterest,
  })),
  {
    projectRef: "PRJ/MORTH/2026/0003",
    districtLgd: "09:146",
    status: "SEC_19_DECLARATION",
    enteredDaysAgo: 120,
    areaHa: 96.4,
    purpose: "Additional land for the Agra Ring Road service road and interchange.",
    publicInterest:
      "Service roads separate local traffic from high-speed through traffic, which is a safety requirement for access-controlled highways.",
  },
  {
    projectRef: "PRJ/MOJS/2026/0002",
    districtLgd: "09:180",
    status: "DRAFT",
    enteredDaysAgo: 4,
    areaHa: 212.75,
    purpose: "Acquisition for the Kanhar distributary network, reach 3.",
    publicInterest:
      "Distributary channels carry water from the main canal to field outlets; without them the main canal delivers no benefit to farmers.",
  },
];

async function main() {
  console.log("Seeding demo proposals…\n");

  const lrb = await prisma.user.findUnique({ where: { email: "nhai.officer@bhoominayan.gov.in" } });
  if (!lrb) throw new Error("Run `npm run db:seed:users` first.");

  const districts = await prisma.district.findMany({
    include: { state: { select: { lgdCode: true } } },
  });
  const districtBy = new Map(districts.map((d) => [`${d.state.lgdCode}:${d.lgdCode}`, d]));

  let made = 0;
  for (const spec of SPECS) {
    const project = await prisma.project.findUnique({ where: { referenceNo: spec.projectRef } });
    if (!project) {
      console.warn(`  skip — project ${spec.projectRef} not seeded`);
      continue;
    }
    const district = districtBy.get(spec.districtLgd);
    if (!district) {
      console.warn(`  skip — district ${spec.districtLgd} not seeded`);
      continue;
    }

    const referenceNo = await nextProposalReference(district.id);
    const enteredAt = daysAgo(spec.enteredDaysAgo);
    const stage = stageFor(project.governingAct, spec.status);
    const statutoryDeadline = stage?.statutoryDays
      ? new Date(enteredAt.getTime() + stage.statutoryDays * 86_400_000)
      : null;

    const proposal = await prisma.proposal.create({
      data: {
        referenceNo,
        projectId: project.id,
        status: spec.status,
        purpose: spec.purpose,
        publicInterestNote: spec.publicInterest,
        proposedAreaHectares: new Prisma.Decimal(spec.areaHa),
        requiresSIA: spec.requiresSIA ?? project.governingAct === "LARR_2013",
        isUrgency: spec.isUrgency ?? false,
        createdById: lrb.id,
        currentHolderRole: stage?.actors[0] ?? null,
        submittedAt: spec.status === "DRAFT" ? null : daysAgo(spec.enteredDaysAgo + 30),
        createdAt: daysAgo(spec.enteredDaysAgo + 45),
      },
    });

    // The path already travelled: every earlier stage on this Act's chain, with how long it was
    // held.
    const chain = definitionFor(project.governingAct).stages.map((st) => st.status);
    const upTo = chain.indexOf(spec.status);
    let cursor = enteredAt.getTime();
    const history: { stage: ProposalStatus; enteredAt: Date; exitedAt: Date }[] = [];
    for (let i = upTo - 1; i >= 1; i--) {
      const st = stageFor(project.governingAct, chain[i]);
      // Held for roughly its SLA, stretched on some stages — the delays CAG records.
      const seed = (referenceNo.charCodeAt(referenceNo.length - 1) + i * 7) % 10;
      const held = Math.max(3, Math.round((st?.slaDays ?? 20) * (0.6 + seed / 6)));
      const exitedAt = new Date(cursor);
      cursor -= held * 86_400_000;
      history.unshift({ stage: chain[i], enteredAt: new Date(cursor), exitedAt });
    }
    for (const h of history) {
      const st = stageFor(project.governingAct, h.stage);
      await prisma.proposalStage.create({
        data: {
          proposalId: proposal.id,
          stage: h.stage,
          actorRole: st?.actors[0] ?? null,
          action: "APPROVE",
          remarks: "Recorded in the seed history.",
          enteredAt: h.enteredAt,
          exitedAt: h.exitedAt,
          slaDays: st?.slaDays ?? null,
        },
      });
    }
    if (history.length) {
      await prisma.proposal.update({ where: { id: proposal.id }, data: { createdAt: new Date(cursor - 5 * 86_400_000), submittedAt: history[0].enteredAt } });
    }

    // The open stage, so the clock has something real to count from.
    await prisma.proposalStage.create({
      data: {
        proposalId: proposal.id,
        stage: spec.status,
        actorRole: stage?.actors[0] ?? null,
        enteredAt,
        slaDays: stage?.slaDays ?? null,
        statutoryDeadline,
      },
    });

    await appendAudit({
      actorId: lrb.id,
      action: "CREATE",
      entityType: "Proposal",
      entityId: proposal.id,
      afterJson: { referenceNo, status: spec.status },
    });

    const days = statutoryDeadline
      ? Math.floor((statutoryDeadline.getTime() - Date.now()) / 86_400_000)
      : null;
    const flag =
      days === null ? "" : days < 0 ? `  ⚠ BREACHED ${Math.abs(days)}d ago` : `  ${days}d to deadline`;
    console.log(`  ${referenceNo.padEnd(24)} ${spec.status.padEnd(28)}${flag}`);
    made++;
  }

  console.log(`\n${made} proposals seeded across the workflow.`);
  console.log("Includes one case 12 days from statutory lapse and one already breached.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
