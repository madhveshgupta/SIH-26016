import { Check } from "lucide-react";
import type { ParcelStatus } from "@prisma/client";
import { cn } from "@frontend/lib/cn";

/** How far a plot has got, as the Act's own sequence. */
const PATH: ParcelStatus[] = ["PROPOSED", "NOTIFIED", "OBJECTED", "AWARD_DECLARED", "COMPENSATED", "POSSESSED"];

export interface TimelineLabels {
  title: string;
  hint: string;
  current: string;
  stageOf: string;
  stages: Record<string, string>;
  offPathNote: string | null;
}

export default function PlotTimeline({ status, labels }: { status: ParcelStatus; labels: TimelineLabels }) {
  // A plot sitting off the path still shows the track, so the citizen can see
  // which stages were already completed before it stalled.
  const offPath = status === "DISPUTED" || status === "WITHDRAWN";
  const activeIndex = offPath ? -1 : PATH.indexOf(status);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-semibold text-foreground">{labels.title}</h4>
        {activeIndex >= 0 && (
          <span className="text-xs tabular-nums text-muted">
            {labels.stageOf.replace("{current}", String(activeIndex + 1)).replace("{total}", String(PATH.length))}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted">{labels.hint}</p>

      {labels.offPathNote && (
        <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">{labels.offPathNote}</p>
      )}

      <ol className="mt-3 space-y-0">
        {PATH.map((stage, i) => {
          const done = activeIndex > i;
          const here = activeIndex === i;
          const last = i === PATH.length - 1;
          return (
            <li key={stage} className="flex gap-3">
              {/* Marker column: the dot, plus the rail joining it to the next. */}
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition",
                    done && "border-success bg-success text-white",
                    here && "border-warning bg-warning text-white ring-4 ring-warning/20",
                    !done && !here && "border-border bg-surface",
                  )}
                >
                  {done && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
                  {here && <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />}
                </span>
                {!last && <span className={cn("w-0.5 flex-1", done ? "bg-success" : "bg-border")} aria-hidden />}
              </div>

              <div className={cn("flex flex-wrap items-center gap-2", last ? "pb-0" : "pb-4")}>
                <span
                  className={cn(
                    "text-sm",
                    here && "font-semibold text-foreground",
                    done && "text-foreground",
                    !done && !here && "text-muted",
                  )}
                >
                  {labels.stages[stage] ?? stage}
                </span>
                {here && (
                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                    {labels.current}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
