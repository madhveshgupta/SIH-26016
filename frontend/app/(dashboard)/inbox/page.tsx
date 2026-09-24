import Link from "next/link";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForProposal } from "@backend/rbac/scope";
import { computeClock, currentTimeMs, SEVERITY_ORDER } from "@backend/statutory/clock";
import { stageFor } from "@backend/workflow/engine";
import ComplianceClock from "@frontend/components/ComplianceClock";
import { PageHeader, Badge } from "@frontend/components/ui";
import { getTranslator } from "@backend/i18n/locale";
import { stageKey } from "@backend/i18n";

export const dynamic = "force-dynamic";

/** The officer's inbox. */
export default async function InboxPage() {
  // Gated on proposal:read, not scrutiny:read.
  const s = await requirePermission("proposal", "read");
  const { t } = await getTranslator();

  const proposals = await prisma.proposal.findMany({
    where: scopeForProposal(s),
    include: {
      project: { select: { name: true, governingAct: true } },
      stages: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" } },
    },
  });

  const now = currentTimeMs();
  const mine = proposals
    .map((p) => {
      const stage = stageFor(p.project.governingAct, p.status);
      const open = p.stages[0];
      const enteredAt = open?.enteredAt ?? p.createdAt;
      const daysHeld = Math.floor((now - enteredAt.getTime()) / 86_400_000);
      const clock = computeClock(
        p.project.governingAct,
        p.status,
        enteredAt,
        open?.statutoryDeadline ?? null,
      );
      const sla = open?.slaDays ?? stage?.slaDays ?? null;
      return {
        p,
        stage,
        clock,
        daysHeld,
        sla,
        // Past twice the SLA is where the engine escalates to a superior.
        overSla: sla !== null && daysHeld > sla,
        escalated: sla !== null && daysHeld > sla * 2,
        actionable: Boolean(stage?.actors.includes(s.role)),
      };
    })
    .filter((x) => x.actionable);

  mine.sort((a, b) => {
    const bySeverity =
      SEVERITY_ORDER.indexOf(a.clock.severity) - SEVERITY_ORDER.indexOf(b.clock.severity);
    return bySeverity !== 0 ? bySeverity : b.daysHeld - a.daysHeld;
  });

  const breached = mine.filter((x) => x.overSla).length;

  return (
    <div>
      <PageHeader
        title={t("pages.inboxTitle")}
        description={t(mine.length === 1 ? "screens.inbox.countOne" : "screens.inbox.countMany", { count: mine.length })}
        actions={breached > 0 ? <Badge tone="warning">{t("screens.inbox.pastSla", { count: breached })}</Badge> : undefined}
      />

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse bg-surface text-[11px]">
          <thead>
            <tr className="border-b border-border text-left">
              {[
                t("screens.proposalTable.colRef"),
                t("common.project"),
                t("screens.inbox.colStage"),
                t("screens.inbox.colHeld"),
                t("screens.inbox.colSla"),
                t("screens.proposalTable.colClock"),
              ].map((h) => (
                <th key={h} className="px-3 py-2 font-medium text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mine.map(({ p, stage, clock, daysHeld, sla, overSla, escalated }) => (
              <tr
                key={p.id}
                className="border-b border-border last:border-0 hover:bg-surface-muted"
              >
                <td className="px-3 py-2 font-mono text-[10px]">
                  <Link href={`/proposals/${p.id}`} className="underline">
                    {p.referenceNo}
                  </Link>
                </td>
                <td className="max-w-[220px] truncate px-3 py-2">{p.project.name}</td>
                <td className="px-3 py-2">
                  {stage ? t(stageKey(p.project.governingAct, p.status)) : p.status}
                  {stage?.section && (
                    <span className="ml-1 font-mono text-[10px] text-muted">
                      {stage.section}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  <span className={overSla ? "font-semibold text-amber-700 dark:text-amber-400" : ""}>
                    {t("screens.inbox.daysN", { days: daysHeld })}
                  </span>
                  {escalated && (
                    <span
                      className="ml-1 rounded bg-red-100 px-1 text-[9px] text-red-700 dark:bg-red-950 dark:text-red-300"
                      title={t("screens.inbox.escalatedTitle")}
                    >
                      {t("screens.inbox.escalated")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted">{sla === null ? "—" : t("screens.inbox.daysN", { days: sla })}</td>
                <td className="px-3 py-2">
                  <ComplianceClock clock={clock} compact />
                </td>
              </tr>
            ))}
            {mine.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted">
                  {t("screens.inbox.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-muted">
        {t("screens.inbox.note")}
      </p>
    </div>
  );
}
