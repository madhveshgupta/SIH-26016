"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, Marker, Tooltip, CircleMarker, GeoJSON, Pane, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { Plus, Minus, LocateFixed, TriangleAlert } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { useT } from "@frontend/components/I18nProvider";

export type PlotTone = "pending" | "progress" | "completed" | "issue";

/** Status colours, tuned to read on satellite imagery; same meaning as the table badges. */
export const TONE_COLOR: Record<PlotTone, string> = {
  pending: "#e0a526",
  progress: "#38bdf8",
  completed: "#4ade80",
  issue: "#f05252",
};

/** Selection is a GIS concept, not a status: white halo, cyan line — the convention in desktop GIS. */
const SELECTED = { halo: "#ffffff", line: "#22d3ee" };

export interface MapPlot {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
  tone: PlotTone;
  village: string;
  district: string;
  project: string;
  recordHa: number;
  mappedHa: number | null;
  owner: string | null;
  statusLabel: string;
  hasConflict: boolean;
}

type Basemap = "satellite" | "streets";

const BASEMAPS: Record<Basemap, { label: "screens.globe.satellite" | "screens.globe.street"; url: string; maxNative: number }> = {
  satellite: {
    label: "screens.globe.satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNative: 18,
  },
  streets: {
    label: "screens.globe.street",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxNative: 19,
  },
};

/** Below this zoom, individual plots are too small to outline: group them. */
const DETAIL_ZOOM = 15;
/** From this zoom every plot carries its khasra number. */
const LABEL_ZOOM = 18;
/** Screen distance (px) inside which markers are grouped at overview zooms. */
const CLUSTER_PX = 44;

/** Every boundary the officer may see, fetched once per session. */
let outlinePromise: Promise<Map<string, Geometry>> | null = null;
function loadOutlines(): Promise<Map<string, Geometry>> {
  outlinePromise ??= fetch("/api/gis/parcels")
    .then((r) => (r.ok ? r.json() : { features: [] }))
    .then((fc: FeatureCollection) => {
      const byId = new Map<string, Geometry>();
      for (const f of fc.features ?? []) {
        const id = (f.properties as { id?: string } | null)?.id;
        if (id && f.geometry) byId.set(id, f.geometry);
      }
      return byId;
    })
    .catch(() => {
      outlinePromise = null; // try again next time rather than caching a failure
      return new Map<string, Geometry>();
    });
  return outlinePromise;
}

function useOutlines(): Map<string, Geometry> {
  const [outlines, setOutlines] = useState<Map<string, Geometry>>(new Map());
  useEffect(() => {
    if (!navigator.onLine) return;
    let live = true;
    void loadOutlines().then((m) => live && setOutlines(m));
    return () => {
      live = false;
    };
  }, []);
  return outlines;
}

function ScaleBar() {
  const map = useMap();
  useEffect(() => {
    const scale = L.control.scale({ metric: true, imperial: false, position: "bottomleft", maxWidth: 100 });
    scale.addTo(map);
    return () => {
      scale.remove();
    };
  }, [map]);
  return null;
}

/** Frames the selected plot: its outline when known, else its centroid. */
function FrameSelection({ plot, outline, nonce }: { plot: MapPlot | null; outline: Geometry | null; nonce: number }) {
  const map = useMap();
  const hasOutline = outline != null;
  useEffect(() => {
    if (outline) {
      const bounds = L.geoJSON(outline).getBounds();
      if (bounds.isValid()) {
        map.flyToBounds(bounds, { padding: [72, 72], maxZoom: 18, duration: 0.6 });
        return;
      }
    }
    if (plot?.lat != null && plot.lng != null) map.flyTo([plot.lat, plot.lng], 17, { duration: 0.6 });
    // Re-frame when the selection, its outline's arrival, or a recenter request changes.
  }, [map, plot?.id, hasOutline, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Controls({ onRecenter }: { onRecenter: () => void }) {
  const t = useT();
  const map = useMap();
  const btn =
    "flex h-8 w-8 items-center justify-center bg-surface text-foreground/80 transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40";
  return (
    <div className="absolute left-3 top-3 z-[500] flex flex-col overflow-hidden rounded-lg border border-border shadow-sm">
      <button type="button" className={btn} onClick={() => map.zoomIn()} aria-label={t("screens.field.zoomIn")} title={t("screens.field.zoomIn")}>
        <Plus className="h-4 w-4" />
      </button>
      <button type="button" className={`${btn} border-t border-border`} onClick={() => map.zoomOut()} aria-label={t("screens.field.zoomOut")} title={t("screens.field.zoomOut")}>
        <Minus className="h-4 w-4" />
      </button>
      <button type="button" className={`${btn} border-t border-border`} onClick={onRecenter} aria-label={t("screens.field.recenter")} title={t("screens.field.recenter")}>
        <LocateFixed className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Everything that is not the selected plot, drawn with as little ink as will
 * still tell the officer what is around them:
 *  - overview zooms: markers grouped by screen distance, one bubble per group;
 *  - detail zooms: faint outlines in the status colour, labels only when close.
 */
function ContextLayers({
  plots,
  outlines,
  selectedId,
  onSelect,
}: {
  plots: MapPlot[];
  outlines: Map<string, Geometry>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const selected = plots.find((p) => p.id === selectedId);
  // The same khasra recorded under a second project is the same land (a conflict).
  const isTwin = (p: MapPlot) =>
    selected != null && p.label === selected.label && p.village === selected.village &&
    Math.abs(p.lat! - (selected.lat ?? 0)) < 1e-5 && Math.abs(p.lng! - (selected.lng ?? 0)) < 1e-5;
  const others = useMemo(
    () => plots.filter((p) => p.id !== selectedId && p.lat != null && p.lng != null && !isTwin(p)),
    [plots, selectedId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const selectedLabel = selected?.label;

  const clusters = useMemo(() => {
    if (zoom >= DETAIL_ZOOM) return [];
    const cells = new Map<string, MapPlot[]>();
    for (const p of others) {
      const pt = map.project([p.lat!, p.lng!], zoom);
      const key = `${Math.floor(pt.x / CLUSTER_PX)}:${Math.floor(pt.y / CLUSTER_PX)}`;
      const cell = cells.get(key);
      if (cell) cell.push(p);
      else cells.set(key, [p]);
    }
    return [...cells.values()];
  }, [others, zoom, map]);

  const outlined = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: others
        .filter((p) => outlines.has(p.id))
        .map((p): Feature => ({ type: "Feature", geometry: outlines.get(p.id)!, properties: { id: p.id, label: p.label, tone: p.tone } })),
    }),
    [others, outlines],
  );

  if (zoom < DETAIL_ZOOM) {
    return (
      <>
        {clusters.map((group) => {
          if (group.length === 1) {
            const p = group[0];
            return (
              <CircleMarker
                key={p.id}
                center={[p.lat!, p.lng!]}
                radius={4}
                pathOptions={{ color: "#fff", weight: 1, fillColor: TONE_COLOR[p.tone], fillOpacity: 0.9 }}
                eventHandlers={{ click: () => onSelect(p.id) }}
              >
                <Tooltip direction="top" offset={[0, -4]}>{t("screens.parcelPage.khasraTitle", { no: p.label })}</Tooltip>
              </CircleMarker>
            );
          }
          const lat = group.reduce((a, p) => a + p.lat!, 0) / group.length;
          const lng = group.reduce((a, p) => a + p.lng!, 0) / group.length;
          const issues = group.filter((p) => p.tone === "issue").length;
          return (
            <Marker
              key={group.map((p) => p.id).join()}
              position={[lat, lng]}
              icon={L.divIcon({
                className: "",
                html: `<div class="field-cluster${issues ? " has-issue" : ""}">${group.length}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15],
              })}
              eventHandlers={{
                click: () => map.flyToBounds(L.latLngBounds(group.map((p) => [p.lat!, p.lng!])), { padding: [40, 40], maxZoom: 17 }),
              }}
            >
              <Tooltip direction="top" offset={[0, -14]}>
                {issues
                  ? t("screens.field.clusterTipIssues", { plots: t("screens.globe.plotsMany", { count: group.length }), issues })
                  : t("screens.field.clusterTip", { plots: t("screens.globe.plotsMany", { count: group.length }) })}
              </Tooltip>
            </Marker>
          );
        })}
      </>
    );
  }

  const showLabels = zoom >= LABEL_ZOOM;
  return (
    <>
      <GeoJSON
        // Leaflet reads data and handlers once; re-key when either must change.
        key={`${selectedId}:${showLabels}:${outlined.features.length}`}
        data={outlined}
        style={(f) => {
          const c = TONE_COLOR[(f?.properties?.tone as PlotTone) ?? "pending"];
          return { color: c, weight: 1.25, opacity: 0.8, fillColor: c, fillOpacity: 0.07 };
        }}
        onEachFeature={(f, layer) => {
          const { id, label } = f.properties as { id: string; label: string };
          // A second claim on the selected khasra sits under it; one label is enough.
          const permanent = showLabels && label !== selectedLabel;
          layer.bindTooltip(`Khasra ${label}`, permanent
            ? { permanent: true, direction: "center", className: "field-parcel-label" }
            : { sticky: true, direction: "top" });
          layer.on({
            click: () => onSelect(id),
            mouseover: (e) => (e.target as L.Path).setStyle({ weight: 2.25, fillOpacity: 0.16 }),
            mouseout: (e) => (e.target as L.Path).setStyle({ weight: 1.25, fillOpacity: 0.07 }),
          });
        }}
      />
      {/* Plots with no mapped boundary yet: a small point, never a pin. */}
      {others
        .filter((p) => !outlines.has(p.id))
        .map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat!, p.lng!]}
            radius={4}
            pathOptions={{ color: "#fff", weight: 1, fillColor: TONE_COLOR[p.tone], fillOpacity: 0.9 }}
            eventHandlers={{ click: () => onSelect(p.id) }}
          >
            <Tooltip direction="top" offset={[0, -4]} permanent={showLabels} className={showLabels ? "field-parcel-label" : undefined}>
              {showLabels ? p.label : t("screens.parcelPage.khasraTitle", { no: p.label })}
            </Tooltip>
          </CircleMarker>
        ))}
    </>
  );
}

export default function FieldMapPreview({
  plots,
  selected,
  popupOpen,
  onSelect,
  onClosePopup,
  onSurvey,
}: {
  plots: MapPlot[];
  selected: MapPlot | null;
  /** Show the compact detail popup on the selected plot. */
  popupOpen: boolean;
  /** A plot was picked on the map. */
  onSelect: (id: string) => void;
  /** The popup for this plot was closed (by the user, or by moving to another plot). */
  onClosePopup: (id: string) => void;
  onSurvey: (id: string) => void;
}) {
  const t = useT();
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [nonce, setNonce] = useState(0);
  const outlines = useOutlines();
  const selectedOutline = selected ? outlines.get(selected.id) ?? null : null;

  const hasFix = selected?.lat != null && selected.lng != null;
  const center: [number, number] = hasFix ? [selected.lat!, selected.lng!] : [22.0, 78.0];
  const base = BASEMAPS[basemap];

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={hasFix ? 17 : 4}
        maxZoom={20}
        zoomControl={false}
        scrollWheelZoom
        attributionControl={false}
        className="field-map h-full w-full"
        style={{ background: "#1c2620", zIndex: 0 }}
      >
        <TileLayer key={basemap} url={base.url} maxNativeZoom={base.maxNative} maxZoom={20} />

        <ContextLayers plots={plots} outlines={outlines} selectedId={selected?.id ?? null} onSelect={onSelect} />

        {/* The selection lives in its own pane above every context layer, so
            nothing redrawn later (e.g. on zoom) can cover it. */}
        <Pane name="field-selected" style={{ zIndex: 450 }}>
        {selectedOutline && (
          <>
            <GeoJSON
              key={`${selected!.id}-halo`}
              data={selectedOutline}
              interactive={false}
              style={{ color: SELECTED.halo, weight: 5, opacity: 0.85, fill: false, className: "field-selected-flash" }}
            />
            <GeoJSON
              key={`${selected!.id}-line`}
              data={selectedOutline}
              style={{ color: SELECTED.line, weight: 2.5, opacity: 1, fillColor: SELECTED.line, fillOpacity: 0.16, className: "field-selected-flash" }}
              eventHandlers={{ click: () => onSelect(selected!.id) }}
            />
          </>
        )}

        {hasFix && !popupOpen && (
          <CircleMarker
            center={[selected.lat!, selected.lng!]}
            radius={5}
            pathOptions={{ color: SELECTED.halo, weight: 2, fillColor: SELECTED.line, fillOpacity: 1 }}
            eventHandlers={{ click: () => onSelect(selected.id) }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]} className="field-plot-label">
              {t("screens.parcelPage.khasraTitle", { no: selected.label })}
            </Tooltip>
          </CircleMarker>
        )}
        </Pane>

        {hasFix && popupOpen && (
          <Popup
            key={selected.id}
            position={[selected.lat!, selected.lng!]}
            className="field-popup"
            autoPanPadding={[24, 24]}
            maxWidth={260}
            minWidth={236}
            eventHandlers={{ remove: () => onClosePopup(selected.id) }}
          >
            <PlotPopup plot={selected} onSurvey={() => onSurvey(selected.id)} />
          </Popup>
        )}

        <FrameSelection plot={selected} outline={selectedOutline} nonce={nonce} />
        <ScaleBar />
        <Controls onRecenter={() => setNonce((n) => n + 1)} />
      </MapContainer>

      {/* Basemap toggle */}
      <div className="absolute right-3 top-3 z-[500] flex overflow-hidden rounded-lg border border-border bg-surface p-0.5 text-xs font-medium shadow-sm" role="group" aria-label={t("screens.field.basemap")}>
        {(Object.keys(BASEMAPS) as Basemap[]).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBasemap(b)}
            aria-pressed={basemap === b}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              basemap === b ? "bg-brand text-white" : "text-foreground/75 hover:bg-surface-muted hover:text-foreground"
            }`}
          >
            {t(BASEMAPS[b].label)}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 right-3 z-[500] rounded-lg border border-border bg-surface/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground/80">
          {(
            [
              ["pending", t("status.pending")],
              ["progress", t("screens.field.onDevice")],
              ["completed", t("screens.field.surveyed")],
              ["issue", t("screens.field.conflict")],
            ] as [PlotTone, string][]
          ).map(([tone, label]) => (
            <li key={tone} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full ring-1 ring-black/10" style={{ background: TONE_COLOR[tone] }} />
              {label}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-3 rounded-[2px] border-2" style={{ borderColor: SELECTED.line, background: `${SELECTED.line}33` }} />
            {t("screens.field.selected")}
          </li>
        </ul>
      </div>

      {!hasFix && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-[400] mx-auto w-fit -translate-y-1/2 rounded-lg border border-border bg-surface/95 px-3 py-2 text-xs font-medium text-muted shadow-sm">
          {selected ? t("screens.field.noLocation") : t("screens.field.selectToSee")}
        </div>
      )}
    </div>
  );
}

/** The compact card shown on the selected plot — the few facts needed to decide what to do next. */
function PlotPopup({ plot, onSurvey }: { plot: MapPlot; onSurvey: () => void }) {
  const t = useT();
  return (
    <div className="font-sans text-foreground">
      <div className="flex items-start justify-between gap-2 pr-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{t("common.khasra")}</div>
          <div className="text-base font-semibold leading-tight tabular-nums">{plot.label}</div>
        </div>
        <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${
          plot.tone === "completed" ? "bg-success-soft text-success"
            : plot.tone === "progress" ? "bg-info-soft text-info"
            : "bg-warning-soft text-warning"
        }`}>
          {plot.statusLabel}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div className="col-span-2">
          <dt className="text-muted">{t("screens.field.location")}</dt>
          <dd className="font-medium">{plot.village}, {plot.district}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted">{t("common.project")}</dt>
          <dd className="truncate font-medium" title={plot.project}>{plot.project}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("screens.field.areaOnRecord")}</dt>
          <dd className="font-medium tabular-nums">{t("screens.units.ha", { value: plot.recordHa.toFixed(4) })}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("screens.field.mappedArea")}</dt>
          <dd className="font-medium tabular-nums">{plot.mappedHa != null ? t("screens.units.ha", { value: plot.mappedHa.toFixed(4) }) : "—"}</dd>
        </div>
        {plot.owner && (
          <div className="col-span-2">
            <dt className="text-muted">{t("screens.field.landowner")}</dt>
            <dd className="truncate font-medium">{plot.owner}</dd>
          </div>
        )}
      </dl>
      {plot.hasConflict && (
        <p className="mt-2 flex items-center gap-1.5 rounded bg-danger-soft px-2 py-1 text-[11px] font-medium text-danger">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> {t("screens.field.conflictTitle")}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Link
          href={`/parcels/${plot.id}`}
          className="inline-flex h-8 flex-1 items-center justify-center rounded-lg border border-border bg-surface text-xs font-medium text-foreground! hover:bg-surface-muted"
        >
          {t("screens.mapPanel.viewFull")}
        </Link>
        <button
          type="button"
          onClick={onSurvey}
          className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-brand text-xs font-medium text-white hover:bg-brand-strong"
        >
          {t("screens.field.startSurvey")}
        </button>
      </div>
    </div>
  );
}
