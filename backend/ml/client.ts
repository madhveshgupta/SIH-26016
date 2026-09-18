/** The platform's side of the prediction service. */
import { callIntegration } from "@backend/integrations/call";

const BASE = process.env.ML_SERVICE_URL ?? "http://localhost:8000";

export interface CaseFeatures {
  project_type: string;
  act: string;
  parcels: number;
  area_ha: number;
  owners: number;
  is_urban: number;
  circle_rate_per_ha: number;
  multiplier_factor: number;
  consent_pct: number;
  objections: number;
  digitised: number;
}

export interface PredictionFactor {
  feature: string;
  humanLabel: string;
  value: number;
  typicalValue: number;
  contribution: number;
  direction: "raises" | "lowers" | "neutral";
}

export interface CasePrediction {
  delayRisk: number;
  delayRiskBand: "LOW" | "MEDIUM" | "HIGH";
  expectedDelayDays: number;
  compensationPerHa: number;
  litigationRisk: number;
  anomalyScore: number;
  isAnomaly: boolean;
  factors: PredictionFactor[];
  modelVersion: string;
}

export interface ModelCard {
  version: string;
  trainedAt: string;
  rows: number;
  features: string[];
  dataset: { source: string; calibration: string[]; why_synthetic: string };
  models: Record<string, Record<string, unknown>>;
  importances: Record<string, Record<string, number>>;
}

async function post<T>(path: string, body: unknown, timeoutMs = 8000): Promise<T | null> {
  const result = await callIntegration<T>({
    system: "ML_SERVICE",
    endpoint: `${BASE}${path}`,
    method: "POST",
    request: body,
    attempts: 2,
    run: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${BASE}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Prediction service returned HTTP ${res.status}`);
        return { data: (await res.json()) as T, statusCode: res.status, source: "LIVE" as const };
      } finally {
        clearTimeout(timer);
      }
    },
  });
  return result.ok ? result.data : null;
}

/** Score one case. Null means the service could not be reached. */
export function predictCase(features: CaseFeatures): Promise<CasePrediction | null> {
  return post<CasePrediction>("/predict", features);
}

/** What a policy change would do across a portfolio. */
export function simulatePolicy(input: {
  cases: CaseFeatures[];
  multiplierFactor?: number;
  solatiumPct?: number;
  slaDays?: number;
  consentThresholdPct?: number;
}): Promise<{
  cases: number;
  compensation: { baseline: number; simulated: number; changePct: number };
  delayRisk: { baseline: number; simulated: number };
  expectedDelayDays: { baseline: number; simulated: number };
  slaBreachShare: number | null;
  modelVersion: string;
} | null> {
  return post("/simulate", input, 30_000);
}

/** The model card: metrics, training set and feature importances. */
export async function modelCard(): Promise<ModelCard | null> {
  const result = await callIntegration<ModelCard>({
    system: "ML_SERVICE",
    endpoint: `${BASE}/models`,
    method: "GET",
    attempts: 1,
    run: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${BASE}/models`, { signal: controller.signal });
        if (!res.ok) throw new Error(`Prediction service returned HTTP ${res.status}`);
        return { data: (await res.json()) as ModelCard, statusCode: res.status, source: "LIVE" as const };
      } finally {
        clearTimeout(timer);
      }
    },
  });
  return result.ok ? result.data : null;
}

/** Is the service reachable at all? Used by the integration monitor. */
export async function mlServiceHealth(): Promise<{ ok: boolean; modelVersion: string | null; rows: number }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${BASE}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, modelVersion: null, rows: 0 };
    const data = (await res.json()) as { ok: boolean; modelVersion: string | null; rows: number };
    return data;
  } catch {
    return { ok: false, modelVersion: null, rows: 0 };
  }
}
