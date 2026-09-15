/** Corridor harvest — which REAL plots does a proposed alignment take? */
import { setTimeout as delay } from "node:timers/promises";
import { ringArea, type Extent } from "@backend/gis/trace";
import { portalFetch } from "@backend/integrations/http";
import { fetchPlotBoundary, type BoundaryPortal } from "./plot-boundary";


export interface CorridorPortal extends BoundaryPortal {
  /**
   * angular — /bhunakshaserver (UP, Haryana, HP) · classic — ScalarDatahandler
   * (Rajasthan, Punjab, Goa…) · georef — Maharashtra's /rest viewer, which
   * publishes each plot's surveyed polygon as vector WKT, so nothing is traced
   * · assam — Assam's Bhu-Naksha (bhunakshaBackEnd/proxy), vector too, joined
   * to Dharitree's record of each dag.
   */
  kind: "angular" | "classic" | "georef" | "assam";
  /** Angular: https://upbhunaksha.gov.in/bhunakshaserver · classic: …/bhunaksha · georef: …/rest */
  apiBase: string;
  /** Classic portals address a village by comma-joined level codes. */
  levels?: string;
}

export interface CorridorSpec {
  /** Centreline vertices in the portal's UTM CRS. */
  centreline: [number, number][];
  rightOfWayM: number;
  /** Stop after this many plots — keeps the harvest polite and bounded. */
  maxPlots: number;
  /** Sample spacing along and across the line, metres. */
  stepM?: number;
}

export interface HarvestedPlot {
  khasraNo: string;
  plotId: string;
  /** Classic portals' unique parcel number; Angular ones have none. */
  pniu: string | null;
  reportedExtent: Extent;
  ringUtm: [number, number][];
  tracedAreaSqm: number;
  /** Area on the revenue record (RoR), where the portal publishes it. */
  recordedAreaSqm: number | null;
  vertices: number;
  metresPerPixel: number;
  extentErrorM: number;
  /** Distance along the centreline where the plot was first met — orders the chain. */
  chainageM: number;
}

async function post(url: string, body: string, referer: string, json = false) {
  const res = await portalFetch(url, {
    method: "POST",
    body,
    referer,
    headers: { "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded" },
    timeoutMs: 15_000,
  });
  return res.ok ? await res.text() : null;
}

export interface PointHit {
  khasraNo: string;
  plotId: string;
  pniu: string | null;
  extent: Extent;
  recordedAreaSqm: number | null;
  /** Vector portals answer with the plot's polygon itself (portal UTM CRS). */
  ring?: [number, number][];
}

/** The exterior ring of each part of a WKT (MULTI)POLYGON. Holes are skipped. */
function wktExteriors(wkt: string): [number, number][][] {
  return [...wkt.matchAll(/\(\(([^()]+)\)/g)].map((m) =>
    m[1].split(",").map((pair) => pair.trim().split(/\s+/).map(Number) as [number, number]),
  );
}

function extentOf(ring: [number, number][]): Extent {
  const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export async function plotAtPoint(p: CorridorPortal, x: number, y: number): Promise<PointHit | null> {
  if (p.kind === "assam") {
    // gisCode is the village's location code; the lookup stays inside that village.
    const res = await portalFetch(`${p.apiBase}/click_info`, {
      method: "POST",
      referer: p.referer,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ village_code: p.gisCode, layer_code: "ASSAM_PARCEL", attributes: { dcode: "080101" }, crs: p.srid, x, y }),
      timeoutMs: 30_000,
    });
    if (!res.ok) return null;
    let d: { data?: { id?: string; uniqueId?: string; geom?: string; attributes?: { TEXTPARCEL?: string } } };
    try {
      d = await res.json();
    } catch {
      return null;
    }
    const t = d.data;
    const dag = t?.attributes?.TEXTPARCEL;
    if (!t?.id || !t.geom || !dag) return null;
    const parts = wktExteriors(t.geom);
    const ring = parts.find((r) => pointInRing(x, y, r)) ?? parts.sort((a, b) => ringArea(b) - ringArea(a))[0];
    if (!ring || ring.length < 4) return null;
    return { khasraNo: dag, plotId: t.id, pniu: t.uniqueId || null, extent: extentOf(ring), recordedAreaSqm: null, ring };
  }
  if (p.kind === "georef") {
    const text = await post(
      `${p.apiBase}/MapInfo/getPlotAtXY`,
      new URLSearchParams({ state: p.stateCode, giscode: p.gisCode, x: String(x), y: String(y), srs: String(p.srid), plotno: "" }).toString(),
      p.referer,
    );
    if (!text?.trimStart().startsWith("{")) return null;
    const d = JSON.parse(text) as { id?: string; kide?: string };
    if (!d.id || !d.kide) return null;
    // The extent and area come with the geometry (georefPlot), one request later.
    return { khasraNo: d.kide, plotId: d.id, pniu: null, extent: { minX: x, minY: y, maxX: x, maxY: y }, recordedAreaSqm: null };
  }
  if (p.kind === "angular") {
    const text = await post(
      `${p.apiBase}/MapInfo/getPlotAtXY`,
      new URLSearchParams({ giscode: p.gisCode, x: String(x), y: String(y), plotno: "" }).toString(),
      p.referer,
    );
    if (!text) return null;
    const d = JSON.parse(text) as { id?: string; kide?: string; minx?: number; miny?: number; maxx?: number; maxy?: number };
    if (!d.id || d.minx == null || d.miny == null || d.maxx == null || d.maxy == null) return null;
    return {
      khasraNo: String(d.kide ?? ""), plotId: d.id, pniu: null,
      extent: { minX: d.minx, minY: d.miny, maxX: d.maxx, maxY: d.maxy },
      recordedAreaSqm: null,
    };
  }
  // Classic: ScalarDatahandler OP=4 is plot-at-XY.
  const qs = new URLSearchParams({ OP: "4", state: p.stateCode, levels: p.levels ?? "", x: String(x), y: String(y) });
  const res = await portalFetch(`${p.apiBase}/ScalarDatahandler?${qs}`, { referer: p.referer, timeoutMs: 15_000 });
  if (!res.ok) return null;
  let d: {
    has_data?: string; ID?: string; PNIU?: string; plotNo?: string; info?: string;
    xmin?: number; ymin?: number; xmax?: number; ymax?: number;
  };
  try {
    d = await res.json();
  } catch {
    return null;
  }
  if (d.has_data !== "Y" || !d.ID || d.xmin == null || d.ymin == null || d.xmax == null || d.ymax == null) return null;
  // Only the area line is read from the info blob; it also carries names.
  const area = d.info?.match(/(?:Total Area|क्षेत्रफल)\s*:\s*([\d.]+)\s*(sq|hectare)/i);
  return {
    khasraNo: String(d.plotNo ?? ""), plotId: d.ID, pniu: d.PNIU || null,
    extent: { minX: d.xmin, minY: d.ymin, maxX: d.xmax, maxY: d.ymax },
    recordedAreaSqm: area ? Math.round(Number(area[1]) * (/hectare/i.test(area[2]) ? 10_000 : 1)) : null,
  };
}

/** Angular portals publish the RoR area through the plot-info text. Area line only. */
export async function angularRecordedArea(p: CorridorPortal, khasraNo: string): Promise<number | null> {
  const text = await post(
    `${p.apiBase}/MapInfo/getPlotInfo`,
    JSON.stringify({ gisCode: p.gisCode, plotNo: khasraNo }),
    p.referer,
    true,
  );
  if (!text) return null;
  // A plot held under several khatas has one "Area :" line per khata; the plot's recorded area is
  // their sum.
  const areas = [...text.matchAll(/Area\s*:\s*([\d.]+)\s*Hectare/gi)].map((m) => Number(m[1]));
  if (areas.length === 0) return null;
  return Math.round(areas.reduce((a, b) => a + b, 0) * 10_000);
}

/**
 * A georef portal's own surveyed polygon for one plot, in the portal's UTM CRS.
 * getPlotInfo carries the geometry as WKT; its info text is read for the area
 * lines only (it also lists owners, which are never kept).
 */
export async function georefPlot(p: CorridorPortal, khasraNo: string, at?: { x: number; y: number }): Promise<{ ring: [number, number][]; extent: Extent; recordedAreaSqm: number | null } | null> {
  const text = await post(
    `${p.apiBase}/MapInfo/getPlotInfo`,
    new URLSearchParams({ state: p.stateCode, giscode: p.gisCode, plotno: khasraNo, srs: String(p.srid) }).toString(),
    p.referer,
  );
  if (!text?.trimStart().startsWith("{")) return null;
  const d = JSON.parse(text) as { the_geom?: string; info?: string; xmin?: number; ymin?: number; xmax?: number; ymax?: number };
  if (!d.the_geom || d.xmin == null || d.ymin == null || d.xmax == null || d.ymax == null) return null;
  // MULTIPOLYGON(((x y, …)), …) — the largest part's exterior ring is the plot.
  const rings = wktExteriors(d.the_geom);
  // A survey number can be several separate pieces (a MULTIPOLYGON): keep the piece under the
  // lookup point, else the largest.
  const exteriors = rings;
  const ring = (at && exteriors.find((r) => pointInRing(at.x, at.y, r))) ?? exteriors.sort((a, b) => ringArea(b) - ringArea(a))[0];
  const pieces = exteriors.length;
  if (!ring || ring.length < 4 || ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
  // One "Total Area : h.hhhh" line (hectares) per khata holding a share of the plot.
  const areas = [...(d.info ?? "").matchAll(/Total Area\s*:\s*([\d.]+)/gi)].map((m) => Number(m[1]));
  const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
  return {
    ring,
    // The reported extent covers every piece; a single piece is checked against its own.
    extent: pieces > 1 ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } : { minX: d.xmin, minY: d.ymin, maxX: d.xmax, maxY: d.ymax },
    // The record is for the whole survey number; for one piece of several it does not apply.
    recordedAreaSqm: pieces === 1 && areas.length ? Math.round(areas.reduce((a, b) => a + b, 0) * 10_000) : null,
  };
}

function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Assam: the area Dharitree records for every dag in a village, in m². */
export async function assamRecordedAreas(p: CorridorPortal): Promise<Map<string, number>> {
  const res = await portalFetch(`${p.apiBase}/getAllDagsFromDharitree`, {
    method: "POST",
    referer: p.referer,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: p.gisCode, dist_code: p.gisCode.slice(0, 2) }),
    timeoutMs: 60_000,
  });
  const out = new Map<string, number>();
  if (!res.ok) return out;
  const d = await res.json<{ data?: { dag_no: string; dag_area_bigha: string; dag_area_katha: string; dag_area_lessa: string; dag_area_gonda?: string; dag_area_kranti?: string }[] }>();
  for (const r of d.data ?? []) {
    // Barak-valley units (gonda, kranti) mean a different bigha: leave those unread.
    if (Number(r.dag_area_gonda ?? 0) || Number(r.dag_area_kranti ?? 0)) continue;
    const sqm = Number(r.dag_area_bigha) * 1337.8 + Number(r.dag_area_katha) * 267.56 + Number(r.dag_area_lessa) * 13.378;
    if (Number.isFinite(sqm) && sqm > 0) out.set(String(r.dag_no), Math.round(sqm));
  }
  return out;
}

/** Sample points across the right-of-way, ordered by chainage. */
function samplePoints(spec: CorridorSpec): { x: number; y: number; chainage: number }[] {
  const step = spec.stepM ?? 10;
  const half = spec.rightOfWayM / 2;
  const offsets: number[] = [];
  for (let o = -half; o <= half + 1e-6; o += Math.min(step, half)) offsets.push(o);
  const out: { x: number; y: number; chainage: number }[] = [];
  let chainage = 0;
  for (let s = 0; s < spec.centreline.length - 1; s++) {
    const [ax, ay] = spec.centreline[s];
    const [bx, by] = spec.centreline[s + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    for (let d = 0; d <= len; d += step) {
      for (const o of offsets) {
        out.push({ x: ax + ux * d - uy * o, y: ay + uy * d + ux * o, chainage: chainage + d });
      }
    }
    chainage += len;
  }
  return out;
}

export async function harvestCorridor(
  portal: CorridorPortal,
  spec: CorridorSpec,
  opts: { pauseMs?: number; log?: (msg: string) => void } = {},
): Promise<{ plots: HarvestedPlot[]; rejected: { khasraNo: string; reason: string }[]; lookups: number }> {
  const pause = opts.pauseMs ?? 150;
  const log = opts.log ?? (() => {});
  const plots: HarvestedPlot[] = [];
  const rejected: { khasraNo: string; reason: string }[] = [];
  const seen = new Set<string>();
  let lookups = 0;
  const assamAreas = portal.kind === "assam" ? await assamRecordedAreas(portal).catch(() => new Map<string, number>()) : null;

  for (const pt of samplePoints(spec)) {
    if (plots.length >= spec.maxPlots) break;
    if (plots.some((p) => pointInRing(pt.x, pt.y, p.ringUtm))) continue;

    lookups++;
    let hit: PointHit | null = null;
    try {
      hit = await plotAtPoint(portal, pt.x, pt.y);
    } catch {
      /* one failed lookup must not abandon the corridor */
    }
    await delay(pause);
    // Vector portals are keyed by survey/dag number, so one number is one plot.
    const key = (portal.kind === "georef" || portal.kind === "assam") && hit ? `k:${hit.khasraNo}` : hit?.plotId;
    if (!hit || !key || seen.has(key)) continue;
    seen.add(key);

    let boundary = null;
    if (hit.ring) {
      // Vector from the portal: the surveyed polygon itself, nothing rendered or traced.
      boundary = { ringUtm: hit.ring, tracedAreaSqm: ringArea(hit.ring), vertices: hit.ring.length - 1, metresPerPixel: 0, extentErrorM: 0 };
      hit.recordedAreaSqm ??= assamAreas?.get(hit.khasraNo) ?? null;
    } else if (portal.kind === "georef") {
      try {
        const g = await georefPlot(portal, hit.khasraNo, pt);
        if (g) {
          const xs = g.ring.map((q) => q[0]), ys = g.ring.map((q) => q[1]);
          hit.extent = g.extent;
          hit.recordedAreaSqm = g.recordedAreaSqm;
          boundary = {
            ringUtm: g.ring,
            tracedAreaSqm: Math.abs(ringArea(g.ring)),
            vertices: g.ring.length - 1,
            metresPerPixel: 0, // vector from the portal: no rendering involved
            extentErrorM: Math.max(
              Math.abs(Math.min(...xs) - g.extent.minX), Math.abs(Math.max(...xs) - g.extent.maxX),
              Math.abs(Math.min(...ys) - g.extent.minY), Math.abs(Math.max(...ys) - g.extent.maxY),
            ),
          };
        }
      } catch {
        /* treated as a rejection below */
      }
    } else {
      try {
        boundary = await fetchPlotBoundary(portal, hit.plotId, hit.extent);
      } catch {
        /* treated as a rejection below */
      }
    }
    await delay(pause);
    if (!boundary) {
      rejected.push({ khasraNo: hit.khasraNo, reason: "boundary could not be traced and verified" });
      log(`  ✗ ${hit.khasraNo.padEnd(8)} rejected — trace failed verification`);
      continue;
    }

    let recorded = hit.recordedAreaSqm;
    if (recorded == null && portal.kind === "angular" && hit.khasraNo) {
      try {
        recorded = await angularRecordedArea(portal, hit.khasraNo);
      } catch {
        recorded = null;
      }
      await delay(pause);
    }

    plots.push({
      khasraNo: hit.khasraNo, plotId: hit.plotId, pniu: hit.pniu,
      reportedExtent: hit.extent,
      ringUtm: boundary.ringUtm.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))]),
      tracedAreaSqm: Math.round(boundary.tracedAreaSqm),
      recordedAreaSqm: recorded,
      vertices: boundary.vertices,
      metresPerPixel: boundary.metresPerPixel,
      extentErrorM: Number(boundary.extentErrorM.toFixed(3)),
      chainageM: Math.round(pt.chainage),
    });
    const diff = recorded ? ` record ${recorded} m² (${(((boundary.tracedAreaSqm - recorded) / recorded) * 100).toFixed(1)}%)` : "";
    log(`  ✓ ${hit.khasraNo.padEnd(8)} ${String(boundary.vertices).padStart(3)} vertices  ${Math.round(boundary.tracedAreaSqm)} m²${diff}  extent ±${boundary.extentErrorM.toFixed(2)} m`);
  }
  return { plots, rejected, lookups };
}
