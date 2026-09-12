import { notFound } from "next/navigation";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForProject } from "@backend/rbac/scope";

/** The project a project-scoped page is about. */
export interface ProjectContext {
  id: string;
  name: string;
  referenceNo: string;
}

/**
 * Load a project for a project-scoped page — or 404 when this viewer may not
 * see it, the same answer an unknown id gets, so the page never confirms that
 * a project outside the viewer's jurisdiction exists.
 */
export async function loadProjectContext(id: string): Promise<ProjectContext> {
  const s = await requirePermission("project", "read");
  const project = await prisma.project.findFirst({
    where: { AND: [{ id }, scopeForProject(s)] },
    select: { id: true, name: true, referenceNo: true },
  });
  if (!project) notFound();
  return project;
}

/** Where a section lives: inside the project when there is one, else at its own address. */
export function sectionPath(project: ProjectContext | undefined, section: string, global: string): string {
  return project ? `/projects/${project.id}/${section}` : global;
}

/** "Projects › <name> › <section>" inside a project. */
export function projectCrumbs(project: ProjectContext, projectsLabel: string, sectionLabel: string) {
  return [
    { label: projectsLabel, href: "/projects" },
    { label: project.name, href: `/projects/${project.id}` },
    { label: sectionLabel },
  ];
}
