/** The compliance clock in words, in the reader's language. */
import type { ClockState } from "@backend/statutory/clock";
import type { MessageKey } from "@backend/i18n/types";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const plural = (n: number) => (n === 1 ? "One" : "Many");

/** "47 days to the award deadline under s.25. If missed, the entire acquisition LAPSES." */
export function clockMessage(t: T, c: ClockState): string {
  if (!c.deadline || c.daysRemaining == null) return t("screens.clock.none");
  const d = c.daysRemaining;
  const days = Math.abs(d);
  const sec = c.section ? t("screens.clock.underSection", { section: c.section }) : "";
  const kind =
    d < 0
      ? c.consequence === "LAPSE" ? "lapsed" : c.consequence === "RESCIND" ? "rescinded" : "overdue"
      : c.consequence === "LAPSE" ? "toLapse" : c.consequence === "RESCIND" ? "toRescind" : "remaining";
  return t(`screens.clock.${kind}${plural(days)}` as MessageKey, { days, sec });
}

/** The big figure: "47 days remaining" / "3 days overdue". */
export function clockHeadline(t: T, c: ClockState): string {
  const d = c.daysRemaining ?? 0;
  const days = Math.abs(d);
  return t(`screens.clock.${d < 0 ? "headOverdue" : "headRemaining"}${plural(days)}` as MessageKey, { days });
}

/** The short form for a badge: "47d left" / "3d overdue". */
export function clockShort(t: T, c: ClockState): string {
  const d = c.daysRemaining ?? 0;
  return d < 0 ? t("screens.units.daysOverdue", { days: Math.abs(d) }) : t("screens.units.daysLeft", { days: d });
}
