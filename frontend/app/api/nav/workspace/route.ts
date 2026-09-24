import { getSession } from "@backend/auth/session";
import { getTranslator } from "@backend/i18n/locale";
import { projectWorkspace } from "@frontend/lib/nav-workspace";
import { apiJson } from "@backend/http/respond";

/**
 * The sidebar's project workspace for a page, fetched by the shell when the
 * viewer navigates client-side — the layout that drew the sidebar is not
 * re-rendered then, so it asks here instead.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  const path = new URL(req.url).searchParams.get("path") ?? "";
  const { t } = await getTranslator();
  const workspace = await projectWorkspace(s, path, t);
  return await apiJson({ workspace }, { headers: { "Cache-Control": "no-store" } });
}
