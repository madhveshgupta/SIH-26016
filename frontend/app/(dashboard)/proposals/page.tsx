import type { Metadata } from "next";
import ProposalsView from "./View";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.proposals") };
}

/** Across every project in the viewer's jurisdiction; /projects/[id]/… shows one. */
export default async function Page({ searchParams }: { searchParams: Promise<{ clock?: string; project?: string }> }) {
  const sp = await searchParams;
  return <ProposalsView clock={sp.clock} project={sp.project} />;
}
