import type { GrievanceCategory } from "@prisma/client";
import { LIMITS, rateLimit } from "@backend/security/rate-limit";
import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForParcel } from "@backend/rbac/scope";
import { CATEGORIES } from "@backend/grievances/catalogue";
import { fileGrievance } from "@backend/grievances/file";
import { apiError, id } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

const KEYS = new Set(CATEGORIES.map((c) => c.key));

/** File a citizen's representation about their own acquisition. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });

  const limit = rateLimit(`grievances:${s.id}`, LIMITS.citizenWrite);
  if (!limit.ok) {
    return await apiJson(
      { error: "That is faster than this can be done by hand. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  if (!can(s.role, "grievance", "create")) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parcelId = id(body?.parcelId);
  const category = body?.category as GrievanceCategory | undefined;
  if (!parcelId) return await apiJson({ error: "Choose the plot this is about" }, { status: 400 });
  if (!category || !KEYS.has(category)) {
    return await apiJson({ error: "Choose what the problem is" }, { status: 400 });
  }
  const answers = body?.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return await apiJson({ error: "Fill in the form before submitting" }, { status: 400 });
  }

  // Scoped lookup: a plot outside the caller's own land is simply not found.
  const parcel = await prisma.landParcel.findFirst({
    where: { AND: [scopeForParcel(s), { id: parcelId }] },
    select: { id: true },
  });
  if (!parcel) return await apiJson({ error: "Plot not found" }, { status: 404 });

  try {
    const result = await fileGrievance({
      category,
      parcelId: parcel.id,
      answers: answers as Record<string, unknown>,
      filedByUserId: s.id,
      objectorName: s.fullName,
      ownerId: s.role === "LANDOWNER" ? s.ownerId ?? "__none__" : null,
    });
    return await apiJson({ ok: true, ...result });
  } catch (e) {
    const { status, error } = apiError(e, "file grievance");
    return await apiJson({ error }, { status });
  }
}
