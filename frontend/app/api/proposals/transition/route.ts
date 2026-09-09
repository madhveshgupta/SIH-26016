import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { transition } from "@backend/workflow/engine";
import type { ProposalStatus } from "@prisma/client";
import { apiJson } from "@backend/http/respond";

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "proposal", "approve") && !can(s.role, "proposal", "update")) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.proposalId || !body?.to || !body?.action) {
    return await apiJson({ error: "proposalId, to and action are required" }, { status: 400 });
  }

  const result = await transition({
    proposalId: String(body.proposalId),
    to: String(body.to) as ProposalStatus,
    action: body.action,
    actorId: s.id,
    actorRole: s.role,
    remarks: body.remarks ? String(body.remarks) : undefined,
    checklist: body.checklist,
  });

  if (!result.ok) {
    const status =
      result.error === "ROLE_NOT_PERMITTED" ? 403 :
      result.error === "PROPOSAL_NOT_FOUND" ? 404 : 400;
    return await apiJson({ error: result.message ?? result.error }, { status });
  }
  return await apiJson(result);
}
