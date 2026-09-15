import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { geoRows } from "@backend/analytics/geo";
import { scopeForDistrict } from "@backend/rbac/scope";
import { apiError, id } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Figures for the national map, by state — or by district within one state. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "dashboard", "read")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const raw = new URL(req.url).searchParams.get("stateId");
  const stateId = raw ? id(raw) : null;
  if (raw && !stateId) return await apiJson({ error: "Unknown state" }, { status: 400 });
  // Drilling into a state is only allowed where the caller may see its districts.
  if (stateId && !(await prisma.district.count({ where: { AND: [scopeForDistrict(s), { stateId }] } }))) {
    return await apiJson({ error: "Outside your jurisdiction" }, { status: 403 });
  }

  try {
    return await apiJson({ level: stateId ? "district" : "state", rows: await geoRows(s, stateId) });
  } catch (e) {
    const { status, error } = apiError(e, "analytics geo");
    return await apiJson({ error }, { status });
  }
}
