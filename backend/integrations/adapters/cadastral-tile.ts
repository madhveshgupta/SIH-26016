/** Cadastral sheet proxy and cache. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const CACHE_DIR = process.env.CADASTRAL_CACHE ?? ".cache/cadastral";
/** Cadastral sheets change rarely; a week is generous and still fresh. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SheetRequest {
  baseUrl: string;
  stateCode: string;
  gisCode: string;
  /** The portal's own projected CRS, e.g. EPSG:32643. */
  srs: string;
  /** minx,miny,maxx,maxy in that CRS. Axis order matters — wrong order returns a blank sheet. */
  bbox: string;
  width?: number;
  height?: number;
  /** Classic portals serve /WMS; the Angular ones /bhunakshaserver/WMS. */
  variant?: "classic" | "angular";
}

export interface SheetResult {
  png: Buffer;
  source: "LIVE" | "CACHED";
  fetchedAt: Date;
}

function cacheKey(r: SheetRequest): string {
  return createHash("sha1")
    .update([r.baseUrl, r.stateCode, r.gisCode, r.srs, r.bbox, r.width, r.height, r.variant].join("|"))
    .digest("hex");
}

/** Fetch a village cadastral sheet, preferring cache. */
export async function getCadastralSheet(req: SheetRequest): Promise<SheetResult | null> {
  const key = cacheKey(req);
  const path = join(CACHE_DIR, `${key}.png`);

  try {
    const s = await stat(path);
    if (Date.now() - s.mtimeMs < TTL_MS) {
      return { png: await readFile(path), source: "CACHED", fetchedAt: s.mtime };
    }
  } catch {
    // Not cached yet.
  }

  const qs = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    FORMAT: "image/png",
    LAYERS: "VILLAGE_MAP",
    transparent: "true",
    state: req.stateCode,
    gis_code: req.gisCode,
    SRS: req.srs,
    BBOX: req.bbox,
    WIDTH: String(req.width ?? 1200),
    HEIGHT: String(req.height ?? 1200),
  });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const wmsPath = req.variant === "angular" ? "/bhunakshaserver/WMS" : "/WMS";
    const res = await fetch(`${req.baseUrl}${wmsPath}?${qs}`, {
      signal: ctl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BhoomiNayan/1.0)",
        // The header without which the portal returns 500.
        Referer: `${req.baseUrl}/`,
      },
    });
    if (!res.ok) throw new Error(`WMS returned ${res.status}`);

    const png = Buffer.from(await res.arrayBuffer());
    // A transparent sheet of a few hundred bytes means the bbox was wrong.
    if (png.byteLength < 2000) throw new Error("WMS returned an empty sheet");

    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path, png);
    return { png, source: "LIVE", fetchedAt: new Date() };
  } catch {
    // Portal unreachable — serve whatever we have rather than nothing.
    try {
      const s = await stat(path);
      return { png: await readFile(path), source: "CACHED", fetchedAt: s.mtime };
    } catch {
      return null;
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Known cadastral sheets, keyed by the village gisCode stored on `Village`. */
export interface SheetDefinition {
  baseUrl: string;
  stateCode: string;
  gisCode: string;
  srs: string;
  utmBbox: [number, number, number, number];
  /** The newer Angular portals serve sheets from a different path. */
  variant: "classic" | "angular";
  label: string;
}

export const SHEETS: Record<string, SheetDefinition> = {
  // Aldona, Bardez, North Goa — the classic deployment, verified end to end.
  "013001000240113000000VILLAGE": {
    baseUrl: "https://bhunaksha.goa.gov.in/bhunaksha",
    stateCode: "30",
    gisCode: "013001000240113000000VILLAGE",
    srs: "EPSG:32643",
    utmBbox: [377556.57099038095, 1721275.29833788, 380474.083219338, 1726656.390603136],
    variant: "classic",
    label: "Aldona, North Goa",
  },
  // Akbarpur, Agra, Uttar Pradesh — the demo's primary jurisdiction.
  "14600766124649": {
    baseUrl: "https://upbhunaksha.gov.in",
    stateCode: "09",
    gisCode: "14600766124649",
    srs: "EPSG:32644",
    utmBbox: [209253.96830814116, 3000949.0375635787, 210800.81989703694, 3003634.9108190043],
    variant: "angular",
    label: "Akbarpur, Agra",
  },
};

/** Backwards-compatible alias for the sheet verified first. */
export const ALDONA_SHEET = SHEETS["013001000240113000000VILLAGE"];
