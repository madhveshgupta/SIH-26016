/** Request-body hygiene for the write endpoints. */

/** Thrown for input the caller can fix; routes turn it into a 400. */
export class InvalidInput extends Error {}

/** An identifier: cuid-shaped, and safe to put in a query. */
export function id(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

/** Free text with no NUL or control characters, trimmed and length-bounded. */
export function text(v: unknown, { min = 1, max = 1000 }: { min?: number; max?: number } = {}): string | null {
  if (typeof v !== "string") return null;
  // Control characters, NUL included: PostgreSQL rejects them outright.
  if (/[\u0000-\u001F\u007F]/.test(v)) return null;
  const t = v.trim();
  return t.length >= min && t.length <= max ? t : null;
}

/** A real number — never an array, a boolean, or a blank string. */
export function num(v: unknown, { min = -Infinity, max = Infinity, int = false }: { min?: number; max?: number; int?: boolean } = {}): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim())) n = Number(v);
  else return null;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  if (int && !Number.isInteger(n)) return null;
  return n;
}

/**
 * India's bounding box with a margin — from Lakshadweep in the south-west to
 * Arunachal in the north-east, and the Andamans in the east.
 */
export const INDIA_BBOX = { minLng: 66, maxLng: 98, minLat: 5, maxLat: 38 } as const;

/** One [longitude, latitude] pair, inside India. GeoJSON order, not map order. */
export function lngLat(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const lng = num(v[0]);
  const lat = num(v[1]);
  if (lng == null || lat == null) return null;
  if (lng < INDIA_BBOX.minLng || lng > INDIA_BBOX.maxLng) return null;
  if (lat < INDIA_BBOX.minLat || lat > INDIA_BBOX.maxLat) return null;
  return [lng, lat];
}

/** A line of [longitude, latitude] points, inside India. */
export function lineString(v: unknown, { maxPoints = 200 }: { maxPoints?: number } = {}): [number, number][] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > maxPoints) return null;
  const out: [number, number][] = [];
  for (const p of v) {
    const pt = lngLat(p);
    if (!pt) return null;
    out.push(pt);
  }
  // A line that never moves is not a line.
  if (out.every(([lng, lat]) => lng === out[0][0] && lat === out[0][1])) return null;
  return out;
}

/** A latitude/longitude the map clicked, inside India. */
export function latLng(v: { lat?: unknown; lng?: unknown }): { lat: number; lng: number } | null {
  const pt = lngLat([v.lng, v.lat]);
  return pt ? { lat: pt[1], lng: pt[0] } : null;
}

const PRISMA_ERROR = /^PrismaClient/;

/** Turn a thrown value into a response. */
export function apiError(e: unknown, context: string): { status: number; error: string } {
  const name = e instanceof Error ? e.constructor.name : "";
  if (PRISMA_ERROR.test(name)) {
    console.error(`[${context}] ${name}:`, e instanceof Error ? e.message.split("\n")[0] : e);
    return { status: 500, error: "The system could not complete that action. Nothing has been changed." };
  }
  if (e instanceof Error) return { status: 400, error: e.message };
  console.error(`[${context}] unknown error:`, e);
  return { status: 500, error: "The system could not complete that action." };
}
