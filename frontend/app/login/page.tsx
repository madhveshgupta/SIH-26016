import type { Metadata } from "next";
import type { RoleType } from "@prisma/client";
import en from "@backend/i18n/locales/en";
import { COVERAGE, TRANSLATED, type MessageKey } from "@backend/i18n";
import { getTranslator } from "@backend/i18n/locale";
import LanguageSwitcher from "@frontend/components/LanguageSwitcher";
import LoginForm, { type LoginStrings } from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("common.signIn") };
}

/**
 * Sign-in. The flow itself is a client component; its words are translated here, where the
 * language is known, so no dictionary reaches the browser.
 */
export default async function LoginPage() {
  const { locale, t } = await getTranslator();
  const roles = Object.keys(en.roles) as RoleType[];
  const strings: LoginStrings = {
    ...(Object.fromEntries(
      Object.keys(en.login).map((k) => [k, t(`login.${k}` as MessageKey)]),
    ) as { [K in keyof typeof en.login]: string }),
    back: t("common.back"),
    district: t("common.district"),
    eyebrow: t("landing.eyebrow"),
    roles: Object.fromEntries(roles.map((r) => [r, t(`roles.${r}` as MessageKey)])),
    roleDesc: Object.fromEntries(roles.map((r) => [r, t(`roleDesc.${r}` as MessageKey)])),
  };

  return (
    <LoginForm
      strings={strings}
      languageSwitcher={
        <LanguageSwitcher
          current={locale}
          translated={[...TRANSLATED]}
          coverage={COVERAGE}
          labels={{ change: t("shell.changeLanguage"), draft: t("language.draft"), note: t("language.note") }}
        />
      }
    />
  );
}
