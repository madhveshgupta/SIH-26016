import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { verifyChain } from "@backend/audit/chain";
import { apiJson } from "@backend/http/respond";

export async function GET() {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "auditLog", "read")) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }
  const result = await verifyChain();
  return await apiJson({
    ...result,
    brokenAtSequence: result.brokenAtSequence?.toString() ?? null,
  });
}
