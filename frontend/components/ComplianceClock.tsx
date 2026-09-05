"use client";

import { AlarmClock, AlertOctagon, CheckCircle2, Clock, TriangleAlert } from "lucide-react";
import { SEVERITY_STYLES, type ClockState } from "@backend/statutory/severity";
import type { MessageKey } from "@backend/i18n/types";
import { useT } from "@frontend/components/I18nProvider";
import { clockHeadline, clockMessage, clockShort } from "@frontend/lib/clock-text";
import { cn } from "@frontend/lib/cn";

const SEVERITY_ICONS = {
  SAFE: CheckCircle2,
  WATCH: Clock,
  URGENT: TriangleAlert,
  CRITICAL: AlarmClock,
  BREACHED: AlertOctagon,
};

const SEVERITY_BORDERS = {
  SAFE: "border-emerald-200 dark:border-emerald-800/50",
  WATCH: "border-amber-200 dark:border-amber-800/50",
  URGENT: "border-orange-300 dark:border-orange-800/50",
  CRITICAL: "border-red-300 dark:border-red-800/50",
  BREACHED: "border-neutral-800 dark:border-neutral-700",
};

/** The compliance clock badge/card. */
export default function ComplianceClock({
  clock,
  compact = false,
}: {
  clock: ClockState;
  compact?: boolean;
}) {
  const t = useT();
  const label = t(`screens.severity.${clock.severity}` as MessageKey);
  if (!clock.deadline) {
    return compact ? null : (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted">
        <Clock className="h-4 w-4" />
        <span>{t("screens.clock.none")}</span>
      </div>
    );
  }

  if (compact) {
    const headline = clockShort(t, clock);
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-medium",
          SEVERITY_STYLES[clock.severity]
        )}
        title={clockMessage(t, clock)}
      >
        {clock.isFatal && <span aria-hidden>⏱</span>}
        {label} · {headline}
        {clock.section && <span className="opacity-70">{clock.section}</span>}
      </span>
    );
  }

  const Icon = SEVERITY_ICONS[clock.severity];
  const headline = clockHeadline(t, clock);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 shadow-sm",
        SEVERITY_BORDERS[clock.severity],
        SEVERITY_STYLES[clock.severity]
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Icon className="h-5 w-5" />
          <h3 className="font-semibold">{label}</h3>
        </div>
        {clock.section && (
          <span className="rounded-md bg-white/40 px-2 py-0.5 font-mono text-xs font-bold tracking-wider opacity-90 mix-blend-multiply dark:bg-black/20 dark:mix-blend-screen">
            {clock.section}
          </span>
        )}
      </div>

      <div>
        <div className="text-2xl font-bold tabular-nums tracking-tight">
          {headline}
        </div>
        <p className="mt-1 text-sm leading-relaxed opacity-90">
          {clockMessage(t, clock)}
        </p>
      </div>
    </div>
  );
}
