/** Probe every Bhu-Naksha state portal end to end and record what works. */
import { mkdir, writeFile } from "node:fs/promises";
import { portalFetch } from "@backend/integrations/http";
import { fetchPlotBoundary, type BoundaryPortal } from "@backend/integrations/adapters/plot-boundary";
import { georefPlot, plotAtPoint, type CorridorPortal, type PointHit } from "@backend/integrations/adapters/cadastral-corridor";

import { PORTALS, type PortalDef } from "@backend/integrations/portals";
export { PORTALS };

interface Level { code: string; name: string }

/** Narrow a probe to one district, or to a village already known by its level path. */
export interface ProbeTarget {
  districtCode?: string;
  path?: string[];
}
interface Extent { minX: number; minY: number; maxX: number; maxY: number }

export interface PortalProfile {
  state: string;
  lgd: string;
  kind: "angular" | "classic" | "georef" | "assam";
  base: string;
  ok: boolean;
  failedAt?: string;
  reason?: string;
  stateCode?: string;
  levelLabels?: string[];
  path?: Level[];
  /** Classic: comma-joined level codes with a trailing comma. */
  levels?: string;
  gisCode?: string;
  extent?: Extent;
  srid?: number;
  wmsCrs?: "epsg" | "blank";
  /** Villages examined before one worked, and why the others were skipped. */
  skipped?: string[];
  hitPoint?: { x: number; y: number };
  sample?: { khasraNo: string; plotId: string; lat: number; lng: number; vertices: number; extentErrorM: number };
  probedAt: string;
}

const log = (s: string) => console.log(s);

// ---------------------------------------------------------------------------
// Angular (/bhunakshaserver)
// ---------------------------------------------------------------------------
async function angularLevels(base: string, codes: string, level: number): Promise<Level[]> {
  const res = await portalFetch(`${base}/bhunakshaserver/masterdata/levelvalue`, {
    method: "POST",
    body: new URLSearchParams({ level: String(level), codes }).toString(),
    referer: `${base}/`,
  });
  if (!res.ok) throw new Error(`levelvalue ${res.status}`);
  const rows = await res.json<{ code: string; value: string; extraParams?: { hasData?: boolean } }[]>();
  return rows.filter((r) => r.extraParams?.hasData !== false).map((r) => ({ code: r.code, name: r.value }));
}

async function probeAngular(def: PortalDef, profile: PortalProfile, target: ProbeTarget = {}) {
  const B = `${def.base}/bhunakshaserver`;
  const ref = `${def.base}/`;
  profile.failedAt = "levels";
  const labels = await (await portalFetch(`${B}/Levels/levelLabels`, { referer: ref })).json<string[]>();
  profile.levelLabels = labels;
  const sc = await (await portalFetch(`${B}/Levels/stateCode`, { referer: ref })).text();
  profile.stateCode = sc.replace(/\D/g, "");

  // Walk: try a few districts / sub-levels until a village has a usable extent and a plot.
  const all = await angularLevels(def.base, "", 1);
  const districts = target.districtCode ? all.filter((x) => x.code === target.districtCode) : all.slice(0, 4);
  // Depth-first over however many levels this portal has (UP 3, Haryana 4…),
  // a few options per level, so one unmapped village does not end the search.
  const candidates: Level[][] = [];
  const expand = async (path: Level[]) => {
    if (candidates.length >= 16) return;
    if (path.length === labels.length) {
      candidates.push(path);
      return;
    }
    const opts = await angularLevels(def.base, path.map((p) => p.code).join(","), path.length + 1);
    for (const o of opts.slice(0, path.length === labels.length - 1 ? 4 : 3)) await expand([...path, o]);
  };
  for (const d of districts) await expand([d]);
  for (const path of candidates) {
    const gisLevels = path.map((p) => p.code).join(",");
    profile.failedAt = "extent";
    const ext = await portalFetch(`${B}/MapInfo/getVVVVExtentGeoref`, {
      method: "POST", body: new URLSearchParams({ gisLevels }).toString(), referer: ref,
    });
    if (!ext.ok) continue;
    const e = await ext.json<{ xmin: number; ymin: number; xmax: number; ymax: number; gisCode: string; crs?: string }>();
    if (!e.xmax || e.xmax - e.xmin <= 0) continue;
    profile.path = path;
    profile.gisCode = e.gisCode;
    profile.extent = { minX: e.xmin, minY: e.ymin, maxX: e.xmax, maxY: e.ymax };
    const crs = e.crs?.match(/EPSG:(\d+)/)?.[1];
    const portal: CorridorPortal = {
      kind: "angular", apiBase: B, wmsUrl: `${B}/WMS`, referer: ref, wmsVersion: "1.3.0",
      stateCode: "", gisCode: e.gisCode, srid: crs ? Number(crs) : 32600 + def.zones[0],
    };
    if (await finishProbe(def, profile, portal, crs ? [Number(crs) - 32600] : def.zones)) return;
  }
  throw new Error("no village yielded a traceable plot");
}

// ---------------------------------------------------------------------------
// Classic (ScalarDatahandler)
// ---------------------------------------------------------------------------
async function classicStateCode(def: PortalDef): Promise<string> {
  try {
    const home = await (await portalFetch(`${def.base}/`, { timeoutMs: 15_000 })).text();
    const m = home.match(/id="state"[^>]*value="(\d+)"/) ?? home.match(/value="(\d+)"[^>]*id="state"/);
    if (m) return m[1];
  } catch {
    /* fall back to the LGD code */
  }
  return def.lgd;
}

async function classicLevels(def: PortalDef, state: string, level: number, selections: string): Promise<{ options: Level[]; levelCount: number | null }> {
  const qs = new URLSearchParams({ OP: "2", state, level: String(level), selections });
  const html = await (await portalFetch(`${def.base}/ScalarDatahandler?${qs}`, { referer: `${def.base}/` })).text();
  const count = html.match(/id="levelCount"\s+value="(\d+)"/)?.[1];
  const sel = html.match(new RegExp(`name="level_${level}"[^>]*>([\\s\\S]*?)</select>`));
  const options = sel
    ? [...sel[1].matchAll(/value="([^"]*)"[^>]*>\s*([^<]*)/g)]
        .map((m) => ({ code: m[1], name: m[2].trim() }))
        .filter((o) => o.code && o.code !== "-1" && o.code !== "0")
    : [];
  return { options, levelCount: count ? Number(count) : null };
}

/** Is this extent plausibly UTM metres in India (not a local, un-georeferenced sheet)? */
function utmLike(e: Extent): boolean {
  return e.minX > 150_000 && e.maxX < 850_000 && e.minY > 700_000 && e.maxY < 4_000_000 && e.maxX - e.minX > 50;
}

async function probeClassic(def: PortalDef, profile: PortalProfile, target: ProbeTarget = {}) {
  profile.failedAt = "levels";
  const state = await classicStateCode(def);
  profile.stateCode = state;
  const first = await classicLevels(def, state, 1, "");
  if (!first.options.length) {
    // Some deployments embed the district list in the page (OP=9 or the home page) instead.
    for (const url of [`${def.base}/ScalarDatahandler?${new URLSearchParams({ OP: "9", state, levels: "" })}`, `${def.base}/`]) {
      try {
        const html = await (await portalFetch(url, { referer: `${def.base}/`, timeoutMs: 15_000 })).text();
        const sel = html.match(/name="level_1"[^>]*>([\s\S]*?)<\/select>/);
        if (!sel) continue;
        first.options = [...sel[1].matchAll(/value="([^"]*)"[^>]*>\s*([^<]*)/g)]
          .map((m) => ({ code: m[1], name: m[2].trim() }))
          .filter((o) => o.code && o.code !== "-1" && o.code !== "0");
        first.levelCount ??= Number(html.match(/id="levelCount"\s+value="(\d+)"/)?.[1] ?? 0) || null;
        if (first.options.length) break;
      } catch {
        /* try the next source */
      }
    }
  }
  if (!first.options.length) throw new Error("no districts listed");
  profile.skipped = [];

  // Depth-first, a few options per level, until a GEOREFERENCED village with a traceable plot turns
  // up.
  let budget = Number(process.env.PROBE_BUDGET ?? 14);
  const walk = async (path: Level[], levelCount: number): Promise<boolean> => {
    if (budget <= 0) return false;
    const lv = path.length + 1;
    const r = lv <= levelCount ? await classicLevels(def, state, lv, path.map((p) => p.code).join(",") + ",") : { options: [], levelCount: null };
    const count = r.levelCount ?? levelCount;
    if (r.options.length === 0) {
      if (path.length < 3) return false;
      budget--;
      profile.failedAt = "extent";
      const levels = path.map((p) => p.code).join(",") + ",";
      let e: { xmin?: number; ymin?: number; xmax?: number; ymax?: number; gis_code?: string };
      try {
        const ext = await portalFetch(`${def.base}/ScalarDatahandler?${new URLSearchParams({ OP: "3", state, levels })}`, { referer: `${def.base}/` });
        e = await ext.json();
      } catch {
        return false;
      }
      if (!e.xmax || !e.gis_code) return false;
      const extent = { minX: e.xmin!, minY: e.ymin!, maxX: e.xmax, maxY: e.ymax! };
      const label = path.map((p) => p.name).join(" › ");
      if (!utmLike(extent)) {
        profile.skipped!.push(`${label}: local sheet coordinates, not georeferenced`);
        return false;
      }
      profile.path = path;
      profile.levels = levels;
      profile.gisCode = e.gis_code;
      profile.extent = extent;
      const portal: CorridorPortal = {
        kind: "classic", apiBase: def.base, wmsUrl: `${def.base}/WMS`, referer: `${def.base}/`, wmsVersion: "1.1.1",
        stateCode: state, levels, gisCode: e.gis_code, srid: 32600 + def.zones[0],
      };
      const ok = await finishProbe(def, profile, portal, def.zones);
      if (!ok) profile.skipped!.push(`${label}: ${profile.reason}`);
      return ok;
    }
    for (const opt of r.options.slice(0, lv <= 2 ? 3 : 2)) {
      if (await walk([...path, opt], count)) return true;
    }
    return false;
  };

  if (target.path) {
    // A village already known: go straight to it.
    const path = target.path.map((code) => ({ code, name: code }));
    budget = 1;
    const levels = target.path.join(",") + ",";
    const ext = await portalFetch(`${def.base}/ScalarDatahandler?${new URLSearchParams({ OP: "3", state, levels })}`, { referer: `${def.base}/` });
    const e = await ext.json<{ xmin?: number; ymin?: number; xmax?: number; ymax?: number; gis_code?: string }>();
    if (e.xmax && e.gis_code) {
      profile.path = path;
      profile.levels = levels;
      profile.gisCode = e.gis_code;
      profile.extent = { minX: e.xmin!, minY: e.ymin!, maxX: e.xmax, maxY: e.ymax! };
      const portal: CorridorPortal = {
        kind: "classic", apiBase: def.base, wmsUrl: `${def.base}/WMS`, referer: `${def.base}/`, wmsVersion: "1.1.1",
        stateCode: state, levels, gisCode: e.gis_code, srid: 32600 + def.zones[0],
      };
      if (await finishProbe(def, profile, portal, def.zones)) return;
    }
    throw new Error(`the given village path did not yield a traceable plot: ${profile.reason ?? "no extent"}`);
  }
  const districts = target.districtCode ? first.options.filter((o) => o.code === target.districtCode) : first.options.slice(0, 6);
  for (const d of districts) {
    if (await walk([d], first.levelCount ?? 8)) return;
  }
  throw new Error(`no georeferenced village with a traceable plot among those examined (${profile.skipped.length})`);
}

// ---------------------------------------------------------------------------
// Shared: find a plot, find the CRS, trace, verify
// ---------------------------------------------------------------------------
async function finishProbe(def: PortalDef, profile: PortalProfile, portal: CorridorPortal, zones: number[]): Promise<boolean> {
  const e = profile.extent!;
  profile.failedAt = "plot-at-xy";
  let hit: PointHit | null = null;
  const cx = (e.minX + e.maxX) / 2, cy = (e.minY + e.maxY) / 2;
  const w = e.maxX - e.minX, h = e.maxY - e.minY;
  // Spiral out from the centre: a village's bounding-box centre is not always inside a plot.
  for (const [fx, fy] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1], [0.2, 0.2], [-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.3, 0]]) {
    try {
      hit = await plotAtPoint(portal, cx + fx * w, cy + fy * h);
    } catch {
      hit = null;
    }
    if (hit) break;
  }
  if (!hit) {
    profile.reason = "no plot found inside the village extent";
    return false;
  }
  (profile as PortalProfile & { hitPoint?: { x: number; y: number } }).hitPoint = {
    x: (hit.extent.minX + hit.extent.maxX) / 2,
    y: (hit.extent.minY + hit.extent.maxY) / 2,
  };

  profile.failedAt = "crs";
  for (const zone of zones) for (const wmsCrs of ["epsg", "blank"] as const) {
    const srid = 32600 + zone;
    const candidate: BoundaryPortal = { ...portal, srid, wmsCrs };
    let boundary = null;
    try {
      boundary = await fetchPlotBoundary(candidate, hit.plotId, hit.extent);
    } catch {
      boundary = null;
    }
    if (!boundary) continue;
    // Convert the traced centre to WGS84 and check it lands in the right state.
    const { lat, lng } = utmToLatLng((hit.extent.minX + hit.extent.maxX) / 2, (hit.extent.minY + hit.extent.maxY) / 2, zone);
    const [a, b, c, d] = def.box;
    if (lat < a || lat > c || lng < b || lng > d) {
      profile.reason = `zone ${zone} traced but lands at ${lat.toFixed(3)},${lng.toFixed(3)} — outside ${def.state}`;
      continue;
    }
    profile.srid = srid;
    profile.wmsCrs = wmsCrs;
    profile.sample = {
      khasraNo: hit.khasraNo, plotId: hit.plotId, lat, lng,
      vertices: boundary.vertices, extentErrorM: Number(boundary.extentErrorM.toFixed(3)),
    };
    profile.ok = true;
    delete profile.failedAt;
    delete profile.reason;
    return true;
  }
  profile.reason ??= "plot found, but no UTM zone produced a traceable single-plot rendering";
  return false;
}

/** UTM (northern hemisphere, WGS84) → lat/lng. Standard Krüger series; accurate to centimetres. */
export function utmToLatLng(x: number, y: number, zone: number): { lat: number; lng: number } {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const n1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const t1 = Math.tan(phi1) ** 2, c1 = ep2 * Math.cos(phi1) ** 2;
  const r1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const d = (x - 500000) / (n1 * k0);
  const lat = phi1 - ((n1 * Math.tan(phi1)) / r1) * (d ** 2 / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6) / 720);
  const lng = (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5) / 120) / Math.cos(phi1);
  return { lat: (lat * 180) / Math.PI, lng: (zone - 1) * 6 - 180 + 3 + (lng * 180) / Math.PI };
}

// ---------------------------------------------------------------------------
// Georef (Maharashtra's /rest viewer): vector plots, addressed by a level path
// ---------------------------------------------------------------------------
async function probeGeoref(def: PortalDef, profile: PortalProfile, target: ProbeTarget) {
  const B = `${def.base}/rest`;
  const ref = `${def.base}/${def.lgd}/index.html`;
  profile.stateCode = def.lgd;
  // The viewer only answers once it has handed out a session.
  await portalFetch(ref, { timeoutMs: 30_000 });
  profile.failedAt = "levels";
  profile.levelLabels = await (await portalFetch(`${B}/Levels/LevelLabels`, { method: "POST", body: `state=${def.lgd}`, referer: ref })).json<string[]>();
  const path = target.path;
  if (!path || path.length !== 4) throw new Error("georef portals are probed by a known path: category, district, taluka, village");
  // Category R (rural) reads its village maps as "RVM"; the rest are concatenated codes.
  const gisCode = `${path[0]}${path[0] === "R" ? "VM" : "CM"}${path.slice(1).join("")}`;
  profile.path = path.map((code) => ({ code, name: code }));
  profile.gisCode = gisCode;

  profile.failedAt = "extent";
  for (const zone of def.zones) {
    const srid = 32600 + zone;
    const e = await (await portalFetch(`${B}/MapInfo/getVVVVExtentGeoref`, {
      method: "POST", body: new URLSearchParams({ state: def.lgd, giscode: gisCode, srs: String(srid) }).toString(), referer: ref,
    })).json<{ xmin?: number; ymin?: number; xmax?: number; ymax?: number; attribution?: string }>();
    if (!e.xmax || e.xmin == null || e.ymin == null || e.ymax == null) continue;
    // The attribution names each level: "District : 25 पुणे, Taluka : 13 बारामती, Village : … सुपा".
    const names = [...(e.attribution ?? "").replace(/<[^>]*>/g, " ").matchAll(/:\s*\S+\s+([^,<]+)/g)].map((m) => m[1].trim());
    if (names.length >= 4) profile.path = path.map((code, i) => ({ code, name: names[i] }));
    profile.extent = { minX: e.xmin, minY: e.ymin, maxX: e.xmax, maxY: e.ymax };
    const centre = utmToLatLng((e.xmin + e.xmax) / 2, (e.ymin + e.ymax) / 2, zone);
    const [minLat, minLng, maxLat, maxLng] = def.box;
    if (centre.lat < minLat || centre.lat > maxLat || centre.lng < minLng || centre.lng > maxLng) continue;
    const portal: CorridorPortal = { kind: "georef", apiBase: B, wmsUrl: `${def.base}/WMS`, referer: ref, wmsVersion: "1.1.1", stateCode: def.lgd, gisCode, srid };
    profile.failedAt = "plot";
    // Walk out from the village centre until a plot answers.
    const cx = (e.xmin + e.xmax) / 2, cy = (e.ymin + e.ymax) / 2;
    for (const r of [0, 50, 100, 200, 400]) {
      for (const [dx, dy] of r === 0 ? [[0, 0]] : [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const hit = await plotAtPoint(portal, cx + dx, cy + dy);
        if (!hit) continue;
        const g = await georefPlot(portal, hit.khasraNo, { x: cx + dx, y: cy + dy });
        if (!g) continue;
        const at = utmToLatLng((g.extent.minX + g.extent.maxX) / 2, (g.extent.minY + g.extent.maxY) / 2, zone);
        profile.srid = srid;
        profile.hitPoint = { x: cx + dx, y: cy + dy };
        profile.sample = { khasraNo: hit.khasraNo, plotId: hit.plotId, lat: at.lat, lng: at.lng, vertices: g.ring.length - 1, extentErrorM: 0 };
        profile.ok = true;
        delete profile.failedAt;
        return;
      }
    }
  }
  throw new Error("village has no georeferenced plot the portal would return");
}

// ---------------------------------------------------------------------------
// Assam (bhunakshaBackEnd/proxy): a village's first dag, as vector
// ---------------------------------------------------------------------------
async function probeAssam(def: PortalDef, profile: PortalProfile, target: ProbeTarget) {
  const B = `${def.base}/bhunakshaBackEnd/proxy`;
  const ref = `${def.base}/`;
  const path = target.path;
  if (!path || path.length !== 3) throw new Error("Assam is probed by a known path: district, circle, village");
  profile.stateCode = def.lgd;
  // Names for the path, from the portal's own lists: "নগাওঁ ( NAGAON )" → "Nagaon".
  const post = async (route: string, body?: object) => (await portalFetch(`${B}/${route}`, {
    method: body ? "POST" : "GET", referer: ref, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, timeoutMs: 30_000,
  })).json<{ code: string; value: string }[]>();
  const english = (v?: string) => {
    const m = v?.match(/\(\s*([^)]+?)\s*\)\s*$/)?.[1];
    return m && m !== "null" ? m.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : v?.trim() ?? "";
  };
  const lists = [await post("districts"), await post("circles", { dist_code: path[0] }), await post("villages", { circle_code: path[1] })];
  profile.path = path.map((code, i) => ({ code, name: english(lists[i].find((o) => o.code === code)?.value) || code }));
  profile.gisCode = path[2];
  profile.srid = 32600 + def.zones[0];
  profile.failedAt = "plot";
  const res = await portalFetch(`${B}/parcel_info`, {
    method: "POST", referer: ref, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ village_code: path[2], layer_code: "ASSAM_PARCEL", dag_no: "1", crs: String(profile.srid) }),
    timeoutMs: 30_000,
  });
  const d = await res.json<{ data?: { id: string; geom: string }[] }>();
  const g = d.data?.[0];
  const pts = g?.geom.match(/-?[\d.]+ -?[\d.]+/g)?.map((q) => q.split(" ").map(Number)) ?? [];
  if (!g || pts.length < 4) throw new Error("village has no mapped dag 1");
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  profile.extent = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  profile.hitPoint = { x: (profile.extent.minX + profile.extent.maxX) / 2, y: (profile.extent.minY + profile.extent.maxY) / 2 };
  const at = utmToLatLng(profile.hitPoint.x, profile.hitPoint.y, def.zones[0]);
  profile.sample = { khasraNo: "1", plotId: g.id, lat: at.lat, lng: at.lng, vertices: pts.length - 1, extentErrorM: 0 };
  profile.ok = true;
  delete profile.failedAt;
}

export async function probe(def: PortalDef, target: ProbeTarget = {}): Promise<PortalProfile & { hitPoint?: { x: number; y: number } }> {
  const profile: PortalProfile = { state: def.state, lgd: def.lgd, kind: def.kind, base: def.base, ok: false, probedAt: new Date().toISOString() };
  try {
    if (def.kind === "angular") await probeAngular(def, profile, target);
    else if (def.kind === "georef") await probeGeoref(def, profile, target);
    else if (def.kind === "assam") await probeAssam(def, profile, target);
    else await probeClassic(def, profile, target);
  } catch (err) {
    profile.ok = false;
    profile.reason ??= err instanceof Error ? err.message : String(err);
  }
  return profile;
}

async function main() {
  const only = process.argv.slice(2);
  await mkdir("prisma/data/portals", { recursive: true });
  const targets = PORTALS.filter((p) => only.length === 0 || only.includes(p.lgd));
  // A few at a time: separate servers, but be polite.
  const results: PortalProfile[] = [];
  for (let i = 0; i < targets.length; i += 4) {
    const batch = await Promise.all(targets.slice(i, i + 4).map((t) => probe(t)));
    for (const r of batch) {
      results.push(r);
      await writeFile(`prisma/data/portals/${r.lgd}.json`, JSON.stringify(r, null, 1));
      log(
        r.ok
          ? `✓ ${r.state.padEnd(18)} ${r.path?.map((p) => p.name).join(" › ")} · EPSG:${r.srid} · khasra ${r.sample?.khasraNo} (${r.sample?.vertices} vertices, ±${r.sample?.extentErrorM} m) @ ${r.sample?.lat.toFixed(4)},${r.sample?.lng.toFixed(4)}`
          : `✗ ${r.state.padEnd(18)} failed at ${r.failedAt}: ${r.reason}`,
      );
    }
  }
  log(`\n${results.filter((r) => r.ok).length}/${results.length} portals yield traceable plots`);
}

if (process.argv[1]?.includes("probe-portals")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
