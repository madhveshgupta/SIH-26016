import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { assignedParcels } from "@backend/field/surveys";
import { apiError } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** The plots to survey, for the device to keep offline. Never owner contact details. */
export async function GET() {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "parcel", "read")) return await apiJson({ error: "Not permitted" }, { status: 403 });
  try {
    const parcels = await assignedParcels(s);
    return await apiJson({
      parcels: parcels.map((p) => ({
        id: p.id,
        khasraNo: p.khasraNo,
        status: p.status,
        hasConflict: p.hasConflict,
        recordedHa: Number(p.declaredAreaHectares),
        mappedHa: p.computedAreaHectares == null ? null : Number(p.computedAreaHectares),
        lat: p.centroidLat == null ? null : Number(p.centroidLat),
        lng: p.centroidLng == null ? null : Number(p.centroidLng),
        village: p.village.name,
        district: p.district.name,
        project: p.project.name,
        owners: p.owners.map((o) => o.owner.fullName),
        lastSurveyedAt: p.fieldSurveys[0]?.capturedAt ?? null,
      })),
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    const { status, error } = apiError(e, "field parcels");
    return await apiJson({ error }, { status });
  }
}
