import type { Metadata } from "next";
import { loadProjectContext } from "@frontend/lib/project-context";
import ObjectionsView from "../../../objections/View";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.objections") };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const project = await loadProjectContext((await params).id);
  const sp = await searchParams;
  return <ObjectionsView project={project} show={sp.show} />;
}
