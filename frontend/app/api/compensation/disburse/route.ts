import { LIMITS, rateLimit } from "@backend/security/rate-limit";
import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { disburse } from "@backend/compensation/disbursement";
import { apiError, id, text } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Instruct payment of one compensation record, or deposit it under s.77. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  const limit = rateLimit(`disburse:${s.id}`, LIMITS.officerWrite);
  if (!limit.ok) {
    return await apiJson(
      { error: "That is faster than this can be done by hand. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  // Approving a disbursement is not the same as being able to read one.
  if (!can(s.role, "payment", "approve")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const compensationId = id(body?.compensationId);
  if (!compensationId) return await apiJson({ error: "Choose the compensation record to pay" }, { status: 400 });
  const deposit = body?.depositWithAuthority === true;
  const reason = deposit ? text(body?.depositReason, { min: 10, max: 1000 }) : null;
  if (deposit && !reason) {
    return await apiJson({ error: "State why the amount cannot be paid to the person (s.77 requires a reason)" }, { status: 400 });
  }

  try {
    const result = await disburse({ compensationId, actor: s, depositWithAuthority: deposit, depositReason: reason ?? undefined });
    return await apiJson({ ok: true, ...result });
  } catch (e) {
    const { status, error } = apiError(e, "disburse compensation");
    return await apiJson({ error }, { status });
  }
}
