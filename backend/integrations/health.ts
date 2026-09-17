/** Integration health — is each external system reachable right now? */
import type { IntegrationSystem } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { portalFetch } from "@backend/integrations/http";
import { PORTALS } from "@backend/integrations/portals";

export interface HealthTarget {
  key: string;
  system: IntegrationSystem;
  name: string;
  stateLgd: string | null;
  url: string;
  method?: "GET" | "POST";
  body?: string;
  /** Does the response prove the service works (not just that a page loaded)? */
  valid: (status: number, text: string) => boolean;
}

export const HEALTH_TARGETS: HealthTarget[] = [
  ...PORTALS.map((p): HealthTarget =>
    p.kind === "assam"
      ? { key: `bhunaksha-${p.lgd}`, system: "CADASTRAL", name: `Bhu-Naksha — ${p.state}`, stateLgd: p.lgd, url: `${p.base}/bhunakshaBackEnd/proxy/districts`, valid: (s, t) => s === 200 && t.trim().startsWith("[") }
      : p.kind === "georef"
      ? { key: `bhunaksha-${p.lgd}`, system: "CADASTRAL", name: `Bhu-Naksha — ${p.state}`, stateLgd: p.lgd, url: `${p.base}/rest/Levels/LevelLabels`, method: "POST", body: `state=${p.lgd}`, valid: (s, t) => s === 200 && t.trim().startsWith("[") }
      : p.kind === "angular"
      ? { key: `bhunaksha-${p.lgd}`, system: "CADASTRAL", name: `Bhu-Naksha — ${p.state}`, stateLgd: p.lgd, url: `${p.base}/bhunakshaserver/Levels/levelLabels`, valid: (s, t) => s === 200 && t.trim().startsWith("[") }
      : { key: `bhunaksha-${p.lgd}`, system: "CADASTRAL", name: `Bhu-Naksha — ${p.state}`, stateLgd: p.lgd, url: `${p.base}/ScalarDatahandler?OP=2&state=${p.lgd}&level=2&selections=`, valid: (s, t) => s === 200 && /select|option|level_/i.test(t) },
  ),
  { key: "overpass", system: "OPEN_GIS", name: "OpenStreetMap Overpass (field boundaries)", stateLgd: null, url: "https://overpass-api.de/api/status", valid: (s, t) => s === 200 && /slots|Connected/i.test(t) },
  { key: "nominatim", system: "OPEN_GIS", name: "OpenStreetMap Nominatim (geocoding)", stateLgd: null, url: "https://nominatim.openstreetmap.org/status?format=json", valid: (s, t) => s === 200 && t.includes("OK") },
  { key: "open-meteo", system: "OPEN_GIS", name: "Open-Meteo elevation (boundary point heights)", stateLgd: null, url: "https://api.open-meteo.com/v1/elevation?latitude=27.12&longitude=78.07", valid: (s, t) => s === 200 && t.includes("elevation") },
  { key: "bhuvan", system: "OPEN_GIS", name: "ISRO Bhuvan imagery (WMS)", stateLgd: null, url: "https://bhuvan-vec1.nrsc.gov.in/bhuvan/wms?service=WMS&request=GetCapabilities", valid: (s) => s === 200 },
];

export interface HealthResult {
  key: string;
  name: string;
  system: IntegrationSystem;
  stateLgd: string | null;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: Date;
}

export async function runHealthChecks(): Promise<HealthResult[]> {
  return Promise.all(
    HEALTH_TARGETS.map(async (t) => {
      const started = Date.now();
      let statusCode: number | null = null, ok = false, error: string | null = null;
      try {
        const res = await portalFetch(t.url, { method: t.method, body: t.body, timeoutMs: 12_000, headers: t.system === "OPEN_GIS" ? { "User-Agent": "BhoomiNayan/1.0 (SIH PS 26016 demonstration)" } : undefined });
        statusCode = res.status;
        ok = t.valid(res.status, (await res.text()).slice(0, 4000));
        if (!ok) error = `unexpected response (HTTP ${res.status})`;
      } catch (e) {
        const cause = (e as { cause?: { code?: string } }).cause?.code;
        error = cause ?? (e instanceof Error ? (e.name === "AbortError" ? "timed out after 12 s" : e.message) : String(e));
      }
      const latencyMs = Date.now() - started;
      await prisma.integrationLog.create({
        data: { system: t.system, stateCode: t.stateLgd, endpoint: t.url, method: t.method ?? "GET", statusCode, latencyMs, success: ok, errorMessage: error, resolvedSource: "LIVE" },
      });
      return { key: t.key, name: t.name, system: t.system, stateLgd: t.stateLgd, ok, statusCode, latencyMs, error, checkedAt: new Date() };
    }),
  );
}

/** The latest logged result per target, without calling anything. */
export async function latestHealth(): Promise<(HealthResult | null)[]> {
  return Promise.all(
    HEALTH_TARGETS.map(async (t) => {
      const last = await prisma.integrationLog.findFirst({ where: { endpoint: t.url }, orderBy: { createdAt: "desc" } });
      if (!last) return null;
      return { key: t.key, name: t.name, system: t.system, stateLgd: t.stateLgd, ok: last.success, statusCode: last.statusCode, latencyMs: last.latencyMs, error: last.errorMessage, checkedAt: last.createdAt };
    }),
  );
}
