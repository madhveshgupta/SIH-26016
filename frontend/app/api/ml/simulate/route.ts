import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForProposal } from "@backend/rbac/scope";
import { featuresFor } from "@backend/ml/scoring";
import { simulatePolicy } from "@backend/ml/client";
import { apiError, num } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/**
 * The what-if simulator: move a policy lever, see what it does to the cases
 * in the caller's own jurisdiction.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "mlPrediction", "read")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const multiplierFactor = body?.multiplierFactor == null ? undefined : num(body.multiplierFactor, { min: 1, max: 2 }) ?? undefined;
  const solatiumPct = body?.solatiumPct == null ? undefined : num(body.solatiumPct, { min: 0, max: 200 }) ?? undefined;
  const slaDays = body?.slaDays == null ? undefined : num(body.slaDays, { min: 30, max: 1095, int: true }) ?? undefined;
  const consentThresholdPct = body?.consentThresholdPct == null ? undefined : num(body.consentThresholdPct, { min: 0, max: 100 }) ?? undefined;

  try {
    // Up to 60 open cases: enough for a representative portfolio, small enough
    // that a slider feels instant.
    const proposals = await prisma.proposal.findMany({
      where: { AND: [scopeForProposal(s), { status: { notIn: ["CLOSED", "REJECTED", "LAPSED"] } }] },
      select: { id: true },
      take: 60,
    });
    const cases = (await Promise.all(proposals.map(async (p) => (await featuresFor(p.id))?.features))).filter(Boolean);
    if (cases.length === 0) return await apiJson({ error: "No open cases in your jurisdiction to simulate" }, { status: 400 });

    const result = await simulatePolicy({
      cases: cases as NonNullable<(typeof cases)[number]>[],
      multiplierFactor, solatiumPct, slaDays, consentThresholdPct,
    });
    if (!result) {
      return await apiJson({ error: "The prediction service is not reachable." }, { status: 503 });
    }
    return await apiJson({ ok: true, ...result });
  } catch (e) {
    const { status, error } = apiError(e, "policy simulation");
    return await apiJson({ error }, { status });
  }
}
