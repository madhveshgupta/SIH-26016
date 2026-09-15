"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";
import ChoroplethGlobe from "./ChoroplethGlobe";
import type { GeoMetric, GeoRow } from "@backend/analytics/geo";
import { formatIndianScale } from "@backend/compensation/format";
import { useLocale, useT } from "@frontend/components/I18nProvider";
import type { Locale } from "@backend/i18n/meta";

interface Props {
  /** Metrics offered in the picker, in order. */
  metrics: { key: GeoMetric; label: string; format: string }[];
  initialMetric: GeoMetric;
  /** A state officer opens on their own state; they cannot zoom out past it. */
  lockedStateId?: string | null;
  lockedStateName?: string | null;
  height?: number;
  /** Where the figures come from. The front page uses the public, land-only endpoint. */
  source?: string;
}

type Level = "india" | "state";

interface BoundaryProps {
  name: string;
  key: string;
  state?: string;
  stateKey?: string;
}

/** Five steps for "some acquisition", low → high, plus slot 0 for "none". */
const RAMP = ["transparent", "#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"];

/** Must match the keys written by scripts/harvest-boundaries.ts. */
function normaliseName(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]/g, "");
}

/**
 * Break points by rank, not by value: land acquisition is extremely skewed —
 * one state can hold ten times the next — and equal-width bins would paint the
 * whole country the lightest step and one state the darkest.
 */
function quantileBreaks(values: number[], steps: number): number[] {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  return Array.from({ length: steps - 1 }, (_, i) => sorted[Math.floor(((i + 1) / steps) * (sorted.length - 1))]);
}

function formatValue(value: number, format: string, locale: Locale, intl: string, ha: string): string {
  if (format === "money") return formatIndianScale(value, locale);
  if (format === "pct") return `${Math.round(value)}%`;
  if (format === "area") return `${value.toLocaleString(intl, { maximumFractionDigits: 0 })} ${ha}`;
  return value.toLocaleString(intl);
}

export default function IndiaChoropleth({
  metrics,
  initialMetric,
  lockedStateId = null,
  lockedStateName = null,
  height = 460,
  source = "/api/analytics/geo",
}: Props) {
  const t = useT();
  const { locale, intl } = useLocale();
  const show = (value: number, fmt: string) => formatValue(value, fmt, locale, intl, t("screens.units.haShort"));
  const [metric, setMetric] = useState<GeoMetric>(initialMetric);
  const metricLabel = metrics.find((m) => m.key === metric)?.label ?? "";
  const [level, setLevel] = useState<Level>(lockedStateId ? "state" : "india");
  const [stateId, setStateId] = useState<string | null>(lockedStateId);
  const [stateName, setStateName] = useState<string | null>(lockedStateName);
  // Rows are stored with the state they belong to, so switching level shows
  // "loading" rather than the previous level's figures.
  const [loaded, setLoaded] = useState<{ forState: string | null; rows: GeoRow[] } | null>(null);
  // Boundaries carry the level they are for, so the map never colours one
  // level's shapes with another level's figures while a switch is in flight.
  const [boundaryData, setBoundaryData] = useState<{ forLevel: Level; forState: string | null; fc: FeatureCollection } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  // Figures for the level in view.
  useEffect(() => {
    let cancelled = false;
    fetch(`${source}${stateId ? `?stateId=${encodeURIComponent(stateId)}` : ""}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: GeoRow[] }) => !cancelled && setLoaded({ forState: stateId, rows: d.rows ?? [] }));
    return () => {
      cancelled = true;
    };
  }, [stateId, source]);

  const rows = loaded && loaded.forState === stateId ? loaded.rows : null;

  // Boundaries: the national state outlines, or one state's current district boundaries
  // (scripts/harvest-district-boundaries.ts).
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<FeatureCollection | null> => {
      if (level === "india") return fetch("/geo/india-states.json").then((r) => (r.ok ? r.json() : null));
      if (!stateName) return null;
      const stateKey = normaliseName(stateName);
      const own = await fetch(`/geo/districts/${stateKey}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (own) return own as FeatureCollection;
      const national = (await fetch("/geo/india-districts.json").then((r) => (r.ok ? r.json() : null))) as FeatureCollection | null;
      return national && { ...national, features: national.features.filter((f) => (f.properties as BoundaryProps)?.stateKey === stateKey) };
    };
    load().then((fc) => {
      if (!cancelled && fc) setBoundaryData({ forLevel: level, forState: stateId, fc });
    });
    return () => {
      cancelled = true;
    };
    // stateId only labels which drill this belongs to; the file depends on the level.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, stateName]);

  const boundaries = boundaryData && boundaryData.forLevel === level && boundaryData.forState === stateId ? boundaryData.fc : null;

  const byKey = useMemo(() => new Map((rows ?? []).map((r) => [r.key, r])), [rows]);
  const format = metrics.find((m) => m.key === metric)?.format ?? "count";
  const values = useMemo(() => (rows ?? []).map((r) => Number(r[metric] ?? 0)), [rows, metric]);
  const breaks = useMemo(() => quantileBreaks(values, RAMP.length), [values]);

  const colourFor = useCallback(
    (value: number) => {
      if (value <= 0) return RAMP[0];
      const step = breaks.findIndex((b) => value <= b);
      return RAMP[step === -1 ? RAMP.length - 1 : Math.min(step + 1, RAMP.length - 1)];
    },
    [breaks],
  );

  // Only regions with something recorded are filled; the rest stay clear
  // imagery, so the shaded places are the ones that carry acquisition.
  const fills = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) {
      const v = Number(r[metric] ?? 0);
      if (v > 0) m.set(r.key, colourFor(v));
    }
    return m;
  }, [rows, metric, colourFor]);

  const drillInto = (key: string) => {
    const row = byKey.get(key);
    if (level !== "india" || !row) return;
    setHover(null);
    setStateId(row.id);
    setStateName(row.name);
    setLevel("state");
  };

  const total = values.reduce((a, b) => a + b, 0);
  const hovered = hover ? byKey.get(hover) : null;
  const ranked = [...(rows ?? [])].sort((a, b) => Number(b[metric] ?? 0) - Number(a[metric] ?? 0));
  // A list of ninety districts reading "0" is not a ranking; show the ones with
  // something recorded, which is what the map is colouring.
  const withValue = ranked.filter((r) => Number(r[metric] ?? 0) > 0);
  const topValue = Number(withValue[0]?.[metric] ?? 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted">
          {t("screens.choro.colourBy")}{" "}
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as GeoMetric)}
            className="ml-1 h-8 rounded-lg border border-border bg-surface px-2 text-xs text-foreground"
          >
            {metrics.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>
        {level === "state" && !lockedStateId && (
          <button
            onClick={() => {
              setLevel("india");
              setStateId(null);
              setStateName(null);
            }}
            className="h-8 rounded-lg border border-border px-2.5 text-xs hover:bg-surface-muted"
          >
            {t("screens.choro.backIndia")}
          </button>
        )}
        <span className="text-xs font-medium text-foreground">{level === "india" ? t("screens.choro.allIndia") : t("screens.choro.stateDistricts", { state: stateName ?? "" })}</span>
        <button onClick={() => setShowTable((v) => !v)} className="ml-auto h-8 rounded-lg border border-border px-2.5 text-xs hover:bg-surface-muted">
          {showTable ? t("screens.choro.showMap") : t("screens.choro.showTable")}
        </button>
      </div>

      {showTable ? (
        // The table view is the accessible equal of the map: same numbers, no colour.
        <div className="max-h-[460px] overflow-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-muted text-left text-[11px] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{level === "india" ? t("common.state") : t("common.district")}</th>
                <th className="px-3 py-2 text-right font-medium">{metricLabel}</th>
                <th className="px-3 py-2 text-right font-medium">{t("nav.projects")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("screens.integ.colPlots")}</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium">{show(Number(r[metric] ?? 0), format)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted">{r.projects}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted">{r.parcels}</td>
                </tr>
              ))}
              {ranked.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">{t("screens.choro.noLand")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        // India and a single state are both roughly as tall as they are wide, so a full-width panel
        // leaves several hundred pixels of dead space on either side of the shape however well it
        // is fitted.
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        <div
          className="relative overflow-hidden rounded-xl border border-border"
          style={{ height }}
          data-level={level}
          data-features={boundaries?.features.length ?? 0}
        >
          <ChoroplethGlobe
            boundaries={boundaries}
            fills={fills}
            highlight={hover}
            fitKey={`${level}-${stateId ?? "india"}`}
            onHover={setHover}
            onPick={drillInto}
            height={height}
          />
          {(rows === null || boundaries === null) && (
            <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
              <span className="rounded bg-black/60 px-2 py-1 text-xs text-white">
                {boundaries === null ? t("screens.parcelPage.loadingMap") : t("screens.choro.loadingFigures")}
              </span>
            </div>
          )}
          {hovered && (
            <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-lg bg-surface/95 px-3 py-2 text-xs shadow-lg">
              <div className="font-semibold text-foreground">{hovered.name}</div>
              <div className="tabular-nums text-foreground">{show(Number(hovered[metric] ?? 0), format)}</div>
              <div className="text-[11px] text-muted">{t("screens.choro.hoverLine", { pct: hovered.possessedPct, risk: hovered.casesAtRisk })}</div>
              {level === "india" && <div className="mt-0.5 text-[11px] font-semibold text-brand">{t("screens.choro.openDistricts")}</div>}
            </div>
          )}
        </div>

        {/* The ranking, beside the map rather than hidden behind a toggle. */}
        <div className="hidden overflow-hidden rounded-xl border border-border lg:block" style={{ maxHeight: height }}>
          <div className="flex items-center justify-between border-b border-border bg-surface-muted px-3 py-2 text-[11px] text-muted">
            <span className="font-medium text-foreground">
              {t(level === "india" ? "screens.choro.rankStates" : "screens.choro.rankDistricts", { metric: metricLabel })}
            </span>
            <span>{t("screens.choro.withAcq", { count: withValue.length })}</span>
          </div>
          <div className="overflow-auto" style={{ maxHeight: height - 33 }}>
            {withValue.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted">{t("screens.choro.noLand")}</p>
            ) : (
              <ul>
                {withValue.map((r) => {
                  const value = Number(r[metric] ?? 0);
                  const share = topValue > 0 ? (value / topValue) * 100 : 0;
                  return (
                    <li
                      key={r.id}
                      onMouseEnter={() => setHover(r.key)}
                      onMouseLeave={() => setHover(null)}
                      className="border-b border-border px-3 py-1.5 last:border-0 hover:bg-surface-muted"
                    >
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate text-foreground">{r.name}</span>
                        <span className="shrink-0 tabular-nums font-medium text-foreground">
                          {show(value, format)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                          <span className="block h-full rounded-full bg-brand" style={{ width: `${share}%` }} />
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted">
                          {t(r.parcels === 1 ? "screens.globe.plotsOne" : "screens.globe.plotsMany", { count: r.parcels })}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        </div>
      )}

      {/* Legend: the ramp, with the break points it stands for. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          {RAMP.slice(1).map((v, i) => (
            <span
              key={v}
              className="h-3 w-6"
              style={{ background: v }}
              title={
                i < breaks.length
                  ? t("screens.choro.upTo", { v: show(breaks[i] ?? 0, format) })
                  : t("screens.choro.above", { v: show(breaks[breaks.length - 1] ?? 0, format) })
              }
            />
          ))}
          <span className="ml-1">{t("screens.choro.lowHigh")}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-6 border border-border" />
          {t("screens.choro.nothing")}
        </span>
        <span className="tabular-nums">{t("screens.choro.total", { v: show(total, format) })}</span>
        {level === "india" && <span>{t("screens.choro.clickState")}</span>}
        <span className="ml-auto">
          Imagery © Esri, Maxar · map © OpenStreetMap ·{" "}
          {t("screens.choro.boundariesRef", {
            source: (boundaries as { source?: string } | null)?.source?.startsWith("OpenStreetMap")
              ? "© OpenStreetMap contributors"
              : t("screens.choro.census"),
          })}
        </span>
      </div>
    </div>
  );
}
