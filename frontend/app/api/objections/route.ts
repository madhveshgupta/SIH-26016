import { LIMITS, rateLimit } from "@backend/security/rate-limit";
import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForParcel, scopeForProposal } from "@backend/rbac/scope";
import { fileObjection } from "@backend/statutory/notifications";
import { apiError, id, text } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** File an objection (LARR s.15 / NH Act s.3C). */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  const limit = rateLimit(`objections:${s.id}`, LIMITS.citizenWrite);
  if (!limit.ok) {
    return await apiJson(
      { error: "That is faster than this can be done by hand. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  if (!can(s.role, "objection", "create")) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parcelId = id(body?.parcelId);
  const grounds = text(body?.grounds, { min: 10, max: 4000 });
  if (!parcelId) return await apiJson({ error: "Choose the plot the objection is about" }, { status: 400 });
  if (!grounds) return await apiJson({ error: "State the grounds of the objection" }, { status: 400 });

  // Scoped lookup: a plot outside the caller's land or jurisdiction is not found.
  const parcel = await prisma.landParcel.findFirst({
    where: { AND: [scopeForParcel(s), { id: parcelId }] },
    select: { id: true, proposalId: true },
  });
  if (!parcel?.proposalId) return await apiJson({ error: "Plot not found" }, { status: 404 });
  const proposal = await prisma.proposal.count({ where: { AND: [scopeForProposal(s), { id: parcel.proposalId }] } });
  if (!proposal) return await apiJson({ error: "Plot not found" }, { status: 404 });

  const citizen = s.role === "LANDOWNER";
  const objectorName = citizen ? s.fullName : text(body?.objectorName, { max: 200 });
  if (!objectorName) return await apiJson({ error: "Name the objector" }, { status: 400 });
  const objectorPhone = text(body?.objectorPhone, { max: 20 }) ?? undefined;

  try {
    const o = await fileObjection({
      proposalId: parcel.proposalId,
      parcelId: parcel.id,
      objectorName,
      objectorPhone,
      grounds,
      filedByUserId: citizen ? s.id : null,
      objectorOwnerId: citizen ? s.ownerId ?? "__none__" : null,
      actorId: s.id,
    });
    return await apiJson({ ok: true, id: o.id });
  } catch (e) {
    const { status, error } = apiError(e, "file objection");
    return await apiJson({ error }, { status });
  }
}
