/** One wrapper around every outbound call to a government system. */
import type { IntegrationSystem } from "@prisma/client";
import { prisma } from "@backend/db/client";

export type Source = "LIVE" | "CACHED" | "SIMULATED";

export interface CallResult<T> {
  ok: boolean;
  data: T | null;
  source: Source;
  statusCode: number;
  latencyMs: number;
  error: string | null;
  retries: number;
}

export interface CallOptions<T> {
  system: IntegrationSystem;
  endpoint: string;
  method?: string;
  request?: unknown;
  stateCode?: string | null;
  /** Attempts in total, including the first. */
  attempts?: number;
  /** The work itself; throw to signal failure. */
  run: () => Promise<{ data: T; statusCode?: number; source?: Source }>;
  /** Decide whether a failure is worth retrying. Default: everything is. */
  retryable?: (e: unknown) => boolean;
}

/** Is this system talking to a real endpoint, or to its mock? */
export function modeFor(system: IntegrationSystem): "live" | "mock" {
  const env: Partial<Record<IntegrationSystem, string | undefined>> = {
    LAND_RECORDS: process.env.LAND_RECORDS_MODE,
    PAYMENTS: process.env.PAYMENTS_MODE,
    E_GAZETTE: process.env.EGAZETTE_MODE,
    SMS_GATEWAY: process.env.SMS_MODE,
    EMAIL: process.env.EMAIL_MODE,
    // Unlike the department systems, this one we run ourselves, so it is a real service by default.
    ML_SERVICE: process.env.ML_SERVICE_MODE ?? "live",
    CADASTRAL: process.env.CADASTRAL_LIVE_ENABLED === "true" ? "live" : "mock",
    OPEN_GIS: "live",
  };
  return (env[system] ?? "mock") === "live" ? "live" : "mock";
}

/** Run an integration call, logging it whatever happens. */
export async function callIntegration<T>(opts: CallOptions<T>): Promise<CallResult<T>> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const started = Date.now();
  let lastError: unknown = null;
  let retries = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { data, statusCode = 200, source } = await opts.run();
      const result: CallResult<T> = {
        ok: true,
        data,
        source: source ?? (modeFor(opts.system) === "live" ? "LIVE" : "SIMULATED"),
        statusCode,
        latencyMs: Date.now() - started,
        error: null,
        retries,
      };
      await log(opts, result);
      return result;
    } catch (e) {
      lastError = e;
      const worthRetrying = opts.retryable ? opts.retryable(e) : true;
      if (!worthRetrying || attempt === attempts) break;
      retries++;
      await new Promise((r) => setTimeout(r, 120 * attempt));
    }
  }

  const result: CallResult<T> = {
    ok: false,
    data: null,
    source: modeFor(opts.system) === "live" ? "LIVE" : "SIMULATED",
    statusCode: (lastError as { statusCode?: number })?.statusCode ?? 502,
    latencyMs: Date.now() - started,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    retries,
  };
  await log(opts, result);
  return result;
}

async function log<T>(opts: CallOptions<T>, result: CallResult<T>): Promise<void> {
  try {
    await prisma.integrationLog.create({
      data: {
        system: opts.system,
        stateCode: opts.stateCode ?? null,
        endpoint: opts.endpoint,
        method: opts.method ?? "POST",
        // Never log a whole payload: these carry names, bank accounts and Aadhaar-like identifiers.
        requestJson: (opts.request ?? undefined) as never,
        responseJson: (result.data ?? undefined) as never,
        statusCode: result.statusCode,
        latencyMs: result.latencyMs,
        success: result.ok,
        errorMessage: result.error,
        retryCount: result.retries,
        resolvedSource: result.source,
      },
    });
  } catch {
    // A logging failure must never take down the call it was logging.
  }
}

/** Recent traffic for the integration monitor. */
export async function recentCalls(limit = 50) {
  return prisma.integrationLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

/** Per-system rollup: volume, failures and latency, for the monitor. */
export async function integrationSummary(sinceHours = 24) {
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const rows = await prisma.integrationLog.groupBy({
    by: ["system", "success"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _avg: { latencyMs: true },
  });
  const summary = new Map<string, { system: string; calls: number; failures: number; avgLatencyMs: number }>();
  for (const r of rows) {
    const s = summary.get(r.system) ?? { system: r.system, calls: 0, failures: 0, avgLatencyMs: 0 };
    const n = r._count._all;
    // Weighted so the average is over all calls, not over the two groups.
    s.avgLatencyMs = (s.avgLatencyMs * s.calls + (r._avg.latencyMs ?? 0) * n) / (s.calls + n);
    s.calls += n;
    if (!r.success) s.failures += n;
    summary.set(r.system, s);
  }
  return [...summary.values()].map((s) => ({ ...s, avgLatencyMs: Math.round(s.avgLatencyMs) }));
}
