import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@frontend/lib/cn";
import type { Tone } from "./Badge";

const ICON_TONE: Record<Tone, string> = {
  neutral: "bg-surface-muted text-muted",
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-warning",
};

/** A KPI tile. */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "brand",
  href,
  onClick,
  active,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  href?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <div className="flex items-start gap-3">
      {icon && <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", ICON_TONE[tone])}>{icon}</span>}
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted">{label}</div>
        <div className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">{value}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
      </div>
    </div>
  );
  const cls = "block rounded-xl border border-border bg-surface p-4 shadow-sm";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          cls,
          "w-full text-left transition hover:border-brand/40 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          active && "border-brand/60 ring-1 ring-brand/30",
        )}
      >
        {body}
      </button>
    );
  }
  return href ? (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(cls, "transition hover:border-brand/40 hover:shadow", active && "border-brand/60 ring-1 ring-brand/30")}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
