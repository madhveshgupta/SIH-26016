/** Loading a case for Saarthi. */
import type { AcquisitionAct, ProposalStatus, RoleType } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { scopeForProposal, type Actor } from "@backend/rbac/scope";
import { diagnose } from "./engine";
import type { CaseSnapshot, Diagnosis } from "./types";

export * from "./types";
export { diagnose, attribute, accountability, findCauses, planRecovery, prescribe } from "./engine";

/** Cases whose geometry is only a bounding box have not really been surveyed. */
const SURVEYED_KINDS = ["SURVEYED", "TRACED", "OSM_FIELD"];

/** Payment states that actually put money in the landowner's hands. */
const SETTLED = ["PAID", "DEPOSITED_WITH_AUTHORITY"];

/** How long this stage normally takes, learned from the system's own history. */
export async function stageBenchmarks(
  act: AcquisitionAct,
  excludeProposalId?: string,
): Promise<CaseSnapshot["benchmark"]> {
  const hops = await prisma.proposalStage.findMany({
    where: {
      exitedAt: { not: null },
      proposalId: excludeProposalId ? { not: excludeProposalId } : undefined,
      proposal: { project: { governingAct: act } },
    },
    select: { stage: true, enteredAt: true, exitedAt: true },
  });

  const byStage = new Map<ProposalStatus, number[]>();
  for (const h of hops) {
    if (!h.exitedAt) continue;
    const held = Math.max(0, Math.round((h.exitedAt.getTime() - h.enteredAt.getTime()) / 86_400_000));
    const list = byStage.get(h.stage) ?? [];
    list.push(held);
    byStage.set(h.stage, list);
  }

  const out: CaseSnapshot["benchmark"] = {};
  for (const [stage, list] of byStage) {
    list.sort((a, b) => a - b);
    out[stage] = { medianDays: list[Math.floor(list.length / 2)], sampleSize: list.length };
  }
  return out;
}

/** Is anyone actually posted to this desk for this case? */
async function staffOnDesk(
  role: RoleType | null,
  stateIds: string[],
  districtIds: string[],
): Promise<number | null> {
  if (!role) return null;
  return prisma.user.count({
    where: {
      isActive: true,
      role: { type: role },
      OR: [
        { jurisdictionLevel: "NATIONAL" },
        ...(stateIds.length ? [{ stateId: { in: stateIds } }] : []),
        ...(districtIds.length ? [{ districtId: { in: districtIds } }] : []),
      ],
    },
  });
}

/** Read one case into the shape the engine expects. Null when out of scope. */
export async function snapshotFor(proposalId: string, actor: Actor): Promise<CaseSnapshot | null> {
  const proposal = await prisma.proposal.findFirst({
    where: { AND: [{ id: proposalId }, scopeForProposal(actor)] },
    select: {
      id: true,
      referenceNo: true,
      status: true,
      createdAt: true,
      currentHolderRole: true,
      isUrgency: true,
      project: {
        select: {
          name: true,
          governingAct: true,
          isPPP: true,
          isPrivateCompany: true,
          states: { select: { stateId: true } },
          districts: { select: { districtId: true } },
        },
      },
      stages: {
        orderBy: { enteredAt: "asc" },
        select: {
          stage: true,
          enteredAt: true,
          exitedAt: true,
          actorRole: true,
          action: true,
          remarks: true,
          slaDays: true,
          statutoryDeadline: true,
          actor: { select: { fullName: true } },
        },
      },
      objections: { select: { status: true, filedAt: true, hearingDate: true, decidedAt: true } },
      consents: { select: { status: true } },
      notifications: {
        select: {
          type: true,
          issuedOn: true,
          publishedGazette: true,
          publishedNewspaper1: true,
          publishedNewspaper2: true,
          publishedLocalLang: true,
        },
      },
      parcels: { select: { id: true, geometryKind: true, districtId: true } },
      predictions: { orderBy: { scoredAt: "desc" }, select: { modelType: true, modelVersion: true, score: true, predictedValue: true, explanation: true } },
    },
  });
  if (!proposal) return null;

  const parcelIds = proposal.parcels.map((p) => p.id);
  const stateIds = proposal.project.states.map((s) => s.stateId);
  const districtIds = [
    ...new Set([...proposal.project.districts.map((d) => d.districtId), ...proposal.parcels.map((p) => p.districtId)]),
  ];

  const [records, lastAudit, holderStaffCount, benchmark] = await Promise.all([
    parcelIds.length
      ? prisma.compensationRecord.findMany({
          where: { parcelId: { in: parcelIds } },
          select: {
            payableToOwner: true,
            owner: { select: { id: true, bankAccountMasked: true } },
            payments: { select: { status: true, amount: true } },
          },
        })
      : Promise.resolve([]),
    prisma.auditLog.findFirst({
      where: { entityType: "Proposal", entityId: proposal.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    staffOnDesk(proposal.currentHolderRole, stateIds, districtIds),
    stageBenchmarks(proposal.project.governingAct, proposal.id),
  ]);

  let assessed = 0;
  let paid = 0;
  const unpaidOwners = new Set<string>();
  const unreachableOwners = new Set<string>();
  for (const r of records) {
    const due = Number(r.payableToOwner);
    const settled = r.payments
      .filter((p) => SETTLED.includes(p.status))
      .reduce((a, p) => a + Number(p.amount), 0);
    assessed += due;
    paid += settled;
    if (settled < due) {
      unpaidOwners.add(r.owner.id);
      if (!r.owner.bankAccountMasked) unreachableOwners.add(r.owner.id);
    }
  }

  const delay = proposal.predictions.find((p) => p.modelType === "DELAY_RISK");
  const delayRisk = delay ? Number(delay.score) : null;

  return {
    referenceNo: proposal.referenceNo,
    projectName: proposal.project.name,
    act: proposal.project.governingAct,
    status: proposal.status,
    createdAt: proposal.createdAt,
    currentHolderRole: proposal.currentHolderRole,
    isUrgency: proposal.isUrgency,
    isPPP: proposal.project.isPPP,
    isPrivateCompany: proposal.project.isPrivateCompany,
    hops: proposal.stages.map((s) => ({
      stage: s.stage,
      enteredAt: s.enteredAt,
      exitedAt: s.exitedAt,
      actorRole: s.actorRole,
      actorName: s.actor?.fullName ?? null,
      action: s.action,
      remarks: s.remarks,
      slaDays: s.slaDays,
      statutoryDeadline: s.statutoryDeadline,
    })),
    objections: proposal.objections,
    consents: proposal.consents,
    parcels: proposal.parcels.map((p) => ({ hasBoundary: SURVEYED_KINDS.includes(p.geometryKind) })),
    notifications: proposal.notifications,
    compensation: {
      assessed,
      paid,
      ownerCount: new Set(records.map((r) => r.owner.id)).size,
      unpaidOwnerCount: unpaidOwners.size,
      unreachableOwnerCount: unreachableOwners.size,
    },
    lastActivityAt: lastAudit?.createdAt ?? null,
    holderStaffCount,
    benchmark,
    prediction:
      delay && delayRisk !== null
        ? {
            band: delayRisk >= 0.66 ? "HIGH" : delayRisk >= 0.33 ? "MEDIUM" : "LOW",
            delayRisk,
            expectedDelayDays: delay.predictedValue ? Math.round(Number(delay.predictedValue)) : 0,
            modelVersion: delay.modelVersion,
            topFactors: ((delay.explanation ?? []) as unknown as {
              humanLabel: string;
              direction: "raises" | "lowers" | "neutral";
              contribution: number;
            }[])
              .slice()
              .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
              .map((f) => ({ humanLabel: f.humanLabel, direction: f.direction })),
          }
        : null,
  };
}

/** Diagnose one case. Null when the actor may not see it. */
export async function diagnoseProposal(
  proposalId: string,
  actor: Actor,
  now: Date = new Date(),
): Promise<Diagnosis | null> {
  const snapshot = await snapshotFor(proposalId, actor);
  return snapshot ? diagnose(snapshot, now) : null;
}
