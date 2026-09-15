import { getSession } from "@backend/auth/session";
import { mayChangeProjectLand, mayCreateProjects, recordPlotsInCorridor } from "@backend/projects/land-selection";
import { apiError, id, lineString, num } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** The mapped plots a drawn alignment's right-of-way crosses. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!mayCreateProjects(s.role) && !mayChangeProjectLand(s.role)) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const districtId = id(body?.districtId);
  const line = lineString(body?.line);
  const row = num(body?.rightOfWayM, { min: 5, max: 500 });
  if (!districtId) return await apiJson({ error: "Choose the district first" }, { status: 400 });
  if (!line) return await apiJson({ error: "Draw the alignment inside India, as at least two points" }, { status: 400 });
  if (row == null) return await apiJson({ error: "Right-of-way must be between 5 and 500 metres" }, { status: 400 });
  try {
    return await apiJson({ keys: await recordPlotsInCorridor(districtId, line, row) });
  } catch (e) {
    const { status, error } = apiError(e, "corridor selection");
    return await apiJson({ error }, { status });
  }
}
