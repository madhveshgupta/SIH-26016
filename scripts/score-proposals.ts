/** Score every open case and store the results. */
import { prisma } from "@backend/db/client";
import { mlServiceHealth } from "@backend/ml/client";
import { scoreProposal } from "@backend/ml/scoring";

async function main() {
  const health = await mlServiceHealth();
  if (!health.ok) {
    console.error("The prediction service is not reachable at " + (process.env.ML_SERVICE_URL ?? "http://localhost:8000"));
    console.error("Start it with:  npm run ml:serve");
    process.exit(1);
  }
  console.log(`Prediction service up — model ${health.modelVersion}, trained on ${health.rows.toLocaleString("en-IN")} cases\n`);

  const proposals = await prisma.proposal.findMany({
    where: { status: { notIn: ["CLOSED", "REJECTED", "LAPSED"] } },
    select: { id: true },
  });

  let scored = 0, failed = 0, high = 0;
  for (const p of proposals) {
    const result = await scoreProposal(p.id);
    if (!result?.prediction) {
      failed++;
      continue;
    }
    scored++;
    if (result.prediction.delayRiskBand === "HIGH") high++;
  }

  console.log(`scored ${scored} of ${proposals.length} open cases (${failed} failed)`);
  console.log(`  ${high} at HIGH risk of missing a statutory deadline`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
