/** THE STATUTORY COMPLIANCE CLOCK — the signature feature. */
import type { AcquisitionAct, ProposalStatus } from "@prisma/client";
import { stageFor } from "@backend/workflow/engine";
import { daysBetween, type ClockSeverity, type ClockState } from "./severity";

export {
  SEVERITY_ORDER, SEVERITY_STYLES, SEVERITY_LABEL, daysBetween,
  type ClockSeverity, type ClockState,
} from "./severity";

/** Obtain the request-time clock without making a React render impure. */
export function currentTimeMs(): number {
  return Date.now();
}

function severityFor(days: number, fatal: boolean): ClockSeverity {
  if (days < 0) return "BREACHED";
  // A fatal deadline gets pulled forward a band: 60 days to a lapse deserves
  // the same alarm as 30 days to a merely escalating one.
  if (fatal) {
    if (days <= 30) return "CRITICAL";
    if (days <= 90) return "URGENT";
    if (days <= 180) return "WATCH";
    return "SAFE";
  }
  if (days <= 15) return "CRITICAL";
  if (days <= 30) return "URGENT";
  if (days <= 90) return "WATCH";
  return "SAFE";
}

/**
 * Compute the clock for a proposal sitting at `status`, having entered that stage at
 * `enteredAt`.
 */
export function computeClock(
  act: AcquisitionAct,
  status: ProposalStatus,
  enteredAt: Date,
  storedDeadline?: Date | null,
  now: Date = new Date(),
): ClockState {
  const stage = stageFor(act, status);

  const deadline =
    storedDeadline ??
    (stage?.statutoryDays ? new Date(enteredAt.getTime() + stage.statutoryDays * 86_400_000) : null);

  if (!deadline || !stage) {
    return {
      deadline: null,
      daysRemaining: null,
      severity: "SAFE",
      consequence: null,
      section: stage?.section ?? null,
      isFatal: false,
      message: "No statutory deadline at this stage.",
    };
  }

  const isFatal = stage.onBreach === "LAPSE" || stage.onBreach === "RESCIND";
  const days = daysBetween(now, deadline);
  const severity = severityFor(days, isFatal);
  const sec = stage.section ? ` under ${stage.section}` : "";

  let message: string;
  if (days < 0) {
    const over = Math.abs(days);
    message =
      stage.onBreach === "LAPSE"
        ? `LAPSED — the statutory deadline${sec} passed ${over} day${over === 1 ? "" : "s"} ago. The acquisition is void and must restart.`
        : stage.onBreach === "RESCIND"
          ? `RESCINDED — the deadline${sec} passed ${over} day${over === 1 ? "" : "s"} ago; the preceding notification no longer stands.`
          : `Overdue by ${over} day${over === 1 ? "" : "s"}${sec}.`;
  } else if (stage.onBreach === "LAPSE") {
    message = `${days} day${days === 1 ? "" : "s"} to the award deadline${sec}. If missed, the entire acquisition LAPSES.`;
  } else if (stage.onBreach === "RESCIND") {
    message = `${days} day${days === 1 ? "" : "s"} remaining${sec}. If missed, the preceding notification is rescinded.`;
  } else {
    message = `${days} day${days === 1 ? "" : "s"} remaining${sec}.`;
  }

  return {
    deadline,
    daysRemaining: days,
    severity,
    consequence: stage.onBreach ?? null,
    section: stage.section ?? null,
    isFatal,
    message,
  };
}
