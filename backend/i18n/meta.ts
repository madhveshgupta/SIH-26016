/** The languages, without their dictionaries. */
/**
 * The six interface languages: English, Hindi, and Bengali,
 * Marathi, Tamil and Telugu from the Eighth Schedule — each translated end to end, every screen.
 */
export const LOCALES = [
  "en", "hi",
  "bn", "mr", "ta", "te",
] as const;
export type Locale = (typeof LOCALES)[number];

export interface LocaleInfo {
  /** The language's name for itself, as the switcher shows it. */
  label: string;
  english: string;
  /** All six are left to right; kept so a right-to-left language can be added. */
  dir: "ltr" | "rtl";
  /** The tag handed to Intl for dates and numbers. */
  intl: string;
  /** Whether a native speaker has reviewed this translation. */
  reviewed: boolean;
}

const info = (label: string, english: string, intl: string, dir: "ltr" | "rtl" = "ltr"): LocaleInfo => ({
  label, english, dir, intl: `${intl}-u-nu-latn`, reviewed: false,
});

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { ...info("English", "English", "en-IN"), reviewed: true },
  hi: info("हिन्दी", "Hindi", "hi-IN"),
  bn: info("বাংলা", "Bengali", "bn-IN"),
  mr: info("मराठी", "Marathi", "mr-IN"),
  ta: info("தமிழ்", "Tamil", "ta-IN"),
  te: info("తెలుగు", "Telugu", "te-IN"),
};

