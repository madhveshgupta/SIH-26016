import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { isLocale } from "@backend/i18n";
import { LOCALE_COOKIE } from "@backend/i18n/locale";
import { apiJson } from "@backend/http/respond";

/** Change language. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!isLocale(body?.locale)) return await apiJson({ error: "Unknown language" }, { status: 400 });

  const session = await getSession();
  if (session) {
    await prisma.user.update({ where: { id: session.id }, data: { preferredLocale: body.locale } }).catch(() => {});
  }

  const response = await apiJson({ ok: true, locale: body.locale });
  response.cookies.set(LOCALE_COOKIE, body.locale, {
    httpOnly: false, // read by the client switcher to show the current choice
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  return response;
}
