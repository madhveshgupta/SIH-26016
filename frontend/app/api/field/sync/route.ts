import { LIMITS, rateLimit } from "@backend/security/rate-limit";
import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { receiveSurvey, type SurveyInput } from "@backend/field/surveys";
import { apiError } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Receive everything a device queued while it was offline. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  const limit = rateLimit(`field-sync:${s.id}`, LIMITS.officerWrite);
  if (!limit.ok) {
    return await apiJson(
      { error: "That is faster than this can be done by hand. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  if (!can(s.role, "parcel", "update")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const surveys: SurveyInput[] = Array.isArray(body?.surveys) ? body.surveys.slice(0, 100) : [];
  if (surveys.length === 0) return await apiJson({ error: "Nothing to sync" }, { status: 400 });

  const stored: unknown[] = [];
  const rejected: { clientId: string; error: string }[] = [];
  for (const survey of surveys) {
    try {
      stored.push(await receiveSurvey(survey, s));
    } catch (e) {
      rejected.push({ clientId: String(survey?.clientId ?? "unknown"), error: (e as Error).message });
    }
  }

  try {
    return await apiJson({ ok: true, stored, rejected });
  } catch (e) {
    const { status, error } = apiError(e, "field sync");
    return await apiJson({ error }, { status });
  }
}
