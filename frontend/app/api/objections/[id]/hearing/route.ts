import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForOptionalParcel, scopeForProposal } from "@backend/rbac/scope";
import { scheduleHearing } from "@backend/statutory/notifications";
import { apiError, id as cleanId } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** List a hearing for an objection. Only the authority the Act names. */
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
  // Accepted only as a plain calendar day, listed at 11:00 local time — the usual start of
  // hearings.
  const day = typeof body?.hearingDate === "string" ? body.hearingDate.trim() : "";
  const date = new Date(`${day}T11:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) {
    return await apiJson({ error: "Give the hearing date as a calendar date, YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const o = await scheduleHearing({ objectionId: id, hearingDate: date, actorId: s.id, actorRole: s.role });
    return await apiJson({ ok: true, hearingDate: o.hearingDate });
  } catch (e) {
    const { status, error } = apiError(e, "schedule hearing");
    return await apiJson({ error }, { status });
  }
}
