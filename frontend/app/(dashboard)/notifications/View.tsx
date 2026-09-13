import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForProposal } from "@backend/rbac/scope";
import { awaitingNotification, PUBLICATION_CHANNELS, publicationStatus } from "@backend/statutory/notifications";
import { can } from "@backend/rbac/permissions";
import { IssueNotificationButton, RecordPublicationButton } from "@frontend/components/notifications/IssueNotification";
import { formatDate, type MessageKey } from "@backend/i18n";
import { Badge, EmptyState, PageHeader } from "@frontend/components/ui";
import { getTranslator } from "@backend/i18n/locale";
import { projectCrumbs, type ProjectContext } from "@frontend/lib/project-context";

export default async function NotificationsView({ project, issue }: { project?: ProjectContext; issue?: string }) {
  const s = await requirePermission("notification", "read");
  const { locale, t } = await getTranslator();
  const day = (d: Date) => formatDate(locale, d);
  const channel = (key: string) => t(`notices.channel.${key}` as MessageKey);

  // A national role's jurisdiction is every notification ever issued, so the page shows the most
  // recent and says how many there are in total.
  const PAGE_SIZE = 50;
  const where = { proposal: { AND: [scopeForProposal(s), project ? { projectId: project.id } : {}] } };
  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: { proposal: { select: { referenceNo: true, project: { select: { name: true } } } } },
      orderBy: { issuedOn: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.notification.count({ where }),
  ]);

  const incomplete = rows.filter((n) => !publicationStatus(n as never).complete).length;

  // What this officer can issue now, from cases in their own jurisdiction.
  const mayIssue = can(s.role, "notification", "create");
  const mayRecord = can(s.role, "notification", "update");
  const awaiting = mayIssue
    ? await awaitingNotification({ AND: [scopeForProposal(s), project ? { projectId: project.id } : {}] })
    : [];
  const channelOptions = PUBLICATION_CHANNELS.map((c) => ({ key: c.key, label: channel(c.key) }));

  return (
    <div>
      <PageHeader
        title={t("pages.notificationsTitle")}
        crumbs={project ? projectCrumbs(project, t("nav.projects"), t("nav.notifications")) : undefined}
        description={
          total > rows.length
            ? t("notices.issuedShowing", { total, shown: rows.length })
            : t("notices.issued", { total })
        }
        actions={
          incomplete > 0 || mayIssue ? (
            <div className="flex flex-wrap items-center gap-2">
              {incomplete > 0 && (
                <Badge tone="danger">
                  {t("notices.incomplete", { count: incomplete })}
                </Badge>
              )}
              {mayIssue && <IssueNotificationButton options={awaiting} channels={channelOptions} initialProposalId={issue} />}
            </div>
          ) : undefined
        }
      />

      <div className="mt-4 grid gap-2">
        {rows.map((n) => {
          const pub = publicationStatus(n as never);
          return (
            <div key={n.id} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t(`notices.type.${n.type}` as MessageKey)}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted">
                    {n.proposal.referenceNo}
                    {n.gazetteRef && <span className="ms-2">{t("notices.gazette", { ref: n.gazetteRef })}</span>}
                  </div>
                  {!project && <div className="text-[11px] text-muted">{n.proposal.project.name}</div>}
                </div>
                <div className="text-end">
                  <div className="text-[11px] tabular-nums">
                    {day(n.issuedOn)}
                  </div>
                  {n.startsDeadlineAt && (
                    <div className="text-[10px] text-amber-700 dark:text-amber-500">
                      {t("notices.startsClock", { date: day(n.startsDeadlineAt) })}
                    </div>
                  )}
                </div>
              </div>

              {/* Courts have quashed acquisitions purely because publication in
                  one channel could not be proved. */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                <span className="text-[10px] text-muted">{t("notices.publishedIn")}</span>
                {PUBLICATION_CHANNELS.map((c) => {
                  const done = Boolean((n as unknown as Record<string, unknown>)[c.key]);
                  return (
                    <span key={c.key} className={`rounded px-1.5 py-0.5 text-[10px] ${
                      done ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                           : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                    }`}>
                      {done ? "✓" : "✗"} {channel(c.key)}
                    </span>
                  );
                })}
              </div>
              {!pub.complete && (
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded bg-red-50 px-2 py-1 dark:bg-red-950">
                  <p className="text-[10px] text-red-800 dark:text-red-300">
                    {t("notices.missing", {
                      channels: PUBLICATION_CHANNELS.filter((c) => pub.missing.includes(c.label)).map((c) => channel(c.key)).join(", "),
                    })}
                  </p>
                  {mayRecord && (
                    <RecordPublicationButton
                      id={n.id}
                      missing={channelOptions.filter((c) => !(n as unknown as Record<string, unknown>)[c.key])}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <EmptyState
            title={t("notices.none")}
            description={t("notices.noneHint")}
          />
        )}
      </div>
    </div>
  );
}
