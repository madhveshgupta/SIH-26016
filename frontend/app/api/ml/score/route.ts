import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForProposal } from "@backend/rbac/scope";
import { scoreProposal } from "@backend/ml/scoring";
import { apiError, id } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Re-score one case against the current model. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "mlPrediction", "read")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const proposalId = id(body?.proposalId);
  if (!proposalId) return await apiJson({ error: "Choose a case to score" }, { status: 400 });
  // Scoped: a case outside the caller's jurisdiction is not theirs to score.
  if (!(await prisma.proposal.count({ where: { AND: [scopeForProposal(s), { id: proposalId }] } }))) {
    return await apiJson({ error: "Case not found" }, { status: 404 });
  }

  try {
    const result = await scoreProposal(proposalId);
    if (!result?.prediction) {
      return await apiJson(
        { error: "The prediction service is not reachable. No score has been recorded — a guessed risk figure is worse than none." },
        { status: 503 },
      );
    }
    return await apiJson({ ok: true, ...result.prediction });
  } catch (e) {
    const { status, error } = apiError(e, "score proposal");
    return await apiJson({ error }, { status });
  }
}
