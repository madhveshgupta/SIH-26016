import type { Metadata } from "next";
import { loadProjectContext } from "@frontend/lib/project-context";
import NotificationsView from "../../../notifications/View";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.notifications") };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ issue?: string }> }) {
  const project = await loadProjectContext((await params).id);
  return <NotificationsView project={project} issue={(await searchParams).issue} />;
}
