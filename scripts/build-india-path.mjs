/** Regenerate frontend/lib/india-outline.ts from Natural Earth. */
import { writeFileSync } from "node:fs";

const SRC =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson";

/** State/UT internal boundaries, so the country reads as a federation. */
const STATES_SRC =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lines.geojson";

const W = 400;
const H = 520;
const PAD = 10;
const EPSILON = 0.03; // degrees
const MIN_RING = 60; // drop islets too small to read at hero size

/** Iterative Douglas–Peucker; iterative so a 7,500-point ring cannot blow the stack. */
function simplify(pts, eps) {
  const n = pts.length;
  if (n < 3) return pts;
  const keep = new Array(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (j <= i + 1) continue;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const dx = bx - ax;
    const dy = by - ay;
    const den = Math.hypot(dx, dy);
    let dmax = -1;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      // A closed ring's endpoints coincide, which degenerates the line —
      // fall back to radial distance in that case.
      const d =
        den < 1e-12
          ? Math.hypot(pts[k][0] - ax, pts[k][1] - ay)
          : Math.abs(dy * pts[k][0] - dx * pts[k][1] + bx * ay - by * ax) / den;
      if (d > dmax) {
        dmax = d;
        idx = k;
      }
    }
    if (dmax > eps && idx > 0) {
      keep[idx] = true;
      stack.push([i, idx], [idx, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const gj = await (await fetch(SRC)).json();
const india = gj.features.find(
  (f) => (f.properties.NAME || f.properties.ADMIN) === "India",
);
if (!india) throw new Error("India not present in the source file");

const polys =
  india.geometry.type === "Polygon"
    ? [india.geometry.coordinates]
    : india.geometry.coordinates;

const rings = polys
  .map((p) => p[0])
  .sort((a, b) => b.length - a.length)
  .filter((r) => r.length >= MIN_RING);

let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const r of rings) {
  for (const [lon, lat] of r) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
}

// Mercator on y, so the country is not vertically squashed.
const my = (lat) => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const yTop = my(maxLat);
const yBottom = my(minLat);
const scale = Math.min(
  (W - 2 * PAD) / (maxLon - minLon),
  (H - 2 * PAD) / (yTop - yBottom),
);
const offX = PAD + (W - 2 * PAD - (maxLon - minLon) * scale) / 2;
const offY = PAD + (H - 2 * PAD - (yTop - yBottom) * scale) / 2;
const project = ([lon, lat]) => [
  +(offX + (lon - minLon) * scale).toFixed(1),
  +(offY + (yTop - my(lat)) * scale).toFixed(1),
];

const d = rings
  .map((r) => simplify(r, EPSILON))
  .filter((r) => r.length >= 8)
  .map((r) => "M" + r.map(project).map((p) => p.join(" ")).join("L") + "Z")
  .join("");

// ── internal boundaries ────────────────────────────────────────────────
const sgj = await (await fetch(STATES_SRC)).json();
const stateLines = sgj.features.filter(
  (f) => f.properties.adm0_name === "India" || f.properties.ADM0_NAME === "India",
);

const stateSegs = [];
for (const f of stateLines) {
  const parts =
    f.geometry.type === "LineString"
      ? [f.geometry.coordinates]
      : f.geometry.coordinates;
  for (const line of parts) {
    const simp = simplify(line, EPSILON * 5);
    if (simp.length < 2) continue;
    const pts = simp.map(project);
    // Drop slivers: at hero size anything under a few pixels is visual noise
    // that costs bytes without being legible.
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    if (len < 6) continue;
    stateSegs.push("M" + pts.map((q) => q.join(" ")).join("L"));
  }
}
const statesD = stateSegs.join("");
console.log(`state lines: ${stateSegs.length} segments, ${statesD.length} chars`);

writeFileSync(
  new URL("../frontend/lib/india-outline.ts", import.meta.url),
  `/**
 * India's outline as an SVG path, for the landing hero.
 *
 * GENERATED — do not edit by hand. Run: node scripts/build-india-path.mjs
 *
 * Source: Natural Earth 1:10m \`ne_10m_admin_0_countries_ind\` (public domain),
 * the India point-of-view edition, which depicts the boundaries as India
 * officially claims them.
 */
export const INDIA_VIEWBOX = "0 0 ${W} ${H}";

/**
 * The same Mercator fit used to build the path, so callers can place markers
 * by real latitude/longitude instead of eyeballing viewBox coordinates.
 */
export function projectToIndia(lon: number, lat: number): { x: number; y: number } {
  const my = (l: number) => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360));
  return {
    x: ${offX.toFixed(4)} + (lon - ${minLon}) * ${scale.toFixed(6)},
    y: ${offY.toFixed(4)} + (${yTop.toFixed(9)} - my(lat)) * ${scale.toFixed(6)},
  };
}

export const INDIA_PATH =
  "${d}";

/** State and union-territory boundaries, as open polylines (stroke, never fill). */
export const INDIA_STATES_PATH =
  "${statesD}";
`,
);

console.log(`wrote ${d.length} chars from ${rings.length} rings`);
