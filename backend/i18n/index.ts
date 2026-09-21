/** Language. */
import en from "./locales/en";
import hi from "./locales/hi";
import bn from "./locales/bn";
import mr from "./locales/mr";
import ta from "./locales/ta";
import te from "./locales/te";
import type { Dictionary, MessageKey } from "./types";
import { fill, lookupIn, overlay } from "./core";

export type { Dictionary, MessageKey } from "./types";

export { LOCALES, LOCALE_INFO, type Locale, type LocaleInfo } from "./meta";
import { LOCALE_INFO, LOCALES, type Locale } from "./meta";

/** Kept for existing callers: just the two names. */
export const LOCALE_NAMES: Record<Locale, { label: string; english: string }> = LOCALE_INFO;

/**
 * A key missing from a dictionary falls back to English, one string at a time,
 * so a half-translated screen is still usable; the coverage figures below make
 * sure nobody is told a language is complete when it is not.
 */
const DICTIONARIES: Record<Locale, Partial<Dictionary>> = {
  en, hi, bn, mr, ta, te,
};

/** Every dot path in the English dictionary — the denominator for coverage. */
function leaves(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

const ALL_KEYS = leaves(en);

/** How much of the interface a language actually covers, 0–1. */
export function coverage(locale: Locale): number {
  const dictionary = DICTIONARIES[locale] ?? {};
  const done = ALL_KEYS.filter((key) => lookup(dictionary, key) !== undefined).length;
  return ALL_KEYS.length === 0 ? 0 : done / ALL_KEYS.length;
}

/** Languages translated end to end. Anything less is reported as a percentage. */
export const TRANSLATED: Locale[] = (Object.keys(DICTIONARIES) as Locale[]).filter(
  (l) => coverage(l) >= 0.999,
);

export const COVERAGE: Record<Locale, number> = Object.fromEntries(
  (Object.keys(DICTIONARIES) as Locale[]).map((l) => [l, coverage(l)]),
) as Record<Locale, number>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

function lookup(dictionary: Partial<Dictionary>, key: string): string | undefined {
  return lookupIn(dictionary, key);
}

/** Translate one key, filling {placeholders}. */
export function translate(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const text = lookup(DICTIONARIES[locale] ?? {}, key) ?? lookup(en, key) ?? key;
  return fill(text, vars);
}

/**
 * One language's complete dictionary, English filling any gap — what the
 * browser is sent, so interactive components translate without a round trip.
 */
export function dictionaryFor(locale: Locale): Dictionary {
  return overlay(en as unknown as Dictionary, DICTIONARIES[locale]);
}

/** A translator bound to one language, for a page to use repeatedly. */
export function translator(locale: Locale) {
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

/** Dates and numbers in the user's own language and the Indian system. */
export function formatDate(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(LOCALE_INFO[locale].intl, { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function formatNumber(locale: Locale, value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(LOCALE_INFO[locale].intl, options).format(value);
}

// A workflow stage's name under the Act that governs the case.
export { stageKey } from "./core";

/** Text direction for the document root. */
export function dirFor(locale: Locale): "ltr" | "rtl" {
  return LOCALE_INFO[locale].dir;
}
