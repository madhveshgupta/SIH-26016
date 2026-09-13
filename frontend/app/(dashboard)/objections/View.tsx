import Link from "next/link";
import { Landmark, Plus, Scale } from "lucide-react";
import type { ObjectionStatus } from "@prisma/client";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForOptionalParcel, scopeForProposal } from "@backend/rbac/scope";
import { mayHearObjections } from "@backend/statutory/notifications";
import { storedRouteText } from "@backend/grievances/localise";
import type { MessageKey } from "@backend/i18n";
import { rich } from "@frontend/lib/rich";
import { Badge, EmptyState, LinkButton, PageHeader, type Tone } from "@frontend/components/ui";
import { cn } from "@frontend/lib/cn";
import ObjectionActions from "./ObjectionActions";
import { getTranslator } from "@backend/i18n/locale";
import { projectCrumbs, sectionPath, type ProjectContext } from "@frontend/lib/project-context";

const TONE: Record<ObjectionStatus, Tone> = {
  FILED: "info",
  UNDER_REVIEW: "info",
  HEARING_SCHEDULED: "warning",
  HEARD: "warning",
  ACCEPTED: "success",
  PARTIALLY_ACCEPTED: "brand",
  REJECTED: "neutral",
  WITHDRAWN: "neutral",
};

export default async function ObjectionsView({ show, project }: { show?: string; project?: ProjectContext }) {
  const s = await requirePermission("objection", "read");
  const { t, intl } = await getTranslator();
  const tk = (key: string) => t(key as MessageKey);
  const day = (d: Date) => d.toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric" });
  const base = sectionPath(project, "objections", "/objections");

  const rows = await prisma.objection.findMany({
    // Case scope and plot scope: a district officer on a multi-district
    // highway sees objections about land in their own district.
    where: {
      AND: [{ proposal: scopeForProposal(s) }, scopeForOptionalParcel(s), project ? { proposal: { projectId: project.id } } : {}],
    },
    include: {
      proposal: { select: { id: true, referenceNo: true, project: { select: { name: true, governingAct: true } } } },
      parcel: { select: { khasraNo: true, status: true, village: { select: { name: true } } } },
      filedByUser: { select: { fullName: true } },
    },
    orderBy: [{ decidedAt: { sort: "asc", nulls: "first" } }, { filedAt: "desc" }],
  });

  const pending = rows.filter((r) => !r.decidedAt && r.status !== "WITHDRAWN");
  const online = rows.filter((r) => r.filedByUserId).length;
  const now = new Date();
  const dueToDecide = pending.filter((r) => r.hearingDate && r.hearingDate <= now).length;
  const visible = show === "decided" ? rows.filter((r) => r.decidedAt) : show === "all" ? rows : pending;
  const mayAct = can(s.role, "objection", "approve");
  const mayRaise = can(s.role, "grievance", "create");

  // A citizen's own representations, whatever statute each one travels under.
  const grievances = mayRaise
    ? await prisma.grievance.findMany({
        where: { filedByUserId: s.id },
        include: {
          parcel: { select: { khasraNo: true, village: { select: { name: true } } } },
          assignedTo: { select: { fullName: true } },
        },
        orderBy: [{ decidedAt: { sort: "asc", nulls: "first" } }, { filedAt: "desc" }],
        take: 50,
      })
    : [];

  return (
    <div>
      <PageHeader
        title={t("pages.objectionsTitle")}
        description={t("pageDesc.objections")}
        crumbs={project ? projectCrumbs(project, t("nav.projects"), t("nav.objections")) : [{ label: t("navGroups.land") }, { label: t("nav.objections") }]}
        badge={<Badge tone="brand">{rows.length}</Badge>}
        actions={
          mayRaise ? (
            <LinkButton href="/objections/raise" icon={<Plus className="h-4 w-4" />}>
              {t("screens.objPage.raise")}
            </LinkButton>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {[
          { key: undefined, label: t("screens.objPage.awaiting"), count: pending.length },
          { key: "decided", label: t("screens.objPage.decided"), count: rows.length - pending.length },
          { key: "all", label: t("common.all"), count: rows.length },
        ].map((f) => (
          <Link
            key={f.label}
            href={f.key ? `${base}?show=${f.key}` : base}
            className={cn(
              "rounded-full border px-3 py-1",
              show === f.key ? "border-brand bg-brand text-white" : "border-border bg-surface text-foreground hover:bg-surface-muted",
            )}
          >
            {f.label} <span className="ml-1 tabular-nums opacity-70">{f.count}</span>
          </Link>
        ))}
        <span className="ml-auto text-muted">
          {t("screens.objPage.stats", { online, ready: dueToDecide })}
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Scale className="h-5 w-5" />}
          title={t("screens.objPage.none")}
          description={mayRaise ? t("screens.objPage.noneCitizen") : t("screens.objPage.noneOfficer")}
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((o) => {
            const act = o.proposal.project.governingAct;
            const open = !o.decidedAt && o.status !== "WITHDRAWN";
            const authority = act === "LARR_2013" || act === "STATE_ACT" ? t("screens.objPage.authCollector") : t("screens.objPage.authCala");
            return (
              <li key={o.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {o.objectorName}
                      {o.filedByUser && <Badge tone="info">{t("screens.objPage.filedOnline")}</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      <Link href={`/proposals/${o.proposal.id}`} className="font-mono text-brand hover:underline">
                        {o.proposal.referenceNo}
                      </Link>
                      {!project && <span>{o.proposal.project.name}</span>}
                      {o.parcel && (
                        <span>
                          {rich(t("screens.objPage.khasraOf"), {
                            no: <span className="font-mono">{o.parcel.khasraNo}</span>,
                            village: o.parcel.village.name,
                          })}
                        </span>
                      )}
                      <span>{t("screens.objPage.filedOn", { date: day(o.filedAt) })}</span>
                    </div>
                  </div>
                  <Badge tone={TONE[o.status]}>{tk(`objectionStatus.${o.status}`)}</Badge>
                </div>

                <p className="mt-2 text-sm leading-relaxed text-foreground">{o.grounds}</p>

                {open && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    <p className="text-xs text-muted">
                      {o.hearingDate
                        ? o.hearingDate > now
                          ? t("screens.objPage.hearingListed", { date: day(o.hearingDate) })
                          : t("screens.objPage.heardAwaiting", { date: day(o.hearingDate), authority })
                        : t("screens.objPage.noHearing", { authority })}
                    </p>
                    {mayAct && mayHearObjections(act, s.role) && (
                      <ObjectionActions id={o.id} hearingDate={o.hearingDate?.toISOString() ?? null} />
                    )}
                  </div>
                )}

                {o.decidedAt && (
                  <div className="mt-3 rounded-lg bg-surface-muted p-3 text-xs">
                    <div className="font-medium">{o.decision}</div>
                    {/* Reasons are mandatory: "rejected" with no reasoning is the
                        most common ground on which an acquisition is quashed. */}
                    <div className="mt-1 leading-relaxed text-muted">
                      <span className="font-medium text-foreground">{t("screens.objPage.reasons")} </span>
                      {o.decisionReasons}
                    </div>
                    <div className="mt-1 text-muted">
                      {t("screens.objPage.decidedOn", { date: day(o.decidedAt) })}
                      {o.hearingDate && ` ${t("screens.objPage.afterHearing", { date: day(o.hearingDate) })}`}
                      {o.status === "ACCEPTED" && o.parcel && ` · ${t("screens.objPage.leftOut")}`}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {mayRaise && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold">{t("screens.objPage.everythingElse")}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {t("screens.objPage.everythingElseDesc")}
          </p>
          {grievances.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
              {t("screens.objPage.nothingYet")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {grievances.map((g) => (
                <li key={g.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {tk(`screens.objPage.cat_${g.category}`)}
                        {g.objectionId && <Badge tone="brand">{t("screens.objPage.alsoFormal")}</Badge>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span className="font-mono">{g.referenceNo}</span>
                        {g.parcel && (
                          <span>
                            {rich(t("screens.objPage.khasraOf"), {
                              no: <span className="font-mono">{g.parcel.khasraNo}</span>,
                              village: g.parcel.village.name,
                            })}
                          </span>
                        )}
                        <span>{t("screens.objPage.raisedOn", { date: day(g.filedAt) })}</span>
                      </div>
                    </div>
                    <Badge tone={g.decidedAt ? (g.status === "REJECTED" ? "neutral" : "success") : "info"}>
                      {tk(`screens.objPage.gst_${g.status}`)}
                    </Badge>
                  </div>

                  <p className="mt-2 flex gap-2 text-xs leading-relaxed text-muted">
                    <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      {t("screens.objPage.withAuthority", {
                        section: storedRouteText(t, g.statuteSection),
                        authority: storedRouteText(t, g.authorityLabel),
                      })}
                      {g.assignedTo ? ` (${g.assignedTo.fullName})` : ""}
                    </span>
                  </p>

                  {g.decidedAt && (
                    <div className="mt-2 rounded-lg bg-surface-muted p-3 text-xs">
                      <div className="font-medium">{g.decision}</div>
                      <div className="mt-1 leading-relaxed text-muted">
                        <span className="font-medium text-foreground">{t("screens.objPage.reasons")} </span>
                        {g.decisionReasons}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
