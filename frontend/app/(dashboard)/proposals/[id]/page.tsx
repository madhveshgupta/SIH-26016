import { notFound } from "next/navigation";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { scopeForProposal } from "@backend/rbac/scope";
import { computeClock } from "@backend/statutory/clock";
import { stageFor, definitionFor, allowedTransitions } from "@backend/workflow/engine";
import { diagnoseProposal } from "@backend/saarthi";
import ComplianceClock from "@frontend/components/ComplianceClock";
import SaarthiPanel from "@frontend/components/saarthi/SaarthiPanel";
import TransitionForm from "@frontend/components/TransitionForm";
import { can } from "@backend/rbac/permissions";
import { awaitingNotification, PUBLICATION_CHANNELS } from "@backend/statutory/notifications";
import { IssueNotificationButton } from "@frontend/components/notifications/IssueNotification";
import { getTranslator } from "@backend/i18n/locale";
import { stageKey, type MessageKey } from "@backend/i18n";

export const dynamic = "force-dynamic";

export default async function ProposalDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePermission("proposal", "read");
  const { intl, t } = await getTranslator();
  const act = (k: string) => t(`screens.act.${k}` as MessageKey);
  const stageName = (status: string) => t(stageKey(proposal!.project.governingAct, status));
  const note = (status: string) => {
    // i18n-ignore — a dictionary key, not text
    const key = `screens.stageNote.${proposal!.project.governingAct === "NH_ACT_1956" ? "nh" : "larr"}_${status}` as MessageKey;
    const text = t(key);
    return text === key ? null : text;
  };
  const role = (r: string) => t(`roles.${r}` as MessageKey);

  // Scope is applied here too: a direct URL must not bypass jurisdiction.
  const proposal = await prisma.proposal.findFirst({
    where: { AND: [{ id }, scopeForProposal(s)] },
    include: {
      project: true,
      createdBy: { select: { fullName: true } },
      stages: { orderBy: { enteredAt: "asc" }, include: { actor: { select: { fullName: true } } } },
    },
  });
  if (!proposal) notFound();

  const def = definitionFor(proposal.project.governingAct);
  const open = proposal.stages.find((x) => !x.exitedAt);
  const clock = computeClock(
    proposal.project.governingAct,
    proposal.status,
    open?.enteredAt ?? proposal.createdAt,
    open?.statutoryDeadline ?? null,
  );
  const stage = stageFor(proposal.project.governingAct, proposal.status);
  const allowed = await allowedTransitions(proposal.id, s.role);
  // Saarthi reads the same case again under the same scope guard.
  const saarthi = await diagnoseProposal(proposal.id, s);
  // The notification this stage publishes, when it has not been published yet.
  const noticeDue = can(s.role, "notification", "create") ? (await awaitingNotification({ id: proposal.id }))[0] : undefined;

  return (
    <div className="space-y-5">
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <div>
        <div className="font-mono text-[10px] text-muted">{proposal.referenceNo}</div>
        <h1 className="mt-0.5 text-lg font-semibold tracking-tight">{proposal.project.name}</h1>
        <p className="mt-0.5 text-xs text-muted">
          {act(proposal.project.governingAct)} · {t(`screens.projectType.${proposal.project.type}` as MessageKey)} ·{" "}
          {t("screens.proposalDetail.filedBy", { name: proposal.createdBy.fullName })}
        </p>

        <div className="mt-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t("screens.proposalDetail.currentStage", { stage: stage ? stageName(proposal.status) : proposal.status })}
          </h2>
          <ComplianceClock clock={clock} />
          {stage && note(proposal.status) && (
            <p className="text-[11px] leading-relaxed text-muted">
              {note(proposal.status)}
            </p>
          )}
        </div>

        {/* The journey. Answers the question everyone actually asks: where is my file stuck? */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {t("screens.proposalDetail.timeline")}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {t("screens.proposalDetail.timelineDesc")}
          </p>
          <ol className="mt-6 space-y-0">
            {def.stages.map((d, index) => {
              const hop = proposal.stages.find((x) => x.stage === d.status);
              const isCurrent = proposal.status === d.status;
              const done = Boolean(hop?.exitedAt);
              const held =
                hop?.exitedAt && hop.enteredAt
                  ? Math.max(0, Math.round((hop.exitedAt.getTime() - hop.enteredAt.getTime()) / 86_400_000))
                  : null;
              
              const isLast = index === def.stages.length - 1;

              return (
                <li key={d.status} className="group relative flex gap-5">
                  <div className="flex flex-col items-center">
                    <span
                      className={`relative z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                        isCurrent
                          ? "border-brand bg-brand ring-4 ring-brand/10 dark:ring-brand/20"
                          : done
                            ? "border-success bg-success"
                            : "border-border bg-surface"
                      }`}
                    >
                      {done && (
                        <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      )}
                      {isCurrent && (
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    {!isLast && (
                      <span className={`w-px flex-1 ${done ? "bg-success" : "bg-border"}`} />
                    )}
                  </div>
                  
                  <div className={`pb-7 pt-0.5 ${!done && !isCurrent ? "opacity-50" : ""}`}>
                    <div className={`text-sm font-semibold ${isCurrent ? "text-brand" : done ? "text-foreground" : "text-muted"}`}>
                      {stageName(d.status)}
                      {d.section && (
                        <span className="ml-2 inline-flex items-center rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted">
                          {d.section}
                        </span>
                      )}
                    </div>
                    
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      {hop ? (
                        <>
                          <span className="font-medium text-foreground">
                            {hop.enteredAt.toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                          <span className="text-border">•</span>
                          {held !== null ? (
                            <span>{t(held === 1 ? "screens.proposalDetail.heldOne" : "screens.proposalDetail.heldMany", { days: held })}</span>
                          ) : (
                            <span className="font-medium text-brand">{t("status.inProgress")}</span>
                          )}
                          {hop.actor && (
                            <>
                              <span className="text-border">•</span>
                              <span>{t("screens.proposalDetail.byActor", { name: hop.actor.fullName })}</span>
                            </>
                          )}
                        </>
                      ) : (
                        <span>
                          {t("screens.proposalDetail.slaLine", { sla: d.slaDays })}
                          {d.statutoryDays ? ` • ${t("screens.proposalDetail.statutoryLine", { days: d.statutoryDays })}` : ""}
                        </span>
                      )}
                    </div>
                    
                    {hop?.remarks && (
                      <div className="mt-2.5 inline-block rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs leading-relaxed text-foreground">
                        {hop.remarks}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("screens.proposalDetail.details")}</h2>
          <dl className="mt-2 space-y-2 text-[11px]">
            {[
              [t("screens.proposalDetail.areaProposed"), t("screens.units.ha", { value: Number(proposal.proposedAreaHectares ?? 0).toLocaleString(intl) })],
              [t("screens.proposalDetail.governingAct"), act(proposal.project.governingAct)],
              [t("screens.proposalDetail.siaRequired"), proposal.requiresSIA ? t("common.yes") : t("common.no")],
              [t("screens.proposalDetail.urgency"), proposal.isUrgency ? t("screens.proposalDetail.invoked") : t("screens.proposalDetail.notInvoked")],
              [t("screens.proposalDetail.holder"), proposal.currentHolderRole ? role(proposal.currentHolderRole) : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 border-t border-border pt-2">
            <div className="text-[10px] font-medium text-muted">{t("screens.proposalDetail.publicPurpose")}</div>
            <p className="mt-0.5 text-[11px] leading-relaxed">{proposal.publicInterestNote}</p>
          </div>
        </div>

        {noticeDue && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">{t("screens.proposalDetail.noticeDue")}</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
              {t("screens.proposalDetail.noticeDueText", { notice: t(`notices.type.${noticeDue.type}` as MessageKey) })}
              {noticeDue.advancesTo ? ` ${t("screens.proposalDetail.noticeAdvances", { stage: stageName(noticeDue.advancesTo) })}` : ""}
            </p>
            <div className="mt-3">
              <IssueNotificationButton
                options={[noticeDue]}
                channels={PUBLICATION_CHANNELS.map((c) => ({ key: c.key, label: c.label }))}
              />
            </div>
          </div>
        )}

        {allowed && allowed.targets.length > 0 ? (
          <TransitionForm proposalId={proposal.id} targets={allowed.targets} act={proposal.project.governingAct} />
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4 text-[11px] text-muted">
            {t("screens.proposalDetail.cannotAct", {
              holder: proposal.currentHolderRole ? role(proposal.currentHolderRole) : t("screens.proposalDetail.assignedAuthority"),
            })}
          </div>
        )}
      </div>
    </div>

    {saarthi && (
      <div id="saarthi" className="scroll-mt-4">
        <SaarthiPanel diagnosis={saarthi} />
      </div>
    )}
    </div>
  );
}
