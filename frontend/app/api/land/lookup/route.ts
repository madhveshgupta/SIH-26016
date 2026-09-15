import { getSession } from "@backend/auth/session";
import { lookupLivePlot, mayChangeProjectLand, mayCreateProjects } from "@backend/projects/land-selection";
import { apiError, id, latLng } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** The plot under a clicked point, from the state's live cadastre. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!mayCreateProjects(s.role) && !mayChangeProjectLand(s.role)) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const districtId = id(body?.districtId);
  const point = latLng({ lat: body?.lat, lng: body?.lng });
  if (!districtId) return await apiJson({ error: "Choose the district first" }, { status: 400 });
  if (!point) return await apiJson({ error: "That point is outside India" }, { status: 400 });
  try {
    const projectId = body?.projectId ? id(body.projectId) ?? undefined : undefined;
    return await apiJson(await lookupLivePlot(districtId, point.lat, point.lng, projectId));
  } catch (e) {
    const { status, error } = apiError(e, "live plot lookup");
    return await apiJson({ error }, { status });
  }
}
