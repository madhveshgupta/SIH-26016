import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { scopeForProject } from "@backend/rbac/scope";
import { changeProjectLand, mayChangeProjectLand, parsePicks } from "@backend/projects/land-selection";
import { apiError, id as cleanId } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** Add plots to, or take plots out of, a project whose land is still at draft. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!mayChangeProjectLand(s.role)) return await apiJson({ error: "Not permitted" }, { status: 403 });
  const id = cleanId((await params).id);
  if (!id || !(await prisma.project.count({ where: { AND: [scopeForProject(s), { id }] } }))) {
    return await apiJson({ error: "Project not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const remove = Array.isArray(body?.remove) ? body.remove.map(cleanId) : [];
  if (remove.some((r: string | null) => r === null)) {
    return await apiJson({ error: "Some plots to remove are not part of this project" }, { status: 400 });
  }
  try {
    const result = await changeProjectLand(id, { add: parsePicks(body?.add), remove: remove as string[] }, s);
    return await apiJson({ ok: true, ...result });
  } catch (e) {
    const { status, error } = apiError(e, "change project land");
    return await apiJson({ error }, { status });
  }
}
