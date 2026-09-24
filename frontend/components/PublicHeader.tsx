import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTranslator } from "@backend/i18n/locale";
import { COVERAGE, TRANSLATED, type MessageKey } from "@backend/i18n";
import LanguageSwitcher from "@frontend/components/LanguageSwitcher";
import { ThemeToggle } from "@frontend/components/ui";
import Wordmark from "@frontend/components/Wordmark";

/** `id` matches the page's `current`; the text shown is the translated key. */
const NAV: { href: string; key: MessageKey; id: string }[] = [
  { href: "/", key: "public.home", id: "Home" },
  { href: "/#map", key: "public.maps", id: "Maps" },
  { href: "/alerts", key: "nav.alerts", id: "Alerts" },
  { href: "/#features", key: "public.features", id: "Resources" },
  { href: "/#about", key: "public.about", id: "About" },
];

/** Header for pages anyone can open without signing in. */
export default async function PublicHeader({
  signedIn = false,
  current = "Home",
}: {
  signedIn?: boolean;
  current?: string;
}) {
  const { locale, t } = await getTranslator();

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="relative mx-auto flex h-20 max-w-7xl items-center gap-6 px-4 sm:px-8">
        <Link href="/" aria-label={`${t("shell.appName")} — ${t("public.home")}`}>
          <Wordmark />
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-9 text-[15px] md:flex">
          {NAV.map((item) => {
            const active = item.id === current;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "relative text-foreground after:absolute after:-bottom-1.5 after:left-0 after:h-[2px] after:w-full after:rounded-full after:bg-brand"
                    : "text-muted transition-colors hover:text-foreground"
                }
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher
            current={locale}
            translated={[...TRANSLATED]}
            coverage={COVERAGE}
            labels={{ change: t("shell.changeLanguage"), draft: t("language.draft"), note: t("language.note") }}
            compact
          />
          <ThemeToggle />
          <Link
            href={signedIn ? "/dashboard" : "/login"}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-strong"
          >
            {signedIn ? t("public.openDashboard") : t("common.signIn")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
