/** The Secretary's one-page brief. */
import { prisma } from "@backend/db/client";
import { computeKpis, stageDwellTimes } from "@backend/analytics/kpi";
import { geoRows } from "@backend/analytics/geo";
import { reconciliation } from "@backend/compensation/disbursement";
import { EMPTY_FILTER, proposalFilter, type DashboardFilter } from "@backend/analytics/filters";
import { formatIndianScale } from "@backend/compensation/format";
import { computeClock } from "@backend/statutory/clock";
import { stageFor } from "@backend/workflow/engine";
import { describeFilter } from "@backend/reports/registry";
import { scopeForProposal, type Actor } from "@backend/rbac/scope";
import { english, jurisdictionName, type Translate } from "@backend/reports/words";
import { stageKey, type Locale } from "@backend/i18n";

export interface BriefFinding {
  severity: "critical" | "warning" | "note";
  headline: string;
  detail: string;
  action: string;
  /** Where to go and see it. */
  href?: string;
}

export interface ExecutiveBrief {
  title: string;
  jurisdiction: string;
  generatedAt: Date;
  filterNote: string;
  summary: string;
  headlines: { label: string; value: string }[];
  findings: BriefFinding[];
}

/**
 * The brief, worded in the given language (English by default: the PDF and the scheduled
 * emails).
 */
export async function executiveBrief(
  actor: Actor,
  filter: DashboardFilter = EMPTY_FILTER,
  t: Translate = english,
  locale: Locale = "en",
): Promise<ExecutiveBrief> {
  const money$ = (n: number) => formatIndianScale(n, locale);
  const list = (parts: string[]) => new Intl.ListFormat(locale === "en" ? "en-IN" : `${locale}-IN`, { type: "conjunction" }).format(parts);
  const stageName = (act: string, status: string) => {
    const key = stageKey(act, status);
    const text = t(key);
    return text === key ? status : text;
  };
  const [k, money, geo, dwell, openCases] = await Promise.all([
    computeKpis(actor, filter),
    reconciliation(actor),
    geoRows(actor, null, filter),
    stageDwellTimes(actor, filter),
    prisma.proposal.findMany({
      where: { AND: [scopeForProposal(actor), ...proposalFilter(filter), { status: { notIn: ["CLOSED", "REJECTED", "LAPSED", "DRAFT"] } }] },
      select: {
        id: true, referenceNo: true, status: true, createdAt: true,
        project: { select: { name: true, governingAct: true } },
        stages: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" } },
      },
    }),
  ]);

  const cases = openCases
    .map((p) => {
      const open = p.stages[0];
      const clock = computeClock(p.project.governingAct, p.status, open?.enteredAt ?? p.createdAt, open?.statutoryDeadline ?? null);
      return { ...p, clock, stage: stageFor(p.project.governingAct, p.status) ? stageName(p.project.governingAct, p.status) : p.status };
    })
    .sort((a, b) => (a.clock.daysRemaining ?? 1e9) - (b.clock.daysRemaining ?? 1e9));

  const breached = cases.filter((c) => c.clock.severity === "BREACHED");
  const critical = cases.filter((c) => c.clock.severity === "CRITICAL");
  const findings: BriefFinding[] = [];

  if (breached.length) {
    findings.push({
      severity: "critical",
      headline: t(breached.length === 1 ? "screens.brief.breachedOne" : "screens.brief.breachedMany", { count: breached.length }),
      detail: t("screens.brief.breachedDetail", {
        list: breached
          .slice(0, 3)
          .map((c) => t("screens.brief.breachedItem", { ref: c.referenceNo, stage: c.stage, days: Math.abs(c.clock.daysRemaining ?? 0) }))
          .join("; "),
      }),
      action: t("screens.brief.breachedAction"),
      href: "/proposals?clock=BREACHED",
    });
  }
  if (critical.length) {
    findings.push({
      severity: "critical",
      headline: t(critical.length === 1 ? "screens.brief.criticalOne" : "screens.brief.criticalMany", { count: critical.length }),
      detail: critical
        .slice(0, 3)
        .map((c) => t("screens.brief.criticalItem", { ref: c.referenceNo, stage: c.stage, days: c.clock.daysRemaining ?? 0 }))
        .join("; "),
      action: t("screens.brief.criticalAction"),
      href: "/proposals?clock=CRITICAL",
    });
  }

  if (money.outstanding > 0) {
    const worst = money.byDistrict.slice(0, 3).filter((d) => d.outstanding > 0);
    findings.push({
      severity: money.outstanding > money.assessed * 0.5 ? "critical" : "warning",
      headline: t("screens.brief.unpaid", { amount: money$(money.outstanding) }),
      detail: worst.length
        ? t("screens.brief.unpaidDetail", {
            list: list(worst.map((d) => t("screens.brief.unpaidItem", { district: d.district, amount: money$(d.outstanding) }))),
          })
        : t("screens.brief.unpaidDetailPlain"),
      action: t("screens.brief.unpaidAction"),
      href: "/compensation",
    });
  }
  if (money.failed > 0) {
    findings.push({
      severity: "warning",
      headline: t("screens.brief.rejected", { amount: money$(money.failed) }),
      detail: t("screens.brief.rejectedDetail"),
      action: t("screens.brief.rejectedAction"),
      href: "/compensation",
    });
  }

  if (k.conflictingParcels > 0) {
    findings.push({
      severity: "warning",
      headline: t(k.conflictingParcels === 1 ? "screens.brief.conflictsOne" : "screens.brief.conflictsMany", { count: k.conflictingParcels }),
      detail: t("screens.brief.conflictsDetail"),
      action: t("screens.brief.conflictsAction"),
      href: "/parcels",
    });
  }

  const slowest = dwell.filter((d) => d.avgDays > 180).slice(0, 2);
  if (slowest.length) {
    findings.push({
      severity: "warning",
      headline: t("screens.brief.slowest", { stages: list(slowest.map((d) => stageName("LARR_2013", d.stage))) }),
      detail: slowest
        .map((d) => t("screens.brief.slowestItem", { stage: stageName("LARR_2013", d.stage), days: Math.round(d.avgDays) }))
        .join("; "),
      action: t("screens.brief.slowestAction"),
      href: "/dashboard",
    });
  }

  const laggards = geo
    .filter((g) => g.parcels >= 10)
    .sort((a, b) => a.possessedPct - b.possessedPct)
    .slice(0, 3);
  if (laggards.length && laggards[0].possessedPct < 25) {
    findings.push({
      severity: "note",
      headline: t("screens.brief.laggards", {
        list: laggards.map((l) => t("screens.brief.laggardItem", { name: l.name, pct: l.possessedPct })).join(", "),
      }),
      detail: t("screens.brief.laggardsDetail"),
      action: t("screens.brief.laggardsAction"),
      href: "/dashboard",
    });
  }

  if (k.rnrCompletionPct < 50 && k.affectedFamilies > 0) {
    findings.push({
      severity: "warning",
      headline: t(k.affectedFamilies === 1 ? "screens.brief.rnrOne" : "screens.brief.rnrMany", { pct: k.rnrCompletionPct, count: k.affectedFamilies }),
      detail: t(k.displacedFamilies === 1 ? "screens.brief.rnrDetailOne" : "screens.brief.rnrDetailMany", { count: k.displacedFamilies }),
      action: t("screens.brief.rnrAction"),
      href: "/rnr",
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "note",
      headline: t("screens.brief.noneHeadline"),
      detail: t("screens.brief.noneDetail"),
      action: t("screens.brief.noneAction"),
    });
  }

  const severe = findings.filter((f) => f.severity === "critical").length;
  const jurisdiction = jurisdictionName(t, actor);
  const hectares = (n: number) => t("screens.units.ha", { value: n.toLocaleString("en-IN", { maximumFractionDigits: 0 }) });

  return {
    title: t("screens.reportPack.brief"),
    jurisdiction,
    generatedAt: new Date(),
    filterNote: await describeFilter(filter, t),
    summary: [
      t("screens.brief.summary", {
        plots: k.parcelsTotal,
        states: t(geo.length === 1 ? "screens.brief.statesOne" : "screens.brief.statesMany", { count: geo.length }),
        possessed: k.parcelsPossessed,
        pct: k.projectProgressPct,
        paid: money$(k.compensationPaid),
        assessed: money$(k.compensationAssessed),
      }),
      severe
        ? t(severe === 1 ? "screens.brief.decideOne" : "screens.brief.decideMany", { count: severe })
        : t(findings.length === 1 ? "screens.brief.watchOne" : "screens.brief.watchMany", { count: findings.length }),
    ].join(" "),
    headlines: [
      { label: t("screens.brief.hArea"), value: hectares(k.areaProposedHa) },
      { label: t("screens.brief.hAcquired"), value: hectares(k.areaAcquiredHa) },
      { label: t("screens.brief.hPaid"), value: money$(k.compensationPaid) },
      { label: t("screens.brief.hOutstanding"), value: money$(money.outstanding) },
      { label: t("screens.brief.hFamilies"), value: t("screens.brief.hFamiliesValue", { affected: k.affectedFamilies, displaced: k.displacedFamilies }) },
      { label: t("screens.brief.hTimeline"), value: `${k.timelineAdherencePct}%` },
      { label: t("screens.brief.hAtRisk"), value: String(k.casesAtRiskOfLapse) },
      { label: t("screens.brief.hBreached"), value: String(k.casesBreached) },
    ],
    findings,
  };
}
