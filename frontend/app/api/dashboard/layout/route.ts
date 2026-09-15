import { getSession } from "@backend/auth/session";
import { resetLayout, saveLayout } from "@backend/analytics/layout";
import { apiError } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Save (or reset) the caller's own dashboard arrangement. Only ever their own. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  try {
    if (body?.reset) {
      await resetLayout(s.id);
      return await apiJson({ ok: true, reset: true });
    }
    if (!Array.isArray(body?.widgets)) {
      return await apiJson({ error: "widgets must be a list of widget keys" }, { status: 400 });
    }
    return await apiJson({ ok: true, widgets: await saveLayout(s.id, body.widgets.map(String).slice(0, 50)) });
  } catch (e) {
    const { status, error } = apiError(e, "save dashboard layout");
    return await apiJson({ error }, { status });
  }
}
