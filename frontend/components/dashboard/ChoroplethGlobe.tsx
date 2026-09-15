"use client";

import { useEffect, useRef, useState } from "react";
import type * as CesiumT from "cesium";
import type { FeatureCollection, Position } from "geojson";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { startViewer, type StartedViewer } from "../map/cesium-viewer";
import { useT } from "@frontend/components/I18nProvider";

/** Administrative boundaries draped over satellite imagery, filled by a metric. */

interface Props {
  boundaries: FeatureCollection | null;
  /** Boundary key → fill colour (CSS). A key that is absent is left unfilled. */
  fills: Map<string, string>;
  /** Key to outline strongly — hovered on the globe or in the ranking beside it. */
  highlight: string | null;
  /** Changes whenever the camera should refit (level or state switch). */
  fitKey: string;
  onHover: (key: string | null) => void;
  onPick: (key: string) => void;
  height: number;
}

// Translucent enough that the river, ridge or town under a district still
// reads through its colour: the fill tints the ground rather than covering it.
const FILL_ALPHA = 0.5;
const FILL_ALPHA_HIGHLIGHT = 0.72;

type Ring = Position[];

/** Every polygon in a feature, as [outer, ...holes]. */
function polygonsOf(geometry: FeatureCollection["features"][number]["geometry"]): Ring[][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function boundsOf(fc: FeatureCollection): [number, number, number, number] | null {
  let w = 180, s = 90, e = -180, n = -90;
  for (const f of fc.features) {
    for (const poly of polygonsOf(f.geometry)) {
      for (const [lon, lat] of poly[0] ?? []) {
        if (lon < w) w = lon;
        if (lon > e) e = lon;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
      }
    }
  }
  return w <= e && s <= n ? [w, s, e, n] : null;
}

/** Entity ids are `key|part|kind`; keys are already [a-z0-9] only. */
function keyOfEntity(entity: CesiumT.Entity | undefined): string | null {
  const id = entity?.id;
  return typeof id === "string" && id.includes("|") ? id.split("|")[0] : null;
}

/** Recolour every region; Cesium entities are mutable scene objects, not React state. */
function paint(C: typeof CesiumT, ds: CesiumT.CustomDataSource, parsed: Map<string, CesiumT.Color>, highlight: string | null) {
  for (const entity of ds.entities.values) {
    const key = keyOfEntity(entity);
    if (!key) continue;
    const lit = key === highlight;
    if (entity.polygon) {
      const base = parsed.get(key);
      const colour = base
        ? base.withAlpha(lit ? FILL_ALPHA_HIGHLIGHT : FILL_ALPHA)
        : // Unfilled regions take a faint tint on hover, and never alpha 0 —
          // Cesium drops fully transparent fragments from picking.
          C.Color.WHITE.withAlpha(lit ? 0.18 : 0.01);
      entity.polygon.material = new C.ColorMaterialProperty(colour);
    } else if (entity.polyline) {
      entity.polyline.width = new C.ConstantProperty(lit ? 3 : 1.5);
      entity.polyline.material = new C.ColorMaterialProperty(
        lit ? C.Color.fromCssColorString("#22d3ee") : C.Color.WHITE.withAlpha(0.8),
      );
    }
  }
}

export default function ChoroplethGlobe({ boundaries, fills, highlight, fitKey, onHover, onPick, height }: Props) {
  const t = useT();
  // The viewer is started once; its failure message reads the current wording from here.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const container = useRef<HTMLDivElement | null>(null);
  const started = useRef<StartedViewer | null>(null);
  const source = useRef<CesiumT.CustomDataSource | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<"satellite" | "street">("satellite");

  // Handlers change identity every render; the Cesium callbacks are wired once.
  const onHoverRef = useRef(onHover);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onHoverRef.current = onHover;
    onPickRef.current = onPick;
  });

  // ── Viewer, once ───────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    const el = container.current;
    if (!el) return;
    const leave = () => onHoverRef.current(null);
    el.addEventListener("mouseleave", leave);

    startViewer(el)
      .then((s) => {
        if (disposed) {
          s.viewer.destroy();
          return;
        }
        started.current = s;
        const { C, viewer } = s;
        const scene = viewer.scene;
        // A dashboard sits open for a long time; only draw when something moves.
        scene.requestRenderMode = true;
        scene.maximumRenderTimeChange = Infinity;
        viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(80, 22, 9_500_000) });

        const handler = new C.ScreenSpaceEventHandler(scene.canvas);
        // Picking is not free, so hover is sampled at most once a frame.
        let pending: CesiumT.Cartesian2 | null = null;
        let lastKey: string | null = null;
        handler.setInputAction((m: { endPosition: CesiumT.Cartesian2 }) => {
          const first = pending === null;
          pending = C.Cartesian2.clone(m.endPosition);
          if (!first) return;
          requestAnimationFrame(() => {
            if (disposed || !pending) return;
            const key = keyOfEntity(scene.pick(pending)?.id as CesiumT.Entity | undefined);
            pending = null;
            scene.canvas.style.cursor = key ? "pointer" : "";
            if (key !== lastKey) {
              lastKey = key;
              onHoverRef.current(key);
            }
          });
        }, C.ScreenSpaceEventType.MOUSE_MOVE);
        handler.setInputAction((m: { position: CesiumT.Cartesian2 }) => {
          const key = keyOfEntity(scene.pick(m.position)?.id as CesiumT.Entity | undefined);
          if (key) onPickRef.current(key);
        }, C.ScreenSpaceEventType.LEFT_CLICK);
        el.addEventListener("mouseleave", () => {
          lastKey = null;
        });

        setReady(true);
      })
      .catch((e) => {
        if (!disposed) setFailed(e instanceof Error ? e.message : tRef.current("screens.globe.failedStart"));
      });

    return () => {
      disposed = true;
      el.removeEventListener("mouseleave", leave);
      started.current?.viewer.destroy();
      started.current = null;
      source.current = null;
    };
  }, []);

  // ── Shapes, whenever the boundary set changes ─────────────────────────────
  useEffect(() => {
    const s = started.current;
    if (!ready || !s) return;
    const { C, viewer } = s;
    if (source.current) viewer.dataSources.remove(source.current, true);
    source.current = null;
    if (!boundaries) {
      viewer.scene.requestRender();
      return;
    }

    const ds = new C.CustomDataSource("choropleth");
    boundaries.features.forEach((f, fi) => {
      const key = (f.properties as { key?: string } | null)?.key;
      if (!key) return;
      polygonsOf(f.geometry).forEach((poly, i) => {
        const [outer, ...holes] = poly.map((ring) => ring.flatMap(([lon, lat]) => [lon, lat]));
        if (!outer || outer.length < 6) return;
        // Fill and border both lie on the ground itself (no height given, and
        // clampToGround), so they stay pinned to the imagery at any tilt
        // instead of floating over it. zIndex keeps borders above fills.
        ds.entities.add({
          id: `${key}|${fi}|${i}|fill`,
          polygon: {
            hierarchy: new C.PolygonHierarchy(
              C.Cartesian3.fromDegreesArray(outer),
              holes.map((h) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(h))),
            ),
            material: C.Color.TRANSPARENT,
            zIndex: 0,
          },
        });
        ds.entities.add({
          id: `${key}|${fi}|${i}|edge`,
          polyline: {
            positions: C.Cartesian3.fromDegreesArray(outer),
            clampToGround: true,
            width: 1.5,
            material: C.Color.WHITE.withAlpha(0.8),
            zIndex: 1,
          },
        });
      });
    });
    viewer.dataSources.add(ds);
    source.current = ds;
    // Colours are applied by the effect below; it depends on the same data.
  }, [ready, boundaries]);

  // ── Colour and highlight ──────────────────────────────────────────────────
  useEffect(() => {
    const s = started.current;
    const ds = source.current;
    if (!ready || !s || !ds) return;
    const { C, viewer } = s;
    const parsed = new Map<string, CesiumT.Color>();
    for (const [key, css] of fills) parsed.set(key, C.Color.fromCssColorString(css));

    paint(C, ds, parsed, highlight);
    viewer.scene.requestRender();
  }, [ready, boundaries, fills, highlight]);

  // ── Camera: fit the level in view ─────────────────────────────────────────
  const featureCount = boundaries?.features.length ?? 0;
  useEffect(() => {
    const s = started.current;
    if (!ready || !s || !boundaries || !featureCount) return;
    const b = boundsOf(boundaries);
    if (!b) return;
    const [w, so, e, n] = b;
    // A margin so the edge regions are not flush against the panel.
    const pad = Math.max(e - w, n - so) * 0.08;
    s.viewer.camera.flyTo({
      destination: s.C.Rectangle.fromDegrees(w - pad, so - pad, e + pad, n + pad),
      duration: 1.4,
    });
    // Refit on a level switch, not on every recolour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey, featureCount]);

  // ── Basemap ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const s = started.current;
    if (!ready || !s) return;
    s.satellite.show = basemap === "satellite";
    s.street.show = basemap === "street";
    s.viewer.scene.requestRender();
  }, [ready, basemap]);

  const refit = () => {
    const s = started.current;
    const b = boundaries && boundsOf(boundaries);
    if (!s || !b) return;
    const [w, so, e, n] = b;
    const pad = Math.max(e - w, n - so) * 0.08;
    s.viewer.camera.flyTo({ destination: s.C.Rectangle.fromDegrees(w - pad, so - pad, e + pad, n + pad), duration: 1 });
  };

  return (
    <div
      className="relative h-full w-full"
      style={{ height, background: "radial-gradient(circle at 50% 45%, #14213d 0%, #080d1a 70%)" }}
    >
      <style>{`.cesium-widget-credits, .cesium-viewer-bottom { display: none !important; }`}</style>
      <div ref={container} className="h-full w-full" />

      {ready && (
        <div className="absolute right-2 top-2 z-[500] flex gap-1">
          <div className="flex overflow-hidden rounded-md border border-white/20 bg-black/55 text-[11px] text-white backdrop-blur">
            {(["satellite", "street"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBasemap(b)}
                className={`px-2 py-1 ${basemap === b ? "bg-white/25 font-semibold" : "hover:bg-white/10"}`}
              >
                {b === "satellite" ? t("screens.globe.satellite") : t("screens.choro.map")}
              </button>
            ))}
          </div>
          <button
            onClick={refit}
            title={t("screens.choro.fit")}
            className="rounded-md border border-white/20 bg-black/55 px-2 py-1 text-[11px] text-white backdrop-blur hover:bg-white/10"
          >
            ⤢
          </button>
        </div>
      )}

      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-slate-300">
          {t("screens.choro.globeFailed", { reason: failed })}
        </div>
      )}
    </div>
  );
}
