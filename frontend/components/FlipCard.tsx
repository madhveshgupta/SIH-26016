"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@frontend/lib/cn";
import { useT } from "@frontend/components/I18nProvider";

interface FlipCardProps {
  /** An already-rendered icon element, e.g. `<MapPin className="h-8 w-8" />`. */
  icon: ReactNode;
  title: string;
  text: string;
  /** "row" = icon left of text (the hero pillars); "col" = icon above text (the feature grid). */
  layout?: "row" | "col";
  className?: string;
}

/**
 * A card that flips to its own back face on click, and flips back on the next click — the same
 * title and text as the front, only restyled, so nothing about what the card says ever changes.
 */
export default function FlipCard({ icon, title, text, layout = "col", className }: FlipCardProps) {
  const tr = useT();
  const [flipped, setFlipped] = useState(false);
  const row = layout === "row";

  function toggle() {
    setFlipped((f) => !f);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }

  return (
    <div className={cn("flip-scene card-lift h-full", className)}>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={flipped}
        aria-label={tr("screens.ui.flipCard", { title: String(title) })}
        onClick={toggle}
        onKeyDown={onKeyDown}
        className={cn("flip-card", flipped && "is-flipped")}
      >
        {/* front */}
        <div
          className={cn(
            "flip-face",
            row
              ? "flex items-start gap-4 border border-white/60 bg-white/90 px-5 py-4 shadow-[0_6px_24px_rgba(20,38,29,0.10)] backdrop-blur-md dark:border-white/10 dark:bg-surface/85"
              : "border border-border bg-surface p-5 shadow-sm",
          )}
        >
          {row ? (
            <>
              <span className="card-glyph mt-0.5 inline-flex h-8 w-8 shrink-0 text-brand">{icon}</span>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold leading-tight">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{text}</p>
              </div>
            </>
          ) : (
            <>
              <span className="card-icon flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                {icon}
              </span>
              <h3 className="mt-3 text-sm font-semibold">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
            </>
          )}
          <RotateCw className="flip-hint absolute right-3 top-3 h-3.5 w-3.5 text-muted" />
        </div>

        {/* back — the same title and text, restyled */}
        <div
          className={cn(
            "flip-face flip-face-back bg-brand-strong px-5 py-4 text-white shadow-[0_10px_32px_rgba(10,25,18,0.4)]",
            row ? "flex items-start gap-4" : "flex flex-col",
          )}
        >
          <span className={cn("inline-flex shrink-0 text-accent", row ? "mt-0.5 h-8 w-8" : "h-8 w-8")}>{icon}</span>
          <div className="min-w-0">
            <h3 className={cn("font-semibold leading-tight", row ? "text-[15px]" : "mt-3 text-sm")}>{title}</h3>
            <p className={cn("leading-relaxed text-white/75", row ? "mt-1.5 text-[13px]" : "mt-1 text-sm")}>
              {text}
            </p>
          </div>
          <RotateCw className="flip-hint absolute right-3 top-3 h-3.5 w-3.5 text-white" />
        </div>
      </div>
    </div>
  );
}
