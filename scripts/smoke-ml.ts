/** The prediction service and the scores it produces. */
import { prisma } from "@backend/db/client";
import { mlServiceHealth, modelCard, predictCase, simulatePolicy, type CaseFeatures } from "@backend/ml/client";
import { featuresFor, scoreProposal, storedPredictions } from "@backend/ml/scoring";
import type { Actor } from "@backend/rbac/scope";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? `  ${d}` : ""}`);
  if (ok) pass++;
  else fail++;
};

const BASE_CASE: CaseFeatures = {
  project_type: "HIGHWAY", act: "NH_ACT_1956", parcels: 40, area_ha: 25, owners: 60,
  is_urban: 0, circle_rate_per_ha: 2_000_000, multiplier_factor: 1.5, consent_pct: 75,
  objections: 1, digitised: 1,
};

async function main() {
  console.log("\nML SMOKE TEST\n======================================================");
  const health = await mlServiceHealth();
  if (!health.ok) {
    console.log("\n  The prediction service is not running. Start it with: npm run ml:serve\n");
    process.exitCode = 1;
    return;
  }
  check("the service reports a model version", Boolean(health.modelVersion), `${health.modelVersion}`);
  check("it was trained on a real number of cases", health.rows >= 10_000, `${health.rows.toLocaleString("en-IN")} cases`);

  console.log("\nThe model card is honest:");
  const card = await modelCard();
  check("the card loads", card !== null);
  if (card) {
    check("it names every model", ["delay_risk", "delay_days", "compensation_per_ha", "litigation_risk", "anomaly"].every((m) => m in card.models));
    const delay = card.models.delay_risk as { auc: number; accuracy: number };
    check("delay risk beats a coin toss", delay.auc > 0.7, `AUC ${delay.auc}`);
    check("it does not claim to be perfect", delay.auc < 0.999 && delay.accuracy < 0.999, `AUC ${delay.auc}, accuracy ${delay.accuracy}`);
    const comp = card.models.compensation_per_ha as { mape_pct: number };
    check("the compensation error is reported as a percentage", comp.mape_pct > 0 && comp.mape_pct < 60, `MAPE ${comp.mape_pct}%`);
    check("the card says the data is synthetic and why", card.dataset.source.includes("synthetic") && card.dataset.why_synthetic.includes("DPDP"));
    check("every calibration source is cited", card.dataset.calibration.length >= 4 && card.dataset.calibration.some((c) => c.includes("CAG")));
  }

  console.log("\nPredictions respond to the facts:");
  const calm = await predictCase(BASE_CASE);
  check("a straightforward case scores", calm !== null && calm.delayRisk >= 0 && calm.delayRisk <= 1, `${Math.round((calm?.delayRisk ?? 0) * 100)}% risk`);
  const contested = await predictCase({ ...BASE_CASE, objections: 30, consent_pct: 40 });
  check("objections and low consent raise the risk", (contested?.delayRisk ?? 0) > (calm?.delayRisk ?? 1),
    `${Math.round((calm?.delayRisk ?? 0) * 100)}% → ${Math.round((contested?.delayRisk ?? 0) * 100)}%`);
  const big = await predictCase({ ...BASE_CASE, parcels: 800, owners: 1600, area_ha: 400 });
  check("a much larger case is riskier than a small one", (big?.delayRisk ?? 0) > (calm?.delayRisk ?? 1),
    `${Math.round((big?.delayRisk ?? 0) * 100)}%`);
  const rich = await predictCase({ ...BASE_CASE, circle_rate_per_ha: 9_000_000 });
  check("a higher circle rate predicts higher compensation", (rich?.compensationPerHa ?? 0) > (calm?.compensationPerHa ?? 0),
    `${Math.round((calm?.compensationPerHa ?? 0) / 1e5) / 10} → ${Math.round((rich?.compensationPerHa ?? 0) / 1e5) / 10} lakh/ha`);

  console.log("\nExplanations:");
  check("a score comes with its factors", (contested?.factors.length ?? 0) > 0, `${contested?.factors.length} factors`);
  check("the factors name the real drivers", contested?.factors.some((f) => f.humanLabel.includes("objection")) ?? false,
    contested?.factors.map((f) => f.humanLabel).join(", "));
  check("each factor says which way it pushed", contested?.factors.every((f) => f.direction === "raises" || f.direction === "lowers") ?? false);
  check("contributions are in plain units", contested?.factors.every((f) => Math.abs(f.contribution) <= 1) ?? false);

  console.log("\nScoring a real case:");
  const proposal = await prisma.proposal.findFirstOrThrow({
    where: { status: { notIn: ["CLOSED", "REJECTED", "LAPSED"] }, parcels: { some: {} } },
    select: { id: true, referenceNo: true },
  });
  const features = await featuresFor(proposal.id);
  check("features are read off the live case", (features?.features.parcels ?? 0) > 0, `${features?.features.parcels} plots`);
  const scored = await scoreProposal(proposal.id);
  check("the score is stored", scored?.prediction !== null);
  const stored = await prisma.mLPrediction.findMany({ where: { proposalId: proposal.id } });
  check("one row per model", stored.length === 4, `${stored.length} rows`);
  check("each row records the model version", stored.every((r) => r.modelVersion.length > 0));
  const explained = stored.find((r) => r.modelType === "DELAY_RISK");
  check("the stored delay score keeps its explanation", Array.isArray(explained?.explanation));

  const before = Number(explained?.score ?? 0);
  // Filing objections must move the number — otherwise the badge is decorative.
  const parcel = await prisma.landParcel.findFirst({ where: { proposalId: proposal.id }, select: { id: true } });
  const added = await prisma.objection.createManyAndReturn({
    data: Array.from({ length: 12 }, (_, i) => ({
      proposalId: proposal.id, parcelId: parcel?.id ?? null,
      objectorName: `ML smoke objector ${i}`, grounds: "Filed by the ML smoke test to prove the risk score responds to the facts.",
    })),
    select: { id: true },
  });
  const rescored = await scoreProposal(proposal.id);
  const after = rescored?.prediction?.delayRisk ?? 0;
  check("filing objections raises the stored risk", after > before, `${Math.round(before * 100)}% → ${Math.round(after * 100)}%`);
  await prisma.objection.deleteMany({ where: { id: { in: added.map((a) => a.id) } } });
  await scoreProposal(proposal.id);

  console.log("\nThe simulator:");
  const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@bhoominayan.gov.in" }, include: { role: true } });
  const actor: Actor = { id: admin.id, role: admin.role.type, jurisdictionLevel: admin.jurisdictionLevel, stateId: null, districtId: null, tehsilId: null, agencyId: null };
  const portfolio = (await Promise.all(
    (await prisma.proposal.findMany({ where: { status: { notIn: ["CLOSED", "REJECTED", "LAPSED"] } }, take: 10, select: { id: true } }))
      .map(async (p) => (await featuresFor(p.id))?.features),
  )).filter(Boolean) as CaseFeatures[];

  const baseline = await simulatePolicy({ cases: portfolio });
  const generous = await simulatePolicy({ cases: portfolio, multiplierFactor: 2.0, solatiumPct: 150 });
  check("a simulation returns a portfolio figure", (baseline?.compensation.simulated ?? 0) > 0, `${Math.round((baseline?.compensation.simulated ?? 0) / 1e7)} crore`);
  check("raising the multiplier and solatium raises the outlay",
    (generous?.compensation.simulated ?? 0) > (baseline?.compensation.simulated ?? 0),
    `${generous?.compensation.changePct}% against today`);
  const mean = await simulatePolicy({ cases: portfolio, solatiumPct: 0 });
  check("removing the solatium lowers it", (mean?.compensation.simulated ?? 1e18) < (baseline?.compensation.simulated ?? 0));
  const sla = await simulatePolicy({ cases: portfolio, slaDays: 365 });
  check("a tighter deadline reports a breach share", sla?.slaBreachShare !== null && sla?.slaBreachShare !== undefined);

  console.log("\nStored predictions are scoped:");
  const nationalRows = await storedPredictions(actor, 200);
  check("a national officer sees scored cases", nationalRows.length > 0, `${nationalRows.length} cases`);
  check("they are ordered by risk", nationalRows.every((r, i, a) => i === 0 || (a[i - 1].delayRisk ?? -1) >= (r.delayRisk ?? -1)));
  const collectorUser = await prisma.user.findFirstOrThrow({ where: { email: "collector.agra@bhoominayan.gov.in" }, include: { role: true } });
  const collector: Actor = { id: collectorUser.id, role: collectorUser.role.type, jurisdictionLevel: collectorUser.jurisdictionLevel, stateId: collectorUser.stateId, districtId: collectorUser.districtId, tehsilId: collectorUser.tehsilId, agencyId: collectorUser.agencyId };
  check("a collector sees fewer", (await storedPredictions(collector, 200)).length < nationalRows.length);

  console.log("\n======================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
