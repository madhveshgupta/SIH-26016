"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Geometry } from "geojson";
import {
  AlertTriangle, ArrowUpRight, Building2, Download, FileText, Info,
  LandPlot, Layers, MapPin, Ruler, Split, Users,
} from "lucide-react";
import { Badge, EmptyState } from "@frontend/components/ui";
import type { Tone } from "@frontend/components/ui/Badge";
import { buttonClass } from "@frontend/components/ui/Button";
import { formatIndianScale } from "@backend/compensation/format";
import { cn } from "@frontend/lib/cn";
import { rich } from "@frontend/lib/rich";
import { STATUS_COLOUR, STATUS_ORDER, STATUS_TONE } from "./legend";
import { useLocale, useT } from "@frontend/components/I18nProvider";
import { parcelStatusKey } from "@backend/i18n/scope";
import { stageKey } from "@backend/i18n/core";
import type { MessageKey } from "@backend/i18n/types";

type T = ReturnType<typeof useT>;

/** What the map layer already knows about a plot — the map popup shows this. */
export interface PlotSummary {
  id: string;
  khasraNo: string;
  status: string;
  village: string;
  district: string;
  state: string;
  project: string;
  projectRef: string;
  projectId: string;
  ulpin: string | null;
  recordHa: number | null;
  mapHa: number | null;
  discrepancyHa: number | null;
  geometryKind: string;
  boundaryAccuracyM: number | null;
  chainageM: number | null;
  hasConflict: boolean;
  otherProjects: string | null;
}

/** Everything else, fetched once per plot from /api/gis/parcels/[id]. */
interface PlotDetail {
  id: string;
  khasraNo: string;
  ulpin: string | null;
  status: string;
  village: string;
  tehsil: string;
  district: string;
  state: string;
  landUse: string;
  chainageM: number | null;
  hasConflict: boolean;
  geometry: Geometry | null;
  area: { recordHa: number | null; mapHa: number | null; differenceHa: number | null; differencePct: number | null; areaFromRecord: boolean };
  boundary: {
    geometryKind: string; accuracyM: number | null; dataSource: string; sourcePlotId: string | null;
    syncedAt: string | null; centroid: { lat: number; lng: number } | null;
    points: { seq: number; lat: number; lng: number; sideM: number; elevationM: number | null }[];
  };
  project: {
    id: string; name: string; referenceNo: string; type: string; governingAct: string;
    authority: string; ministry: string | null; rightOfWayM: number | null;
    estimatedAreaHectares: number | null; totalParcels: number; possessedParcels: number;
  };
  proposal: { id: string; referenceNo: string; status: string } | null;
  owners: { id: string; fullName: string; fatherName: string | null; sharePct: number; hasPortalLogin: boolean }[];
  compensation: {
    assessed: number; paid: number;
    records: { id: string; owner: string; payable: number; total: number; assessedAt: string;
      payments: { amount: number; status: string; paidAt: string | null; utrNumber: string | null }[] }[];
  };
  awards: { id: string; awardNo: string; declaredOn: string; publishedOn: string | null; totalAmount: number; isRnRAward: boolean }[];
  objections: { id: string; filedAt: string; status: string; grounds: string; objectorName: string; hearingDate: string | null; decidedAt: string | null }[];
  possession: { takenOn: string; handedOverBy: string | null; receivedBy: string | null; remarks: string | null } | null;
  surveys: { id: string; kind: string; capturedAt: string; walkedAreaHectares: number | null; surveyor: string }[];
  claimedBy: { projectId: string; project: string; referenceNo: string; type: string; parcelId: string | null; khasraNo: string | null; overlapHa: number | null }[];
  nearby: { id: string; khasraNo: string; status: string; village: string; project: string; projectId: string; mapHa: number | null; metres: number; adjoining: boolean; visible: boolean }[];
  history: { id: string; action: string; at: string; actor: string; actorRole: string | null; detail: unknown }[];
}

/** Where a plot's outline came from; the wording is screens.plotRecord.src_<KIND>. */
const SOURCE_TONE: Record<string, Tone> = {
  TRACED: "success", SURVEYED: "success", OSM_FIELD: "info", GENERATED: "warning", ENVELOPE: "warning",
};

const TABS = [
  { id: "overview", label: "screens.plotRecord.tabOverview" },
  { id: "ownership", label: "screens.plotRecord.tabOwnership" },
  { id: "project", label: "screens.plotRecord.tabProject" },
  { id: "boundary", label: "screens.plotRecord.tabBoundary" },
  { id: "nearby", label: "screens.plotRecord.tabNearby" },
  { id: "history", label: "screens.plotRecord.tabHistory" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Dates in the viewer's language. */
function useDate() {
  const { intl } = useLocale();
  return (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric" }) : "—");
}
const sentence = (v: string) => v.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
/** A coded value by its dictionary name; the code itself, readably, if the dictionary has none. */
const named = (t: T, key: string, raw: string) => {
  const text = t(key as MessageKey);
  return text === key ? sentence(raw) : text;
};

/** The complete record of one plot, as tabs — the full-details view the map popup links to. */
export default function PlotRecord({ plotId }: { plotId: string }) {
  const t = useT();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("overview");
  const [detail, setDetail] = useState<PlotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/gis/parcels/${encodeURIComponent(plotId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? t("screens.plotRecord.errOutside") : t("screens.plotRecord.errLoad")))))
      .then((d: PlotDetail) => !cancelled && setDetail(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [plotId, t]);

  const plot = useMemo<PlotSummary | null>(() => {
    if (!detail) return null;
    return {
      id: detail.id, khasraNo: detail.khasraNo, status: detail.status,
      village: detail.village, district: detail.district, state: detail.state,
      project: detail.project.name, projectRef: detail.project.referenceNo, projectId: detail.project.id,
      ulpin: detail.ulpin, recordHa: detail.area.recordHa, mapHa: detail.area.mapHa,
      discrepancyHa: detail.area.differenceHa, geometryKind: detail.boundary.geometryKind,
      boundaryAccuracyM: detail.boundary.accuracyM, chainageM: detail.chainageM,
      hasConflict: detail.hasConflict, otherProjects: null,
    };
  }, [detail]);

  const colour = plot ? STATUS_COLOUR[plot.status] ?? "#94a3b8" : "#94a3b8";
  const kind = SOURCE_TONE[plot?.geometryKind ?? ""] ? plot!.geometryKind : "ENVELOPE";
  const source = {
    label: t(`screens.plotRecord.src_${kind}` as MessageKey),
    tone: SOURCE_TONE[kind],
    text: t(`screens.plotRecord.src_${kind}_text` as MessageKey),
  };
  const go = useCallback((id: TabId) => setTab(id), []);
  /** An adjoining plot, or the same land in a competing project: open its record. */
  const openPlot = useCallback((id: string) => router.push(`/parcels/${encodeURIComponent(id)}`), [router]);

  return (
    <section aria-label={t("screens.plotRecord.aria")} className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border px-4">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            aria-selected={tb.id === tab}
            onClick={() => setTab(tb.id)}
            className={cn(
              "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition",
              tb.id === tab ? "border-brand font-semibold text-brand" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t(tb.label)}
            {tb.id === "nearby" && detail && (
              <span className="rounded-full bg-surface-muted px-1.5 text-[10px] tabular-nums text-muted">{detail.nearby.length}</span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="@container bg-background px-4 py-4 sm:px-5">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        {!plot && !error && <Loading rows={5} />}
        {plot && tab === "overview" && (
          <Overview plot={plot} detail={detail} colour={colour} source={source} go={go} onSelectPlot={openPlot} />
        )}
        {plot && tab === "ownership" && <Ownership plot={plot} detail={detail} />}
        {plot && tab === "project" && <ProjectTab plot={plot} detail={detail} />}
        {plot && tab === "boundary" && <BoundaryTab plot={plot} detail={detail} source={source} />}
        {plot && tab === "nearby" && <Nearby detail={detail} onSelectPlot={openPlot} />}
        {plot && tab === "history" && <History detail={detail} />}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- sections -- */

function Section({ n, title, description, icon, action, children }: {
  n: number; title: string; description?: string; icon?: React.ReactNode;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand-soft text-[10px] font-bold text-brand">{n}</span>
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground">
              {icon}{title}
            </h3>
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

/** Label/value pairs as a real definition list — reads as a record, not a form. */
function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,38%)_1fr] gap-x-3 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs leading-5 text-muted">{k}</dt>
          <dd className="min-w-0 leading-5 text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Overview({
  plot, detail, colour, source, go, onSelectPlot,
}: {
  plot: PlotSummary; detail: PlotDetail | null; colour: string;
  source: { label: string; tone: Tone; text: string }; go: (t: TabId) => void; onSelectPlot: (id: string) => void;
}) {
  const t = useT();
  const record = detail?.area.recordHa ?? plot.recordHa;
  const mapped = detail?.area.mapHa ?? plot.mapHa;
  const diff = detail?.area.differenceHa ?? plot.discrepancyHa;
  const diffPct = detail?.area.differencePct ?? (record && diff != null ? (diff / record) * 100 : null);
  const material = diff != null && Math.abs(diff) >= 0.01 && diffPct != null && Math.abs(diffPct) >= 10;

  return (
    <div className="space-y-4">
      {/* 1 */}
      <Section n={1} title={t("screens.plotRecord.basicInfo")} icon={<LandPlot className="h-3.5 w-3.5 text-brand" />}>
        <Facts
          rows={[
            [t("screens.plotRecord.khasraNo"), <span key="k" className="font-mono font-medium">{plot.khasraNo}</span>],
            [t("common.village"), plot.village],
            [t("screens.plotRecord.tehsil"), detail?.tehsil ?? "—"],
            [t("common.district"), plot.district],
            [t("common.state"), plot.state],
            [t("screens.plotRecord.currentStatus"), <Badge key="s" tone={STATUS_TONE[plot.status] ?? "neutral"} icon={<span className="h-2 w-2 rounded-full" style={{ background: colour }} />}>{t(parcelStatusKey(plot.status))}</Badge>],
            [t("screens.plotRecord.landUse"), detail ? named(t, `screens.landUse.${detail.landUse}`, detail.landUse) : "—"],
            [t("common.project"), <span key="p" className="font-medium">{plot.project}</span>],
            [
              t("screens.plotRecord.projectRef"),
              <span key="r" className="font-mono text-xs">
                {plot.projectRef}
                {plot.chainageM != null && <span className="ml-2 font-sans text-muted">{t("screens.plotRecord.kmAlong", { km: (plot.chainageM / 1000).toFixed(2) })}</span>}
              </span>,
            ],
          ]}
        />
      </Section>

      {/* 2 */}
      <Section
        n={2}
        title={t("screens.plotRecord.areaDetails")}
        description={t("screens.plotRecord.areaDesc")}
        icon={<Ruler className="h-3.5 w-3.5 text-brand" />}
      >
        <div className="grid gap-2.5 @md:grid-cols-3">
          <AreaTile label={t("screens.plotRecord.recordArea")} value={record == null ? t("screens.plotRecord.notPublished") : `${record.toFixed(4)}`} unit={record == null ? undefined : t("screens.units.haShort")} />
          <AreaTile label={t("screens.plotRecord.measuredOnMap")} value={mapped == null ? "—" : `${mapped.toFixed(4)}`} unit={mapped == null ? undefined : t("screens.units.haShort")} />
          <AreaTile
            label={t("screens.plotRecord.difference")}
            value={diff == null ? "—" : `${diff > 0 ? "+" : ""}${diff.toFixed(4)}`}
            unit={diff == null ? undefined : t("screens.units.haShort")}
            tone={material ? "warning" : diff == null ? undefined : "muted"}
            hint={diffPct == null ? undefined : t("screens.plotRecord.pctOfRecord", { pct: `${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}` })}
          />
        </div>
        {diff != null && diff !== 0 && (
          <p className={cn("mt-2.5 rounded-lg px-3 py-2 text-xs", material ? "bg-warning-soft text-warning" : "bg-surface-muted text-muted")}>
            {material && <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />}
            {rich(t(diffPct != null ? "screens.plotRecord.diffText" : "screens.plotRecord.diffTextNoPct", {
              ha: Math.abs(diff).toFixed(4),
              pct: diffPct != null ? Math.abs(diffPct).toFixed(1) : "",
            }), { word: <strong className="font-semibold">{t(diff > 0 ? "screens.plotRecord.larger" : "screens.plotRecord.smaller")}</strong> })}
            {material && ` ${t("screens.plotRecord.verifyGround")}`}
          </p>
        )}
        {record == null && (
          <p className="mt-2.5 rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted">
            {t("screens.plotRecord.noRecordArea")}
          </p>
        )}
      </Section>

      {/* 3 */}
      <Section
        n={3}
        title={t("screens.plotRecord.locBoundary")}
        icon={<MapPin className="h-3.5 w-3.5 text-brand" />}
      >
        <Facts
          rows={[
            [t("screens.plotRecord.boundarySource"), <Badge key="b" tone={source.tone}>{source.label}</Badge>],
            [t("screens.plotRecord.traceability"), <span key="t" className="text-xs text-muted">{source.text}</span>],
            [
              t("screens.plotRecord.accuracy"),
              plot.boundaryAccuracyM == null
                ? <span className="text-muted">{t("screens.plotRecord.notMeasuredPortal")}</span>
                : <span className="tabular-nums">{t("screens.plotRecord.accuracyPortal", { m: plot.boundaryAccuracyM.toFixed(2) })}</span>,
            ],
            ["ULPIN / PNIU", <span key="u" className="font-mono text-xs">{plot.ulpin ?? t("screens.plotRecord.notAllotted")}</span>],
            [t("screens.plotRecord.boundaryPoints"), detail ? t("screens.plotRecord.numberedPoints", { count: detail.boundary.points.length }) : "—"],
          ]}
        />
      </Section>

      {/* 4 */}
      <Section n={4} title={t("screens.plotRecord.projectInfo")} icon={<Building2 className="h-3.5 w-3.5 text-brand" />}>
        <Facts
          rows={[
            [t("screens.plotRecord.projectName"), <Link key="n" href={`/projects/${plot.projectId}`} className="font-medium text-brand hover:underline">{plot.project}</Link>],
            [t("screens.plotRecord.projectType"), detail ? named(t, `screens.projectType.${detail.project.type}`, detail.project.type) : "—"],
            [t("screens.plotRecord.authority"), detail?.project.authority ?? "—"],
            [t("screens.plotRecord.ministry"), detail?.project.ministry ?? "—"],
            [
              t("screens.plotRecord.affectedParcels"),
              detail ? (
                <span className="tabular-nums">
                  {rich(t("screens.plotRecord.khasrasInProject"), { count: <strong className="font-semibold">{detail.project.totalParcels}</strong> })}
                </span>
              ) : "—",
            ],
            [
              t("screens.plotRecord.possession"),
              detail ? (
                <span className="tabular-nums">
                  {t("screens.plotRecord.possessedOf", { done: detail.project.possessedParcels, total: detail.project.totalParcels })}
                  <span className="ml-2 text-muted">
                    ({detail.project.totalParcels ? Math.round((detail.project.possessedParcels / detail.project.totalParcels) * 100) : 0}%)
                  </span>
                </span>
              ) : "—",
            ],
            [
              t("screens.plotRecord.thisPlot"),
              <Badge key="pp" tone={plot.status === "POSSESSED" ? "success" : "neutral"}>
                {plot.status === "POSSESSED" ? t("status.possessionTaken") : t("screens.plotRecord.notYetPossessed")}
              </Badge>,
            ],
          ]}
        />
      </Section>

      {/* 5 */}
      <Section n={5} title={t("screens.plotRecord.alsoClaimed")} description={t("screens.plotRecord.alsoClaimedDesc")} icon={<Split className="h-3.5 w-3.5 text-brand" />}>
        {!detail ? (
          <Loading rows={1} />
        ) : detail.claimedBy.length === 0 ? (
          <p className="text-xs text-muted">{t("screens.plotRecord.noOtherClaim")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {detail.claimedBy.map((c) => (
              <li key={c.projectId}>
                <button
                  onClick={() => c.parcelId && onSelectPlot(c.parcelId)}
                  disabled={!c.parcelId}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:bg-surface-muted disabled:cursor-default"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{c.project}</span>
                    <span className="block text-xs text-muted">
                      {c.referenceNo}
                      {c.khasraNo && ` · ${t("screens.plotRecord.asKhasra", { no: c.khasraNo })}`}
                      {c.overlapHa != null && ` · ${t("screens.plotRecord.overlapHa", { ha: c.overlapHa.toFixed(4) })}`}
                    </span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 6 */}
      <Section n={6} title={t("screens.plotRecord.statusTimeline")} description={t("screens.plotRecord.timelineDesc")} icon={<FileText className="h-3.5 w-3.5 text-brand" />}>
        <Timeline status={plot.status} detail={detail} />
      </Section>

      {/* 7 */}
      <Section n={7} title={t("screens.plotRecord.quickActions")}>
        <div className="grid gap-2 @sm:grid-cols-2">
          <button onClick={() => go("ownership")} className={buttonClass("secondary", "md", "justify-start")}>
            <Users className="h-4 w-4 text-brand" /> {t("screens.plotRecord.viewOwnership")}
          </button>
          <button onClick={() => go("nearby")} className={buttonClass("secondary", "md", "justify-start")}>
            <Layers className="h-4 w-4 text-brand" /> {t("screens.plotRecord.viewNearby")}
          </button>
          <button onClick={() => go("project")} className={buttonClass("secondary", "md", "justify-start")}>
            <Building2 className="h-4 w-4 text-brand" /> {t("screens.plotRecord.viewAlignment")}
          </button>
          <a href={`/api/gis/parcels/${plot.id}/export?format=csv`} className={buttonClass("primary", "md", "justify-start")}>
            <Download className="h-4 w-4" /> {t("screens.plotRecord.generateReport")}
          </a>
        </div>
      </Section>
    </div>
  );
}

function AreaTile({ label, value, unit, hint, tone }: { label: string; value: string; unit?: string; hint?: string; tone?: "warning" | "muted" }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted/60 px-3 py-2.5">
      <div className="text-[11px] leading-tight text-muted">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums tracking-tight", tone === "warning" ? "text-warning" : "text-foreground")}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
      </div>
      {hint && <div className={cn("mt-0.5 text-[11px] tabular-nums", tone === "warning" ? "font-medium text-warning" : "text-muted")}>{hint}</div>}
    </div>
  );
}

/** The seven stages a plot moves through. */
function Timeline({ status, detail }: { status: string; detail: PlotDetail | null }) {
  const t = useT();
  const date = useDate();
  const stages = STATUS_ORDER as readonly string[];
  const currentIndex = stages.indexOf(status);
  const when: Record<string, string | null> = {
    OBJECTED: detail?.objections[0]?.filedAt ?? null,
    AWARD_DECLARED: detail?.awards[0]?.declaredOn ?? null,
    COMPENSATED: detail?.compensation.records.flatMap((r) => r.payments).find((p) => p.status === "PAID")?.paidAt ?? null,
    POSSESSED: detail?.possession?.takenOn ?? null,
  };

  if (status === "WITHDRAWN") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2.5 text-sm">
        <Badge tone="neutral">{t("stages.withdrawn")}</Badge>
        <span className="text-xs text-muted">{t("screens.plotRecord.withdrawnText")}</span>
      </div>
    );
  }

  return (
    <ol className="space-y-0">
      {stages.map((s, i) => {
        const done = currentIndex > i;
        const active = currentIndex === i;
        const last = i === stages.length - 1;
        return (
          <li key={s} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                  active ? "border-transparent" : done ? "border-transparent bg-success" : "border-border bg-surface",
                )}
                style={active ? { background: STATUS_COLOUR[s], boxShadow: `0 0 0 3px ${STATUS_COLOUR[s]}33` } : undefined}
              />
              {!last && <span className={cn("w-0.5 flex-1", done ? "bg-success" : "bg-border")} />}
            </div>
            <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-3")}>
              <div className={cn("text-sm leading-4", active ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted")}>
                {t(parcelStatusKey(s))}
                {active && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">{t("screens.plotRecord.current")}</span>}
              </div>
              {when[s] && <div className="mt-0.5 text-[11px] text-muted">{date(when[s])}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------- other tabs -- */

function Ownership({ plot, detail }: { plot: PlotSummary; detail: PlotDetail | null }) {
  const t = useT();
  const date = useDate();
  const { locale } = useLocale();
  const money = (n: number) => formatIndianScale(n, locale);
  if (!detail) return <Loading rows={4} />;
  return (
    <div className="space-y-4">
      <Section n={1} title={t("screens.plotRecord.recordedOwners")} description={t("screens.plotRecord.ownersDesc")} icon={<Users className="h-3.5 w-3.5 text-brand" />}>
        {detail.owners.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <AlertTriangle className="h-4 w-4" /> {t("screens.plotRecord.noOwner")}
          </p>
        ) : (
          <Table
            head={[t("common.owner"), t("screens.plotRecord.fatherName"), t("screens.plotRecord.share")]}
            rows={detail.owners.map((o) => [
              <span key="n" className="font-medium">{o.fullName}{o.hasPortalLogin && <Badge tone="info" className="ml-2">{t("screens.plotRecord.portalLogin")}</Badge>}</span>,
              o.fatherName ?? "—",
              <span key="s" className="tabular-nums">{o.sharePct}%</span>,
            ])}
            align={["left", "left", "right"]}
          />
        )}
      </Section>

      <Section n={2} title={t("screens.plotRecord.compensation")} description={t("screens.plotRecord.compDesc")} icon={<FileText className="h-3.5 w-3.5 text-brand" />}>
        {detail.compensation.records.length === 0 ? (
          <p className="text-xs text-muted">{t("screens.plotRecord.notAssessed")}</p>
        ) : (
          <>
            <div className="mb-3 grid gap-2.5 @sm:grid-cols-2">
              <AreaTile label={t("screens.plotRecord.assessed")} value={money(detail.compensation.assessed)} />
              <AreaTile
                label={t("status.paid")}
                value={money(detail.compensation.paid)}
                tone={detail.compensation.paid < detail.compensation.assessed ? "warning" : undefined}
                hint={detail.compensation.paid < detail.compensation.assessed ? t("screens.plotRecord.outstanding", { amount: money(detail.compensation.assessed - detail.compensation.paid) }) : t("screens.plotRecord.settled")}
              />
            </div>
            <Table
              head={[t("common.owner"), t("screens.plotRecord.payable"), t("common.status")]}
              rows={detail.compensation.records.map((r) => {
                const paid = r.payments.filter((p) => p.status === "PAID").reduce((a, p) => a + p.amount, 0);
                const utr = r.payments.find((p) => p.utrNumber)?.utrNumber;
                return [
                  r.owner,
                  <span key="p" className="tabular-nums">{money(r.payable)}</span>,
                  paid >= r.payable
                    ? <Badge key="s" tone="success">{utr ? t("screens.plotRecord.paidUtr", { utr }) : t("status.paid")}</Badge>
                    : <Badge key="s" tone="warning">{paid > 0 ? t("screens.plotRecord.partPaid") : t("status.pending")}</Badge>,
                ];
              })}
              align={["left", "right", "right"]}
            />
          </>
        )}
      </Section>

      <Section n={3} title={t("screens.plotRecord.awards")} description={t("screens.plotRecord.awardsDesc")} icon={<FileText className="h-3.5 w-3.5 text-brand" />}>
        {detail.awards.length === 0 ? (
          <p className="text-xs text-muted">{t("screens.plotRecord.noAward")}</p>
        ) : (
          <Table
            head={[t("screens.plotRecord.awardNo"), t("screens.plotRecord.declared"), t("screens.plotRecord.amount")]}
            rows={detail.awards.map((a) => [
              <span key="n" className="font-mono text-xs">{a.awardNo}{a.isRnRAward && <Badge tone="info" className="ml-2">{t("screens.misc.rnr")}</Badge>}</span>,
              date(a.declaredOn),
              <span key="a" className="tabular-nums">{money(a.totalAmount)}</span>,
            ])}
            align={["left", "left", "right"]}
          />
        )}
      </Section>

      <Section n={4} title={t("screens.plotRecord.objections")} description={t("screens.plotRecord.objDesc")} icon={<AlertTriangle className="h-3.5 w-3.5 text-brand" />}>
        {detail.objections.length === 0 ? (
          <p className="text-xs text-muted">{t("screens.plotRecord.noObjection")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {detail.objections.map((o) => (
              <li key={o.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{o.objectorName}</span>
                  <Badge tone={o.status === "ACCEPTED" || o.status === "PARTIALLY_ACCEPTED" ? "success" : o.status === "REJECTED" ? "danger" : "warning"}>{named(t, `objectionStatus.${o.status}`, o.status)}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{o.grounds}</p>
                <p className="mt-1 text-[11px] text-muted">
                  {t("screens.plotRecord.filedOn", { date: date(o.filedAt) })}
                  {o.hearingDate && ` · ${t("screens.plotRecord.heardOn", { date: date(o.hearingDate) })}`}
                  {o.decidedAt && ` · ${t("screens.plotRecord.decidedOn", { date: date(o.decidedAt) })}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section n={5} title={t("screens.plotRecord.possession")} icon={<LandPlot className="h-3.5 w-3.5 text-brand" />}>
        {!detail.possession ? (
          <p className="text-xs text-muted">
            {t("screens.plotRecord.possessionNotTaken", { khasra: plot.khasraNo })}
          </p>
        ) : (
          <Facts
            rows={[
              [t("screens.plotRecord.takenOn"), date(detail.possession.takenOn)],
              [t("screens.plotRecord.handedOverBy"), detail.possession.handedOverBy ?? "—"],
              [t("screens.plotRecord.receivedBy"), detail.possession.receivedBy ?? "—"],
              [t("screens.plotRecord.remarks"), detail.possession.remarks ?? "—"],
            ]}
          />
        )}
      </Section>
    </div>
  );
}

function ProjectTab({ plot, detail }: { plot: PlotSummary; detail: PlotDetail | null }) {
  const t = useT();
  if (!detail) return <Loading rows={4} />;
  const p = detail.project;
  return (
    <div className="space-y-4">
      <Section n={1} title={t("common.project")} icon={<Building2 className="h-3.5 w-3.5 text-brand" />}
        action={<Link href={`/projects/${p.id}`} className={buttonClass("secondary", "sm")}>{t("screens.plotRecord.openProject")} <ArrowUpRight className="h-3.5 w-3.5" /></Link>}>
        <Facts
          rows={[
            [t("screens.plotRecord.name"), <span key="n" className="font-medium">{p.name}</span>],
            [t("screens.plotRecord.reference"), <span key="r" className="font-mono text-xs">{p.referenceNo}</span>],
            [t("screens.plotRecord.type"), named(t, `screens.projectType.${p.type}`, p.type)],
            [t("screens.proposalDetail.governingAct"), <Badge key="g" tone="brand">{named(t, `screens.act.${p.governingAct}`, p.governingAct)}</Badge>],
            [t("screens.plotRecord.authority"), p.authority],
            [t("screens.plotRecord.ministry"), p.ministry ?? "—"],
            [t("screens.plotRecord.estimatedArea"), p.estimatedAreaHectares == null ? "—" : t("screens.units.ha", { value: p.estimatedAreaHectares.toFixed(2) })],
          ]}
        />
      </Section>

      <Section n={2} title={t("screens.plotRecord.alignment")} description={t("screens.plotRecord.alignmentDesc")} icon={<Ruler className="h-3.5 w-3.5 text-brand" />}>
        <Facts
          rows={[
            [t("screens.plotRecord.rightOfWay"), p.rightOfWayM == null ? t("screens.plotRecord.notLinear") : t("screens.plotRecord.metresWide", { m: p.rightOfWayM })],
            [t("screens.plotRecord.chainage"), plot.chainageM == null ? "—" : t("screens.plotRecord.kmAlong", { km: (plot.chainageM / 1000).toFixed(2) })],
            [t("screens.plotRecord.proposal"), detail.proposal ? <Link key="p" href={`/proposals/${detail.proposal.id}`} className="font-mono text-xs text-brand hover:underline">{detail.proposal.referenceNo}</Link> : t("screens.plotRecord.notInProposal")],
            [t("screens.plotRecord.proposalStage"), detail.proposal ? named(t, stageKey(p.governingAct, detail.proposal.status), detail.proposal.status) : "—"],
          ]}
        />
      </Section>

      <Section n={3} title={t("screens.plotRecord.progress")} description={t("screens.plotRecord.progressDesc")} icon={<Layers className="h-3.5 w-3.5 text-brand" />}>
        <div className="grid gap-2.5 @sm:grid-cols-2">
          <AreaTile label={t("screens.plotRecord.totalKhasras")} value={String(p.totalParcels)} />
          <AreaTile
            label={t("status.possessionTaken")}
            value={String(p.possessedParcels)}
            hint={t("screens.plotRecord.pctOfProject", { pct: p.totalParcels ? Math.round((p.possessedParcels / p.totalParcels) * 100) : 0 })}
          />
        </div>
      </Section>
    </div>
  );
}

function BoundaryTab({ plot, detail, source }: { plot: PlotSummary; detail: PlotDetail | null; source: { label: string; tone: Tone; text: string } }) {
  const t = useT();
  const date = useDate();
  if (!detail) return <Loading rows={4} />;
  const b = detail.boundary;
  return (
    <div className="space-y-4">
      <Section n={1} title={t("screens.plotRecord.provenance")} description={t("screens.plotRecord.provenanceDesc")} icon={<Info className="h-3.5 w-3.5 text-brand" />}>
        <Facts
          rows={[
            [t("screens.plotRecord.source"), <Badge key="s" tone={source.tone}>{source.label}</Badge>],
            [t("screens.plotRecord.whatMeans"), <span key="t" className="text-xs text-muted">{source.text}</span>],
            [t("screens.plotRecord.dataSourceLabel"), named(t, `screens.dataSource.${b.dataSource}`, b.dataSource)],
            [t("screens.plotRecord.portalPlotId"), b.sourcePlotId ? <span key="i" className="font-mono text-xs">{b.sourcePlotId}</span> : "—"],
            [t("screens.plotRecord.lastSynced"), date(b.syncedAt)],
            [t("screens.plotRecord.accuracy"), b.accuracyM == null ? t("screens.plotRecord.notMeasured") : <span key="a" className="tabular-nums">±{t("screens.plotRecord.metres", { m: b.accuracyM.toFixed(2) })}</span>],
            [t("screens.plotRecord.centroid"), b.centroid ? <span key="c" className="font-mono text-xs tabular-nums">{b.centroid.lat.toFixed(6)}, {b.centroid.lng.toFixed(6)}</span> : "—"],
          ]}
        />
      </Section>

      <Section
        n={2}
        title={t("screens.plotRecord.boundaryPoints")}
        description={t("screens.plotRecord.pointsDesc")}
        icon={<MapPin className="h-3.5 w-3.5 text-brand" />}
        action={
          <div className="flex gap-1.5">
            <a href={`/api/gis/parcels/${plot.id}/export?format=csv`} className={buttonClass("secondary", "sm")}>CSV</a>
            <a href={`/api/gis/parcels/${plot.id}/export?format=geojson`} className={buttonClass("secondary", "sm")}>GeoJSON</a>
            <a href={`/api/gis/parcels/${plot.id}/export?format=kml`} className={buttonClass("secondary", "sm")}>KML</a>
          </div>
        }
      >
        {b.points.length === 0 ? (
          <EmptyState title={t("screens.plotRecord.noBoundary")} description={t("screens.plotRecord.noBoundaryDesc")} />
        ) : (
          <Table
            head={[t("screens.plotRecord.colPt"), t("screens.plotRecord.latitude"), t("screens.plotRecord.longitude"), t("screens.plotRecord.sideToNext"), t("screens.plotRecord.elevation")]}
            rows={b.points.map((pt) => [
              <span key="s" className="tabular-nums text-muted">{pt.seq}</span>,
              <span key="a" className="font-mono text-xs tabular-nums">{pt.lat.toFixed(6)}</span>,
              <span key="b" className="font-mono text-xs tabular-nums">{pt.lng.toFixed(6)}</span>,
              <span key="c" className="tabular-nums">{t("screens.plotRecord.metres", { m: pt.sideM.toFixed(1) })}</span>,
              <span key="d" className="tabular-nums">{pt.elevationM == null ? "—" : t("screens.plotRecord.metres", { m: pt.elevationM.toFixed(0) })}</span>,
            ])}
            align={["right", "left", "left", "right", "right"]}
          />
        )}
      </Section>

      {detail.surveys.length > 0 && (
        <Section n={3} title={t("screens.plotRecord.fieldSurveys")} description={t("screens.plotRecord.surveysDesc")} icon={<LandPlot className="h-3.5 w-3.5 text-brand" />}>
          <Table
            head={[t("screens.plotRecord.kind"), t("screens.plotRecord.surveyor"), t("screens.plotRecord.captured"), t("screens.plotRecord.walkedArea")]}
            rows={detail.surveys.map((s) => [
              named(t, `screens.surveyKind.${s.kind}`, s.kind),
              s.surveyor,
              date(s.capturedAt),
              <span key="w" className="tabular-nums">{s.walkedAreaHectares == null ? "—" : t("screens.units.ha", { value: s.walkedAreaHectares.toFixed(4) })}</span>,
            ])}
            align={["left", "left", "left", "right"]}
          />
        </Section>
      )}
    </div>
  );
}

function Nearby({ detail, onSelectPlot }: { detail: PlotDetail | null; onSelectPlot: (id: string) => void }) {
  const t = useT();
  if (!detail) return <Loading rows={5} />;
  const adjoining = detail.nearby.filter((n) => n.adjoining);
  const around = detail.nearby.filter((n) => !n.adjoining);
  return (
    <div className="space-y-4">
      <Section n={1} title={t("screens.plotRecord.adjoining")} description={t("screens.plotRecord.adjoiningDesc")} icon={<Split className="h-3.5 w-3.5 text-brand" />}>
        {adjoining.length === 0 ? <p className="text-xs text-muted">{t("screens.plotRecord.noAdjoining")}</p> : <NearbyList rows={adjoining} onSelectPlot={onSelectPlot} />}
      </Section>
      <Section n={2} title={t("screens.plotRecord.within", { m: 750 })} description={t("screens.plotRecord.withinDesc")} icon={<Layers className="h-3.5 w-3.5 text-brand" />}>
        {around.length === 0 ? <p className="text-xs text-muted">{t("screens.plotRecord.nothingWithin", { m: 750 })}</p> : <NearbyList rows={around} onSelectPlot={onSelectPlot} />}
      </Section>
    </div>
  );
}

function NearbyList({ rows, onSelectPlot }: { rows: PlotDetail["nearby"]; onSelectPlot: (id: string) => void }) {
  const t = useT();
  return (
    <ul className="divide-y divide-border">
      {rows.map((n) => (
        <li key={n.id}>
          <button
            onClick={() => n.visible && onSelectPlot(n.id)}
            disabled={!n.visible}
            title={n.visible ? t("screens.plotRecord.openKhasra", { no: n.khasraNo }) : t("screens.plotRecord.outsideJur")}
            className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:bg-surface-muted disabled:cursor-default disabled:opacity-60"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: STATUS_COLOUR[n.status] ?? "#94a3b8" }} />
              <span className="min-w-0">
                <span className="block truncate text-sm">
                  <span className="font-mono font-medium">{n.khasraNo}</span>
                  <span className="ml-2 text-muted">{n.village}</span>
                </span>
                <span className="block truncate text-[11px] text-muted">
                  {t(parcelStatusKey(n.status))} · {n.project}
                  {n.mapHa != null && ` · ${t("screens.units.ha", { value: n.mapHa.toFixed(3) })}`}
                </span>
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-xs tabular-nums text-muted">{n.adjoining ? t("screens.plotRecord.adjoiningTag") : t("screens.plotRecord.metres", { m: n.metres })}</span>
              {n.visible && <ArrowUpRight className="ml-auto mt-0.5 h-3.5 w-3.5 text-muted" />}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function History({ detail }: { detail: PlotDetail | null }) {
  const t = useT();
  const { intl } = useLocale();
  if (!detail) return <Loading rows={5} />;
  if (detail.history.length === 0) {
    return (
      <EmptyState
        title={t("screens.plotRecord.noHistory")}
        description={t("screens.plotRecord.noHistoryDesc")}
      />
    );
  }
  return (
    <Section n={1} title={t("screens.plotRecord.auditTrail")} description={t("screens.plotRecord.auditDesc")} icon={<FileText className="h-3.5 w-3.5 text-brand" />}>
      <ul className="divide-y divide-border">
        {detail.history.map((h) => (
          <li key={h.id} className="flex items-baseline justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{named(t, `screens.auditAction.${h.action}`, h.action)}</span>
              <span className="block truncate text-xs text-muted">
                {h.actor === "System" ? t("screens.plotRecord.system") : h.actor}
                {h.actorRole && <> · {named(t, `roles.${h.actorRole}`, h.actorRole)}</>}
              </span>
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted">
              {new Date(h.at).toLocaleString(intl, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ---------------------------------------------------------------- shared -- */

function Table({ head, rows, align }: { head: string[]; rows: React.ReactNode[][]; align?: ("left" | "right")[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {head.map((h, i) => (
              <th key={h} className={cn("pb-1.5 pr-3 text-[11px] font-medium uppercase tracking-wide text-muted last:pr-0", align?.[i] === "right" ? "text-right" : "text-left")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {r.map((c, j) => (
                <td key={j} className={cn("py-2 pr-3 last:pr-0 align-top", align?.[j] === "right" && "text-right")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Loading({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-muted" />
      ))}
    </div>
  );
}
