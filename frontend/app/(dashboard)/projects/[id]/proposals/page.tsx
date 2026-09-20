import type { Metadata } from "next";
import { loadProjectContext } from "@frontend/lib/project-context";
import ProposalsView from "../../../proposals/View";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.proposals") };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ clock?: string }> }) {
  const project = await loadProjectContext((await params).id);
  const sp = await searchParams;
  return <ProposalsView scoped={project} clock={sp.clock} />;
}
