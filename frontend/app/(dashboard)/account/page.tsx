import type { Metadata } from "next";
import { KeyRound, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { requireSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { scopeDescKey } from "@backend/i18n/scope";
import type { MessageKey } from "@backend/i18n";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@frontend/components/ui";
import ChangePasswordForm from "./ChangePasswordForm";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("shell.myAccount") };
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ first?: string; next?: string }> }) {
  const s = await requireSession();
  const { t, intl } = await getTranslator();
  const tk = (key: string) => t(key as MessageKey);
  const { first, next } = await searchParams;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: s.id },
    include: {
      role: true,
      state: { select: { name: true } },
      district: { select: { name: true } },
      agency: { select: { name: true } },
    },
  });
  const recent = await prisma.auditLog.findMany({
    where: { actorId: s.id, action: { in: ["LOGIN", "LOGIN_FAILED", "OTP_FAILED", "PASSWORD_CHANGED"] } },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { id: true, action: true, createdAt: true, ipAddress: true },
  });

  return (
    <div>
      <PageHeader title={t("pages.accountTitle")} description={t("pageDesc.account")} crumbs={[{ label: t("crumbs.account") }]} />
      {first && (
        <div className="mb-5 rounded-xl border border-accent/40 bg-accent-soft p-4 text-sm">
          <strong>{t("screens.account.firstTitle")}</strong> {t("screens.account.firstText")}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("screens.account.profile")} icon={<UserRound className="h-4 w-4" />} />
          <CardBody>
            <dl className="grid grid-cols-[140px_1fr] gap-y-2.5 text-sm">
              <dt className="text-muted">{t("screens.account.name")}</dt><dd className="font-medium">{user.fullName}</dd>
              <dt className="text-muted">{t("screens.account.designation")}</dt><dd>{user.designation ?? "—"}</dd>
              <dt className="text-muted">{t("screens.account.role")}</dt><dd><Badge tone="brand">{tk(`roles.${user.role.type}`)}</Badge></dd>
              <dt className="text-muted">{t("screens.account.email")}</dt><dd className="font-mono text-xs">{user.email}</dd>
              <dt className="text-muted">{t("screens.account.mobile")}</dt><dd className="font-mono text-xs">{user.phone ?? "—"}</dd>
              {user.agency && (<><dt className="text-muted">{t("screens.account.agency")}</dt><dd>{user.agency.name}</dd></>)}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("screens.account.jurisdiction")} description={t("screens.account.jurisdictionDesc")} icon={<MapPin className="h-4 w-4" />} />
          <CardBody>
            <dl className="grid grid-cols-[140px_1fr] gap-y-2.5 text-sm">
              <dt className="text-muted">{t("screens.account.scope")}</dt><dd>{t(scopeDescKey(s))}</dd>
              <dt className="text-muted">{t("common.state")}</dt><dd>{user.state?.name ?? t("screens.account.allStates")}</dd>
              <dt className="text-muted">{t("common.district")}</dt><dd>{user.district?.name ?? (user.state ? t("screens.account.allDistricts") : "—")}</dd>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <div id="password" />
          <CardHeader title={t("screens.account.changePassword")} description={t("screens.account.passwordRules")} icon={<KeyRound className="h-4 w-4" />} />
          <CardBody>
            <ChangePasswordForm next={next ?? null} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("screens.account.recent")} description={t("screens.account.recentDesc")} icon={<ShieldCheck className="h-4 w-4" />} />
          <CardBody className="p-0">
            <ul className="divide-y divide-border text-sm">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-5 py-2.5">
                  <Badge tone={r.action === "LOGIN" ? "success" : r.action === "PASSWORD_CHANGED" ? "info" : "danger"}>
                    {tk(`screens.auditAction.${r.action}`)}
                  </Badge>
                  <span className="text-xs text-muted">
                    {r.createdAt.toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" })} {r.ipAddress ? `· ${r.ipAddress}` : ""}
                  </span>
                </li>
              ))}
              {recent.length === 0 && <li className="px-5 py-4 text-xs text-muted">{t("screens.account.noEvents")}</li>}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
