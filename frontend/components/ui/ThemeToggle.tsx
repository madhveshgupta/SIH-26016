"use client";

import { Moon, Sun } from "lucide-react";
import { useT } from "@frontend/components/I18nProvider";

/** Light is the default for everyone. */
export function ThemeToggle() {
  const t = useT();
  function toggle() {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    document.cookie = `bhoomi_theme=${dark ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <button onClick={toggle} aria-label={t("screens.ui.toggleTheme")} title={t("screens.ui.toggleTheme")} className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground">
      <Sun className="hidden h-4 w-4 dark:block" />
      <Moon className="h-4 w-4 dark:hidden" />
    </button>
  );
}
