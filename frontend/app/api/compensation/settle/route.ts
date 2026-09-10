import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { settleInstructedPayments } from "@backend/compensation/disbursement";
import { apiError } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Ask the payments gateway to confirm instructions still in flight. */
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "payment", "update")) return await apiJson({ error: "Not permitted" }, { status: 403 });
  try {
    // Inside a project workspace the button speaks for that project only.
    const body = (await request.json().catch(() => null)) as { projectId?: unknown } | null;
    const projectId = typeof body?.projectId === "string" && body.projectId ? body.projectId : undefined;
    return await apiJson({ ok: true, ...(await settleInstructedPayments(s, 25, projectId)) });
  } catch (e) {
    const { status, error } = apiError(e, "settle payments");
    return await apiJson({ error }, { status });
  }
}
