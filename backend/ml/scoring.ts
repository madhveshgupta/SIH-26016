/** Turning a live case into a prediction, and storing the result. */
import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { predictCase, type CaseFeatures, type CasePrediction } from "@backend/ml/client";
import { scopeForProposal, type Actor } from "@backend/rbac/scope";

export interface ScoredProposal {
  proposalId: string;
  referenceNo: string;
  project: string;
  features: CaseFeatures;
  prediction: CasePrediction | null;
}

/** Read the model's features off a live case. */
export async function featuresFor(proposalId: string): Promise<{ features: CaseFeatures; referenceNo: string; project: string } | null> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: {
      referenceNo: true,
      project: { select: { name: true, type: true, governingAct: true } },
      _count: { select: { objections: true } },
      consents: { select: { status: true } },
      parcels: {
        select: {
          declaredAreaHectares: true,
          district: { select: { circleRatePerHectare: true, multiplierFactor: true, isUrban: true } },
          owners: { select: { ownerId: true } },
        },
      },
    },
  });
  if (!proposal) return null;

  const parcels = proposal.parcels;
  const owners = new Set(parcels.flatMap((p) => p.owners.map((o) => o.ownerId)));
  const area = parcels.reduce((a, p) => a + Number(p.declaredAreaHectares), 0);
  const rates = parcels.map((p) => Number(p.district.circleRatePerHectare ?? 0)).filter((r) => r > 0);
  const granted = proposal.consents.filter((c) => c.status === "GRANTED").length;

  return {
    referenceNo: proposal.referenceNo,
    project: proposal.project.name,
    features: {
      project_type: proposal.project.type,
      act: proposal.project.governingAct,
      parcels: parcels.length,
      area_ha: Number(area.toFixed(4)),
      owners: owners.size,
      is_urban: parcels.some((p) => p.district.isUrban) ? 1 : 0,
      // The median circle rate across the districts the case touches.
      circle_rate_per_ha: rates.length ? rates.sort((a, b) => a - b)[Math.floor(rates.length / 2)] : 1_000_000,
      multiplier_factor: parcels.length ? Number(parcels[0].district.multiplierFactor) : 1.5,
      // No consent record means consent was not required for this project.
      consent_pct: proposal.consents.length ? Math.round((granted / proposal.consents.length) * 100) : 75,
      objections: proposal._count.objections,
      // Every case in this system is handled digitally — that is the point of it.
      digitised: 1,
    },
  };
}

/** Score one case and store the result, if the service answers. */
export async function scoreProposal(proposalId: string): Promise<ScoredProposal | null> {
  const loaded = await featuresFor(proposalId);
  if (!loaded) return null;
  const prediction = await predictCase(loaded.features);

  if (prediction) {
    const rows: Prisma.MLPredictionCreateManyInput[] = [
      {
        modelType: "DELAY_RISK", modelVersion: prediction.modelVersion, proposalId,
        score: new Prisma.Decimal(prediction.delayRisk),
        predictedValue: new Prisma.Decimal(prediction.expectedDelayDays),
        explanation: prediction.factors as unknown as Prisma.InputJsonValue,
      },
      {
        modelType: "COMPENSATION_ESTIMATE", modelVersion: prediction.modelVersion, proposalId,
        score: new Prisma.Decimal(0),
        predictedValue: new Prisma.Decimal(prediction.compensationPerHa.toFixed(2)),
      },
      {
        modelType: "LITIGATION_RISK", modelVersion: prediction.modelVersion, proposalId,
        score: new Prisma.Decimal(prediction.litigationRisk),
      },
      {
        modelType: "ANOMALY", modelVersion: prediction.modelVersion, proposalId,
        score: new Prisma.Decimal(prediction.anomalyScore.toFixed(5)),
        predictedValue: new Prisma.Decimal(prediction.isAnomaly ? 1 : 0),
      },
    ];
    // One current score per model per case: replace rather than accumulate.
    await prisma.mLPrediction.deleteMany({ where: { proposalId } });
    await prisma.mLPrediction.createMany({ data: rows });
  }

  return { proposalId, referenceNo: loaded.referenceNo, project: loaded.project, features: loaded.features, prediction };
}

/** The stored scores for the cases an officer may see. */
export async function storedPredictions(actor: Actor, limit = 100) {
  const proposals = await prisma.proposal.findMany({
    where: { AND: [scopeForProposal(actor), { status: { notIn: ["CLOSED", "REJECTED", "LAPSED"] } }] },
    select: {
      id: true, referenceNo: true, status: true,
      project: { select: { name: true, type: true } },
      _count: { select: { parcels: true, objections: true } },
      predictions: { orderBy: { scoredAt: "desc" } },
    },
    take: limit,
  });

  return proposals
    .map((p) => {
      const by = (type: string) => p.predictions.find((x) => x.modelType === type);
      const delay = by("DELAY_RISK");
      return {
        id: p.id,
        referenceNo: p.referenceNo,
        project: p.project.name,
        status: p.status,
        parcels: p._count.parcels,
        objections: p._count.objections,
        scoredAt: delay?.scoredAt ?? null,
        modelVersion: delay?.modelVersion ?? null,
        delayRisk: delay ? Number(delay.score) : null,
        expectedDelayDays: delay?.predictedValue ? Number(delay.predictedValue) : null,
        litigationRisk: by("LITIGATION_RISK") ? Number(by("LITIGATION_RISK")!.score) : null,
        compensationPerHa: by("COMPENSATION_ESTIMATE")?.predictedValue ? Number(by("COMPENSATION_ESTIMATE")!.predictedValue) : null,
        isAnomaly: by("ANOMALY")?.predictedValue ? Number(by("ANOMALY")!.predictedValue) === 1 : false,
        factors: (delay?.explanation ?? []) as unknown as { humanLabel: string; contribution: number; direction: string; value: number; typicalValue: number }[],
      };
    })
    .sort((a, b) => (b.delayRisk ?? -1) - (a.delayRisk ?? -1));
}
