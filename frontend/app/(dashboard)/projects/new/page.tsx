import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { mayCreateProjects, selectableDistricts } from "@backend/projects/land-selection";
import { PageHeader } from "@frontend/components/ui";
import LandWorkbench from "@frontend/components/land/LandWorkbench";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("screens.projectsList.newProject") };
}

/** A new project and the land it needs — for the body that needs the land. */
export default async function NewProjectPage() {
  const s = await requireSession();
  const { t } = await getTranslator();
  if (!mayCreateProjects(s.role)) redirect("/projects");

  const [districts, agencies] = await Promise.all([
    selectableDistricts(),
    // An administrator names the agency; a requiring body files for itself.
    s.role === "SUPER_ADMIN" ? prisma.agency.findMany({ where: { isRequiringBody: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : null,
  ]);

  return (
    <div>
      <PageHeader
        title={t("pages.newProjectTitle")}
        description={t("pageDesc.newProject")}
        crumbs={[{ label: t("navGroups.casework") }, { label: t("nav.projects"), href: "/projects" }, { label: t("crumbs.new") }]}
      />
      <LandWorkbench
        districts={districts}
        initialDistrictId={districts.find((d) => d.liveCadastre)?.id ?? null}
        mode={{ kind: "create", agencies }}
      />
    </div>
  );
}
