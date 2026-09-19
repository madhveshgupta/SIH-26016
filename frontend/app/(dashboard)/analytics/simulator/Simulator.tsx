"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@frontend/components/ui";
import { formatIndianScale } from "@backend/compensation/format";
import { cn } from "@frontend/lib/cn";
import { rich } from "@frontend/lib/rich";
import { useLocale, useT } from "@frontend/components/I18nProvider";
import type { MessageKey } from "@backend/i18n/types";
import type { Locale } from "@backend/i18n/meta";

type T = ReturnType<typeof useT>;

interface Result {
  cases: number;
  compensation: { baseline: number; simulated: number; changePct: number };
  delayRisk: { baseline: number; simulated: number };
  expectedDelayDays: { baseline: number; simulated: number };
  slaBreachShare: number | null;
  modelVersion: string;
}

type Levers = { multiplierFactor: number; solatiumPct: number; slaDays: number; consentThresholdPct: number };

/** Today's settings — what every comparison is measured against. */
const TODAY: Levers = { multiplierFactor: 1.5, solatiumPct: 100, slaDays: 730, consentThresholdPct: 70 };

/** Questions a policy maker actually asks, each one click. */
const SCENARIOS: { question: MessageKey; levers: Partial<Levers> }[] = [
  { question: "screens.sim.q_multiplier", levers: { multiplierFactor: 2 } },
  { question: "screens.sim.q_sla", levers: { slaDays: 545 } },
  { question: "screens.sim.q_consent", levers: { consentThresholdPct: 80 } },
  { question: "screens.sim.q_solatium", levers: { solatiumPct: 50 } },
];

/** A rule the simulator can move; its words are screens.sim.l_<id>, …Legal, …Help. */
interface LeverDef {
  key: keyof Levers;
  id: "multiplier" | "solatium" | "sla" | "consent";
  min: number;
  max: number;
  step: number;
  format: (v: number, t: T) => string;
  /** What "today" means when it is not one number for every case. */
  todayLabel?: MessageKey;
}

const LEVERS: LeverDef[] = [
  {
    key: "multiplierFactor",
    id: "multiplier",
    min: 1, max: 2, step: 0.05,
    format: (v) => `×${v.toFixed(2)}`,
    todayLabel: "screens.sim.l_multiplierToday",
  },
  {
    key: "solatiumPct",
    id: "solatium",
    min: 0, max: 200, step: 5,
    format: (v) => `${v}%`,
  },
  {
    key: "slaDays",
    id: "sla",
    min: 180, max: 1095, step: 15,
    format: (v, t) => (v % 365 === 0 ? t("screens.sim.years", { n: v / 365 }) : t("screens.sim.months", { n: Math.round(v / 30.4) })),
  },
  {
    key: "consentThresholdPct",
    id: "consent",
    min: 0, max: 100, step: 5,
    format: (v) => `${v}%`,
  },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Change a rule and see what it would do to the open cases in your own
 * jurisdiction: the money, the delays, and how many would run late.
 */
export default function Simulator() {
  const t = useT();
  const { locale } = useLocale();
  const money = (v: number) => formatIndianScale(v, locale);
  const name = (l: LeverDef) => t(`screens.sim.l_${l.id}` as MessageKey);
  const [levers, setLevers] = useState<Levers>(TODAY);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  // Re-run shortly after the last change, so dragging a slider does not fire
  // a request per pixel; only the latest answer is kept.
  useEffect(() => {
    const id = ++request.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      const res = await fetch("/api/ml/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the rules actually changed.
        body: JSON.stringify(Object.fromEntries(LEVERS.filter((l) => levers[l.key] !== TODAY[l.key]).map((l) => [l.key, levers[l.key]]))),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (id !== request.current) return;
      setBusy(false);
      if (!res?.ok) return setError(data.error ?? t("screens.sim.failed"));
      setResult(data as Result);
    }, 450);
    return () => clearTimeout(timer);
  }, [levers, t]);

  const changed = LEVERS.filter((l) => levers[l.key] !== TODAY[l.key]);
  const scenarioActive = (s: (typeof SCENARIOS)[number]) =>
    LEVERS.every((l) => levers[l.key] === (s.levers[l.key] ?? TODAY[l.key]));

  return (
    <div className="space-y-5">
      <section aria-label={t("screens.sim.tryQuestion")} className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">{t("screens.sim.startQuestion")}</h2>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {SCENARIOS.map((s) => {
            const active = scenarioActive(s);
            return (
              <button
                key={s.question}
                type="button"
                aria-pressed={active}
                onClick={() => setLevers({ ...TODAY, ...s.levers })}
                className={cn(
                  "rounded-xl border bg-surface p-3 text-left text-sm leading-snug transition hover:border-brand/40 hover:shadow-sm",
                  active ? "border-brand/60 ring-1 ring-brand/30" : "border-border",
                )}
              >
                {t(s.question)}
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <section aria-label={t("screens.sim.orChange")} className="space-y-5 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">{t("screens.sim.orChange")}</h2>
            {changed.length > 0 && (
              <Button variant="secondary" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setLevers(TODAY)}>
                {t("screens.sim.backToday")}
              </Button>
            )}
          </div>

          {LEVERS.map((l) => {
            const value = levers[l.key];
            const moved = value !== TODAY[l.key];
            const todayAt = ((TODAY[l.key] - l.min) / (l.max - l.min)) * 100;
            return (
              <label key={l.key} className="block">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{name(l)}</span>
                  <span className={cn("font-mono text-sm tabular-nums", moved ? "font-semibold text-brand" : "text-muted")}>{l.format(value, t)}</span>
                </div>
                <div className="text-[11px] text-muted">{t(`screens.sim.l_${l.id}Legal` as MessageKey)}</div>
                <div className="relative mt-2">
                  <input
                    type="range"
                    min={l.min}
                    max={l.max}
                    step={l.step}
                    value={value}
                    onChange={(e) => setLevers({ ...levers, [l.key]: Number(e.target.value) })}
                    className="w-full accent-[var(--brand)]"
                    aria-label={name(l)}
                    aria-valuetext={l.format(value, t)}
                  />
                  {/* Where today's setting sits on the scale, when it is one value. */}
                  {!l.todayLabel && <span aria-hidden className="pointer-events-none absolute -bottom-1 h-2 w-0.5 -translate-x-1/2 rounded bg-foreground/40" style={{ left: `${todayAt}%` }} />}
                </div>
                <div className="mt-1 flex items-start justify-between gap-2 text-[11px] leading-snug text-muted">
                  <span>{t(`screens.sim.l_${l.id}Help` as MessageKey)}</span>
                  <span className="shrink-0 whitespace-nowrap">
                    {l.todayLabel ? t(l.todayLabel) : t("screens.sim.today", { value: l.format(TODAY[l.key], t) })}
                  </span>
                </div>
              </label>
            );
          })}
        </section>

        <section aria-label={t("screens.sim.whatHappen")} aria-live="polite" className="space-y-3">
          {error ? (
            <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
          ) : !result ? (
            <div className="flex min-h-[240px] items-center justify-center gap-2 rounded-xl border border-dashed border-border p-8 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("screens.sim.working")}
            </div>
          ) : (
            <div className={cn("space-y-3 transition-opacity", busy && "opacity-60")}>
              <div className="rounded-xl border border-brand/30 bg-brand-soft/40 p-4">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-brand">
                  <span>{changed.length ? t("screens.sim.whatChange") : t("screens.sim.todayPicture")}</span>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={t("screens.sim.updating")} />}
                </div>
                <p className="mt-1.5 text-[15px] leading-relaxed text-foreground">{summary(t, locale, result, changed.length > 0, levers)}</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Compare
                  title={t("screens.sim.moneyTitle")}
                  today={result.compensation.baseline}
                  next={result.compensation.simulated}
                  show={money}
                  note={t(result.cases === 1 ? "screens.sim.acrossOne" : "screens.sim.acrossMany", { count: result.cases })}
                />
                <Compare
                  title={t("screens.sim.riskTitle")}
                  today={result.delayRisk.baseline}
                  next={result.delayRisk.simulated}
                  show={pct}
                  scaleMax={1}
                  lowerIsBetter
                  note={t("screens.sim.avgDelay", {
                    days: Math.round(result.expectedDelayDays.simulated),
                    today: Math.round(result.expectedDelayDays.baseline),
                  })}
                />
              </div>

              {result.slaBreachShare !== null && (
                <div className="rounded-xl border border-border bg-surface p-4 text-sm">
                  {rich(t("screens.sim.overLimit"), {
                    pct: <span className="text-lg font-semibold tabular-nums text-foreground">{pct(result.slaBreachShare)}</span>,
                    limit: LEVERS[2].format(levers.slaDays, t),
                  })}
                </div>
              )}

              <details className="rounded-xl border border-border bg-surface p-4 text-xs leading-relaxed text-muted">
                <summary className="flex cursor-pointer select-none items-center gap-1.5 font-medium text-foreground">
                  <HelpCircle className="h-3.5 w-3.5" aria-hidden /> {t("screens.sim.howWorked")}
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  <li>
                    {t("screens.sim.how1", {
                      cases: t(result.cases === 1 ? "screens.sim.casesOne" : "screens.sim.casesMany", { count: result.cases }),
                    })}
                  </li>
                  <li>{t("screens.sim.how2")}</li>
                  <li>{t("screens.sim.how3")}</li>
                  <li>{t("screens.sim.how4", { version: result.modelVersion })}</li>
                </ul>
              </details>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** The answer in one or two sentences, before any number has to be read. */
function summary(t: T, locale: Locale, r: Result, changed: boolean, levers: Levers): string {
  const money = (v: number) => formatIndianScale(v, locale);
  const cases = t(r.cases === 1 ? "screens.sim.casesOne" : "screens.sim.casesMany", { count: r.cases });
  if (!changed) {
    return t("screens.sim.sumToday", { cases, money: money(r.compensation.baseline), pct: pct(r.delayRisk.baseline) });
  }
  const diff = r.compensation.simulated - r.compensation.baseline;
  const cost =
    Math.abs(r.compensation.changePct) < 0.5
      ? t("screens.sim.costSame", { cases, money: money(r.compensation.simulated) })
      : t(diff > 0 ? "screens.sim.costMore" : "screens.sim.costLess", {
          cases,
          money: money(Math.abs(diff)),
          pct: Math.abs(r.compensation.changePct).toFixed(0),
        });
  const a = Math.round(r.delayRisk.baseline * 100);
  const b = Math.round(r.delayRisk.simulated * 100);
  const risk = Math.abs(b - a) < 1 ? t("screens.sim.riskSame", { a }) : t(b > a ? "screens.sim.riskRise" : "screens.sim.riskFall", { a, b });
  const late =
    r.slaBreachShare !== null && levers.slaDays !== TODAY.slaDays
      ? ` ${t("screens.sim.lateLine", { limit: LEVERS[2].format(levers.slaDays, t), pct: pct(r.slaBreachShare) })}`
      : "";
  return `${t("screens.sim.withRules", { cost, risk })}${late}`;
}

/** Today against the changed rules, as two bars on one scale. */
function Compare({
  title,
  today,
  next,
  show,
  scaleMax,
  lowerIsBetter,
  note,
}: {
  title: string;
  today: number;
  next: number;
  show: (v: number) => string;
  scaleMax?: number;
  /** Omitted where more or less is not simply better — more compensation is fairer to owners and dearer to the treasury. */
  lowerIsBetter?: boolean;
  note: string;
}) {
  const t = useT();
  const max = scaleMax ?? Math.max(today, next, 1);
  const moved = Math.abs(next - today) > max * 0.005;
  const tone = !moved || lowerIsBetter === undefined ? "neutral" : (lowerIsBetter ? next < today : next > today) ? "good" : "bad";
  const bar = (v: number) => `${Math.max(2, (v / max) * 100)}%`;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-medium text-muted">{title}</div>
      <div className="mt-3 space-y-2 text-xs">
        <div>
          <div className="flex justify-between"><span className="text-muted">{t("screens.sim.today2")}</span><span className="tabular-nums text-foreground">{show(today)}</span></div>
          <div className="mt-1 h-2 rounded-full bg-surface-muted"><div className="h-2 rounded-full bg-foreground/30" style={{ width: bar(today) }} /></div>
        </div>
        <div>
          <div className="flex justify-between">
            <span className="text-muted">{t("screens.sim.withThese")}</span>
            <span className={cn("font-semibold tabular-nums", tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : "text-foreground")}>{show(next)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-surface-muted">
            <div className={cn("h-2 rounded-full", tone === "good" ? "bg-success" : tone === "bad" ? "bg-danger" : "bg-brand")} style={{ width: bar(next) }} />
          </div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-muted">{note}</div>
    </div>
  );
}
