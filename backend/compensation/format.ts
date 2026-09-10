/** Money formatting, kept free of any server-only import. */

/** Accepts a Prisma Decimal without importing its type. */
type Numeric = number | { toString(): string };

const toNumber = (v: Numeric): number => (typeof v === "number" ? v : Number(v.toString()));

/** ₹ in the Indian numbering system — 12,34,567 not 1,234,567. */
export function formatINR(d: Numeric): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(toNumber(d));
}

/** Crore and lakh in each interface language. */
const SCALE_WORDS: Record<string, { crore: string; lakh: string }> = {
  en: { crore: "crore", lakh: "lakh" },
  hi: { crore: "करोड़", lakh: "लाख" },
  mr: { crore: "कोटी", lakh: "लाख" },
  ta: { crore: "கோடி", lakh: "லட்சம்" },
  te: { crore: "కోట్లు", lakh: "లక్షలు" },
  bn: { crore: "কোটি", lakh: "লক্ষ" },
};

/** Lakh / crore, which is how these figures are actually discussed — in the reader's language. */
export function formatIndianScale(d: Numeric, locale = "en"): string {
  const n = toNumber(d);
  const words = SCALE_WORDS[locale] ?? SCALE_WORDS.en;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} ${words.crore}`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} ${words.lakh}`;
  return formatINR(n);
}
