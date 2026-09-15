"use client";

/**
 * The route as one bar, km 0 to the end, coloured by whether each stretch can
 * be built on today — and, for every gap, which plots are holding it up and
 * how much continuous road settling them would give.
 */
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, TriangleAlert } from "lucide-react";
import type { CorridorPlot, CorridorReadiness as Data, CorridorReason, Gap, Segment, SegmentState } from "@backend/projects/corridor";
import type { MessageKey } from "@backend/i18n/types";
import { cn } from "@frontend/lib/cn";
import { rich } from "@frontend/lib/rich";
import { useLocale, useT } from "@frontend/components/I18nProvider";

type T = ReturnType<typeof useT>;

/** Colours; the words come from screens.corridor.<STATE> and <STATE>_short. */
const STATE: Record<SegmentState, { fill: string }> = {
  READY: { fill: "var(--corridor-ready)" },
  PAID: { fill: "var(--corridor-paid)" },
  IN_PROCESS: { fill: "var(--corridor-process)" },
  BLOCKED: { fill: "var(--corridor-blocked)" },
  UNMAPPED: { fill: "var(--surface-muted)" },
};
const stateLabel = (t: T, s: SegmentState) => t(`screens.corridor.${s}` as MessageKey);
const stateShort = (t: T, s: SegmentState) => t(`screens.corridor.${s}_short` as MessageKey);
/** One/many forms: each language words its own plural. */
const count = (t: T, n: number, one: string, many: string, vars: Record<string, string | number> = {}) =>
  t(`screens.corridor.${n === 1 ? one : many}` as MessageKey, { count: n, ...vars });
const ORDER: SegmentState[] = ["READY", "PAID", "IN_PROCESS", "BLOCKED", "UNMAPPED"];

/** Hatching is the second channel: blocked and unmapped never rely on colour alone. */
const TEXTURE: Partial<Record<SegmentState, string>> = {
  BLOCKED: "repeating-linear-gradient(135deg, rgba(255,255,255,0.45) 0 2px, transparent 2px 6px)",
  UNMAPPED: "repeating-linear-gradient(45deg, var(--border) 0 1.5px, transparent 1.5px 6px)",
};

/** Engineering chainage: km 1+240. */
export const chainage = (m: number) => `km ${Math.floor(m / 1000)}+${String(Math.round(m) % 1000).padStart(3, "0")}`;
const length = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);

/** A reason a plot is not in hand, in the reader's language, dates in their calendar words. */
function reasonText(t: T, intl: string, r: CorridorReason): string {
  const day = (iso: string) => new Date(iso).toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric" });
  switch (r.code) {
    case "objectionHeard":
      return t("screens.corridorReason.objectionHeard", { filed: day(r.filed), hearing: day(r.hearing) });
    case "objectionPending":
      return t("screens.corridorReason.objectionPending", { filed: day(r.filed) });
    case "status": {
      const key = `screens.corridorReason.status_${r.status}` as MessageKey;
      const text = t(key);
      return text === key ? r.status : text;
    }
    default:
      return t(`screens.corridorReason.${r.code}` as MessageKey);
  }
}

function tickStep(L: number) {
  return [50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000].find((s) => L / s <= 6) ?? 100000;
}

export default function CorridorReadiness({ data, roleLabels }: { data: Data; roleLabels: Record<string, string> }) {
  const t = useT();
  const L = data.lengthM;
  const plotById = useMemo(() => new Map(data.plots.map((p) => [p.id, p])), [data.plots]);
  const ranked = useMemo(() => [...data.gaps].sort((a, b) => a.rank - b.rank), [data.gaps]);
  const [openGap, setOpenGap] = useState<number | null>(ranked[0]?.rank ?? null);
  const [hoverSeg, setHoverSeg] = useState<number | null>(null);
  const [hoverPlot, setHoverPlot] = useState<string | null>(null);

  const longestLen = data.longest ? data.longest.toM - data.longest.fromM : 0;
  const pct = (m: number) => (L ? (m / L) * 100 : 0);
  const selected = ranked.find((g) => g.rank === openGap) ?? null;
  const highlight = hoverPlot ? plotById.get(hoverPlot) : null;
  const step = tickStep(L);
  const ticks = Array.from({ length: Math.floor(L / step) + 1 }, (_, i) => i * step).filter((m) => L - m > step * 0.6 || m === 0);
  const after = data.longestAfterPossession;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {t("screens.corridor.title")} <span className="font-normal normal-case">{t("screens.corridor.titleSub")}</span>
      </h2>

      {/* The headline: continuous length, not percentage acquired. */}
      <p className="mt-3 text-base font-semibold tracking-tight">
        {data.longest ? (
          <>
            {t("screens.corridor.headline", { built: length(longestLen), total: length(L) })}{" "}
            <span className="font-normal text-muted">
              {t("screens.corridor.headlineSub", { from: chainage(data.longest.fromM), to: chainage(data.longest.toM) })}
            </span>
          </>
        ) : (
          <>
            {t("screens.corridor.noneYet", { total: length(L) })}{" "}
            <span className="font-normal text-muted">{t("screens.corridor.noneYetSub")}</span>
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-muted">
        {data.totals.READY > 0 && data.stretches.length > 1 && (
          <>
            {t("screens.corridor.pieces", { ready: length(data.totals.READY), pct: Math.round(pct(data.totals.READY)), pieces: data.stretches.length })}{" "}
          </>
        )}
        {data.totals.BLOCKED > 0 && (
          <>
            {count(t, data.segments.filter((x) => x.state === "BLOCKED").length, "blockedOne", "blockedMany", { length: length(data.totals.BLOCKED) })}{" "}
          </>
        )}
        {after && after.toM - after.fromM > longestLen && (
          <>
            {rich(t(`screens.corridor.${after.plots === 1 ? "afterOne" : "afterMany"}` as MessageKey, { count: after.plots }), {
              length: <span className="font-medium text-foreground">{length(after.toM - after.fromM)}</span>,
            })}
          </>
        )}
      </p>

      {/* The strip */}
      <div className="relative mt-4 select-none pt-7" onMouseLeave={() => setHoverSeg(null)}>
        {data.longest && (
          <div
            className="absolute top-0 flex flex-col items-center"
            style={{ left: `${pct(data.longest.fromM)}%`, width: `${pct(longestLen)}%` }}
          >
            <span className="whitespace-nowrap text-[10px] font-medium text-foreground">
              {longestLen / L > 0.12 ? t("screens.corridor.buildable", { length: length(longestLen) }) : length(longestLen)}
            </span>
            <span className="mt-0.5 h-1.5 w-full rounded-t-sm border-x-2 border-t-2 border-foreground/70" />
          </div>
        )}

        <div className="relative h-9 rounded-md bg-surface-muted" role="img" aria-label={stripSummary(t, data)}>
          {data.segments.map((s, i) => {
            const last = i === data.segments.length - 1;
            const w = pct(s.toM - s.fromM);
            const blockedIcon = s.state === "BLOCKED";
            return (
              <button
                key={i}
                type="button"
                aria-label={t("screens.corridor.segmentAria", { from: chainage(s.fromM), to: chainage(s.toM), state: stateLabel(t, s.state) })}
                onMouseEnter={() => setHoverSeg(i)}
                onFocus={() => setHoverSeg(i)}
                onBlur={() => setHoverSeg(null)}
                onClick={() => {
                  const g = ranked.find((x) => x.fromM <= s.fromM && x.toM >= s.toM);
                  if (g) setOpenGap(g.rank);
                }}
                className={cn(
                  "absolute inset-y-0 outline-none focus-visible:ring-2 focus-visible:ring-foreground",
                  i === 0 && "rounded-l-md",
                  last && "rounded-r-md",
                  hoverSeg === i && "brightness-110",
                )}
                style={{
                  left: `${pct(s.fromM)}%`,
                  width: last ? `${w}%` : `max(calc(${w}% - 2px), ${s.state === "BLOCKED" ? 4 : 1}px)`,
                  background: s.state === "UNMAPPED" ? `${TEXTURE.UNMAPPED}, ${STATE.UNMAPPED.fill}` : TEXTURE[s.state] ? `${TEXTURE[s.state]}, ${STATE[s.state].fill}` : STATE[s.state].fill,
                }}
              >
                {blockedIcon && (
                  <TriangleAlert
                    aria-hidden
                    className="absolute -top-5 left-1/2 h-3.5 w-3.5 -translate-x-1/2 text-danger"
                    strokeWidth={2.25}
                  />
                )}
              </button>
            );
          })}

          {/* The gap chosen below, outlined on the strip. */}
          {selected && (
            <div
              className="pointer-events-none absolute -inset-y-1 rounded-md ring-2 ring-foreground"
              style={{ left: `${pct(selected.fromM)}%`, width: `${pct(selected.toM - selected.fromM)}%` }}
            />
          )}
          {highlight && (
            <div
              className="pointer-events-none absolute -inset-y-1.5 rounded-sm border-2 border-dashed border-foreground bg-foreground/10"
              style={{ left: `${pct(highlight.fromM)}%`, width: `max(${pct(highlight.toM - highlight.fromM)}%, 3px)` }}
            />
          )}
        </div>

        {hoverSeg != null && data.segments[hoverSeg] && (
          <SegmentTip segment={data.segments[hoverSeg]} L={L} plotById={plotById} />
        )}

        {/* Axis */}
        <div className="relative mt-1 h-4 text-[10px] tabular-nums text-muted">
          {ticks.map((m, i) => (
            // Every other tick drops on a phone, so labels never collide.
            <span key={m} className={cn("absolute -translate-x-1/2 first:translate-x-0", i % 2 === 1 && "max-sm:hidden")} style={{ left: `${pct(m)}%` }}>
              {chainage(m)}
            </span>
          ))}
          <span className="absolute right-0">{chainage(L)}</span>
        </div>
      </div>

      {/* Legend, with how much of the route each state covers. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
        {ORDER.filter((k) => data.totals[k] > 0 || k !== "UNMAPPED").map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span
              className="h-3 w-4 rounded-sm border border-border"
              style={{ background: TEXTURE[k] ? `${TEXTURE[k]}, ${STATE[k].fill}` : STATE[k].fill }}
            />
            {k === "BLOCKED" && <TriangleAlert aria-hidden className="h-3 w-3 text-danger" />}
            <span>{stateShort(t, k)}</span>
            <span className="tabular-nums text-muted">{length(data.totals[k])}</span>
          </li>
        ))}
      </ul>

      {/* What to do about it */}
      {ranked.length > 0 && (
        <div className="mt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("screens.corridor.whatUnblocks")} <span className="font-normal normal-case">{t("screens.corridor.whatUnblocksSub")}</span>
          </h3>
          <div className="mt-2 space-y-2">
            {ranked.map((g) => (
              <GapCard
                key={g.rank}
                gap={g}
                only={ranked.length === 1}
                open={openGap === g.rank}
                onToggle={() => setOpenGap(openGap === g.rank ? null : g.rank)}
                longestLen={longestLen}
                plotById={plotById}
                roleLabels={roleLabels}
                onHoverPlot={setHoverPlot}
              />
            ))}
          </div>
        </div>
      )}

      <details className="mt-4 text-[11px]">
        <summary className="cursor-pointer text-muted hover:text-foreground">{t("screens.corridor.asTable")}</summary>
        <table className="mt-2 w-full max-w-xl">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
              <th className="pb-1 font-medium">{t("screens.corridor.colFrom")}</th>
              <th className="pb-1 font-medium">{t("screens.corridor.colTo")}</th>
              <th className="pb-1 text-right font-medium">{t("screens.corridor.colLength")}</th>
              <th className="pb-1 pl-4 font-medium">{t("screens.corridor.colState")}</th>
              <th className="pb-1 text-right font-medium">{t("screens.corridor.colNotInHand")}</th>
            </tr>
          </thead>
          <tbody>
            {data.segments.map((s, i) => (
              <tr key={i} className="border-t border-border tabular-nums">
                <td className="py-1">{chainage(s.fromM)}</td>
                <td className="py-1">{chainage(s.toM)}</td>
                <td className="py-1 text-right">{length(s.toM - s.fromM)}</td>
                <td className="py-1 pl-4">{stateLabel(t, s.state)}</td>
                <td className="py-1 text-right">{s.plotIds.length || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="mt-3 text-[10px] text-muted">
        {t("screens.corridor.footnote")}
        {data.unplaced > 0 && ` ${count(t, data.unplaced, "unplacedOne", "unplacedMany")}`}
      </p>
    </section>
  );
}

function stripSummary(t: T, d: Data) {
  const parts = ORDER.filter((k) => d.totals[k] > 0).map((k) => `${stateShort(t, k)} ${length(d.totals[k])}`);
  return t("screens.corridor.stripSummary", { length: length(d.lengthM), parts: parts.join(", ") });
}

function SegmentTip({ segment: s, L, plotById }: { segment: Segment; L: number; plotById: Map<string, CorridorPlot> }) {
  const t = useT();
  const { intl } = useLocale();
  const mid = ((s.fromM + s.toM) / 2 / L) * 100;
  const plots = s.plotIds.map((id) => plotById.get(id)).filter((p): p is CorridorPlot => !!p);
  return (
    <div
      className="pointer-events-none absolute top-[4.25rem] z-10 w-60 rounded-md border border-border bg-surface p-2.5 text-[11px] shadow-lg"
      style={{ left: `clamp(0px, calc(${mid}% - 7.5rem), calc(100% - 15rem))` }}
    >
      <div className="font-medium tabular-nums">
        {chainage(s.fromM)} – {chainage(s.toM)} <span className="font-normal text-muted">· {length(s.toM - s.fromM)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-sm" style={{ background: STATE[s.state].fill }} />
        {stateLabel(t, s.state)}
      </div>
      {plots.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-t border-border pt-1.5 text-muted">
          {plots.slice(0, 6).map((p) => (
            <li key={p.id}>
              <span className="font-mono text-foreground">{p.khasraNo ?? "—"}</span> {p.reasons[0] && reasonText(t, intl, p.reasons[0])}
            </li>
          ))}
          {plots.length > 6 && <li>{t("screens.corridor.andMore", { count: plots.length - 6 })}</li>}
        </ul>
      )}
    </div>
  );
}

const READINESS_ORDER = { BLOCKED: 0, IN_PROCESS: 1, PAID: 2, READY: 3 } as const;
/** Blocked plots sort first, so the cap never hides one of them behind routine cases. */
const ROW_CAP = 8;

function GapCard({
  gap: g, only, open, onToggle, longestLen, plotById, roleLabels, onHoverPlot,
}: {
  gap: Gap;
  only: boolean;
  open: boolean;
  onToggle: () => void;
  longestLen: number;
  plotById: Map<string, CorridorPlot>;
  roleLabels: Record<string, string>;
  onHoverPlot: (id: string | null) => void;
}) {
  const t = useT();
  const { intl } = useLocale();
  const plots = g.blockers
    .map((id) => plotById.get(id))
    .filter((p): p is CorridorPlot => !!p)
    .sort((a, b) => READINESS_ORDER[a.readiness] - READINESS_ORDER[b.readiness] || a.fromM - b.fromM);
  const best = g.rank === 1 && g.gainM > 0 && !only;
  const [all, setAll] = useState(false);
  const shown = all ? plots : plots.slice(0, ROW_CAP);
  // One line per file: the plots on a proposal share its desk.
  const desks = [
    ...plots
      .reduce((m, p) => {
        if (p.desk) m.set(p.desk.proposalId, { ...p.desk, plots: (m.get(p.desk.proposalId)?.plots ?? 0) + 1 });
        return m;
      }, new Map<string, NonNullable<CorridorPlot["desk"]> & { plots: number }>())
      .values(),
  ];
  const hidden = plots.filter((p) => !p.visible).length;
  const parts = [
    g.byReadiness.BLOCKED && t("screens.corridor.nBlocked", { count: g.byReadiness.BLOCKED }),
    g.byReadiness.IN_PROCESS && t("screens.corridor.nInProcess", { count: g.byReadiness.IN_PROCESS }),
    g.byReadiness.PAID && t("screens.corridor.nPaid", { count: g.byReadiness.PAID }),
  ].filter(Boolean);

  return (
    <div className={cn("rounded-md border", best ? "border-brand/40 bg-brand-soft/40" : "border-border")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-3 py-2.5 text-left">
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
            best ? "bg-brand text-surface" : "bg-surface-muted text-muted",
          )}
        >
          {g.rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">
            {g.blockers.length === 0 ? (
              <>{t("screens.corridor.noPlotSurvey", { length: length(g.toM - g.fromM) })}</>
            ) : g.joinsM != null && g.gainM > 0 ? (
              <>
                {count(t, g.blockers.length, "settleJoinsOne", "settleJoinsMany", { length: length(g.joinsM) })}{" "}
                <span className="text-success">(+{length(g.gainM)})</span>
              </>
            ) : g.joinsM != null ? (
              <>
                {count(t, g.blockers.length, "settleStretchOne", "settleStretchMany", { length: length(g.joinsM) })}{" "}
                <span className="font-normal text-muted">{t("screens.corridor.shorterThanLongest")}</span>
              </>
            ) : (
              <>{count(t, g.blockers.length, "notInHandOne", "notInHandMany")}</>
            )}
            {best && <span className="ml-2 rounded bg-brand px-1.5 py-0.5 text-[10px] font-medium text-surface">{t("screens.corridor.bestNext")}</span>}
          </span>
          <span className="mt-0.5 block text-[11px] tabular-nums text-muted">
            {chainage(g.fromM)} → {chainage(g.toM)} · {t("screens.corridor.lengthNotInHand", { length: length(g.toM - g.fromM) })}
            {parts.length > 0 && ` · ${parts.join(" · ")}`}
            {g.gainM > 0 && longestLen > 0 && ` · ${t("screens.corridor.longestToday", { length: length(longestLen) })}`}
          </span>
          {g.unmappedM > 0 && g.blockers.length > 0 && (
            <span className="mt-0.5 block text-[11px] text-warning">
              {t("screens.corridor.unmappedWarn", { length: length(g.unmappedM) })}
            </span>
          )}
        </span>
        <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && plots.length > 0 && (
        <div className="border-t border-border px-3 pb-2">
          <div className="py-2 text-[11px]">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("screens.corridor.whoseDesk")}</span>
            <ul className="mt-1 space-y-0.5">
              {desks.map((d) => {
                const late = d.slaDays != null && d.days > d.slaDays;
                return (
                  <li key={d.proposalId}>
                    <span className="font-mono">{d.referenceNo}</span>
                    <span className="text-muted"> · {count(t, d.plots, "plotsOne", "plotsMany")} · </span>
                    {rich(t("screens.corridor.withRole"), { role: roleLabels[d.role] ?? d.role })}
                    <span className={cn("tabular-nums", late ? "font-medium text-danger" : "text-muted")}>
                      {" "}{count(t, d.days, "forDaysOne", "forDaysMany")}
                      {d.slaDays != null && ` ${t("screens.corridor.serviceLevel", { days: d.slaDays })}`}
                    </span>
                    {" · "}
                    <Link href={`/proposals/${d.proposalId}#saarthi`} className="underline">
                      {t("screens.corridor.whyLate")}
                    </Link>
                  </li>
                );
              })}
              {hidden > 0 && <li className="text-muted">{count(t, hidden, "outsideOne", "outsideMany")}</li>}
            </ul>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">{t("screens.corridor.colPlot")}</th>
                <th className="py-2 font-medium">{t("screens.corridor.colCovers")}</th>
                <th className="py-2 font-medium">{t("screens.corridor.colWhy")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-border align-top hover:bg-surface-muted/60"
                  onMouseEnter={() => onHoverPlot(p.id)}
                  onMouseLeave={() => onHoverPlot(null)}
                >
                  <td className="py-1.5 pr-3">
                    {p.visible ? (
                      <>
                        <span className="font-mono">{p.khasraNo}</span>
                        <span className="block text-[11px] text-muted">{p.village}</span>
                      </>
                    ) : (
                      <span className="text-muted">
                        {t("screens.corridor.plotInDistrict", { district: p.district })}
                        <span className="block text-[11px]">{t("screens.corridor.outsideJurisdiction")}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-muted">
                    {chainage(p.fromM)} – {chainage(p.toM)}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="inline-flex items-start gap-1.5">
                      {p.readiness === "BLOCKED" ? (
                        <TriangleAlert aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
                      ) : (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-sm" style={{ background: STATE[p.readiness].fill }} />
                      )}
                      <span>
                        {p.reasons.map((r, i) => (
                          <Fragment key={i}>
                            {i > 0 && <br />}
                            <span className={i > 0 ? "text-muted" : undefined}>{reasonText(t, intl, r)}</span>
                          </Fragment>
                        ))}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {plots.length > ROW_CAP && (
            <button type="button" onClick={() => setAll(!all)} className="mt-1 text-[11px] text-muted underline hover:text-foreground">
              {all ? t("screens.corridor.showFewer") : t("screens.corridor.showAll", { count: plots.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
