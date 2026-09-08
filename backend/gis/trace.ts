/** Raster → polygon tracing for cadastral plot boundaries. */
import { PNG } from "pngjs";

export interface Extent { minX: number; minY: number; maxX: number; maxY: number }

/** Pixels with alpha above this belong to the plot. */
const ALPHA_THRESHOLD = 32;

/** Outline of the largest filled region, as [col,row] lattice corners. */
function traceLargestRegion(mask: Uint8Array, w: number, h: number): [number, number][] | null {
  // 1. Label regions and keep the largest (drops the stray label glyph etc.).
  const label = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i]) continue;
    next++;
    let size = 0;
    stack.push(i);
    label[i] = next;
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      const x = j % w, y = (j / w) | 0;
      if (x > 0 && mask[j - 1] && !label[j - 1]) { label[j - 1] = next; stack.push(j - 1); }
      if (x < w - 1 && mask[j + 1] && !label[j + 1]) { label[j + 1] = next; stack.push(j + 1); }
      if (y > 0 && mask[j - w] && !label[j - w]) { label[j - w] = next; stack.push(j - w); }
      if (y < h - 1 && mask[j + w] && !label[j + w]) { label[j + w] = next; stack.push(j + w); }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  if (!best) return null;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === best;

  // 2. Collect directed boundary edges (filled on the left when walking).
  const edges = new Map<string, [number, number][]>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = `${ax},${ay}`;
    const list = edges.get(k);
    if (list) list.push([bx, by]); else edges.set(k, [[bx, by]]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x + 1, y, x, y);         // top, walking left
      if (!inside(x, y + 1)) add(x, y + 1, x + 1, y + 1); // bottom, walking right
      if (!inside(x - 1, y)) add(x, y, x, y + 1);         // left, walking down
      if (!inside(x + 1, y)) add(x + 1, y + 1, x + 1, y); // right, walking up
    }
  }

  // 3. Chain the edges into rings; the longest ring is the exterior.
  let longest: [number, number][] = [];
  while (edges.size) {
    const startKey = edges.keys().next().value as string;
    const [sx, sy] = startKey.split(",").map(Number);
    const ring: [number, number][] = [[sx, sy]];
    let key = startKey;
    for (;;) {
      const list = edges.get(key);
      if (!list || !list.length) break;
      const [nx, ny] = list.pop()!;
      if (!list.length) edges.delete(key);
      key = `${nx},${ny}`;
      if (nx === sx && ny === sy) break;
      ring.push([nx, ny]);
    }
    if (ring.length > longest.length) longest = ring;
  }
  return longest.length >= 4 ? longest : null;
}

/** Douglas–Peucker on a closed ring. Tolerance in the ring's own units. */
function simplifyRing(pts: [number, number][], tol: number): [number, number][] {
  const dp = (a: number, b: number, keep: Uint8Array) => {
    let maxD = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; dp(a, idx, keep); dp(idx, b, keep); }
  };
  // Split the ring at its farthest point from the start so both halves are open chains.
  let far = 0, farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  const closed = [...pts, pts[0]];
  const keep = new Uint8Array(closed.length);
  keep[0] = keep[far] = keep[closed.length - 1] = 1;
  const saved = pts;
  pts = closed;
  dp(0, far, keep);
  dp(far, closed.length - 1, keep);
  pts = saved;
  return closed.filter((_, i) => keep[i]).slice(0, -1);
}

/**
 * Move every edge of a simple polygon inwards by `d` (mitred corners, with the
 * mitre capped so a sliver corner cannot shoot across the plot).
 */
export function insetRing(ring: [number, number][], d: number): [number, number][] {
  let signed = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    signed += x1 * y2 - x2 * y1;
  }
  const inward = signed > 0 ? 1 : -1; // counter-clockwise: interior is on the left
  const n = ring.length;
  return ring.map((p, i) => {
    const a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n];
    const e1 = norm([p[0] - a[0], p[1] - a[1]]), e2 = norm([b[0] - p[0], b[1] - p[1]]);
    const n1: [number, number] = [-e1[1] * inward, e1[0] * inward];
    const n2: [number, number] = [-e2[1] * inward, e2[0] * inward];
    const bis = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const cos = bis[0] * n1[0] + bis[1] * n1[1];
    const len = d / Math.max(cos, 0.35);
    return [p[0] + bis[0] * len, p[1] + bis[1] * len] as [number, number];
  });
}

function norm([x, y]: [number, number]): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

/** Shoelace area, in squared ring units. */
export function ringArea(r: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export interface TracedPlot {
  /** Exterior ring in the source projected CRS (UTM metres), closed. */
  ring: [number, number][];
  /** Area of the traced ring, m². */
  areaSqm: number;
  /** Vertices kept after simplification. */
  vertices: number;
}

/** Trace the plot in a PNG that was rendered for `extent` (UTM) at w×h pixels. */
export function tracePlotPng(png: Buffer, extent: Extent, toleranceM = 0.2, insetM = 0): TracedPlot | null {
  const img = PNG.sync.read(png);
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h);
  let filled = 0;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] > ALPHA_THRESHOLD) { mask[i] = 1; filled++; }
  }
  if (filled < 20) return null;

  const lattice = traceLargestRegion(mask, w, h);
  if (!lattice) return null;

  // Drop collinear lattice points, then take the midpoint of every edge.
  const corners = lattice.filter((p, i) => {
    const a = lattice[(i - 1 + lattice.length) % lattice.length];
    const b = lattice[(i + 1) % lattice.length];
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
  const mids = corners.map((p, i) => {
    const q = corners[(i + 1) % corners.length];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as [number, number];
  });

  const mx = (extent.maxX - extent.minX) / w;
  const my = (extent.maxY - extent.minY) / h;
  // Row 0 is the NORTH edge of the image.
  const utm = mids.map(([c, r]) => [extent.minX + c * mx, extent.maxY - r * my] as [number, number]);
  let simple = simplifyRing(utm, toleranceM);
  if (simple.length < 3) return null;
  if (insetM > 0) simple = insetRing(simple, insetM);
  return { ring: [...simple, simple[0]], areaSqm: ringArea(simple), vertices: simple.length };
}
