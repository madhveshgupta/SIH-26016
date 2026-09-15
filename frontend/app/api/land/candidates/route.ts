import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { scopeForProject } from "@backend/rbac/scope";
import { mayChangeProjectLand, mayCreateProjects, recordCandidates } from "@backend/projects/land-selection";
import { apiError, id } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

/** The mapped plots of a district a project can choose from. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!mayCreateProjects(s.role) && !mayChangeProjectLand(s.role)) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }
  const url = new URL(req.url);
  const districtId = id(url.searchParams.get("districtId"));
  const rawProject = url.searchParams.get("projectId");
  const projectId = rawProject ? id(rawProject) ?? "" : undefined;
  if (!districtId) return await apiJson({ error: "districtId is required" }, { status: 400 });
  if (projectId !== undefined && !(await prisma.project.count({ where: { AND: [scopeForProject(s), { id: projectId }] } }))) {
    return await apiJson({ error: "Project not found" }, { status: 404 });
  }
  try {
    return await apiJson({ plots: await recordCandidates(districtId, projectId) });
  } catch (e) {
    const { status, error } = apiError(e, "land candidates");
    return await apiJson({ error }, { status });
  }
}
