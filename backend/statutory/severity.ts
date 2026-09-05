/** Clock types and display constants — no server imports, so client components can use them. */

export type ClockSeverity = "SAFE" | "WATCH" | "URGENT" | "CRITICAL" | "BREACHED";

export interface ClockState {
  /** Null when the current stage has no statutory deadline. */
  deadline: Date | null;
  daysRemaining: number | null;
  severity: ClockSeverity;
  /** What happens if this deadline passes. */
  consequence: "LAPSE" | "RESCIND" | "ESCALATE" | null;
  /** Plain-language line for the UI. */
  message: string;
  section: string | null;
  /** True when breach voids the acquisition — drives the loudest alerts. */
  isFatal: boolean;
}

export const SEVERITY_ORDER: ClockSeverity[] = ["BREACHED", "CRITICAL", "URGENT", "WATCH", "SAFE"];

/** Tailwind classes per severity, so every clock looks the same everywhere. */
export const SEVERITY_STYLES: Record<ClockSeverity, string> = {
  SAFE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  WATCH: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  URGENT: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  BREACHED: "bg-neutral-900 text-white dark:bg-black dark:text-red-400",
};

export const SEVERITY_LABEL: Record<ClockSeverity, string> = {
  SAFE: "On track",
  WATCH: "Watch",
  URGENT: "Urgent",
  CRITICAL: "Critical",
  BREACHED: "Breached",
};

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
