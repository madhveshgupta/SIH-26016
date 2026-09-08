/** Bhu-Naksha cadastral adapter — a REAL government integration, not a mock. */
import { setTimeout as delay } from "node:timers/promises";

export interface CadastralConfig {
  /** e.g. https://bhunaksha.goa.gov.in/bhunaksha */
  baseUrl: string;
  /** The state code that portal expects, e.g. "30" for Goa. */
  stateCode: string;
  /** Comma-joined level codes, e.g. "01,30010002,40113000,000VILLAGE," */
  levels: string;
  gisCode: string;
}

export interface RealParcel {
  khasraNo: string;
  /** The portal's own unique parcel id — Goa calls it PNIU. */
  pniu: string;
  areaSqm: number | null;
  /** WGS84. */
  centroid: { lat: number; lng: number } | null;
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null;
  village: string | null;
  taluka: string | null;
}

const UA = "Mozilla/5.0 (compatible; BhoomiNayan/1.0; +https://bhoominayan.gov.in)";
/** Short, because a hung government socket must not hold a request. */
const TIMEOUT_MS = Number(process.env.CADASTRAL_TIMEOUT_READ_MS ?? 8000);

async function req(url: string, init: RequestInit & { referer: string }): Promise<Response> {
  const ctl = new AbortController();
  const t = globalThis.setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: { "User-Agent": UA, Referer: init.referer, ...(init.headers ?? {}) },
    });
  } finally {
    globalThis.clearTimeout(t);
  }
}

/** Parse the `info` blob, deliberately skipping the occupant-name line. */
function parseInfo(info: string): { areaSqm: number | null; village: string | null; taluka: string | null } {
  const area = info.match(/Total Area\s*:\s*([\d.]+)\s*sq\.?m/i);
  const village = info.match(/Village Name\s*:\s*([^\n]+)/i);
  const taluka = info.match(/Taluka Name\s*:\s*([^\n]+)/i);
  return {
    areaSqm: area ? Number(area[1]) : null,
    village: village ? village[1].trim() : null,
    taluka: taluka ? taluka[1].trim() : null,
  };
}

/** Look a plot up by its survey number. */
export async function fetchParcel(
  cfg: CadastralConfig,
  plotNo: string,
): Promise<RealParcel | null> {
  const qs = new URLSearchParams({
    OP: "5", state: cfg.stateCode, levels: cfg.levels, plotno: plotNo,
  });
  const res = await req(`${cfg.baseUrl}/ScalarDatahandler?${qs}`, { referer: `${cfg.baseUrl}/` });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    has_data?: string;
    plots?: { plotNo: string; PNIU: string; info?: string }[];
  };
  if (data.has_data !== "Y" || !data.plots?.length) return null;

  const p = data.plots[0];
  const meta = parseInfo(p.info ?? "");
  const wgs = await fetchWgs84(cfg, p.PNIU);

  return {
    khasraNo: p.plotNo,
    pniu: p.PNIU,
    areaSqm: meta.areaSqm,
    village: meta.village,
    taluka: meta.taluka,
    centroid: wgs?.centroid ?? null,
    bbox: wgs?.bbox ?? null,
  };
}

/** WGS84 coordinates for a parcel. */
async function fetchWgs84(cfg: CadastralConfig, pniu: string) {
  const res = await req(`${cfg.baseUrl}/rest/MapInfo/getPointsfromPNIU`, {
    method: "POST",
    referer: `${cfg.baseUrl}/`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ state: cfg.stateCode, pniu, gisCode: cfg.gisCode }).toString(),
  });
  if (!res.ok) return null;

  // Bare CSV: centreX, centreY, centreLng, centreLat, id, plotNo,
  //           minLng, minLat, maxLng, maxLat
  const parts = (await res.text()).trim().split(",");
  if (parts.length < 10) return null;
  const n = parts.map(Number);
  if (!Number.isFinite(n[2]) || !Number.isFinite(n[3])) return null;

  return {
    centroid: { lng: n[2], lat: n[3] },
    bbox: { minLng: n[6], minLat: n[7], maxLng: n[8], maxLat: n[9] },
  };
}

/** A bounding box as a GeoJSON polygon — the real extent, not a surveyed outline. */
export function bboxToPolygon(b: NonNullable<RealParcel["bbox"]>) {
  return {
    type: "Polygon",
    coordinates: [[
      [b.minLng, b.minLat], [b.maxLng, b.minLat],
      [b.maxLng, b.maxLat], [b.minLng, b.maxLat], [b.minLng, b.minLat],
    ]],
  };
}

/** The WMS URL for a village's real cadastral sheet. */
export function cadastralWmsUrl(cfg: CadastralConfig): string {
  return `${cfg.baseUrl}/WMS`;
}

export function cadastralWmsParams(cfg: CadastralConfig) {
  return {
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    format: "image/png",
    layers: "VILLAGE_MAP",
    transparent: "true",
    state: cfg.stateCode,
    gis_code: cfg.gisCode,
  };
}

/** Harvest a run of plots. */
export async function harvestParcels(
  cfg: CadastralConfig,
  plotNumbers: string[],
  opts: { pauseMs?: number; onProgress?: (p: RealParcel) => void } = {},
): Promise<RealParcel[]> {
  const out: RealParcel[] = [];
  for (const plotNo of plotNumbers) {
    try {
      const p = await fetchParcel(cfg, plotNo);
      if (p) {
        out.push(p);
        opts.onProgress?.(p);
      }
    } catch {
      // One unreachable plot must not abandon the harvest.
    }
    await delay(opts.pauseMs ?? 250);
  }
  return out;
}

/** Aldona village, Bardez taluka, North Goa — the deployment verified end to end. */
export const GOA_ALDONA: CadastralConfig = {
  baseUrl: "https://bhunaksha.goa.gov.in/bhunaksha",
  stateCode: "30",
  levels: "01,30010002,40113000,000VILLAGE,",
  gisCode: "013001000240113000000VILLAGE",
};

// ---------------------------------------------------------------------------
// The newer Angular deployment (Uttar Pradesh, Haryana, Himachal, J&K).
// ---------------------------------------------------------------------------

export interface AngularCadastralConfig {
  /** e.g. https://upbhunaksha.gov.in */
  host: string;
  /** Composed as district+tehsil+village, e.g. "14600766124649". */
  gisCode: string;
  /** The UTM zone this state's portal reports in, e.g. 32644 for UP. */
  srid: number;
}

export interface AngularParcel {
  khasraNo: string;
  /** The portal's internal plot id. */
  plotId: string;
  /** Bounding box in the portal's projected CRS — transform before use. */
  utm: { minX: number; minY: number; maxX: number; maxY: number };
}

export type CadastralPolygon = {
  type: "Polygon";
  coordinates: number[][][];
};

/** Fetch the authoritative UP polygon when the portal issues an API token. */
export async function fetchAngularParcelPolygon(
  cfg: AngularCadastralConfig,
  plotId: string,
  authorization = process.env.CADASTRAL_AUTHORIZATION,
): Promise<CadastralPolygon | null> {
  if (!authorization) return null;
  const res = await req(`${cfg.host}/bhunakshaserver/v1/khasramap/plot?${new URLSearchParams({
    bhucode: cfg.gisCode,
    id: plotId,
  })}`, {
    method: "POST",
    referer: `${cfg.host}/`,
    headers: { Authorization: authorization },
  });
  if (!res.ok) return null;
  const value = (await res.json()) as {
    type?: string;
    coordinates?: unknown;
    geometry?: { type?: string; coordinates?: unknown };
  };
  const polygon = value.type === "Feature" ? value.geometry : value;
  if (polygon?.type !== "Polygon" || !Array.isArray(polygon.coordinates)) return null;
  return polygon as CadastralPolygon;
}

/** Look up one plot. */
export async function fetchAngularParcel(
  cfg: AngularCadastralConfig,
  plotNo: string,
): Promise<AngularParcel | null> {
  const res = await req(`${cfg.host}/bhunakshaserver/MapInfo/getPlotByPlotNo`, {
    method: "POST",
    referer: `${cfg.host}/`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ giscode: cfg.gisCode, plotno: plotNo }).toString(),
  });
  if (!res.ok) return null;

  const d = (await res.json()) as {
    minx?: number; miny?: number; maxx?: number; maxy?: number;
    id?: string; kide?: string;
  };
  if (d.minx == null || d.miny == null || d.maxx == null || d.maxy == null) return null;
  // A degenerate box means the plot number does not exist in this village.
  if (d.maxx - d.minx <= 0 || d.maxy - d.miny <= 0) return null;

  return {
    khasraNo: d.kide ?? plotNo,
    plotId: d.id ?? plotNo,
    utm: { minX: d.minx, minY: d.miny, maxX: d.maxx, maxY: d.maxy },
  };
}

export async function harvestAngularParcels(
  cfg: AngularCadastralConfig,
  plotNumbers: string[],
  opts: { pauseMs?: number; onProgress?: (p: AngularParcel) => void } = {},
): Promise<AngularParcel[]> {
  const out: AngularParcel[] = [];
  for (const plotNo of plotNumbers) {
    try {
      const p = await fetchAngularParcel(cfg, plotNo);
      if (p) {
        out.push(p);
        opts.onProgress?.(p);
      }
    } catch {
      // One bad plot must not abandon the harvest.
    }
    await delay(opts.pauseMs ?? 200);
  }
  return out;
}

/** Akbarpur village, Agra tehsil, Agra district, Uttar Pradesh. */
export const UP_AKBARPUR: AngularCadastralConfig = {
  host: "https://upbhunaksha.gov.in",
  gisCode: "14600766124649",
  srid: 32644,
};
