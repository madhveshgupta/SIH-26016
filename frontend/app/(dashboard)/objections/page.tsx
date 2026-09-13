import type { Metadata } from "next";
import ObjectionsView from "./View";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.objections") };
}

/** Across every project in the viewer's jurisdiction; /projects/[id]/… shows one. */
export default async function Page({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  return <ObjectionsView show={sp.show} />;
}
