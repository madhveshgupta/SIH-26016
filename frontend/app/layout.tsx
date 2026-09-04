import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ToastProvider } from "@frontend/components/ui/Toast";
import { currentLocale, getTranslator } from "@backend/i18n/locale";
import { LOCALE_INFO, dictionaryFor } from "@backend/i18n";
import { I18nProvider } from "@frontend/components/I18nProvider";
// Self-hosted, because the CSP only allows fonts from this origin.
import "@fontsource-variable/noto-sans-devanagari";
import "@fontsource-variable/noto-sans-bengali";
import "@fontsource-variable/noto-sans-tamil";
import "@fontsource-variable/noto-sans-telugu";
import "../styles/globals.css";

/** The tab title and description, in the viewer's language. */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: { default: t("screens.meta.appTitle"), template: `%s · ${t("shell.appName")}` },
    description: t("screens.meta.appDescription"),
  };
}

// Explicit props rather than Next's generated `LayoutProps`, which only exists
// after a build has written .next/types — so typecheck works on a clean clone.
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Light for everyone unless the user chose dark; read server-side so the
  // first paint is already correct.
  const dark = (await cookies()).get("bhoomi_theme")?.value === "dark";
  // The page's language and direction follow the language chosen, so screen
  // readers pronounce it correctly and :lang() picks the right typeface.
  const code = await currentLocale();
  const locale = LOCALE_INFO[code];
  return (
    <html
      lang={locale.intl.replace(/-u-.*$/, "")}
      dir={locale.dir}
      className={`h-full antialiased${dark ? " dark" : ""}`}
    >
      {/* Browser extensions (ColorZilla, Grammarly…) write attributes onto <body> before React
          hydrates; without this every page reports a hydration mismatch that is not ours. */}
      <body className="min-h-full" suppressHydrationWarning>
        <I18nProvider locale={code} dictionary={dictionaryFor(code)}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
