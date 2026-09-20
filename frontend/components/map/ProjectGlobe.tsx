"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type * as CesiumT from "cesium";
import type { Feature, Geometry } from "geojson";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { STATUS_COLOUR, projectColour } from "./legend";
import { useT } from "@frontend/components/I18nProvider";
import { parcelStatusKey } from "@backend/i18n/scope";
import type { MessageKey } from "@backend/i18n/types";

type T = ReturnType<typeof useT>;
import { esriSatellite } from "./cesium-viewer";

/**
 * The national land map: a 3D globe that flies from orbit down to a project's khasra boundaries
 * in one continuous camera move.
 */

export interface GlobeProject {
  id: string;
  ref: string;
  name: string;
  type: string;
  state: string;
  district: string;
  lat: number;
  lng: number;
  parcels: number;
  hectares: number;
  possessedPct: number;
  conflicts: number;
  source: "TRACED" | "OSM_FIELD" | "GENERATED";
}

/** The controls' words — the viewer's language by default; a caller may pass its own. */
export interface GlobeLabels {
  satellite: string;
  street: string;
  fullScreen: string;
  exitFullScreen: string;
  openFull: string;
  exitFull: string;
  rightOfWay: string;
  loadingGlobe: string;
  loadingLand: string;
  loadFailed: string;
  noParcels: string;
  hint: string;
  close: string;
}

const defaultLabels = (t: T): GlobeLabels => ({
  satellite: t("screens.globe.satellite"),
  street: t("screens.globe.street"),
  fullScreen: t("screens.globe.fullScreen"),
  exitFullScreen: t("screens.globe.exitFullScreen"),
  openFull: t("screens.globe.openFull"),
  exitFull: t("screens.globe.exitFull"),
  rightOfWay: t("screens.globe.rightOfWay"),
  loadingGlobe: t("screens.misc.loadingGlobe"),
  loadingLand: t("screens.globe.loadingLand"),
  loadFailed: t("screens.globe.loadFailed"),
  noParcels: t("screens.globe.noParcels"),
  hint: t("screens.globe.hint"),
  close: t("common.close"),
});

interface Props {
  /** Control labels; the viewer's language where omitted. */
  labels?: Partial<GlobeLabels>;
  projects: GlobeProject[];
  /** Currently selected project (null = the whole-country overview). */
  projectId?: string | null;
  statusFilter?: string | null;
  colourBy?: "status" | "project";
  /** Project pages open straight on their own land, with no overview to go back to. */
  lockProject?: boolean;
  onProjectChange?: (id: string | null) => void;
  /**
   * Clicking a plot hands it to the caller, which selects it, instead of opening the built-in
   * record card.
   */
  onSelectParcel?: (feature: Feature<Geometry, Record<string, unknown>>) => void;
  /** Clicking empty map (or a project marker) drops the caller’s selection. */
  onClearSelection?: () => void;
  /** The selected plot; drawn picked out from its neighbours. */
  selectedId?: string | null;
  /** The selected plot’s card. The globe pins it to that plot on screen. */
  popup?: ReactNode;
  /** Bumped to fly down to the selected plot. */
  focusNonce?: number;
  /** Pixels, or any CSS length — e.g. a calc() that fills the window. */
  height?: number | string;
}

/** One drawn plot: its entities, and what is needed to restyle or frame it. */
interface DrawnParcel {
  fill: CesiumT.Entity;
  edge: CesiumT.Entity;
  fillCss: string;
  edgeMaterial: CesiumT.MaterialProperty;
  edgeWidth: number;
  positions: CesiumT.Cartesian3[];
  feature: Feature<Geometry, Record<string, unknown>>;
}

type ParcelLook = "normal" | "hover" | "selected";

/** Where a project's land stands, so the globe can say so instead of going blank. */
type LandState =
  | { pid: string; status: "ok"; count: number; byStatus: Record<string, number> }
  | { pid: string; status: "error" };

interface ParcelProps {
  id: string;
  ulpin: string | null;
  khasraNo: string;
  status: string;
  recordHa: number | null;
  mapHa: number | null;
  discrepancyHa: number | null;
  hasConflict: boolean;
  otherProjects: string | null;
  geometryKind: string;
  boundaryAccuracyM: number | null;
  chainageM: number | null;
  village: string;
  district: string;
  state: string;
  projectRef: string;
  project: string;
}

interface CadastralLayer {
  village: string;
  district: string;
  state: string;
  imageUrl: string;
  /** `[[south, west], [north, east]]`, as the Leaflet overlay used. */
  bounds: [[number, number], [number, number]];
}

type FC = { features: { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }[] };


/** Outline colour by where the boundary came from — as on the Leaflet map. */
const EDGE: Record<string, string> = {
  OSM_FIELD: "#22d3ee",
  GENERATED: "#ffffff",
};
const EDGE_DEFAULT = "#fde047";

const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Khasra numbers only become readable close in — the 3D form of "zoom ≥ 17". */
const LABEL_RANGE_FACTOR = 4;
const LABEL_RANGE_MIN_M = 900;

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function ha(t: T, v: unknown): string {
  return typeof v === "number" ? t("screens.units.ha", { value: v.toFixed(4) }) : "—";
}

/** Space kept between the plot card and the map edge, and between card and plot. */
const CARD_EDGE = 8;
const CARD_GAP = 14;
/** Below this map width the card docks along the bottom as a sheet. */
const CARD_SHEET_BELOW = 480;

/**
 * Put the selected plot’s card beside the plot: above it when there is room, otherwise below,
 * slid sideways to stay inside the map with its arrow still on the plot.
 */
function placeCard(card: HTMLElement, arrow: HTMLElement | null, at: { x: number; y: number } | null, W: number, H: number) {
  const onMap = at !== null && at.x >= 0 && at.x <= W && at.y >= 0 && at.y <= H;
  let side: "above" | "below" | "sheet" = W < CARD_SHEET_BELOW ? "sheet" : "above";
  if (side !== "sheet" && !onMap) {
    card.style.visibility = "hidden";
    return;
  }
  card.style.width = side === "sheet" ? `${W - CARD_EDGE * 2}px` : "";
  let w = card.offsetWidth;
  let h = card.offsetHeight;
  if (side !== "sheet" && at) {
    if (at.y - CARD_GAP - h >= CARD_EDGE) side = "above";
    else if (at.y + CARD_GAP + h <= H - CARD_EDGE) side = "below";
    else {
      side = "sheet";
      card.style.width = `${W - CARD_EDGE * 2}px`;
      w = card.offsetWidth;
      h = card.offsetHeight;
    }
  }

  let x = CARD_EDGE;
  let y = H - h - CARD_EDGE;
  if (side !== "sheet" && at) {
    x = Math.min(Math.max(at.x - w / 2, CARD_EDGE), W - w - CARD_EDGE);
    y = side === "above" ? at.y - CARD_GAP - h : at.y + CARD_GAP;
  }
  card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  card.style.visibility = "visible";

  if (!arrow) return;
  if (side === "sheet" || !at) {
    arrow.style.display = "none";
    return;
  }
  // A 12px square turned 45°, half outside the card, pointing at the plot.
  arrow.style.display = "block";
  arrow.style.left = `${Math.min(Math.max(at.x - x, 16), w - 16) - 6}px`;
  arrow.style.top = side === "above" ? `${h - 8}px` : "-7px";
  arrow.style.borderWidth = side === "above" ? "0 1px 1px 0" : "1px 0 0 1px"; // i18n-ignore — CSS
}

function markerColour(p: GlobeProject): string {
  if (p.conflicts > 0) return "#ef4444";
  if (p.possessedPct >= 40) return "#10b981";
  if (p.possessedPct > 0) return "#facc15";
  return "#60a5fa";
}

/** The parcel record card — same fields and wording as the Leaflet popup. */
function popupHtml(p: ParcelProps, t: T): string {
  const chainage = p.chainageM != null ? ` · ${esc(t("screens.plotRecord.kmAlong", { km: (Number(p.chainageM) / 1000).toFixed(2) }))}` : "";
  const record = p.recordHa == null ? t("screens.plotRecord.notPublished") : ha(t, p.recordHa);
  const rows = [
    `<div class="pp-title">${esc(t("screens.parcelPage.khasraTitle", { no: p.khasraNo }))}</div>`,
    `<div class="pp-sub">${esc(p.village)}, ${esc(p.district)}, ${esc(p.state)}</div>`,
    `<div class="pp-row"><span class="pp-dot" style="background:${STATUS_COLOUR[p.status] ?? "#94a3b8"}"></span>${esc(t(parcelStatusKey(p.status)))}</div>`,
    `<div class="pp-row pp-muted">${esc(p.project)}${chainage}</div>`,
    `<table class="pp-table">` +
      `<tr><td>${esc(t("screens.globe.revenueRecord"))}</td><td>${esc(record)}</td></tr>` +
      `<tr><td>${esc(t("screens.plotRecord.measuredOnMap"))}</td><td>${esc(ha(t, p.mapHa))}</td></tr>` +
      `</table>`,
  ];
  const disc = p.discrepancyHa;
  const discPct = disc != null && p.recordHa != null && p.recordHa > 0 ? (disc / p.recordHa) * 100 : null;
  if (discPct != null && Math.abs(disc!) >= 0.01 && Math.abs(discPct) >= 10) {
    rows.push(
      `<div class="pp-warn">${esc(t("screens.globe.differ", {
        ha: `${disc! > 0 ? "+" : ""}${disc!.toFixed(4)}`,
        pct: `${discPct > 0 ? "+" : ""}${discPct.toFixed(0)}`,
      }))}</div>`,
    );
  }
  if (p.hasConflict) {
    const others = p.otherProjects ?? t("screens.globe.anotherProject");
    rows.push(`<div class="pp-alert">${esc(t("screens.globe.alsoClaimedBy", { projects: others }))}</div>`);
  }
  if (p.ulpin) rows.push(`<div class="pp-mono">ULPIN/PNIU ${esc(p.ulpin)}</div>`);
  const sourceKey = `screens.globe.src${p.geometryKind}`;
  const sourceName = t(sourceKey as MessageKey) === sourceKey ? p.geometryKind : t(sourceKey as MessageKey);
  const traced = p.geometryKind === "TRACED" && p.boundaryAccuracyM != null
    ? `, ${t("screens.globe.tracedWithin", { m: Number(p.boundaryAccuracyM).toFixed(2) })}`
    : "";
  const sourceClass = p.geometryKind === "GENERATED" ? "pp-source pp-gen" : "pp-source";
  rows.push(`<div class="${sourceClass}">${esc(t("screens.globe.boundaryIs", { source: sourceName }) + traced)}</div>`);
  rows.push(`<a class="pp-link" href="/parcels/${encodeURIComponent(p.id)}">${esc(t("screens.globe.viewFull"))}</a>`);
  return rows.join("");
}

export default function ProjectGlobe({
  projects,
  projectId = null,
  statusFilter = null,
  colourBy = "status",
  lockProject = false,
  onProjectChange,
  onSelectParcel,
  onClearSelection,
  selectedId = null,
  popup: selectionPopup = null,
  focusNonce = 0,
  height = 560,
  labels,
}: Props) {
  const t = useT();
  // The Cesium handlers are wired once; they read the current wording from here.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const L = { ...defaultLabels(t), ...labels };
  const container = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const cesiumRef = useRef<typeof CesiumT | null>(null);
  const viewerRef = useRef<CesiumT.Viewer | null>(null);
  const markerIdsRef = useRef<string[]>([]);
  /** Entities that belong to the current project's land, cleared on change. */
  const parcelEntitiesRef = useRef<CesiumT.Entity[]>([]);
  const overlayLayersRef = useRef<CesiumT.ImageryLayer[]>([]);
  const basemapsRef = useRef<{ satellite?: CesiumT.ImageryLayer; street?: CesiumT.ImageryLayer }>({});
  const loadedPidRef = useRef<string | null | undefined>(undefined);
  const parcelDataRef = useRef<{ parcels: FC | null; alignments: FC | null }>({ parcels: null, alignments: null });
  const onProjectChangeRef = useRef(onProjectChange);
  useEffect(() => {
    onProjectChangeRef.current = onProjectChange;
  }, [onProjectChange]);
  const onSelectParcelRef = useRef(onSelectParcel);
  useEffect(() => {
    onSelectParcelRef.current = onSelectParcel;
  }, [onSelectParcel]);
  const onClearSelectionRef = useRef(onClearSelection);
  useEffect(() => {
    onClearSelectionRef.current = onClearSelection;
  }, [onClearSelection]);
  const selectedIdRef = useRef<string | null>(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  /** Every drawn plot by parcel id, rebuilt with each draw. */
  const drawnRef = useRef<Map<string, DrawnParcel>>(new Map());
  const hoveredIdRef = useRef<string | null>(null);
  /** The project the camera last flew down to, so a restyle does not re-fly. */
  const flownPidRef = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ html: string; x: number; y: number; key: string } | null>(null);
  const [basemap, setBasemap] = useState<"satellite" | "street">("satellite");
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  const [isFull, setIsFull] = useState(false);
  const [sheetState, setSheetState] = useState<{ pid: string | null; layers: CadastralLayer[] }>({
    pid: null,
    layers: [],
  });
  const [showSheets, setShowSheets] = useState(false);
  const [land, setLand] = useState<LandState | null>(null);
  /** Bumped after every draw, so the selection is re-applied to new entities. */
  const [drawVersion, setDrawVersion] = useState(0);
  const [showRow, setShowRow] = useState(true);
  const showRowRef = useRef(true);
  /** The right-of-way lines, so the toggle can reach them without a redraw. */
  const rowEntitiesRef = useRef<CesiumT.Entity[]>([]);
  /** Khasra labels, hidden individually when they would collide on screen. */
  const labelEntitiesRef = useRef<CesiumT.Entity[]>([]);

  const withLand = useMemo(() => projects.filter((p) => p.parcels > 0), [projects]);

  /** Fill the window. */
  const toggleExpanded = useCallback(() => {
    const host = shellRef.current;
    if (!host) return;
    if (expandedRef.current) {
      setExpanded(false);
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (host.requestFullscreen) {
      // Falls back to an in-page overlay where the browser refuses fullscreen.
      host.requestFullscreen().catch(() => setExpanded(true));
    } else {
      setExpanded((v) => !v);
    }
  }, []);
  /** Sheets belong to one project; a stale set is simply not shown. */
  const sheets = useMemo(
    () => (sheetState.pid === projectId ? sheetState.layers : []),
    [sheetState, projectId],
  );

  const toggleRightOfWay = () => {
    const next = !showRow;
    setShowRow(next);
    showRowRef.current = next;
    for (const e of rowEntitiesRef.current) e.show = next;
  };

  /** Which selection the drawn land belongs to; a card from an older one is stale. */
  const viewKey = `${projectId ?? ""}|${statusFilter ?? ""}|${colourBy}`;
  const viewKeyRef = useRef(viewKey);
  useEffect(() => {
    viewKeyRef.current = viewKey;
  }, [viewKey]);

  /** Fill colour for one parcel, matching the Leaflet map's two colour modes. */
  const fillFor = useCallback(
    (status: string, ref: string, refs: string[]) =>
      colourBy === "project" ? projectColour(refs.indexOf(ref)) : STATUS_COLOUR[status] ?? "#94a3b8",
    [colourBy],
  );

  /** Paint one plot as ordinary, under the pointer, or selected. */
  const restyle = useCallback((id: string | null, look: ParcelLook) => {
    const C = cesiumRef.current;
    const d = id ? drawnRef.current.get(id) : undefined;
    if (!C || !d) return;
    const alpha = look === "selected" ? 0.75 : look === "hover" ? 0.7 : 0.5;
    if (d.fill.polygon) {
      d.fill.polygon.material = new C.ColorMaterialProperty(C.Color.fromCssColorString(d.fillCss).withAlpha(alpha));
    }
    if (d.edge.polyline) {
      // A heavy white outline reads over satellite imagery at any altitude.
      d.edge.polyline.material =
        look === "selected" ? new C.ColorMaterialProperty(C.Color.WHITE) : d.edgeMaterial;
      d.edge.polyline.width = new C.ConstantProperty(
        look === "selected" ? 4 : look === "hover" ? d.edgeWidth + 1.5 : d.edgeWidth,
      );
    }
  }, []);

  // ── Build the viewer once ──────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    const el = container.current;
    if (!el) return;

    (async () => {
      // Cesium fetches its workers and assets at runtime, so it has to be told
      // where they live before the module initialises.
      (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium";
      const C = await import("cesium");
      if (disposed) return;
      cesiumRef.current = C;

      // Belt and braces: nothing here uses an Ion asset, and an empty token
      // means a stray request would fail loudly rather than silently phone home.
      C.Ion.defaultAccessToken = "";

      const satellite = esriSatellite(C);
      const street = new C.ImageryLayer(
        new C.UrlTemplateImageryProvider({
          url: OSM_URL,
          maximumLevel: 19,
          credit: new C.Credit('© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'),
        }),
      );
      street.show = false;
      basemapsRef.current = { satellite, street };

      const viewer = new C.Viewer(el, {
        baseLayer: satellite,
        terrainProvider: new C.EllipsoidTerrainProvider(),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        // The record card is our own HTML, so Cesium's own panels stay off.
        infoBox: false,
        selectionIndicator: false,
      });
      if (disposed) {
        viewer.destroy();
        return;
      }
      viewerRef.current = viewer;
      viewer.imageryLayers.add(street);

      // Cesium defaults to the browser's "recommended" resolution, which is one canvas pixel per
      // CSS pixel.
      viewer.useBrowserRecommendedResolution = false;
      viewer.resolutionScale = 1;

      const scene = viewer.scene;
      // Smooth the parcel outlines and the globe's limb rather than leaving
      // them stair-stepped.
      if (scene.msaaSamples !== undefined) scene.msaaSamples = 4;
      const fxaa = scene.postProcessStages?.fxaa;
      if (fxaa) fxaa.enabled = true;
      // Fetch a finer imagery tile for the same screen area.
      scene.globe.maximumScreenSpaceError = 1.5;
      // Keep tiles that are still on screen while finer ones load, so panning
      // does not flash blurry parents.
      scene.globe.preloadSiblings = true;
      scene.globe.baseColor = C.Color.fromCssColorString("#0e2445");
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
      scene.globe.showGroundAtmosphere = true;
      // Double-click otherwise locks the camera onto whatever was hit.
      viewer.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

      // Open looking at India, then let the first fly-to take over.
      viewer.camera.setView({
        destination: C.Cartesian3.fromDegrees(79, 14, 9_000_000),
      });

      // Clicking either picks a project (overview) or opens a parcel record.
      const handler = new C.ScreenSpaceEventHandler(scene.canvas);
      handler.setInputAction((movement: { position: CesiumT.Cartesian2 }) => {
        const picked = scene.pick(movement.position);
        const entity = picked?.id as CesiumT.Entity | undefined;
        if (!entity || !entity.id) {
          setPopup(null);
          onClearSelectionRef.current?.();
          return;
        }
        const id = String(entity.id);
        if (id.startsWith("project:")) {
          setPopup(null);
          onClearSelectionRef.current?.();
          onProjectChangeRef.current?.(id.slice("project:".length));
          return;
        }
        // The fill, its outline and its khasra label all answer for the plot.
        const parcelId = entity.properties?.parcelId?.getValue(C.JulianDate.now()) as string | undefined;
        const drawn = parcelId ? drawnRef.current.get(parcelId) : undefined;
        if (drawn && onSelectParcelRef.current) {
          // The selected plot’s card is drawn inside the map, so it works
          // in fullscreen too — no need to leave it.
          setPopup(null);
          onSelectParcelRef.current(drawn.feature);
          return;
        }
        const record = drawn?.feature.properties as unknown as ParcelProps | undefined;
        if (record) {
          setPopup({
            html: popupHtml(record, tRef.current),
            // Keep the card on screen when a plot near the right edge is picked.
            x: Math.min(movement.position.x + 12, scene.canvas.clientWidth - 312),
            y: Math.max(8, movement.position.y - 40),
            key: viewKeyRef.current,
          });
        } else {
          setPopup(null);
        }
      }, C.ScreenSpaceEventType.LEFT_CLICK);

      // Plots and project markers are controls, so they look like ones under the pointer.
      let hoverAt: CesiumT.Cartesian2 | null = null;
      handler.setInputAction((movement: { endPosition: CesiumT.Cartesian2 }) => {
        const queued = hoverAt !== null;
        hoverAt = C.Cartesian2.clone(movement.endPosition);
        if (queued) return;
        requestAnimationFrame(() => {
          const at = hoverAt;
          hoverAt = null;
          if (!at || viewer.isDestroyed()) return;
          const entity = scene.pick(at)?.id as CesiumT.Entity | undefined;
          const isProject = Boolean(entity?.id && String(entity.id).startsWith("project:"));
          const parcelId =
            (entity?.properties?.parcelId?.getValue(C.JulianDate.now()) as string | undefined) ?? null;
          scene.canvas.style.cursor = isProject || parcelId ? "pointer" : "";
          const prev = hoveredIdRef.current;
          if (prev === parcelId) return;
          hoveredIdRef.current = parcelId;
          if (prev && prev !== selectedIdRef.current) restyle(prev, "normal");
          if (parcelId && parcelId !== selectedIdRef.current) restyle(parcelId, "hover");
        });
      }, C.ScreenSpaceEventType.MOUSE_MOVE);

      // A moving camera invalidates the card's anchor, so it closes on drag.
      scene.camera.moveStart.addEventListener(() => setPopup(null));

      setReady(true);
    })().catch((e) => {
      if (!disposed) setFailed(e instanceof Error ? e.message : tRef.current("screens.globe.failedStart"));
    });

    return () => {
      disposed = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [restyle]);

  // Escape leaves fullscreen without going through our button, so the label
  // follows the browser rather than our own state.
  useEffect(() => {
    const onChange = () => {
      const full = document.fullscreenElement === shellRef.current;
      setIsFull(full);
      if (full) setExpanded(false);
      // Cesium sizes its canvas from the container, which just changed.
      viewerRef.current?.resize();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Escape leaves the in-page full window too, unless a plot card is open on
  // it, in which case Escape closes the card first.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !selectedIdRef.current) setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // The in-page fallback changes the panel's size without a browser event.
  useEffect(() => {
    viewerRef.current?.resize();
  }, [expanded]);

  // ── Basemap switch ─────────────────────────────────────────────────────────
  useEffect(() => {
    const { satellite, street } = basemapsRef.current;
    if (satellite) satellite.show = basemap === "satellite";
    if (street) street.show = basemap === "street";
  }, [basemap, ready]);

  // ── Project markers (overview) ─────────────────────────────────────────────
  useEffect(() => {
    const C = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!C || !viewer) return;

    for (const id of markerIdsRef.current) viewer.entities.removeById(id);
    markerIdsRef.current = [];

    for (const p of withLand) {
      const id = `project:${p.id}`;
      viewer.entities.add({
        id,
        position: C.Cartesian3.fromDegrees(p.lng, p.lat),
        point: {
          // Bigger projects read as bigger dots, as on the flat overview.
          pixelSize: Math.max(9, Math.min(22, 7 + Math.sqrt(Math.max(p.hectares, 0)) * 1.4)),
          color: C.Color.fromCssColorString(markerColour(p)),
          outlineColor: C.Color.WHITE.withAlpha(0.9),
          outlineWidth: 2,
          // Markers sit on the ellipsoid; without this they sink into it.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${p.name}\n${t("screens.globe.markerLine", {
            plots: t(p.parcels === 1 ? "screens.globe.plotsOne" : "screens.globe.plotsMany", { count: p.parcels }),
            ha: p.hectares.toFixed(1),
            pct: p.possessedPct,
          })}`,
          font: "500 12px system-ui, sans-serif",
          fillColor: C.Color.WHITE,
          showBackground: true,
          backgroundColor: C.Color.fromCssColorString("rgba(15,23,42,0.85)"),
          backgroundPadding: new C.Cartesian2(8, 6),
          pixelOffset: new C.Cartesian2(0, -22),
          verticalOrigin: C.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          // Only the projects the camera is actually near get named, so the
          // globe does not turn into a wall of text.
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2_500_000),
        },
      });
      markerIdsRef.current.push(id);
    }
  }, [withLand, ready, t]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const inDetail = projectId !== null;
    for (const id of markerIdsRef.current) {
      const e = viewer.entities.getById(id);
      if (e) e.show = !inDetail;
    }
  }, [projectId, ready]);

  // ── Load the chosen project's land ─────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    if (projectId === null) {
      parcelDataRef.current = { parcels: null, alignments: null };
      loadedPidRef.current = null;
      flownPidRef.current = null;
      return;
    }
    if (loadedPidRef.current === projectId) return;

    let cancelled = false;
    const q = `?projectId=${encodeURIComponent(projectId)}`;
    const json = (url: string) =>
      fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    // A cadastral portal being down must not take the map with it.
    Promise.allSettled([
      json(`/api/gis/parcels${q}`),
      json(`/api/gis/projects${q}`),
      json(`/api/gis/cadastral${q}`),
    ]).then(([p, a, c]) => {
      if (cancelled) return;
      parcelDataRef.current = {
        parcels: p.status === "fulfilled" ? p.value : null,
        alignments: a.status === "fulfilled" ? a.value : null,
      };
      loadedPidRef.current = projectId;
      setSheetState({ pid: projectId, layers: c.status === "fulfilled" ? c.value.layers ?? [] : [] });
      setLand(
        p.status === "fulfilled"
          ? {
              pid: projectId,
              status: "ok",
              count: (p.value as FC).features?.length ?? 0,
              byStatus: ((p.value as FC).features ?? []).reduce<Record<string, number>>((m, f) => {
                const st = String(f.properties.status);
                m[st] = (m[st] ?? 0) + 1;
                return m;
              }, {}),
            }
          : { pid: projectId, status: "error" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, ready]);

  // ── Draw the land, and fly the camera down to it ───────────────────────────
  useEffect(() => {
    const C = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!C || !viewer || !ready) return;

    for (const e of parcelEntitiesRef.current) viewer.entities.remove(e);
    parcelEntitiesRef.current = [];
    drawnRef.current = new Map();
    labelEntitiesRef.current = [];
    hoveredIdRef.current = null;

    if (projectId === null) {
      if (!lockProject) {
        viewer.camera.flyTo({
          destination: C.Cartesian3.fromDegrees(79, 14, 9_000_000),
          duration: 2,
        });
      }
      return;
    }

    const { parcels, alignments } = parcelDataRef.current;
    if (loadedPidRef.current !== projectId || !parcels) return;

    const shown = statusFilter
      ? parcels.features.filter((f) => f.properties.status === statusFilter)
      : parcels.features;
    const refs = [...new Set(shown.map((f) => String(f.properties.projectRef)))].sort();
    const added: CesiumT.Entity[] = [];
    const rowEntities: CesiumT.Entity[] = [];
    const extent: CesiumT.Cartesian3[] = [];
    const labels: CesiumT.Entity[] = [];
    const drawn = new Map<string, DrawnParcel>();

    /** Every ring of a Polygon/MultiPolygon, outer ring first. */
    const ringsOf = (g: { type: string; coordinates: unknown }): number[][][] =>
      g.type === "Polygon" ? (g.coordinates as number[][][]) : (g.coordinates as number[][][][]).flat();

    for (const f of shown) {
      const record = f.properties as unknown as ParcelProps;
      const fillCss = fillFor(record.status, record.projectRef, refs);
      const fill = C.Color.fromCssColorString(fillCss).withAlpha(0.5);
      // A plot two projects both claim is outlined red; otherwise the outline
      // says where the boundary came from.
      const edge = C.Color.fromCssColorString(
        record.hasConflict ? "#dc2626" : EDGE[record.geometryKind] ?? EDGE_DEFAULT,
      );
      const rings = ringsOf(f.geometry);
      if (!rings.length) continue;

      const outer = rings[0];
      const positions = C.Cartesian3.fromDegreesArray(outer.flatMap(([x, y]) => [x, y]));
      const centre = C.BoundingSphere.fromPoints(positions).center;
      extent.push(...positions);

      const fillEntity = viewer.entities.add({
          // Draped on the ground so it follows the imagery exactly.
          polygon: {
            hierarchy: new C.PolygonHierarchy(
              positions,
              rings.slice(1).map(
                (hole) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(hole.flatMap(([x, y]) => [x, y]))),
              ),
            ),
            material: new C.ColorMaterialProperty(fill),
            height: 0,
          },
          properties: { parcelId: record.id },
        });

      // Ground polygons cannot carry their own outline, so the boundary is a
      // clamped polyline of the same ring.
      const edgeWidth = record.hasConflict ? 3 : 2;
      const edgeMaterial: CesiumT.MaterialProperty = record.hasConflict
        ? new C.PolylineDashMaterialProperty({ color: edge, dashLength: 12 })
        : record.geometryKind === "GENERATED"
          ? new C.PolylineDashMaterialProperty({ color: edge, dashLength: 8 })
          : new C.ColorMaterialProperty(edge);
      const edgeEntity = viewer.entities.add({
        polyline: { positions: [...positions, positions[0]], width: edgeWidth, material: edgeMaterial },
        properties: { parcelId: record.id },
      });
      added.push(fillEntity, edgeEntity);
      drawn.set(record.id, {
        fill: fillEntity,
        edge: edgeEntity,
        fillCss,
        edgeMaterial,
        edgeWidth,
        positions,
        feature: { type: "Feature", geometry: f.geometry as Geometry, properties: f.properties },
      });

      const label = viewer.entities.add({
        position: centre,
        label: {
          text: String(record.khasraNo),
          font: "600 12px ui-sans-serif, system-ui, sans-serif",
          fillColor: C.Color.WHITE,
          showBackground: true,
          backgroundColor: C.Color.fromCssColorString("rgba(15,23,42,0.72)"),
          backgroundPadding: new C.Cartesian2(6, 3),
          horizontalOrigin: C.HorizontalOrigin.CENTER,
          verticalOrigin: C.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      // Bigger plots win a place when two labels compete for the same pixels.
      label.properties = new C.PropertyBag({
        weight: record.mapHa ?? 0,
        text: String(record.khasraNo),
        parcelId: record.id,
      });
      added.push(label);
      labels.push(label);
    }

    // The project's right-of-way: a dashed centreline and its band.
    if (alignments) {
      for (const f of alignments.features) {
        const role = String(f.properties.role);
        const white = C.Color.WHITE.withAlpha(0.9);
        if (role === "band") {
          for (const ring of ringsOf(f.geometry)) {
            rowEntities.push(
              viewer.entities.add({
                show: showRowRef.current,
                polyline: {
                  positions: C.Cartesian3.fromDegreesArray(ring.flatMap(([x, y]) => [x, y])),
                  width: 1.5,
                  material: new C.PolylineDashMaterialProperty({ color: white, dashLength: 12 }),
                },
                properties: { row: f.properties },
              }),
            );
          }
        } else {
          const line = (
            f.geometry.type === "LineString"
              ? [f.geometry.coordinates as number[][]]
              : (f.geometry.coordinates as number[][][])
          ) as number[][][];
          for (const part of line) {
            rowEntities.push(
              viewer.entities.add({
                show: showRowRef.current,
                polyline: {
                  positions: C.Cartesian3.fromDegreesArray(part.flatMap(([x, y]) => [x, y])),
                  width: 2,
                  material: new C.PolylineDashMaterialProperty({ color: white, dashLength: 6 }),
                },
                properties: { row: f.properties },
              }),
            );
          }
        }
      }
    }

    labelEntitiesRef.current = labels;
    rowEntitiesRef.current = rowEntities;
    parcelEntitiesRef.current = [...added, ...rowEntities];
    drawnRef.current = drawn;
    setDrawVersion((v) => v + 1);

    // Frame the land from a low angle — the god's-eye arrival.
    if (extent.length) {
      const sphere = C.BoundingSphere.fromPoints(extent);
      const labelRange = Math.max(LABEL_RANGE_MIN_M, sphere.radius * LABEL_RANGE_FACTOR);
      for (const l of labels) {
        if (l.label) l.label.distanceDisplayCondition = new C.ConstantProperty(
          new C.DistanceDisplayCondition(0, labelRange),
        );
      }
      // Only a newly chosen project flies the camera; a change of status
      // filter or colouring restyles the land where the officer is looking.
      if (flownPidRef.current !== projectId) {
        flownPidRef.current = projectId;
        viewer.camera.flyToBoundingSphere(sphere, {
          duration: 3,
          // Far enough that the whole project is in frame, near enough that the
          // khasra numbers are already legible on arrival.
          offset: new C.HeadingPitchRange(0, C.Math.toRadians(-55), Math.max(sphere.radius * 3, 350)),
        });
      }
    }
  }, [projectId, statusFilter, colourBy, fillFor, lockProject, ready, land]);

  // ── The selected plot, picked out from its neighbours ────────────
  const paintedSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = paintedSelectionRef.current;
    if (prev && prev !== selectedId) restyle(prev, prev === hoveredIdRef.current ? "hover" : "normal");
    if (selectedId) restyle(selectedId, "selected");
    paintedSelectionRef.current = selectedId;
  }, [selectedId, drawVersion, restyle]);

  // ── "View on Map": bring the camera down onto the selected plot ────────────
  // Also re-checked after each draw: a plot chosen before the land has loaded
  // (a ?plot= link) is flown to once it exists, and each request flies once.
  const flownNonceRef = useRef(0);
  useEffect(() => {
    const C = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!focusNonce || focusNonce === flownNonceRef.current || !C || !viewer) return;
    const d = selectedIdRef.current ? drawnRef.current.get(selectedIdRef.current) : undefined;
    if (!d) return;
    flownNonceRef.current = focusNonce;
    const sphere = C.BoundingSphere.fromPoints(d.positions);
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1.5,
      offset: new C.HeadingPitchRange(0, C.Math.toRadians(-60), Math.max(sphere.radius * 5, 150)),
    });
  }, [focusNonce, drawVersion]);

  // ── The selected plot’s card, kept on the plot as the camera moves ────────────
  const cardRef = useRef<HTMLDivElement | null>(null);
  const arrowRef = useRef<HTMLDivElement | null>(null);
  const hasCard = selectionPopup != null;
  useEffect(() => {
    const C = cesiumRef.current;
    const viewer = viewerRef.current;
    const card = cardRef.current;
    if (!C || !viewer || !ready || !card || !selectedId) return;
    const d = drawnRef.current.get(selectedId);
    // Filtered out of the current view: nothing on screen to point at.
    if (!d) {
      card.style.visibility = "hidden";
      return;
    }
    const anchor = C.BoundingSphere.fromPoints(d.positions).center;
    const scene = viewer.scene;
    const scratch = new C.Cartesian2();
    const place = () => {
      const at = C.SceneTransforms.worldToWindowCoordinates(scene, anchor, scratch);
      placeCard(card, arrowRef.current, at ? { x: at.x, y: at.y } : null, scene.canvas.clientWidth, scene.canvas.clientHeight);
    };
    place();
    return scene.postRender.addEventListener(place);
  }, [selectedId, hasCard, drawVersion, ready]);


  /** Hide khasra numbers that would overlap. */
  useEffect(() => {
    const C = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!C || !viewer || !ready) return;

    // One canvas, reused, to measure text the same way Cesium draws it.
    const gauge = document.createElement("canvas").getContext("2d");
    const widths = new Map<string, number>();
    const widthOf = (text: string) => {
      let w = widths.get(text);
      if (w === undefined) {
        if (gauge) gauge.font = "600 12px ui-sans-serif, system-ui, sans-serif";
        w = (gauge?.measureText(text).width ?? text.length * 7) + 12;
        widths.set(text, w);
      }
      return w;
    };

    const scene = viewer.scene;

    const declutter = () => {
      const labels = labelEntitiesRef.current;
      if (!labels.length) return;
      const canvas = scene.canvas;
      const now = C.JulianDate.now();

      const placed: { left: number; right: number; top: number; bottom: number }[] = [];
      const ordered = [...labels].sort(
        (a, b) =>
          Number(b.properties?.weight?.getValue(now) ?? 0) - Number(a.properties?.weight?.getValue(now) ?? 0),
      );

      for (const entity of ordered) {
        const label = entity.label;
        const position = entity.position?.getValue(now);
        if (!label || !position) continue;

        // Round the back of the globe: the surface normal at the plot points
        // away from the camera, so the plot is facing into the Earth.
        const toCamera = C.Cartesian3.subtract(scene.camera.position, position, new C.Cartesian3());
        if (C.Cartesian3.dot(position, toCamera) < 0) {
          label.show = new C.ConstantProperty(false);
          continue;
        }
        const win = C.SceneTransforms.worldToWindowCoordinates(scene, position);
        if (!win || win.x < 0 || win.y < 0 || win.x > canvas.clientWidth || win.y > canvas.clientHeight) {
          label.show = new C.ConstantProperty(false);
          continue;
        }

        const text = String(entity.properties?.text?.getValue(now) ?? "");
        const halfW = widthOf(text) / 2;
        const box = { left: win.x - halfW, right: win.x + halfW, top: win.y - 11, bottom: win.y + 11 };
        const clash = placed.some(
          (r) => box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top,
        );
        label.show = new C.ConstantProperty(!clash);
        if (!clash) placed.push(box);
      }
    };

    // Recompute after the camera settles, not on every frame: the work is
    // proportional to the number of plots and the answer only changes when the
    // view does.
    let pending: number | null = null;
    const schedule = () => {
      if (pending !== null) return;
      pending = window.setTimeout(() => {
        pending = null;
        declutter();
      }, 90);
    };

    scene.camera.percentageChanged = 0.02;
    const stopChanged = scene.camera.changed.addEventListener(schedule);
    const stopRender = scene.postRender.addEventListener(schedule);
    schedule();

    return () => {
      if (pending !== null) window.clearTimeout(pending);
      stopChanged();
      stopRender();
    };
  }, [ready, projectId, statusFilter, colourBy]);

  // ── The state's own village sheet, as an imagery overlay ───────────────────
  useEffect(() => {
    const C = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!C || !viewer) return;

    for (const layer of overlayLayersRef.current) viewer.imageryLayers.remove(layer, true);
    overlayLayersRef.current = [];
    if (!showSheets) return;

    for (const s of sheets) {
      const [[south, west], [north, east]] = s.bounds;
      try {
        const layer = viewer.imageryLayers.addImageryProvider(
          new C.SingleTileImageryProvider({
            url: s.imageUrl,
            rectangle: C.Rectangle.fromDegrees(west, south, east, north),
            credit: new C.Credit(`Cadastral map © ${s.state} Revenue Department (Bhu-Naksha)`), // i18n-ignore — the licensor's credit
          }),
        );
        layer.alpha = 0.85;
        overlayLayersRef.current.push(layer);
      } catch {
        // A missing sheet is context, not an error worth breaking the map for.
      }
    }
  }, [sheets, showSheets, ready]);

  // i18n-ignore — class names
  const toggle = (active: boolean) =>
    `rounded px-2 py-1 text-[11px] transition ${
      // Over imagery, not over the page: the same light chip in either theme.
      active ? "bg-[#fff] text-slate-900" : "bg-slate-900/70 text-slate-200 hover:bg-slate-800"
    }`;

  /** Why no plots are on screen, when that is the case. */
  const shownCount =
    land?.status === "ok" && land.pid === projectId && statusFilter ? land.byStatus[statusFilter] ?? 0 : null;
  const landNotice =
    projectId === null
      ? withLand.length === 0
        ? t("screens.globe.noParcelsJur")
        : null
      : land?.pid !== projectId
        ? L.loadingLand
        : land.status === "error"
          ? L.loadFailed
          : land.count === 0
            ? L.noParcels
            : shownCount === 0
              ? t("screens.globe.noPlotsAt", { status: t(parcelStatusKey(statusFilter!)) })
              : null;

  const sheetLabel = sheets.length > 1
    ? t("screens.globe.sheetMany", { count: sheets.length })
    : sheets.length === 1 ? t("screens.globe.sheetOne", { village: sheets[0].village }) : "";

  if (failed) {
    return (
      <div
        style={{ height }}
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-border p-6 text-center text-xs text-muted"
      >
        <div className="text-sm font-medium text-foreground">{t("screens.globe.failedTitle")}</div>
        <div>{failed}</div>
        <div>{t("screens.globe.needsWebgl")}</div>
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className={
        expanded
          ? "fixed inset-0 z-[900]"
          : "relative overflow-hidden rounded-lg border border-border"
      }
      style={{
        height: expanded ? "100vh" : height,
        background: "radial-gradient(circle at 50% 45%, #14213d 0%, #080d1a 70%)",
      }}
    >
      {/* i18n-ignore — CSS */}
      <style>{`
        .pp-title { font-weight: 600; font-size: 13px; }
        .pp-sub, .pp-muted { color: #666; font-size: 11px; }
        .pp-row { margin-top: 4px; font-size: 12px; display: flex; align-items: center; gap: 6px; }
        .pp-dot { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
        .pp-table { margin-top: 6px; font-size: 11px; border-collapse: collapse; width: 100%; }
        .pp-table td { padding: 1px 0; }
        .pp-table td:last-child { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
        .pp-warn { margin-top: 6px; padding: 4px 6px; background: #fef3c7; color: #92400e; border-radius: 4px; font-size: 11px; }
        .pp-alert { margin-top: 6px; padding: 4px 6px; background: #fee2e2; color: #991b1b; border-radius: 4px; font-size: 11px; font-weight: 600; }
        .pp-mono { margin-top: 6px; font-family: ui-monospace, monospace; font-size: 10px; color: #666; }
        .pp-source { margin-top: 6px; font-size: 10px; color: #047857; }
        .pp-gen { color: #b45309; }
        .pp-link { display: block; margin-top: 8px; font-size: 12px; font-weight: 600; color: #0b3d91; }
        .cesium-widget-credits, .cesium-viewer-bottom { display: none !important; }
      `}</style>

      <div ref={container} className="h-full w-full" />

      {/* Filling the window hides the page's own project picker, so the map carries its own. */}
      {ready && (isFull || expanded) && !lockProject && withLand.length > 0 && (
          <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-md bg-slate-900/70 p-1.5 backdrop-blur">
            <span className="pl-1 text-[11px] text-slate-400">{t("common.project")}</span>
            <select
              value={projectId ?? ""}
              onChange={(e) => onProjectChange?.(e.target.value || null)}
              aria-label={t("screens.globe.chooseProject")}
              className="h-7 max-w-[300px] truncate rounded border border-white/15 bg-slate-800 px-2 text-[11px] text-slate-100 focus:border-sky-400 focus:outline-none"
            >
              <option value="">{t("screens.globe.allProjects")}</option>
              {withLand.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {t(p.parcels === 1 ? "screens.globe.plotsOne" : "screens.globe.plotsMany", { count: p.parcels })}
                </option>
              ))}
            </select>
          </div>
      )}

      {/* Layer switcher — the same choices the Leaflet control offered. */}
      {ready && (
        <div className="absolute right-2 top-2 flex max-w-[calc(100%-1rem)] flex-col items-end gap-1">
          <div className="flex items-center gap-1 rounded-md bg-slate-900/60 p-1 backdrop-blur">
            <button onClick={() => setBasemap("satellite")} className={toggle(basemap === "satellite")}>
              {L.satellite}
            </button>
            <button onClick={() => setBasemap("street")} className={toggle(basemap === "street")}>
              {L.street}
            </button>
            <button
              onClick={toggleExpanded}
              className={toggle(false)}
              title={isFull || expanded ? L.exitFull : L.openFull}
              aria-label={isFull || expanded ? L.exitFull : L.openFull}
            >
              {isFull || expanded ? L.exitFullScreen : L.fullScreen}
            </button>
          </div>
          {projectId !== null && (
            <div className="flex flex-col items-end gap-1 rounded-md bg-slate-900/60 p-1 backdrop-blur">
              <button onClick={toggleRightOfWay} className={toggle(showRow)}>
                {L.rightOfWay}
              </button>
              {sheets.length > 0 && (
                <button
                  onClick={() => setShowSheets(!showSheets)}
                  className={`${toggle(showSheets)} max-w-full truncate`}
                  title={sheetLabel}
                >
                  {sheetLabel}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Parcel record card, anchored where the plot was clicked. */}
      {popup && popup.key === viewKey && (
        <div
          className="absolute z-[600] max-w-[300px] rounded-lg border border-border bg-surface p-3 shadow-xl"
          style={{
            left: popup.x,
            top: popup.y,
          }}
        >
          <button
            onClick={() => setPopup(null)}
            aria-label={L.close}
            className="absolute right-1.5 top-1 border-none bg-transparent text-base leading-none text-muted hover:text-neutral-900 dark:hover:text-white"
          >
            ×
          </button>
          <div dangerouslySetInnerHTML={{ __html: popup.html }} />
        </div>
      )}

      {/* The selected plot’s card. */}
      {selectionPopup && (
        <div
          ref={cardRef}
          className="invisible absolute left-0 top-0 z-[650] w-[272px] rounded-xl border border-border bg-surface shadow-[0_8px_24px_rgba(15,23,42,0.22)]"
        >
          <div ref={arrowRef} aria-hidden className="absolute hidden h-3 w-3 rotate-45 border-solid border-border bg-surface" />
          <div className="relative">{selectionPopup}</div>
        </div>
      )}

      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-300">
          {L.loadingGlobe}
        </div>
      )}

      {ready && landNotice && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
          <div className="max-w-sm rounded-md bg-slate-900/80 px-3 py-2 text-center text-xs text-slate-100 backdrop-blur">
            {landNotice}
          </div>
        </div>
      )}

      {ready && (
        <div className="pointer-events-none absolute bottom-7 left-3 right-3 text-[11px] text-slate-400">
          <span>
            {projectId
              ? L.hint
              : t(withLand.length === 1 ? "screens.globe.withLandOne" : "screens.globe.withLandMany", { count: withLand.length })}
          </span>
          {/* The imagery and map licensors' credits stay in their own wording. */}
          <span className="ml-3 opacity-80">
            {basemap === "satellite"
              ? "Imagery © Esri, Maxar, Earthstar Geographics"
              : "© OpenStreetMap contributors"}
            {showSheets && sheets.length > 0 ? ` · Cadastral map © ${sheets[0].state} Revenue Department (Bhu-Naksha)` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
