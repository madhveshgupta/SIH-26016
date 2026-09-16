"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp,
  ClipboardCheck, Clock, CloudUpload, Database, FileText, Info, Map as MapIcon, MoreVertical,
  Plus, RefreshCw, RotateCcw, Search, Smartphone, TriangleAlert, X,
} from "lucide-react";
import { Badge, Button, Card, PageHeader, StatTile, type Tone } from "@frontend/components/ui";
import { cn } from "@frontend/lib/cn";
import type { FieldParcel } from "./FieldApp";
import type { QueuedSurvey } from "@frontend/lib/offline/queue";
import type { MapPlot, PlotTone } from "./FieldMapPreview";
import { useLocale, useT } from "@frontend/components/I18nProvider";
import type { MessageKey } from "@backend/i18n/types";
import { rich } from "@frontend/lib/rich";

const FieldMapPreview = dynamic(() => import("./FieldMapPreview"), {
  ssr: false,
  loading: () => <MapLoading />,
});

interface DashboardProps {
  parcels: FieldParcel[];
  queue: QueuedSurvey[];
  online: boolean;
  syncing: boolean;
  cachedAt: string | null;
  onSync: () => void;
  onSelectPlot: (parcel: FieldParcel) => void;
  note: string | null;
  onClearNote: () => void;
}

type Status = "pending" | "progress" | "completed";
type SortKey = "khasra" | "area" | "project" | "status";

const PAGE_SIZE = 10;

const STATUS_LABEL: Record<Status, MessageKey> = {
  pending: "status.pending",
  progress: "status.inProgress",
  completed: "status.completed",
};

function MapLoading() {
  const t = useT();
  return <div className="flex h-full w-full items-center justify-center bg-surface-muted text-xs text-muted">{t("screens.parcelPage.loadingMap")}</div>;
}

/** Badge tones from the shared palette: amber pending, info for "on this device", green done. */
const STATUS_TONE: Record<Status, Tone> = {
  pending: "warning",
  progress: "info",
  completed: "success",
};

/** Compact control styling, shared by the search box and both selects. */
const control =
  "h-8 w-full rounded-md border border-border bg-surface text-[13px] text-foreground placeholder:text-muted/80 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15";

function formatTime(iso: string | null, intl: string, never: string) {
  return iso ? new Date(iso).toLocaleTimeString(intl, { hour: "numeric", minute: "2-digit" }) : never;
}

export default function FieldDashboard({
  parcels,
  queue,
  online,
  syncing,
  cachedAt,
  onSync,
  onSelectPlot,
  note,
  onClearNote,
}: DashboardProps) {
  const t = useT();
  const { intl } = useLocale();
  const ha = (n: number) => t("screens.units.ha", { value: n.toFixed(4) });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** The plot whose compact popup is open on the map, if any. */
  const [popupId, setPopupId] = useState<string | null>(null);

  const pendingQueue = queue.filter((q) => q.status !== "failed");
  const queuedIds = useMemo(() => new Set(queue.map((q) => q.parcelId)), [queue]);

  const statusOf = (p: FieldParcel): Status =>
    queuedIds.has(p.id) ? "progress" : p.lastSurveyedAt ? "completed" : "pending";

  // KPIs
  const totalAssigned = parcels.length;
  const inProgress = parcels.filter((p) => queuedIds.has(p.id)).length;
  const completedVisits = parcels.filter((p) => !queuedIds.has(p.id) && p.lastSurveyedAt).length;
  const pendingVisits = totalAssigned - inProgress - completedVisits;
  const issueCount = parcels.filter((p) => p.hasConflict).length;

  const projects = useMemo(() => Array.from(new Set(parcels.map((p) => p.project))).sort(), [parcels]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = parcels.filter((p) => {
      const s = queuedIds.has(p.id) ? "progress" : p.lastSurveyedAt ? "completed" : "pending";
      if (statusFilter === "issue" ? !p.hasConflict : statusFilter !== "all" && s !== statusFilter) return false;
      if (projectFilter !== "all" && p.project !== projectFilter) return false;
      if (!q) return true;
      return (
        p.khasraNo.toLowerCase().includes(q) ||
        p.village.toLowerCase().includes(q) ||
        p.district.toLowerCase().includes(q) ||
        p.project.toLowerCase().includes(q) ||
        p.owners.some((o) => o.toLowerCase().includes(q))
      );
    });
    if (!sort) return rows; // server order: conflicts first, then along the alignment
    const value = (p: FieldParcel): string | number => {
      switch (sort.key) {
        case "khasra": return p.khasraNo;
        case "area": return p.recordedHa;
        case "project": return p.project;
        case "status": return (queuedIds.has(p.id) ? 1 : p.lastSurveyedAt ? 2 : 0) * 2 - (p.hasConflict ? 1 : 0);
      }
    };
    return [...rows].sort((a, b) => {
      const va = value(a), vb = value(b);
      const c = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return c * sort.dir;
    });
  }, [parcels, search, statusFilter, projectFilter, sort, queuedIds]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const preview = parcels.find((p) => p.id === previewId) ?? filtered[0] ?? null;
  const mapPlots: MapPlot[] = useMemo(
    () =>
      parcels.map((p) => {
        const s: Status = queuedIds.has(p.id) ? "progress" : p.lastSurveyedAt ? "completed" : "pending";
        const tone: PlotTone = p.hasConflict && s !== "completed" ? "issue" : s;
        return {
          id: p.id, label: p.khasraNo, lat: p.lat, lng: p.lng, tone,
          village: p.village, district: p.district, project: p.project, recordHa: p.recordedHa, mappedHa: p.mappedHa,
          owner: p.owners.length ? p.owners[0] + (p.owners.length > 1 ? ` +${p.owners.length - 1}` : "") : null,
          statusLabel: t(STATUS_LABEL[s]), hasConflict: p.hasConflict,
        };
      }),
    [parcels, queuedIds, t],
  );
  const previewPlot = preview ? mapPlots.find((m) => m.id === preview.id) ?? null : null;

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setProjectFilter("all");
    setSort(null);
    setPage(0);
  };

  const filterBy = (status: string) => {
    setStatusFilter((s) => (s === status ? "all" : status));
    setPage(0);
  };

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
    setPage(0);
  };

  /**
   * Picking a plot, on the map or in the table, moves the map to it and opens its
   * popup — the popup names the project, which is what tells apart the two
   * records of a khasra claimed by two projects (same land, same spot).
   */
  const selectFromMap = (id: string) => {
    setPreviewId(id);
    setPopupId(id);
  };
  const selectFromRow = (id: string) => {
    setPreviewId(id);
    setPopupId(id);
  };

  const allOnPageChecked = pageRows.length > 0 && pageRows.every((p) => checked.has(p.id));
  const toggleAllOnPage = () =>
    setChecked((c) => {
      const next = new Set(c);
      for (const p of pageRows) {
        if (allOnPageChecked) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });

  const nextPending = filtered.find((p) => statusOf(p) === "pending") ?? parcels.find((p) => statusOf(p) === "pending");
  const filtersActive = search !== "" || statusFilter !== "all" || projectFilter !== "all" || sort !== null;

  // The app chrome (sidebar, header) comes from the shared Shell in the (field) layout.
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,40%)] xl:grid-rows-[auto_auto_auto_1fr]">
      <div className="min-w-0 [&>div]:mb-0">
      <PageHeader
        title={t("nav.fieldSurvey")}
        description={t("screens.field.desc")}
        badge={
          <Badge tone={online ? "success" : "warning"} icon={<span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-success" : "bg-warning")} />}>
            {online ? t("screens.field.online") : t("screens.field.offline")}
          </Badge>
        }
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <RefreshCw className="h-3.5 w-3.5" />
              {rich(t("screens.field.lastSynced"), {
                time: <span className="font-medium text-foreground">{formatTime(cachedAt, intl, t("screens.field.never"))}</span>,
              })}
            </span>
            <Button onClick={() => void onSync()} loading={syncing} icon={<RefreshCw className="h-4 w-4" />}>
              {syncing ? t("screens.field.syncing") : t("screens.field.syncNow")}
            </Button>
          </>
        }
      />
      </div>

      {/* KPIs — each one filters the table */}
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5">
        <StatTile label={t("screens.field.kpiAssigned")} value={totalAssigned} hint={t("screens.field.kpiAssignedHint")} tone="brand"
          icon={<FileText className="h-4 w-4" />} onClick={() => filterBy("all")} active={statusFilter === "all"} />
        <StatTile label={t("status.pending")} value={pendingVisits} hint={t("screens.field.kpiPendingHint")} tone="warning"
          icon={<Clock className="h-4 w-4" />} onClick={() => filterBy("pending")} active={statusFilter === "pending"} />
        <StatTile label={t("status.inProgress")} value={inProgress} hint={t("screens.field.kpiProgressHint")} tone="info"
          icon={<Smartphone className="h-4 w-4" />} onClick={() => filterBy("progress")} active={statusFilter === "progress"} />
        <StatTile label={t("status.completed")} value={completedVisits} hint={t("screens.field.kpiCompletedHint")} tone="success"
          icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => filterBy("completed")} active={statusFilter === "completed"} />
        <StatTile label={t("screens.field.kpiIssues")} value={issueCount} hint={t("screens.field.kpiIssuesHint")} tone="danger"
          icon={<TriangleAlert className="h-4 w-4" />} onClick={() => filterBy("issue")} active={statusFilter === "issue"} />
      </div>

      {/* Sync status — one quiet line */}
      <Card className="flex min-w-0 flex-col gap-3 px-4 py-3 text-[13px] lg:flex-row lg:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2">
          <span className="inline-flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", online ? "bg-success" : "bg-warning")} />
            <span className="font-medium text-foreground">{online ? t("screens.field.connected") : t("screens.field.offlineDevice")}</span>
          </span>
          <span className="inline-flex items-center gap-2 text-muted">
            <CloudUpload className="h-4 w-4" />
            {rich(t("screens.field.pendingUploads"), { count: <span className="font-medium text-foreground">{pendingQueue.length}</span> })}
          </span>
          <span className="inline-flex items-center gap-2 text-muted">
            <Database className={cn("h-4 w-4", pendingQueue.length === 0 ? "text-success" : "text-warning")} />
            {pendingQueue.length === 0 ? t("screens.field.allSynced") : t("screens.field.waiting")}
          </span>
        </div>
        {note && (
          <div className="flex items-center gap-2 rounded-md bg-surface-muted px-2.5 py-1.5 text-xs text-foreground" role="status">
            <Info className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="flex-1">{note}</span>
            <button type="button" onClick={onClearNote} aria-label={t("screens.field.dismiss")} className="rounded p-0.5 text-muted hover:bg-border/60 hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </Card>

      {/* Workspace: plot list + GIS map */}
        <Card className="order-2 min-w-0 xl:order-none">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {t("screens.field.plotsToVisit")}
                <Badge tone="warning">{t("screens.field.pendingN", { count: pendingVisits })}</Badge>
              </h2>
              <p className="mt-0.5 text-xs text-muted">{t("screens.field.plotsToVisitDesc")}</p>
            </div>
            <Button
              size="sm"
              disabled={!nextPending}
              onClick={() => nextPending && onSelectPlot(nextPending)}
              icon={<Plus className="h-3.5 w-3.5" />}
              title={nextPending ? t("screens.field.startWith", { no: nextPending.khasraNo }) : t("screens.field.noPending")}
            >
              {t("screens.field.startNew")}
            </Button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <div className="relative min-w-40 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                type="search"
                placeholder={t("screens.field.searchPh")}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className={`${control} pl-8 pr-2`}
                aria-label={t("screens.field.searchAria")}
              />
            </div>
            <SelectBox value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(0); }} label={t("common.status")} className="w-32">
              <option value="all">{t("screens.field.allStatuses")}</option>
              <option value="pending">{t("status.pending")}</option>
              <option value="progress">{t("status.inProgress")}</option>
              <option value="completed">{t("status.completed")}</option>
              <option value="issue">{t("screens.field.conflicts")}</option>
            </SelectBox>
            <SelectBox value={projectFilter} onChange={(v) => { setProjectFilter(v); setPage(0); }} label={t("common.project")} className="w-40">
              <option value="all">{t("screens.field.allProjects")}</option>
              {projects.map((p) => <option key={p} value={p}>{p}</option>)}
            </SelectBox>
            <button
              type="button"
              onClick={resetFilters}
              disabled={!filtersActive}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted transition hover:bg-surface-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("screens.field.reset")}
            </button>
          </div>

          {checked.size > 0 && (
            <div className="mx-4 mb-2 flex items-center justify-between rounded-md bg-brand-soft px-3 py-1.5 text-xs text-brand">
              <span>
                {rich(t(checked.size === 1 ? "screens.field.selectedOne" : "screens.field.selectedMany"), {
                  count: <span className="font-semibold">{checked.size}</span>,
                })}
              </span>
              <button type="button" onClick={() => setChecked(new Set())} className="font-medium hover:underline">{t("screens.field.clear")}</button>
            </div>
          )}

          {/* Table */}
          <div className="max-h-[680px] overflow-auto border-t border-border">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="sticky top-0 z-10 bg-surface-muted/95 text-[11px] font-semibold uppercase tracking-wide text-muted backdrop-blur">
                <tr className="border-b border-border">
                  <th className="w-9 py-2 pl-4 pr-1">
                    <input
                      type="checkbox"
                      aria-label={t("screens.field.selectAll")}
                      checked={allOnPageChecked}
                      onChange={toggleAllOnPage}
                      className="h-3.5 w-3.5 rounded border-border accent-brand"
                    />
                  </th>
                  <SortHeader label={t("screens.field.colKhasraLoc")} k="khasra" sort={sort} onSort={toggleSort} />
                  <SortHeader label={t("common.area")} k="area" sort={sort} onSort={toggleSort} align="right" />
                  <SortHeader label={t("screens.field.colProjectOwner")} k="project" sort={sort} onSort={toggleSort} />
                  <SortHeader label={t("common.status")} k="status" sort={sort} onSort={toggleSort} />
                  <th className="sticky right-0 bg-surface-muted/95 px-3 py-2 pr-4 text-right">
                    <span className="sr-only">{t("common.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {pageRows.map((p) => {
                  const s = statusOf(p);
                  const selected = preview?.id === p.id;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => selectFromRow(p.id)}
                      aria-selected={selected}
                      className={cn(
                        "group cursor-pointer transition-colors",
                        selected ? "bg-brand-soft/60 shadow-[inset_3px_0_0_var(--brand)]" : "hover:bg-surface-muted/60",
                      )}
                    >
                      <td className="py-2.5 pl-4 pr-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={t("screens.field.selectPlot", { no: p.khasraNo })}
                          checked={checked.has(p.id)}
                          onChange={() =>
                            setChecked((c) => {
                              const next = new Set(c);
                              if (next.has(p.id)) next.delete(p.id);
                              else next.add(p.id);
                              return next;
                            })
                          }
                          className="h-3.5 w-3.5 rounded border-border accent-brand"
                        />
                      </td>
                      <td className="max-w-[170px] px-3 py-2.5" title={`${p.village}, ${p.district}`}>
                        <div className="font-semibold tabular-nums text-foreground">{p.khasraNo}</div>
                        <div className="truncate text-xs text-muted">{p.village}, {p.district}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-foreground/90">
                        {p.recordedHa.toFixed(4)} <span className="text-xs text-muted">{t("screens.units.haShort")}</span>
                      </td>
                      <td className="max-w-[190px] px-3 py-2.5">
                        <div className="truncate text-foreground/90" title={p.project}>{p.project}</div>
                        <div className="truncate text-xs text-muted" title={p.owners.join(", ")}>
                          {p.owners.length > 0 ? (
                            <>
                              {p.owners[0]}
                              {p.owners.length > 1 && <span className="ml-1">+{p.owners.length - 1}</span>}
                            </>
                          ) : (
                            t("screens.field.ownerNotRecorded")
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge tone={STATUS_TONE[s]}>{t(STATUS_LABEL[s])}</StatusBadge>
                          {p.hasConflict && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-danger" title={t("screens.field.conflictTitle")}>
                              <TriangleAlert className="h-3 w-3" />
                              {t("screens.field.conflict")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className={cn(
                          "sticky right-0 px-2 py-2.5 pr-3 transition-colors",
                          selected ? "bg-[color-mix(in_srgb,var(--brand-soft)_60%,var(--surface))]" : "bg-surface group-hover:bg-[color-mix(in_srgb,var(--surface-muted)_60%,var(--surface))]",
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => onSelectPlot(p)}
                            className="inline-flex h-7 items-center whitespace-nowrap rounded-md border border-brand/25 bg-brand-soft px-2.5 text-xs font-medium text-brand transition hover:border-brand hover:bg-brand hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                          >
                            {s === "completed" ? t("screens.field.resurvey") : s === "progress" ? t("screens.field.addSurvey") : t("screens.field.startSurvey")}
                          </button>
                          <RowMenu
                            parcel={p}
                            onPreview={() => {
                              selectFromMap(p.id);
                              document.getElementById("plot-map")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                            }}
                            onSurvey={() => onSelectPlot(p)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-14 text-center">
                      <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                        <Search className="h-5 w-5 text-muted" />
                        <p className="text-sm font-medium text-foreground">{t("screens.field.noMatch")}</p>
                        <button type="button" onClick={resetFilters} className="text-xs font-medium text-brand hover:underline">
                          {t("screens.field.resetFilters")}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted sm:flex-row">
            <span>
              {rich(t("screens.field.range"), {
                range: (
                  <span className="font-medium text-foreground">
                    {filtered.length === 0 ? 0 : currentPage * PAGE_SIZE + 1}–{Math.min(filtered.length, (currentPage + 1) * PAGE_SIZE)}
                  </span>
                ),
                total: <span className="font-medium text-foreground">{filtered.length}</span>,
              })}
            </span>
            <div className="flex items-center gap-1">
              <PageButton disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} label={t("screens.field.prevPage")}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </PageButton>
              <span className="px-2 tabular-nums">
                {rich(t("screens.field.pageOf"), { page: <span className="font-medium text-foreground">{currentPage + 1}</span>, count: pageCount })}
              </span>
              <PageButton disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} label={t("screens.field.nextPage")}>
                <ChevronRight className="h-3.5 w-3.5" />
              </PageButton>
            </div>
          </div>
        </Card>

        {/* GIS workspace */}
        <Card
          className="order-1 flex scroll-mt-20 flex-col overflow-hidden xl:sticky xl:top-[76px] xl:order-none xl:col-start-2 xl:row-span-4 xl:row-start-1 xl:h-[calc(100dvh-100px)] xl:min-h-[520px] xl:self-start"
        >
          <div id="plot-map" className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <MapIcon className="h-4 w-4 shrink-0 text-brand" />
              {t("screens.field.plotMap")}
              {preview && <span className="truncate font-normal text-muted">· {t("screens.parcelPage.khasraTitle", { no: preview.khasraNo })}</span>}
            </h2>
            {preview && (
              <Link href={`/parcels/${preview.id}`} className="shrink-0 text-xs font-medium text-brand hover:underline">
                {t("screens.mapPanel.viewFull")}
              </Link>
            )}
          </div>
          <div className="relative h-[62vh] min-h-[360px] flex-1 xl:h-auto">
            <FieldMapPreview
              plots={mapPlots}
              selected={previewPlot}
              popupOpen={popupId != null && popupId === previewPlot?.id}
              onSelect={selectFromMap}
              onClosePopup={(id) => setPopupId((cur) => (cur === id ? null : cur))}
              onSurvey={(id) => {
                const p = parcels.find((x) => x.id === id);
                if (p) onSelectPlot(p);
              }}
            />
          </div>
          {/* Selected-plot strip: the "bottom sheet" on small screens, a status line on desktop. */}
          {preview && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-xs">
              <span className="font-semibold text-foreground">{t("screens.parcelPage.khasraTitle", { no: preview.khasraNo })}</span>
              <span className="text-muted">{preview.village}, {preview.district}</span>
              <span className="text-muted">
                {rich(t("screens.field.record"), { area: <span className="font-medium tabular-nums text-foreground">{ha(preview.recordedHa)}</span> })}
              </span>
              <span className="text-muted">
                {rich(t("screens.field.mapped"), {
                  area: <span className="font-medium tabular-nums text-foreground">{preview.mappedHa != null ? ha(preview.mappedHa) : "—"}</span>,
                })}
              </span>
              <span className="ml-auto text-muted">{t("screens.field.clickAny")}</span>
            </div>
          )}
        </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/** Table status: the shared Badge, squared off to sit quietly in a data row. */
function StatusBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <Badge tone={tone} className="rounded px-1.5 py-px text-[11px]">{children}</Badge>;
}

function SelectBox({
  value, onChange, label, children, className = "",
}: {
  value: string; onChange: (v: string) => void; label: string; children: React.ReactNode; className?: string;
}) {
  return (
    <label className={cn("relative block", className)}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${control} cursor-pointer appearance-none truncate pl-2.5 pr-7`}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
    </label>
  );
}

function SortHeader({
  label, k, sort, onSort, align = "left",
}: {
  label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 } | null; onSort: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = sort?.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === 1 ? ChevronUp : ChevronDown;
  return (
    <th className={cn("px-3 py-2", align === "right" && "text-right")} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap rounded uppercase tracking-wide transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          active && "text-brand",
        )}
      >
        {label}
        <Icon className={cn("h-3 w-3", active ? "text-brand" : "text-muted/60")} />
      </button>
    </th>
  );
}

function RowMenu({ parcel, onPreview, onSurvey }: { parcel: FieldParcel; onPreview: () => void; onSurvey: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));
  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-muted";
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("screens.field.moreActions", { no: parcel.khasraNo })}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-border bg-surface p-1 shadow-lg">
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onSurvey(); }}>
            <ClipboardCheck className="h-3.5 w-3.5 text-muted" /> {t("screens.field.recordSurvey")}
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onPreview(); }}>
            <MapIcon className="h-3.5 w-3.5 text-muted" /> {t("screens.field.showOnMap")}
          </button>
          <Link role="menuitem" href={`/parcels/${parcel.id}`} className={item}>
            <FileText className="h-3.5 w-3.5 text-muted" /> {t("screens.mapPanel.viewFull")}
          </Link>
        </div>
      )}
    </div>
  );
}

function PageButton({ disabled, onClick, label, children }: { disabled: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-foreground/80 transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function useClickAway(ref: React.RefObject<HTMLElement | null>, onAway: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onAway();
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [ref, onAway]);
}
