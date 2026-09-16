import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@backend/auth/session";
import Shell from "@frontend/components/Shell";
import { getTranslator } from "@backend/i18n/locale";
import ServiceWorker from "./ServiceWorker";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: t("screens.meta.fieldTitle"),
    description: t("screens.meta.fieldDescription"),
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: t("screens.meta.fieldShortName"), statusBarStyle: "default" },
  };
}

/** Mobile-first, and comfortable in one hand: this is used standing in a field. */
export const viewport: Viewport = {
  themeColor: "#0b3d91",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

/**
 * Same chrome as the rest of the signed-in app — the shared Shell, so the sidebar, branding and
 * header cannot drift from the (dashboard) group.
 */
export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <Shell session={session}>
      <ServiceWorker />
      {children}
    </Shell>
  );
}
