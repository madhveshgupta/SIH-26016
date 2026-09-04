import type { ReactNode } from "react";
import { cn } from "@frontend/lib/cn";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "accent";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-muted text-muted border-border",
  brand: "bg-brand-soft text-brand border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
  accent: "bg-accent-soft text-warning border-transparent",
};

export function Badge({ tone = "neutral", icon, className, children }: { tone?: Tone; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Dot({ colour }: { colour: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: colour }} />;
}
