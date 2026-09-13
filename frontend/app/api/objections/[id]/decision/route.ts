import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForOptionalParcel, scopeForProposal } from "@backend/rbac/scope";
import { disposeObjection } from "@backend/statutory/notifications";
import { apiError, id as cleanId, text } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

const OUTCOMES = ["ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED"] as const;

/** Decide an objection, with written reasons. Only the authority the Act names. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "objection", "approve")) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }
  const id = cleanId((await params).id);
  if (!id) return await apiJson({ error: "Objection not found" }, { status: 404 });
  // Case AND plot scope: a collector of one district of a multi-district
  // highway decides objections about land in their district only.
  const inScope = await prisma.objection.count({
    where: { AND: [{ id }, { proposal: scopeForProposal(s) }, scopeForOptionalParcel(s)] },
  });
  if (!inScope) return await apiJson({ error: "Objection not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const status = OUTCOMES.find((o) => o === body?.status);
  if (!status) return await apiJson({ error: "Choose accepted, partly accepted or rejected" }, { status: 400 });
  const decision = text(body?.decision, { max: 1000 });
  const reasons = text(body?.decisionReasons, { min: 20, max: 8000 });
  if (!decision) return await apiJson({ error: "Record the decision" }, { status: 400 });
  if (!reasons) {
    return await apiJson(
      { error: "Written reasons are required. An objection disposed without reasons is liable to be set aside on review." },
      { status: 400 },
    );
  }

  try {
    const o = await disposeObjection({
      objectionId: id,
      status,
      decision,
      decisionReasons: reasons,
      actorId: s.id,
      actorRole: s.role,
    });
    return await apiJson({ ok: true, status: o.status });
  } catch (e) {
    const { status: code, error } = apiError(e, "decide objection");
    return await apiJson({ error }, { status: code });
  }
}
