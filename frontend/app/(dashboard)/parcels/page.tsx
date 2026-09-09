import type { Metadata } from "next";
import ParcelsView from "./View";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.landMap") };
}

/** Across every project in the viewer's jurisdiction; /projects/[id]/… shows one. */
export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string; status?: string }> }) {
  const sp = await searchParams;
  return <ParcelsView project={sp.project} status={sp.status} />;
}
