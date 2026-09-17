/** Exact plot boundaries from Bhu-Naksha — traced, not invented. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tracePlotPng, type Extent } from "@backend/gis/trace";
import { portalFetch } from "@backend/integrations/http";

const CACHE_DIR = join(process.env.CADASTRAL_CACHE ?? ".cache/cadastral", "plots");

export interface BoundaryPortal {
  /** Full WMS URL, e.g. https://upbhunaksha.gov.in/bhunakshaserver/WMS */
  wmsUrl: string;
  /** The portal origin — the WMS returns HTTP 500 without it. */
  referer: string;
  /** Angular portals speak WMS 1.3.0 (CRS=); classic ones 1.1.1 (SRS=). */
  wmsVersion: "1.1.1" | "1.3.0";
  /** Classic portals need the state code; Angular ones send it empty. */
  stateCode: string;
  gisCode: string;
  /** The portal's projected CRS, e.g. 32644. */
  srid: number;
  /** How the WMS request names its CRS. */
  wmsCrs?: "epsg" | "blank";
  /** Inset applied to traced outlines, in pixels, cancelling rendering bias. */
  insetPx?: number;
}

export interface PlotBoundary {
  /** Closed exterior ring in the portal's UTM CRS (metres). */
  ringUtm: [number, number][];
  tracedAreaSqm: number;
  vertices: number;
  /** Ground size of one pixel the trace was made at. */
  metresPerPixel: number;
  /** Largest gap between our traced extent and the portal's reported extent. */
  extentErrorM: number;
}

async function fetchPng(portal: BoundaryPortal, plotId: string, win: Extent, w: number, h: number) {
  const bbox = [win.minX, win.minY, win.maxX, win.maxY].map((v) => v.toFixed(3)).join(",");
  const params: Record<string, string> = {
    SERVICE: "WMS", VERSION: portal.wmsVersion, REQUEST: "GetMap",
    LAYERS: "PLOT_LIST", STYLES: "PLOT_SELECTION", FORMAT: "image/png", TRANSPARENT: "true",
    state: portal.stateCode, gis_code: portal.gisCode, overlay_codes: "", plot_id: plotId,
    BBOX: bbox, WIDTH: String(w), HEIGHT: String(h),
    [portal.wmsVersion === "1.3.0" ? "CRS" : "SRS"]: portal.wmsCrs === "blank" ? "" : `EPSG:${portal.srid}`,
  };
  const url = `${portal.wmsUrl}?${new URLSearchParams(params)}`;
  const key = createHash("sha1").update(url).digest("hex");
  const path = join(CACHE_DIR, `${key}.png`);
  try {
    return await readFile(path);
  } catch {
    /* not cached */
  }
  const res = await portalFetch(url, { referer: portal.referer, timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`WMS ${res.status}`);
  if (!res.contentType.includes("image/png")) throw new Error("WMS did not return a PNG");
  const png = await res.buffer();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, png);
  return png;
}

/** Trace one plot's exact boundary. */
export async function fetchPlotBoundary(
  portal: BoundaryPortal,
  plotId: string,
  reported: Extent,
  opts: { metresPerPixel?: number; maxPixels?: number } = {},
): Promise<PlotBoundary | null> {
  const maxPixels = opts.maxPixels ?? 1800;
  const pad = Math.max(8, 0.1 * Math.max(reported.maxX - reported.minX, reported.maxY - reported.minY));
  const win: Extent = {
    minX: reported.minX - pad, minY: reported.minY - pad,
    maxX: reported.maxX + pad, maxY: reported.maxY + pad,
  };
  const spanX = win.maxX - win.minX;
  const spanY = win.maxY - win.minY;
  // 0.25 m/px where the plot is small enough; coarser only for very large plots.
  const mpp = Math.max(opts.metresPerPixel ?? 0.25, Math.max(spanX, spanY) / maxPixels);
  const w = Math.round(spanX / mpp);
  const h = Math.round(spanY / mpp);
  // Square pixels: re-derive the window from the rounded pixel counts.
  win.maxX = win.minX + w * mpp;
  win.maxY = win.minY + h * mpp;

  const png = await fetchPng(portal, plotId, win, w, h);
  // Simplify below one pixel: the midpoint trace has already smoothed the
  // staircase, and every real corner (metres apart) survives.
  const traced = tracePlotPng(png, win, 0.8 * mpp, (portal.insetPx ?? 0) * mpp);
  if (!traced) return null;

  const xs = traced.ring.map((p) => p[0]);
  const ys = traced.ring.map((p) => p[1]);
  const touchesEdge =
    Math.min(...xs) <= win.minX + mpp / 2 || Math.max(...xs) >= win.maxX - mpp / 2 ||
    Math.min(...ys) <= win.minY + mpp / 2 || Math.max(...ys) >= win.maxY - mpp / 2;
  if (touchesEdge) return null;

  const extentErrorM = Math.max(
    Math.abs(Math.min(...xs) - reported.minX), Math.abs(Math.max(...xs) - reported.maxX),
    Math.abs(Math.min(...ys) - reported.minY), Math.abs(Math.max(...ys) - reported.maxY),
  );
  // Simplification can shave a vertex slightly inside the true extent, so allow a few pixels.
  if (extentErrorM > Math.max(1.0, 4 * mpp)) return null;

  return {
    ringUtm: traced.ring,
    tracedAreaSqm: traced.areaSqm,
    vertices: traced.vertices,
    metresPerPixel: mpp,
    extentErrorM,
  };
}
