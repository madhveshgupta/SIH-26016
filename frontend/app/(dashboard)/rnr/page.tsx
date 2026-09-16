import type { Metadata } from "next";
import RnRView from "./View";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.rehabilitation") };
}

/** Across every project in the viewer's jurisdiction; /projects/[id]/… shows one. */
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  return <RnRView status={sp.status} />;
}
