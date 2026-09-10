import type { Metadata } from "next";
import CompensationView from "./View";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.compensation") };
}

/** Across every project in the viewer's jurisdiction; /projects/[id]/… shows one. */
export default function Page() {
  return <CompensationView />;
}
