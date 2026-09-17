import type { Metadata } from "next";
import { existsSync, readFileSync } from "node:fs";
import { Activity, CheckCircle2, Database, Globe2, Plug, XCircle } from "lucide-react";
import { requirePermission } from "@backend/rbac/guard";
import { prisma } from "@backend/db/client";
import { HEALTH_TARGETS, latestHealth } from "@backend/integrations/health";
import { integrationSummary, modeFor, recentCalls } from "@backend/integrations/call";
import { Badge, Card, CardBody, CardHeader, PageHeader, StatTile } from "@frontend/components/ui";
import type { Tone } from "@frontend/components/ui/Badge";
import RunChecksButton from "./RunChecksButton";
import { getTranslator } from "@backend/i18n/locale";
import type { MessageKey } from "@backend/i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("nav.integrations") };
}

/** Every external system the platform integrates with; names and purposes are screens.integ.name_/purpose_<SYSTEM>. */
const ADAPTERS = [
  "CADASTRAL", "LAND_RECORDS", "PAYMENTS", "E_GAZETTE", "SMS_GATEWAY", "EMAIL", "ML_SERVICE", "OPEN_GIS",
] as const;

/** Where a state's boundaries come from; the wording is screens.integ.tier_<KIND>. */
const TIER_TONE: Record<string, Tone> = { TRACED: "success", OSM_FIELD: "info", GENERATED: "warning" };

/** The health check's own key, as its dictionary entry. */
const HEALTH_KEY: Record<string, MessageKey> = {
  overpass: "screens.integ.hk_overpass",
  nominatim: "screens.integ.hk_nominatim",
  "open-meteo": "screens.integ.hk_openMeteo",
  bhuvan: "screens.integ.hk_bhuvan",
};

export default async function IntegrationsPage() {
  await requirePermission("integration", "read");
  const { t, intl } = await getTranslator();
  const tk = (key: string) => t(key as MessageKey);
  const num = (n: number) => n.toLocaleString(intl);
  const ms = (n: number | null | undefined) => (n == null ? "—" : t("screens.integ.ms", { n }));
  const when = (d: Date) => d.toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" });
  const systemName = (system: string) => (ADAPTERS as readonly string[]).includes(system) ? tk(`screens.integ.name_${system}`) : system;
  const targetName = (target: { key: string; name: string }) =>
    target.key.startsWith("bhunaksha-")
      ? t("screens.integ.hk_bhunaksha", { state: target.name.split(" — ")[1] ?? target.name })
      : HEALTH_KEY[target.key] ? t(HEALTH_KEY[target.key]) : target.name;
  const [health, states, byState, summary, calls] = await Promise.all([
    latestHealth(),
    prisma.state.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, lgdCode: true, isUT: true } }),
    prisma.$queryRaw<{ lgd: string; kind: string; n: bigint }[]>`
      SELECT s."lgdCode" AS lgd, p."geometryKind"::text AS kind, count(*)::bigint AS n
        FROM "LandParcel" p JOIN "District" d ON d.id = p."districtId" JOIN "State" s ON s.id = d."stateId"
       GROUP BY 1, 2;`,
    integrationSummary(24 * 7),
    recentCalls(25),
  ]);

  const portalProfile = (lgd: string) => {
    const f = `prisma/data/portals/${lgd}.json`;
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { ok: boolean; reason?: string; failedAt?: string; srid?: number }) : null;
  };
  const checked = health.filter(Boolean);
  const up = checked.filter((h) => h!.ok).length;
  const tiers = { TRACED: 0, OSM_FIELD: 0, GENERATED: 0 } as Record<string, number>;
  for (const r of byState) tiers[r.kind] = (tiers[r.kind] ?? 0) + Number(r.n);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("pages.integrationsTitle")}
        description={t("pageDesc.integrations")}
        crumbs={[{ label: t("crumbs.administration") }, { label: t("pages.integrationsTitle") }]}
        actions={<RunChecksButton />}
      />

      <Card>
        <CardHeader
          title={t("screens.integ.systemsTitle")}
          description={t("screens.integ.systemsDesc")}
          icon={<Plug className="h-4 w-4" />}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-2.5 text-left font-semibold">{t("screens.integ.colSystem")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("screens.integ.colWhat")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("screens.integ.colMode")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{t("screens.integ.colCalls")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{t("screens.integ.colFailed")}</th>
                <th className="px-5 py-2.5 text-right font-semibold">{t("screens.integ.colLatency")}</th>
              </tr>
            </thead>
            <tbody>
              {ADAPTERS.map((system) => {
                const stats = summary.find((x) => x.system === system);
                const mode = modeFor(system);
                return (
                  <tr key={system} className="border-t border-border">
                    <td className="px-5 py-2.5 font-medium text-foreground">{systemName(system)}</td>
                    <td className="px-3 py-2.5 text-xs text-muted">{tk(`screens.integ.purpose_${system}`)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={mode === "live" ? "success" : "warning"}>{mode === "live" ? t("screens.integ.live") : t("screens.integ.mock")}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{stats?.calls ?? 0}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${stats?.failures ? "font-medium text-danger" : "text-muted"}`}>{stats?.failures ?? 0}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted">{stats?.calls ? ms(stats.avgLatencyMs) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <CardBody className="border-t border-border text-xs text-muted">
          {t("screens.integ.adaptersNote")}
        </CardBody>
      </Card>

      {calls.length > 0 && (
        <Card>
          <CardHeader title={t("screens.integ.recentTitle")} description={t("screens.integ.recentDesc")} icon={<Activity className="h-4 w-4" />} />
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="sticky top-0 bg-surface-muted text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2 text-left font-semibold">{t("screens.integ.colWhen")}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t("screens.integ.colSystem")}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t("screens.integ.colEndpoint")}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t("screens.integ.colSource")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("screens.integ.colLatencyShort")}</th>
                  <th className="px-5 py-2 text-left font-semibold">{t("screens.integ.colOutcome")}</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-5 py-1.5 whitespace-nowrap text-muted">{when(c.createdAt)}</td>
                    <td className="px-3 py-1.5">{systemName(c.system)}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">{c.method} {c.endpoint}</td>
                    <td className="px-3 py-1.5">{c.resolvedSource ? tk(`screens.integ.src_${c.resolvedSource}`) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{ms(c.latencyMs)}</td>
                    <td className="px-5 py-1.5">
                      {c.success ? (
                        <span className="text-success">
                          {t("screens.integ.ok", { code: c.statusCode ?? "" })}
                          {c.retryCount ? ` · ${t("screens.integ.retries", { count: c.retryCount })}` : ""}
                        </span>
                      ) : (
                        <span className="text-danger">{c.statusCode} {c.errorMessage?.slice(0, 60)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("screens.integ.reachable")} value={checked.length ? `${up} / ${HEALTH_TARGETS.length}` : t("screens.integ.notCheckedYet")} hint={checked.length ? t("screens.integ.lastChecked", { when: when(checked[0]!.checkedAt) }) : t("screens.integ.pressRun")} icon={<Activity className="h-4 w-4" />} tone={up === HEALTH_TARGETS.length ? "success" : "warning"} />
        <StatTile label={t("screens.integ.fromCadastre")} value={num(tiers.TRACED)} hint={t("screens.integ.fromCadastreHint")} icon={<Database className="h-4 w-4" />} tone="success" />
        <StatTile label={t("screens.integ.fromOsm")} value={num(tiers.OSM_FIELD)} hint={t("screens.integ.fromOsmHint")} icon={<Globe2 className="h-4 w-4" />} tone="info" />
        <StatTile label={t("screens.integ.generated")} value={num(tiers.GENERATED)} hint={t("screens.integ.generatedHint")} icon={<Globe2 className="h-4 w-4" />} tone="warning" />
      </div>

      <Card>
        <CardHeader title={t("screens.integ.liveTitle")} description={t("screens.integ.liveDesc")} icon={<Activity className="h-4 w-4" />} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-2.5 text-left font-semibold">{t("screens.integ.colSystem")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("common.status")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{t("screens.integ.colLatencyShort")}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("screens.integ.colDetail")}</th>
                <th className="px-5 py-2.5 text-right font-semibold">{t("screens.integ.colChecked")}</th>
              </tr>
            </thead>
            <tbody>
              {HEALTH_TARGETS.map((target, i) => {
                const h = health[i];
                return (
                  <tr key={target.key} className="border-t border-border">
                    <td className="px-5 py-2.5">
                      <div className="font-medium">{targetName(target)}</div>
                      <div className="max-w-[340px] truncate font-mono text-[11px] text-muted">{new URL(target.url).host}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {!h ? (
                        <Badge>{t("screens.integ.notChecked")}</Badge>
                      ) : h.ok ? (
                        <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>{t("screens.integ.up")}</Badge>
                      ) : (
                        <Badge tone="danger" icon={<XCircle className="h-3 w-3" />}>{t("screens.integ.down")}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{ms(h?.latencyMs)}</td>
                    <td className="px-3 py-2.5 text-xs text-muted">{h?.error ?? (h ? `HTTP ${h.statusCode}` : "")}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-muted">{h ? h.checkedAt.toLocaleTimeString(intl) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("screens.integ.coverageTitle")} description={t("screens.integ.coverageDesc")} icon={<Globe2 className="h-4 w-4" />} />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2.5 text-left font-semibold">{t("screens.integ.colState")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("screens.plotRecord.boundarySource")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("screens.integ.colPlots")}</th>
                  <th className="px-5 py-2.5 text-left font-semibold">{t("screens.integ.colVerification")}</th>
                </tr>
              </thead>
              <tbody>
                {states.map((st) => {
                  const rows = byState.filter((r) => r.lgd === st.lgdCode);
                  const total = rows.reduce((a, r) => a + Number(r.n), 0);
                  const main = [...rows].sort((a, b) => Number(b.n) - Number(a.n))[0];
                  const prof = portalProfile(st.lgdCode);
                  return (
                    <tr key={st.id} className="border-t border-border">
                      <td className="px-5 py-2 font-medium">{st.name}{st.isUT && <span className="ml-1 text-xs text-muted">{t("screens.integ.ut")}</span>}</td>
                      <td className="px-3 py-2">{main ? (
                          <Badge tone={TIER_TONE[main.kind] ?? "neutral"}>{TIER_TONE[main.kind] ? tk(`screens.integ.tier_${main.kind}`) : main.kind}</Badge>
                        ) : (
                          <span className="text-xs text-muted">{t("screens.integ.noLand")}</span>
                        )}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{total || "—"}</td>
                      <td className="px-5 py-2 text-xs">
                        {!prof ? (
                          <span className="text-muted">{t("screens.integ.noPortal")}</span>
                        ) : prof.ok ? (
                          <span className="text-success">{t("screens.integ.verified", { srid: prof.srid ?? "" })}</span>
                        ) : (
                          // The portal's own diagnostic, as the verification script recorded it.
                          <span className="text-warning">{t("screens.integ.notUsable", { reason: prof.reason ?? prof.failedAt ?? "" })}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
