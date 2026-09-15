import type { Metadata } from "next";
import { getTranslator } from "@backend/i18n/locale";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { scopeForProject } from "@backend/rbac/scope";
import { mayChangeProjectLand, selectableDistricts } from "@backend/projects/land-selection";
import { PageHeader } from "@frontend/components/ui";
import LandWorkbench from "@frontend/components/land/LandWorkbench";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("screens.landPage.tabTitle") };
}

/** Add or take out plots while the project's proposals are still at draft. */
export default async function ProjectLandPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getTranslator();
  const s = await requireSession();
  const { id } = await params;
  if (!mayChangeProjectLand(s.role)) redirect(`/projects/${id}`);

  const project = await prisma.project.findFirst({
    where: { AND: [scopeForProject(s), { id }] },
    select: { id: true, name: true, referenceNo: true, rightOfWayM: true },
  });
  if (!project) notFound();

  const [districts, first] = await Promise.all([
    selectableDistricts(),
    prisma.landParcel.findFirst({ where: { projectId: id }, select: { districtId: true }, orderBy: { chainageM: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader
        title={t("screens.landPage.title", { name: project.name })}
        description={t("screens.landPage.desc")}
        crumbs={[{ label: t("nav.projects"), href: "/projects" }, { label: project.referenceNo, href: `/projects/${id}` }, { label: t("screens.landPage.crumbLand") }]}
      />
      <LandWorkbench
        districts={districts}
        initialDistrictId={first?.districtId ?? districts.find((d) => d.liveCadastre)?.id ?? null}
        mode={{ kind: "edit", projectId: id, rightOfWayM: project.rightOfWayM }}
      />
    </div>
  );
}
