/** Which language to render in. */
import { cookies } from "next/headers";
import { getSession } from "@backend/auth/session";
import { LOCALE_INFO, isLocale, translator, type Locale } from "@backend/i18n";

export const LOCALE_COOKIE = "bhoomi_locale";

export async function currentLocale(): Promise<Locale> {
  const jar = await cookies();
  const chosen = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  const session = await getSession();
  const preferred = session ? await preferredFor(session.id) : null;
  return preferred ?? "en";
}

async function preferredFor(userId: string): Promise<Locale | null> {
  const { prisma } = await import("@backend/db/client");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferredLocale: true } });
  return isLocale(user?.preferredLocale) ? user.preferredLocale : null;
}

/** The translator for this request. */
export async function getTranslator() {
  const locale = await currentLocale();
  return { locale, intl: LOCALE_INFO[locale].intl, t: translator(locale) };
}
