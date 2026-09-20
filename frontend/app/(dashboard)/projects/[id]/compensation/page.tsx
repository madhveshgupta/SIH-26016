import type { Metadata } from "next";
import { loadProjectContext } from "@frontend/lib/project-context";
import CompensationView from "../../../compensation/View";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.compensation") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const project = await loadProjectContext((await params).id);
  return <CompensationView project={project} />;
}
