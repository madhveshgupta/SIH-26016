/**
 * Tier 2 land: real FIELD boundaries from OpenStreetMap, for states whose cadastral portal does
 * not give georeferenced plots.
 */
import { setTimeout as delay } from "node:timers/promises";
import { portalFetch } from "@backend/integrations/http";

const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
/** OSM's usage policies ask for an honest, identifying User-Agent (overpass-api.de returns 406 to browser-like ones). */
const OSM_UA = "BhoomiNayan/1.0 (SIH PS 26016 land-acquisition demonstration)";

async function overpass<T>(query: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const res = await portalFetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }).toString(),
        headers: { "User-Agent": OSM_UA },
        timeoutMs: 120_000,
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith("{")) return JSON.parse(text) as T;
      last = new Error(`Overpass ${res.status}: ${text.slice(0, 120)}`);
    } catch (e) {
      last = e;
    }
    await delay(5000 * (attempt + 1));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export interface OsmVillage {
  osmId: number;
  name: string;
  lat: number;
  lng: number;
}

/** Where in a state are fields actually mapped? */
export async function denseFieldSpots(
  box: [number, number, number, number],
  grid = 5,
  cellKm = 3,
): Promise<{ lat: number; lng: number; count: number }[]> {
  const [minLat, minLng, maxLat, maxLng] = box;
  const dLat = cellKm / 110.574;
  const cells: { lat: number; lng: number; bbox: string }[] = [];
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const lat = minLat + ((i + 0.5) / grid) * (maxLat - minLat);
      const lng = minLng + ((j + 0.5) / grid) * (maxLng - minLng);
      const dLng = cellKm / (111.32 * Math.cos((lat * Math.PI) / 180));
      cells.push({ lat, lng, bbox: `${lat - dLat / 2},${lng - dLng / 2},${lat + dLat / 2},${lng + dLng / 2}` });
    }
  }
  const out: { lat: number; lng: number; count: number }[] = [];
  for (let k = 0; k < cells.length; k += 13) {
    const batch = cells.slice(k, k + 13);
    const q = `[out:json][timeout:90];\n${batch.map((c) => `way["landuse"~"^(farmland|meadow|orchard)$"](${c.bbox});out count;`).join("\n")}`;
    const r = await overpass<{ elements: { tags?: { ways?: string } }[] }>(q);
    batch.forEach((c, i) => out.push({ lat: c.lat, lng: c.lng, count: Number(r.elements[i]?.tags?.ways ?? 0) }));
    await delay(2000);
  }
  return out.sort((a, b) => b.count - a.count);
}

/** The nearest real settlement to a point, from OSM. */
export async function nearestVillage(lat: number, lng: number): Promise<OsmVillage | null> {
  const q = `[out:json][timeout:60];node["place"~"^(village|hamlet|town)$"]["name"](around:5000,${lat},${lng});out 20;`;
  const r = await overpass<{ elements: { id: number; lat: number; lon: number; tags: Record<string, string> }[] }>(q);
  const best = r.elements
    .map((e) => ({ e, d: (e.lat - lat) ** 2 + ((e.lon - lng) * Math.cos((lat * Math.PI) / 180)) ** 2 }))
    .sort((a, b) => a.d - b.d)[0];
  return best ? { osmId: best.e.id, name: best.e.tags["name:en"] ?? best.e.tags.name, lat: best.e.lat, lng: best.e.lon } : null;
}

export interface OsmField {
  osmWayId: number;
  landuse: string;
  crop: string | null;
  /** Closed ring, [lng, lat]. */
  ring: [number, number][];
  chainageM: number;
}

/** Local metres around a reference latitude — accurate enough over a few km. */
function toXY(lng: number, lat: number, lat0: number, lng0: number): [number, number] {
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return [(lng - lng0) * kx, (lat - lat0) * 110_574];
}

function segmentIntersectsBand(ring: [number, number][], ux: number, uy: number, half: number, length: number): boolean {
  // Any vertex inside the band, or the ring straddling the centreline within the band's length.
  let minOff = Infinity, maxOff = -Infinity, inside = false;
  for (const [x, y] of ring) {
    const along = x * ux + y * uy;
    const off = -x * uy + y * ux;
    if (along < -length / 2 || along > length / 2) continue;
    if (Math.abs(off) <= half) inside = true;
    minOff = Math.min(minOff, off);
    maxOff = Math.max(maxOff, off);
  }
  return inside || (minOff < 0 && maxOff > 0);
}

/** Fields along a straight alignment through the densest farmland near a village. */
export async function fieldsAlongCorridor(
  village: OsmVillage,
  opts: { radiusM?: number; rightOfWayM?: number; lengthM?: number; maxFields?: number } = {},
): Promise<{ fields: OsmField[]; centreline: [number, number][] }> {
  const radius = opts.radiusM ?? 1500;
  const q = `[out:json][timeout:90];
way["landuse"~"^(farmland|meadow|orchard)$"](around:${radius},${village.lat},${village.lng});
out geom tags;`;
  const r = await overpass<{ elements: { id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] }>(q);

  const polys = r.elements
    .filter((e) => e.geometry && e.geometry.length >= 4)
    .map((e) => {
      const g = e.geometry!;
      const closed = g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
      return { id: e.id, tags: e.tags ?? {}, ring: (closed ? g : [...g, g[0]]).map((p) => [p.lon, p.lat] as [number, number]) };
    })
    // Skip vast polygons (whole-landscape "farmland" blobs): a plot is a field, not a region.
    .filter((p) => p.ring.length >= 4);
  if (polys.length < 5) return { fields: [], centreline: [] };

  // Principal axis of the field centroids → alignment direction.
  const lat0 = village.lat, lng0 = village.lng;
  const cents = polys.map((p) => {
    const xy = p.ring.map(([lng, lat]) => toXY(lng, lat, lat0, lng0));
    const cx = xy.reduce((a, q) => a + q[0], 0) / xy.length;
    const cy = xy.reduce((a, q) => a + q[1], 0) / xy.length;
    const w = Math.max(...xy.map((q) => q[0])) - Math.min(...xy.map((q) => q[0]));
    const h = Math.max(...xy.map((q) => q[1])) - Math.min(...xy.map((q) => q[1]));
    return { p, xy, cx, cy, size: Math.max(w, h) };
  }).filter((c) => c.size < 800);
  if (cents.length < 5) return { fields: [], centreline: [] };

  const mx = cents.reduce((a, c) => a + c.cx, 0) / cents.length;
  const my = cents.reduce((a, c) => a + c.cy, 0) / cents.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const c of cents) {
    sxx += (c.cx - mx) ** 2;
    syy += (c.cy - my) ** 2;
    sxy += (c.cx - mx) * (c.cy - my);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const half = (opts.rightOfWayM ?? 60) / 2;
  const length = opts.lengthM ?? 2 * radius;

  const picked = cents
    .map((c) => ({ c, local: c.xy.map(([x, y]) => [x - mx, y - my] as [number, number]) }))
    .filter(({ local }) => segmentIntersectsBand(local, ux, uy, half, length))
    .map(({ c, local }) => {
      const along = local.reduce((a, [x, y]) => a + (x * ux + y * uy), 0) / local.length;
      return { c, along };
    })
    .sort((a, b) => a.along - b.along)
    .slice(0, opts.maxFields ?? 45);
  if (picked.length === 0) return { fields: [], centreline: [] };

  const start = picked[0].along;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const toLngLat = (x: number, y: number): [number, number] => [lng0 + x / kx, lat0 + y / 110_574];
  const a0 = picked[0].along - 20, a1 = picked[picked.length - 1].along + 20;
  const centreline = [toLngLat(mx + ux * a0, my + uy * a0), toLngLat(mx + ux * a1, my + uy * a1)];

  return {
    centreline,
    fields: picked.map(({ c, along }) => ({
      osmWayId: c.p.id,
      landuse: c.p.tags.landuse ?? "farmland",
      crop: c.p.tags.crop ?? null,
      ring: c.p.ring,
      chainageM: Math.round(along - start),
    })),
  };
}

/** District and sub-district names for a point, from OSM's own boundaries (Nominatim). */
export async function reverseAdmin(lat: number, lng: number): Promise<{ district: string | null; subdistrict: string | null; state: string | null }> {
  const res = await portalFetch(
    `https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lng), format: "json", zoom: "10", "accept-language": "en" })}`,
    { timeoutMs: 20_000, headers: { "User-Agent": OSM_UA } },
  );
  if (!res.ok) return { district: null, subdistrict: null, state: null };
  const d = await res.json<{ address?: Record<string, string> }>();
  const a = d.address ?? {};
  return {
    district: (a.state_district ?? a.county ?? null)?.replace(/ District$/i, "") ?? null,
    subdistrict: a.subdistrict ?? a.county ?? null,
    state: a.state ?? null,
  };
}

/** Geocode a place name to a point and its administrative names (Nominatim, 1 req/s). */
export async function geocode(query: string): Promise<{ lat: number; lng: number; village: string | null; subdistrict: string | null; district: string | null; state: string | null } | null> {
  const res = await portalFetch(
    `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: query, format: "json", addressdetails: "1", limit: "1", countrycodes: "in", "accept-language": "en" })}`,
    { timeoutMs: 20_000, headers: { "User-Agent": OSM_UA } },
  );
  if (!res.ok) return null;
  const rows = await res.json<{ lat: string; lon: string; name?: string; address?: Record<string, string> }[]>();
  const r = rows[0];
  if (!r) return null;
  const a = r.address ?? {};
  return {
    lat: Number(r.lat),
    lng: Number(r.lon),
    village: a.village ?? a.hamlet ?? a.town ?? a.suburb ?? r.name ?? null,
    subdistrict: a.subdistrict ?? a.county ?? a.city_district ?? null,
    district: (a.state_district ?? a.county ?? null)?.replace(/ District$/i, "") ?? null,
    state: a.state ?? null,
  };
}
