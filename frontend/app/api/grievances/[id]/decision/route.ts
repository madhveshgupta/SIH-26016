import type { GrievanceStatus } from "@prisma/client";
import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { LIMITS, rateLimit } from "@backend/security/rate-limit";
import { scopeForOptionalParcel } from "@backend/rbac/scope";
import { disposeGrievance } from "@backend/grievances/dispose";
import { apiError, id as cleanId, text } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

const OUTCOMES: GrievanceStatus[] = [
  "ACKNOWLEDGED", "UNDER_EXAMINATION", "REFERRED", "RESOLVED", "REJECTED",
];

/** Move a grievance on, or close it with written reasons. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "grievance", "approve")) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }
  const limit = rateLimit(`grievance-decision:${s.id}`, LIMITS.officerWrite);
  if (!limit.ok) {
    return await apiJson({ error: "Too many requests. Wait a moment." }, {
      status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const id = cleanId((await params).id);
  if (!id) return await apiJson({ error: "Not found" }, { status: 404 });

  // Plot scope as well as assignment: an officer answers grievances about land
  // in their own jurisdiction.
  const inScope = await prisma.grievance.count({
    where: { AND: [{ id }, scopeForOptionalParcel(s)] },
  });
  if (!inScope) return await apiJson({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const status = OUTCOMES.find((o) => o === body?.status);
  if (!status) return await apiJson({ error: "Choose what is happening to it" }, { status: 400 });

  try {
    const g = await disposeGrievance({
      grievanceId: id,
      status,
      decision: text(body?.decision, { max: 1000 }),
      decisionReasons: text(body?.decisionReasons, { min: 20, max: 8000 }),
      actorId: s.id,
      actorRole: s.role,
    });
    return await apiJson({ ok: true, status: g.status });
  } catch (e) {
    const { status: code, error } = apiError(e, "dispose grievance");
    return await apiJson({ error }, { status: code });
  }
}
