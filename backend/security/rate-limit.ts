/** Rate limiting for the endpoints worth attacking. */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Swept lazily: this process should not hold yesterday's counters. */
function sweep(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(key);
}

export interface Limit {
  /** How many requests are allowed in the window. */
  max: number;
  /** Window length, in seconds. */
  windowSeconds: number;
}

export const LIMITS = {
  /** Six digits is a million possibilities; ten tries a minute makes that useless. */
  login: { max: 10, windowSeconds: 60 },
  otp: { max: 10, windowSeconds: 60 },
  /** A person filing an objection, not a script filing ten thousand. */
  citizenWrite: { max: 20, windowSeconds: 60 },
  /** Officers work faster, and bulk actions are legitimate. */
  officerWrite: { max: 120, windowSeconds: 60 },
  /** Reports and exports are expensive to produce. */
  export: { max: 30, windowSeconds: 300 },
} as const satisfies Record<string, Limit>;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Count one request against a key. */
export function rateLimit(key: string, limit: Limit): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowSeconds * 1000 });
    return { ok: true, remaining: limit.max - 1, retryAfterSeconds: 0 };
  }

  existing.count++;
  const remaining = Math.max(0, limit.max - existing.count);
  return {
    ok: existing.count <= limit.max,
    remaining,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** The caller's address, or null when the deployment does not tell us. */
export function clientAddress(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = req.headers.get("x-real-ip")?.trim();
  return forwarded || real || null;
}

/** For tests: forget every counter. */
export function resetRateLimits(): void {
  buckets.clear();
}
