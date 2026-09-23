import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { runAlertSweep } from "@backend/alerts/sweep";
import { apiError } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Run the hourly alert sweep now. */
export async function POST() {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "alert", "create")) return await apiJson({ error: "Not permitted" }, { status: 403 });
  try {
    return await apiJson(await runAlertSweep({ actorId: s.id }));
  } catch (e) {
    const { status, error } = apiError(e, "alert sweep");
    return await apiJson({ error }, { status });
  }
}
