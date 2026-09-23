import type { Metadata } from "next";
import Link from "next/link";
import { BellOff } from "lucide-react";
import { requireSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { Badge, EmptyState, PageHeader } from "@frontend/components/ui";
import MarkReadButton from "./MarkReadButton";
import RunSweepButton from "./RunSweepButton";
import { can } from "@backend/rbac/permissions";
import { getTranslator } from "@backend/i18n/locale";
import type { MessageKey } from "@backend/i18n";
import { alertText } from "@backend/alerts/words";
import { alertScheduleStatus } from "@backend/alerts/schedule";
import LiveStamp from "@frontend/components/dashboard/LiveStamp";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.alerts") };
}

const TONE = { INFO: "info", WARNING: "warning", CRITICAL: "danger", STATUTORY_LAPSE_RISK: "danger" } as const;

export default async function AlertsPage() {
  const s = await requireSession();
  const { t, intl } = await getTranslator();
  const alerts = await prisma.alert.findMany({
    where: { recipientId: s.id },
    orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { proposal: { select: { id: true, referenceNo: true } } },
  });
  const unread = alerts.filter((a) => !a.isRead).length;
  const schedule = alertScheduleStatus();

  return (
    <div>
      <PageHeader
        title={t("pages.alertsTitle")}
        description={t("pageDesc.alerts")}
        crumbs={[{ label: t("navGroups.overview"), href: "/dashboard" }, { label: t("nav.alerts") }]}
        badge={unread > 0 ? <Badge tone="danger">{t("screens.alertsPage.unread", { count: unread })}</Badge> : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LiveStamp />
            {can(s.role, "alert", "create") && <RunSweepButton />}
            {unread > 0 && <MarkReadButton all />}
          </div>
        }
      />
      {schedule && (
        <p className="-mt-2 mb-4 text-xs text-muted">
          {t("screens.alertsPage.autoEvery", { minutes: schedule.everyMinutes })}
          {schedule.lastRunAt && ` ${t("screens.alertsPage.lastCheck", { time: schedule.lastRunAt.toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit" }) })}`}
        </p>
      )}
      {alerts.length === 0 ? (
        <EmptyState icon={<BellOff className="h-5 w-5" />} title={t("screens.alertsPage.none")} description={t("screens.alertsPage.noneDesc")} />
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className={`flex items-start gap-3 rounded-xl border bg-surface p-4 ${a.isRead ? "border-border opacity-75" : "border-brand/30 shadow-sm"}`}>
              <div className="flex shrink-0 flex-col items-start gap-1">
                <Badge tone={TONE[a.severity as keyof typeof TONE] ?? "neutral"}>{t(`screens.alertsPage.sev_${a.severity}` as MessageKey)}</Badge>
                {a.type.endsWith("_ESCALATED") && <Badge tone="warning">{t("screens.alertsPage.escalatedToYou")}</Badge>}
              </div>
              <div className="min-w-0 flex-1">
                {/* Stored in English (it also goes out by SMS and email); worded here in the reader's language. */}
                <div className="text-sm font-medium">{alertText(t, a.title)}</div>
                <div className="mt-0.5 text-sm text-muted">{alertText(t, a.message)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                  <span>{a.createdAt.toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" })}</span>
                  {a.channels.some((c) => c !== "IN_APP") && (
                    <span>
                      {t("screens.alertsPage.alsoSent", {
                        channels: a.channels.filter((c) => c !== "IN_APP").map((c) => t(`screens.alertsPage.ch_${c}` as MessageKey)).join(" + "),
                      })}
                      {a.deliveredAt ? "" : ` ${t("screens.alertsPage.notConfirmed")}`}
                    </span>
                  )}
                  {a.proposal && (
                    <Link href={`/proposals/${a.proposal.id}`} className="font-mono text-brand hover:underline">
                      {a.proposal.referenceNo}
                    </Link>
                  )}
                </div>
              </div>
              {!a.isRead && <MarkReadButton id={a.id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
