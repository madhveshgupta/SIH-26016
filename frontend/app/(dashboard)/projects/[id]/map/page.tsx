import type { Metadata } from "next";
import { loadProjectContext } from "@frontend/lib/project-context";
import ParcelsView from "../../../parcels/View";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.landMap") };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const project = await loadProjectContext((await params).id);
  const sp = await searchParams;
  return <ParcelsView scoped={project} status={sp.status} />;
}
