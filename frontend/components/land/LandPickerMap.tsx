"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, GeoJSON, MapContainer, Polygon, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import L, { type GeoJSON as LeafletGeoJSON, type Layer, type LeafletMouseEvent, type PathOptions } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CandidatePlot } from "@backend/projects/land-selection";
import { useT } from "@frontend/components/I18nProvider";

export type PickerTool = "select" | "line" | "lookup";

interface Props {
  plots: CandidatePlot[];
  selected: Set<string>;
  tool: PickerTool;
  /** Alignment vertices, [lat, lng]. */
  line: [number, number][];
  rightOfWayM: number;
  /** Changes when the district changes, so the map refits once. */
  fitKey: string;
  onTogglePlot: (key: string) => void;
  onMapClick: (lat: number, lng: number) => void;
  /** Pixels, or any CSS length — e.g. a calc() that fills the window. */
  height?: number | string;
}

const LABEL_MIN_ZOOM = 17;

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function styleFor(plot: CandidatePlot | undefined, selected: boolean): PathOptions {
  if (!plot) return {};
  if (plot.inProject && !plot.inProject.editable) {
    return { color: "#e5e7eb", weight: 1.5, fillColor: "#64748b", fillOpacity: 0.55 };
  }
  if (selected) {
    return { color: plot.claimedBy.length ? "#dc2626" : "#ffffff", weight: 2.2, dashArray: plot.claimedBy.length ? "5 4" : undefined, fillColor: "#2563eb", fillOpacity: 0.6 };
  }
  if (plot.claimedBy.length) return { color: "#f87171", weight: 1.4, dashArray: "5 4", fillColor: "#f87171", fillOpacity: 0.18 };
  if (plot.source === "LIVE") return { color: "#22d3ee", weight: 1.6, fillColor: "#22d3ee", fillOpacity: 0.15 };
  if (plot.geometryKind === "GENERATED") return { color: "#ffffff", weight: 1.1, dashArray: "4 3", fillColor: "#ffffff", fillOpacity: 0.06 };
  return { color: "#fde047", weight: 1.2, fillColor: "#fde047", fillOpacity: 0.08 };
}

function FitTo({ data, fitKey }: { data: FeatureCollection; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!data.features.length) return;
    const b = L.geoJSON(data as never).getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [20, 20], maxZoom: 18 });
    // Refit only when the district changes, not on every selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, data.features.length > 0, map]);
  return null;
}

function ClickAndZoom({ onClick, onZoom }: { onClick: (e: LeafletMouseEvent) => void; onZoom: (z: number) => void }) {
  const map = useMapEvents({ click: onClick, zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => onZoom(map.getZoom()), [map, onZoom]);
  return null;
}

/** The right-of-way drawn on the ground: a band `width` metres wide around each segment. */
function bandQuads(line: [number, number][], width: number): [number, number][][] {
  const half = width / 2;
  const quads: [number, number][][] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [lat1, lng1] = line[i];
    const [lat2, lng2] = line[i + 1];
    const mLat = 111_320;
    const mLng = 111_320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
    const dx = (lng2 - lng1) * mLng;
    const dy = (lat2 - lat1) * mLat;
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * half;
    const oy = (dx / len) * half;
    const off = (lat: number, lng: number, s: number): [number, number] => [lat + (s * oy) / mLat, lng + (s * ox) / mLng];
    quads.push([off(lat1, lng1, 1), off(lat2, lng2, 1), off(lat2, lng2, -1), off(lat1, lng1, -1)]);
  }
  return quads;
}

export default function LandPickerMap({ plots, selected, tool, line, rightOfWayM, fitKey, onTogglePlot, onMapClick, height = 560 }: Props) {
  const t = useT();
  const [zoom, setZoom] = useState(15);
  const [hover, setHover] = useState<string | null>(null);
  const geoRef = useRef<LeafletGeoJSON | null>(null);
  const byKey = useMemo(() => new Map(plots.map((p) => [p.key, p])), [plots]);

  const data = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: plots.map((p) => ({ type: "Feature", geometry: p.geometry, properties: { key: p.key } })),
    }),
    [plots],
  );

  // Handlers read the latest props through refs, so the layer need not be rebuilt on every click.
  const latest = useRef({ tool, onTogglePlot, onMapClick });
  useEffect(() => {
    latest.current = { tool, onTogglePlot, onMapClick };
  }, [tool, onTogglePlot, onMapClick]);

  // Restyle in place when the selection changes.
  useEffect(() => {
    geoRef.current?.setStyle(((f?: Feature<Geometry, { key: string }>) => {
      const key = f?.properties?.key ?? "";
      return styleFor(byKey.get(key), selected.has(key));
    }) as never);
  }, [selected, byKey]);

  const onEach = (feature: Feature<Geometry, { key: string }>, layer: Layer) => {
    const p = byKey.get(feature.properties.key);
    if (!p) return;
    const path = layer as import("leaflet").Path;
    path.bindTooltip(esc(p.khasraNo), { permanent: true, direction: "center", className: "khasra-label" });
    path.on("mouseover", () => setHover(p.key));
    path.on("mouseout", () => setHover((h) => (h === p.key ? null : h)));
    path.on("click", (e: LeafletMouseEvent) => {
      // Handled here; the map's own click handler must not see it again.
      L.DomEvent.stopPropagation(e);
      const { tool: current, onTogglePlot: toggle, onMapClick: mapClick } = latest.current;
      // While drawing, a click on a plot is a click on the ground.
      if (current === "line") mapClick(e.latlng.lat, e.latlng.lng);
      else toggle(p.key);
    });
  };

  const hovered = hover ? byKey.get(hover) : undefined;

  return (
    <div style={{ height }} className={`relative overflow-hidden rounded-xl border border-border ${zoom < LABEL_MIN_ZOOM ? "hide-khasra" : ""} ${tool === "select" ? "" : "picker-crosshair"}`}>
      <style>{`
        .khasra-label { background: none !important; border: none !important; box-shadow: none !important;
          color: #fff; font: 700 11px/1 system-ui, sans-serif; padding: 0 !important; text-shadow: 0 0 3px #000, 0 0 2px #000; }
        .khasra-label::before { display: none !important; }
        .hide-khasra .khasra-label { display: none; }
        .picker-crosshair .leaflet-container, .picker-crosshair .leaflet-interactive { cursor: crosshair !important; }
      `}</style>
      <MapContainer center={[22.5, 79]} zoom={5} maxZoom={20} zoomSnap={0.25} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer
          attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxNativeZoom={18}
          maxZoom={20}
        />
        <ClickAndZoom
          onZoom={setZoom}
          onClick={(e) => latest.current.onMapClick(e.latlng.lat, e.latlng.lng)}
        />
        <GeoJSON
          key={fitKey + ":" + plots.length}
          ref={geoRef}
          data={data as never}
          style={((f?: Feature<Geometry, { key: string }>) => styleFor(byKey.get(f?.properties?.key ?? ""), selected.has(f?.properties?.key ?? ""))) as never}
          onEachFeature={onEach as never}
        />
        {line.length >= 2 &&
          bandQuads(line, rightOfWayM).map((q, i) => (
            <Polygon key={`band-${i}`} positions={q} interactive={false} pathOptions={{ color: "#ffffff", weight: 1, dashArray: "6 6", fillColor: "#ffffff", fillOpacity: 0.12 }} />
          ))}
        {line.length >= 1 && <Polyline positions={line} interactive={false} pathOptions={{ color: "#f97316", weight: 3 }} />}
        {line.map((p, i) => (
          <CircleMarker key={`v-${i}`} center={p} radius={4} interactive={false} pathOptions={{ color: "#fff", weight: 2, fillColor: "#f97316", fillOpacity: 1 }} />
        ))}
        <FitTo data={data} fitKey={fitKey} />
      </MapContainer>
      {hovered && (
        <div className="pointer-events-none absolute right-3 top-3 z-[500] w-64 rounded-lg bg-white/95 p-3 text-xs text-slate-800 shadow-lg">
          <div className="font-semibold">{t("screens.parcelPage.khasraTitle", { no: hovered.khasraNo })}</div>
          <div className="text-slate-500">
            {hovered.village} ·{" "}
            {hovered.recordHa != null
              ? t("screens.landWb.onRecordHa", { ha: hovered.recordHa.toFixed(4) })
              : hovered.mapHa != null
                ? t("screens.landWb.measuredHa", { ha: hovered.mapHa.toFixed(4) })
                : t("screens.landWb.areaNotPublished")}
          </div>
          {hovered.claimedBy.length > 0 && (
            <div className="mt-2 rounded bg-red-100 px-2 py-1 text-red-800">
              <div className="font-semibold">{t("screens.landWb.alreadyClaimedBy")}</div>
              {hovered.claimedBy.map((c) => (
                <div key={c.projectId}>{c.name} ({c.referenceNo})</div>
              ))}
            </div>
          )}
          {hovered.inProject && !hovered.inProject.editable && (
            <div className="mt-2 text-slate-500">{t("screens.landWb.lockedHover")}</div>
          )}
          {hovered.geometryKind === "GENERATED" && <div className="mt-2 text-amber-700">{t("screens.landWb.generatedHover")}</div>}
        </div>
      )}
    </div>
  );
}
