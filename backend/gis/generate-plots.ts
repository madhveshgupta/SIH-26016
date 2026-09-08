/**
 * Tier 3 land: GENERATED plots, used only where neither a cadastral portal nor OpenStreetMap
 * offers real boundaries for a place.
 */

export interface GeneratedPlot {
  /** Closed ring, [lng, lat]. */
  ring: [number, number][];
  chainageM: number;
  side: "L" | "R";
}

/** Mulberry32 — small, fast, deterministic. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generatePlots(opts: {
  seed: string;
  centre: { lat: number; lng: number };
  lengthM?: number;
  maxPlots?: number;
  bearingDeg?: number;
}): { plots: GeneratedPlot[]; centreline: [number, number][] } {
  const r = rng(opts.seed);
  const length = opts.lengthM ?? 1100;
  const bearing = ((opts.bearingDeg ?? r() * 180) * Math.PI) / 180;
  const ux = Math.sin(bearing), uy = Math.cos(bearing); // along (east, north)
  const vx = uy, vy = -ux; // across
  const kx = 111_320 * Math.cos((opts.centre.lat * Math.PI) / 180);
  const ky = 110_574;
  const toLngLat = (a: number, c: number): [number, number] => {
    const x = a * ux + c * vx;
    const y = a * uy + c * vy;
    return [Number((opts.centre.lng + x / kx).toFixed(7)), Number((opts.centre.lat + y / ky).toFixed(7))];
  };

  const plots: GeneratedPlot[] = [];
  for (const side of ["L", "R"] as const) {
    const sign = side === "L" ? -1 : 1;
    // Division lines along the alignment: position at the road edge and a tilt
    // so the far end sits elsewhere — real plot lines are rarely perpendicular.
    const divisions: { near: number; far: number }[] = [];
    let pos = -length / 2;
    while (pos < length / 2) {
      const tilt = (r() - 0.5) * 30;
      divisions.push({ near: pos, far: pos + tilt });
      pos += 28 + r() * 70; // plot frontage 28–98 m
    }
    for (let i = 0; i < divisions.length - 1; i++) {
      const a = divisions[i], b = divisions[i + 1];
      const depth = 70 + r() * 150; // 70–220 m deep
      const nearOff = 0;
      const farOff = sign * depth;
      const ring: [number, number][] = [
        toLngLat(a.near, nearOff),
        toLngLat(b.near, nearOff),
        // An occasional bend in the back boundary makes a pentagon.
        ...(r() < 0.35 ? [toLngLat((b.near + b.far) / 2 + (r() - 0.5) * 12, sign * depth * (0.55 + r() * 0.2))] : []),
        toLngLat(b.far, farOff),
        toLngLat(a.far, farOff * (0.85 + r() * 0.3)),
      ];
      ring.push(ring[0]);
      plots.push({ ring, chainageM: Math.round(a.near + length / 2), side });
    }
  }
  plots.sort((p, q) => p.chainageM - q.chainageM);
  return {
    plots: plots.slice(0, opts.maxPlots ?? 40),
    centreline: [toLngLat(-length / 2, 0), toLngLat(length / 2, 0)],
  };
}
