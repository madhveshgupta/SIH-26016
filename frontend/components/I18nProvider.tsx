"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { Dictionary, MessageKey } from "@backend/i18n/types";
import { fill, lookupIn } from "@backend/i18n/core";
import { LOCALE_INFO, type Locale } from "@backend/i18n/meta";

/** The interface language, for interactive components. */
const Ctx = createContext<{ locale: Locale; dictionary: Dictionary } | null>(null);

export function I18nProvider({ locale, dictionary, children }: { locale: Locale; dictionary: Dictionary; children: ReactNode }) {
  return <Ctx.Provider value={{ locale, dictionary }}>{children}</Ctx.Provider>;
}

/** t(key, vars) in the viewer's language — the client twin of the server's translator. */
export function useT() {
  const ctx = useContext(Ctx);
  return useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      const text = ctx ? lookupIn(ctx.dictionary, key) : undefined;
      return fill(text ?? key, vars);
    },
    [ctx],
  );
}

/** The viewer's language, with the Intl tag for dates and numbers. */
export function useLocale() {
  const locale = useContext(Ctx)?.locale ?? "en";
  return { locale, intl: LOCALE_INFO[locale].intl };
}
