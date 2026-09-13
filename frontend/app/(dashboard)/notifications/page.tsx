import type { Metadata } from "next";
import NotificationsView from "./View";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.notifications") };
}

/** Across every project in the viewer's jurisdiction; /projects/[id]/… shows one. */
export default async function Page({ searchParams }: { searchParams: Promise<{ issue?: string }> }) {
  return <NotificationsView issue={(await searchParams).issue} />;
}
