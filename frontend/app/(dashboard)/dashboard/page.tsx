import type { Metadata } from "next";
import Link from "next/link";
import {
  AlarmClock, AlertOctagon, ArrowRight, CheckCircle2, Clock, Download, FileText, Home, IndianRupee, Landmark,
  LandPlot, Map, Megaphone, Scale, Split, TrendingUp, Users,
} from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { canChooseDistrict, canSeeAllStates, fixedStateFor, scopeForDistrict, scopeForProposal } from "@backend/rbac/scope";
import {
  computeKpis, jurisdictionRollup, parcelStatusCounts, stageDwellTimes, stageFunnel,
} from "@backend/analytics/kpi";
import { compensationTrend, delayDistribution, GEO_METRICS, type GeoMetric } from "@backend/analytics/geo";
import { filterFromParams, isFiltered, proposalFilter } from "@backend/analytics/filters";
import { layoutFor, WIDGETS } from "@backend/analytics/layout";
import { formatIndianScale } from "@backend/compensation/calculator";
import { computeClock } from "@backend/statutory/clock";
import { stageFor } from "@backend/workflow/engine";
import { DonutChart, HBarChart, TrendChart, VBarChart } from "@frontend/components/charts/Charts";
import ChoroplethPanel from "@frontend/components/dashboard/ChoroplethPanel";
import LiveStamp from "@frontend/components/dashboard/LiveStamp";
import { CustomisePanel, FilterBar } from "@frontend/components/dashboard/DashboardControls";
import { STATUS_COLOUR, STATUS_ORDER } from "@frontend/components/map/legend";
import { Badge, Card, CardBody, CardHeader, EmptyState, LinkButton, PageHeader, StatTile } from "@frontend/components/ui";
import type { Tone } from "@frontend/components/ui/Badge";
import { parcelStatusKey, scopeDescKey, scopeTitleKey } from "@backend/i18n/scope";
import { stageKey, type MessageKey } from "@backend/i18n";
import { getTranslator } from "@backend/i18n/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.dashboard") };
}

const SEVERITY_TONE: Record<string, Tone> = { SAFE: "success", WATCH: "warning", URGENT: "warning", CRITICAL: "danger", BREACHED: "danger" };
const LEVEL_KEY = { state: "common.state", district: "common.district", project: "common.project" } as const;
const PROJECT_TYPES = ["HIGHWAY", "RAILWAY", "IRRIGATION", "INDUSTRIAL_CORRIDOR", "URBAN_DEVELOPMENT", "RENEWABLE_ENERGY", "MINING", "DEFENCE", "OTHER"] as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await requirePermission("dashboard", "read");
  const { locale, intl, t } = await getTranslator();
  const ha = (n: number) => t("screens.units.ha", { value: n.toLocaleString(intl, { maximumFractionDigits: 2 }) });
  const money = (n: number) => formatIndianScale(n, locale);
  const filter = filterFromParams(await searchParams);
  const [district, state] = await Promise.all([
    s.districtId ? prisma.district.findUnique({ where: { id: s.districtId }, select: { name: true } }) : null,
    s.stateId ? prisma.state.findUnique({ where: { id: s.stateId }, select: { name: true } }) : null,
  ]);
  const jurisdiction = district
    ? t("shell.districtOf", { district: district.name, state: state?.name ?? "" })
    : state
      ? state.name
      : t(scopeDescKey(s));
  const [k, funnel, dwell, rollup, statusCounts, trend, delays, layout, filterOptions, openCases] = await Promise.all([
    computeKpis(s, filter),
    stageFunnel(s, filter),
    stageDwellTimes(s, filter),
    jurisdictionRollup(s, filter),
    parcelStatusCounts(s, filter),
    compensationTrend(s, 12, filter),
    delayDistribution(s, filter),
    layoutFor(s.id),
    // Only the states and districts this officer may look at are offered.
    Promise.all([
      // The states this officer may look at, derived from the districts they may see.
      prisma.state.findMany({ where: { districts: { some: scopeForDistrict(s) } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.district.findMany({
        where: { AND: [scopeForDistrict(s), filter.stateId ? { stateId: filter.stateId } : {}] },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.ministry.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    ]),
    prisma.proposal.findMany({
      where: { AND: [scopeForProposal(s), ...proposalFilter(filter), { status: { notIn: ["CLOSED", "REJECTED", "LAPSED", "DRAFT"] } }] },
      select: {
        id: true, referenceNo: true, status: true, createdAt: true,
        project: { select: { name: true, governingAct: true } },
        stages: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" } },
      },
    }),
  ]);

  // Cases ordered by how close they are to a statutory deadline.
  const deadlines = openCases
    .map((p) => {
      const open = p.stages[0];
      const clock = computeClock(p.project.governingAct, p.status, open?.enteredAt ?? p.createdAt, open?.statutoryDeadline ?? null);
      return { ...p, clock, label: stageFor(p.project.governingAct, p.status) ? t(stageKey(p.project.governingAct, p.status)) : p.status };
    })
    .sort((a, b) => (a.clock.daysRemaining ?? 1e9) - (b.clock.daysRemaining ?? 1e9));

  const statusSlices = STATUS_ORDER.map((st) => ({
    key: st,
    label: t(parcelStatusKey(st)),
    value: statusCounts.find((c) => c.status === st)?.count ?? 0,
    colour: STATUS_COLOUR[st],
    href: `/parcels?status=${st}`,
  })).filter((x) => x.value > 0);

  const funnelData = funnel
    .map((f) => ({
      key: f.status,
      label: stageFor("LARR_2013", f.status) ? t(stageKey("LARR_2013", f.status)) : f.status.replaceAll("_", " ").toLowerCase(),
      value: f.count,
      colour: "var(--chart-1)",
    }))
    .sort((a, b) => b.value - a.value);

  const dwellData = dwell.slice(0, 8).map((d) => ({
    key: d.stage,
    label: stageFor("LARR_2013", d.stage as never) ? t(stageKey("LARR_2013", d.stage)) : d.stage.replaceAll("_", " ").toLowerCase(),
    value: Math.round(d.avgDays),
    // A status palette, not a series palette: these mean "late", not "series 3".
    colour: d.avgDays > 180 ? "var(--danger)" : d.avgDays > 60 ? "var(--warning)" : "var(--success)",
  }));

  const paidPct = k.compensationAssessed ? Math.round((k.compensationPaid / k.compensationAssessed) * 100) : 0;

  const [stateOptions, districtOptions, ministries] = filterOptions;

  // Each widget stands alone, so the user can put them in any order.
  const widgets: Record<string, React.ReactNode> = {
    attention:
      k.casesBreached > 0 || k.casesAtRiskOfLapse > 0 || k.conflictingParcels > 0 || k.compensationOutstanding > 0 ? (
        <div key="attention" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {k.casesBreached > 0 && (
            <Callout href="/proposals?clock=BREACHED" tone="danger" icon={<AlertOctagon className="h-5 w-5" />} title={t(k.casesBreached === 1 ? "screens.dashboard.breachedOne" : "screens.dashboard.breachedMany", { count: k.casesBreached })} text={t("screens.dashboard.breachedText")} />
          )}
          {k.casesAtRiskOfLapse > 0 && (
            <Callout href="/proposals?clock=CRITICAL" tone="danger" icon={<AlarmClock className="h-5 w-5" />} title={t("screens.dashboard.atRisk", { count: k.casesAtRiskOfLapse })} text={t("screens.dashboard.atRiskText")} />
          )}
          {k.conflictingParcels > 0 && (
            <Callout href="/parcels" tone="warning" icon={<Split className="h-5 w-5" />} title={t("screens.dashboard.conflicts", { count: k.conflictingParcels })} text={t("screens.dashboard.conflictsText")} />
          )}
          {k.compensationOutstanding > 0 && (
            <Callout href="/compensation" tone="warning" icon={<IndianRupee className="h-5 w-5" />} title={t("screens.dashboard.outstanding", { amount: money(k.compensationOutstanding) })} text={t("screens.dashboard.outstandingText")} />
          )}
        </div>
      ) : null,

    /* The eight KPIs the problem statement names, under its own wording. */
    kpis: (
      <section key="kpis" aria-label={t("screens.dashboard.keyIndicators")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("screens.dashboard.areaNotified")} value={ha(k.areaNotifiedHa)} hint={t("screens.dashboard.ofProposed", { area: ha(k.areaProposedHa) })} icon={<Megaphone className="h-4 w-4" />} href="/notifications" />
        <StatTile label={t("screens.dashboard.areaAcquired")} value={ha(k.areaAcquiredHa)} hint={t("screens.dashboard.areaAcquiredHint")} icon={<LandPlot className="h-4 w-4" />} tone="success" href="/parcels?status=POSSESSED" />
        <StatTile label={t("screens.dashboard.compensation")} value={money(k.compensationPaid)} hint={t("screens.dashboard.paidOfAssessed", { pct: paidPct, amount: money(k.compensationAssessed) })} icon={<IndianRupee className="h-4 w-4" />} tone="accent" href="/compensation" />
        <StatTile label={t("screens.dashboard.families")} value={`${k.affectedFamilies} / ${k.displacedFamilies}`} hint={t("screens.dashboard.familiesHint")} icon={<Users className="h-4 w-4" />} tone="info" href="/rnr" />
        <StatTile label={t("screens.dashboard.rnr")} value={`${k.rnrCompletionPct}%`} hint={t("screens.dashboard.rnrHint")} icon={<Home className="h-4 w-4" />} tone="info" href="/rnr" />
        <StatTile label={t("screens.dashboard.progress")} value={`${k.projectProgressPct}%`} hint={t("screens.dashboard.progressHint")} icon={<TrendingUp className="h-4 w-4" />} href="/projects" />
        <StatTile label={t("screens.dashboard.possession")} value={`${k.parcelsPossessed} / ${k.parcelsTotal}`} hint={t("screens.dashboard.possessionHint")} icon={<CheckCircle2 className="h-4 w-4" />} tone="success" href="/parcels?status=POSSESSED" />
        <StatTile label={t("screens.dashboard.timeline")} value={`${k.timelineAdherencePct}%`} hint={t("screens.dashboard.timelineHint")} icon={<Clock className="h-4 w-4" />} tone={k.timelineAdherencePct < 80 ? "danger" : "success"} href="/proposals" />
      </section>
    ),

    deadlines: (
      <Card key="deadlines">
        <CardHeader title={t("screens.dashboard.deadlinesTitle")} description={t("screens.dashboard.deadlinesDesc")} icon={<AlarmClock className="h-4 w-4" />} action={<Link href="/proposals" className="text-xs text-brand hover:underline">{t("screens.dashboard.allProposals")}</Link>} />
        {deadlines.length === 0 ? (
          <CardBody><EmptyState title={t("screens.dashboard.noOpen")} description={t("screens.dashboard.noOpenDesc")} /></CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {deadlines.slice(0, 6).map((d) => (
              <li key={d.id}>
                <Link href={`/proposals/${d.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-muted">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-brand">{d.referenceNo}</span>
                      <span className="truncate text-sm text-foreground">{d.project.name}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">{d.label}</div>
                  </div>
                  {d.clock.deadline ? (
                    <Badge tone={SEVERITY_TONE[d.clock.severity]}>
                      {t(`screens.severity.${d.clock.severity}` as MessageKey)} ·{" "}
                      {d.clock.daysRemaining! < 0
                        ? t("screens.units.daysOverdue", { days: Math.abs(d.clock.daysRemaining!) })
                        : t("screens.units.daysLeft", { days: d.clock.daysRemaining! })}
                    </Badge>
                  ) : (
                    <Badge>{t("screens.units.noDeadline")}</Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),

    status: (
      <Card key="status">
        <CardHeader title={t("screens.dashboard.statusTitle")} description={t("screens.dashboard.statusDesc")} icon={<LandPlot className="h-4 w-4" />} />
        <CardBody>
          {statusSlices.length ? (
            <DonutChart data={statusSlices} centreValue={String(k.parcelsTotal)} centreLabel={t("screens.dashboard.parcelsWord")} />
          ) : (
            <EmptyState title={t("screens.dashboard.noParcels")} description={t("screens.dashboard.noParcelsDesc")} />
          )}
        </CardBody>
      </Card>
    ),

    map: (
      <Card key="map">
        <CardHeader
          title={canSeeAllStates(s) ? t("screens.dashboard.mapIndia") : t("screens.dashboard.mapMine")}
          description={t("screens.dashboard.mapDesc")}
          icon={<Map className="h-4 w-4" />}
          action={<ExportCsv widget="geo" />}
        />
        <CardBody>
          <ChoroplethPanel
            metrics={Object.entries(GEO_METRICS).map(([key, m]) => ({ key: key as GeoMetric, label: t(`screens.geoMetric.${key}` as MessageKey), format: m.format }))}
            initialMetric="areaProposedHa"
            lockedStateId={fixedStateFor(s)}
            lockedStateName={fixedStateFor(s) ? state?.name ?? null : null}
          />
        </CardBody>
      </Card>
    ),

    trend: (
      <Card key="trend">
        <CardHeader
          title={t("screens.dashboard.trendTitle")}
          description={t("screens.dashboard.trendDesc")}
          icon={<IndianRupee className="h-4 w-4" />}
          action={<ExportCsv widget="trend" />}
        />
        <CardBody>
          <TrendChart
            data={trend as unknown as Record<string, string | number>[]}
            series={[{ key: "assessed", label: t("screens.dashboard.assessed") }, { key: "paid", label: t("screens.dashboard.paid") }]}
            format="money"
          />
        </CardBody>
      </Card>
    ),

    delays: (
      <Card key="delays">
        <CardHeader
          title={t("screens.dashboard.waitingTitle")}
          description={t("screens.dashboard.waitingDesc")}
          icon={<Clock className="h-4 w-4" />}
          action={<ExportCsv widget="delays" />}
        />
        <CardBody>
          <VBarChart
            data={delays.map((d) => ({
              key: d.key,
              label: t(`screens.delayBand.${d.key}` as MessageKey),
              value: d.cases,
              colour: d.key === "over" ? "var(--danger)" : d.key === "b181_365" ? "var(--warning)" : "var(--chart-1)",
            }))}
          />
        </CardBody>
      </Card>
    ),

    funnel: (
      <Card key="funnel">
        <CardHeader title={t("screens.dashboard.whereTitle")} description={t("screens.dashboard.whereDesc")} icon={<Scale className="h-4 w-4" />} action={<ExportCsv widget="funnel" />} />
        <CardBody><HBarChart data={funnelData} /></CardBody>
      </Card>
    ),

    bottlenecks: (
      <Card key="bottlenecks">
        <CardHeader title={t("screens.dashboard.bottlenecks")} description={t("screens.dashboard.bottlenecksDesc")} icon={<Clock className="h-4 w-4" />} action={<ExportCsv widget="dwell" />} />
        <CardBody><HBarChart data={dwellData} unit={t("screens.units.daysShort")} /></CardBody>
      </Card>
    ),

    rollup: (
      <Card key="rollup">
        <CardHeader
          title={t(`screens.dashboard.progressBy_${rollup.level}` as MessageKey)}
          description={t("screens.dashboard.rollupDesc")}
          icon={<Landmark className="h-4 w-4" />}
          action={<ExportCsv widget="rollup" />}
        />
        {rollup.rows.length === 0 ? (
          <CardBody><EmptyState title={t("screens.dashboard.noLand")} /></CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2.5 text-left font-semibold">{t(LEVEL_KEY[rollup.level])}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("screens.dashboard.colParcels")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("common.area")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("screens.dashboard.colConflicts")}</th>
                  <th className="px-5 py-2.5 text-left font-semibold">{t("screens.dashboard.colPossession")}</th>
                </tr>
              </thead>
              <tbody>
                {rollup.rows.map((r) => {
                  const pct = r.parcels ? Math.round((r.possessed / r.parcels) * 100) : 0;
                  const href = rollup.level === "project" ? `/projects/${r.id}` : `/projects`;
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-surface-muted">
                      <td className="px-5 py-2.5">
                        <Link href={href} className="font-medium text-foreground hover:text-brand">{r.name}</Link>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.parcels}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{ha(r.hectares)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.conflicts ? <span className="font-medium text-danger">{r.conflicts}</span> : "0"}</td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-32 overflow-hidden rounded-full bg-surface-muted">
                            <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-muted">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    ),
  };

  /** Widgets that read better side by side when they are next to each other. */
  const HALF = new Set(["deadlines", "status", "trend", "delays", "funnel", "bottlenecks"]);
  const rendered = layout.filter((key) => widgets[key]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(scopeTitleKey(s))}
        description={t("screens.dashboard.liveDesc", { place: jurisdiction })}
        badge={<Badge tone="success" icon={<span className="h-1.5 w-1.5 rounded-full bg-success" />}>{t("screens.dashboard.live")}</Badge>}
        actions={
          <>
            <LiveStamp />
            <CustomisePanel
              widgets={WIDGETS.map((w) => ({ key: w.key, label: t(`screens.widget.${w.key}` as MessageKey), description: t(`screens.widget.${w.key}Desc` as MessageKey) }))}
              layout={[...layout]}
            />
            <LinkButton href="/parcels" variant="secondary" size="sm" icon={<Map className="h-4 w-4" />}>{t("nav.landMap")}</LinkButton>
            <LinkButton href="/inbox" size="sm" icon={<FileText className="h-4 w-4" />}>{t("nav.inbox")}</LinkButton>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar
          states={stateOptions}
          districts={districtOptions}
          ministries={ministries.map((m) => ({ id: m.id, name: `${m.code} — ${ministryName(t, m.code, m.name)}` }))}
          types={PROJECT_TYPES.map((value) => ({ value, label: t(`screens.projectType.${value}` as MessageKey) }))}
          showState={canSeeAllStates(s)}
          showDistrict={canChooseDistrict(s)}
        />
        {isFiltered(filter) && <span className="text-xs text-muted">{t("screens.dashboard.filtered")}</span>}
      </div>

      {/* In the order this user arranged them (Customise). */}
      <div className="grid gap-5 lg:grid-cols-2">
        {rendered.map((key) => (
          <div key={key} className={HALF.has(key) ? "lg:col-span-1" : "lg:col-span-2"}>
            {widgets[key]}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A ministry's name in the reader's language; one added later by an administrator keeps its own. */
function ministryName(t: (key: MessageKey) => string, code: string, name: string): string {
  const key = `screens.ministry.${code}` as MessageKey;
  const translated = t(key);
  return translated === key ? name : translated;
}

function Callout({ href, tone, icon, title, text }: { href: string; tone: "danger" | "warning"; icon: React.ReactNode; title: string; text: string }) {
  const cls = tone === "danger" ? "border-danger/30 bg-danger-soft text-danger" : "border-warning/30 bg-warning-soft text-warning";
  return (
    <Link href={href} className={`group flex items-start gap-3 rounded-xl border p-4 transition hover:shadow ${cls}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-foreground/70">{text}</span>
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 opacity-0 transition group-hover:opacity-100" />
    </Link>
  );
}

/** Download exactly what the widget shows, scoped the same way, and audited. */
function ExportCsv({ widget }: { widget: string }) {
  return (
    <a
      href={`/api/analytics/export?widget=${widget}`}
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted hover:bg-surface-muted hover:text-foreground"
    >
      <Download className="h-3 w-3" aria-hidden />
      CSV
    </a>
  );
}
