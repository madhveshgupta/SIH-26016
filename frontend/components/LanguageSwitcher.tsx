"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Languages } from "lucide-react";
import { LOCALE_INFO, LOCALES, type Locale } from "@backend/i18n/meta";
import { cn } from "@frontend/lib/cn";
import { useT } from "@frontend/components/I18nProvider";

/** The language switcher. */
export type SwitcherLabels = { change: string; draft: string; note: string };

export default function LanguageSwitcher({
  current,
  translated,
  coverage,
  compact = false,
  labels: given,
}: {
  current: Locale;
  translated: Locale[];
  /** How much of the interface each language covers, 0–1. */
  coverage?: Record<Locale, number>;
  compact?: boolean;
  /** The switcher's own words, in the current language. */
  labels?: SwitcherLabels;
}) {
  const t = useT();
  const labels: SwitcherLabels = given ?? { change: t("shell.changeLanguage"), draft: t("language.draft"), note: t("language.note") };
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const choose = async (locale: Locale) => {
    setOpen(false);
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    startTransition(() => router.refresh());
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={labels.change}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-muted",
          pending && "opacity-60",
        )}
      >
        <Languages className="h-3.5 w-3.5" aria-hidden />
        <span lang={current}>{LOCALE_INFO[current].label}</span>
        {!compact && <span className="text-muted">· {LOCALE_INFO[current].english}</span>}
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={labels.change}
          className="absolute end-0 z-50 mt-1 max-h-[70vh] w-64 overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface shadow-lg"
        >
          {LOCALES.map((locale) => {
            const done = translated.includes(locale);
            const info = LOCALE_INFO[locale];
            return (
              <li key={locale}>
                <button
                  role="option"
                  aria-selected={locale === current}
                  onClick={() => void choose(locale)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-surface-muted"
                >
                  <span className="flex-1">
                    <span lang={locale} dir={info.dir}>{info.label}</span>
                    <span className="ms-1.5 text-xs text-muted">{info.english}</span>
                  </span>
                  {!done && (
                    <span className="text-[10px] tabular-nums text-muted">
                      {coverage ? `${Math.round(coverage[locale] * 100)}%` : ""}
                    </span>
                  )}
                  {!info.reviewed && (
                    <span className="rounded bg-warning-soft px-1 text-[10px] text-warning">{labels.draft}</span>
                  )}
                  {locale === current && <Check className="h-3.5 w-3.5 text-brand" />}
                </button>
              </li>
            );
          })}
          <li className="sticky bottom-0 border-t border-border bg-surface px-3 py-2 text-[10px] leading-snug text-muted">
            {labels.note}
          </li>
        </ul>
      )}
    </div>
  );
}
