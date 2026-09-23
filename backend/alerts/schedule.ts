/** The hourly alert sweep, run by the web server itself. */
import { runAlertSweep } from "./sweep";

interface ScheduleState {
  everyMinutes: number;
  lastRunAt: Date | null;
  running: boolean;
  timer?: ReturnType<typeof setInterval>;
}

// On globalThis, not a module variable: the dev server can load this module
// more than once, and there must only ever be one timer.
const g = globalThis as { __alertSchedule?: ScheduleState };

async function tick(state: ScheduleState) {
  if (state.running) return; // a slow run is still going; skip, don't pile up
  state.running = true;
  try {
    const r = await runAlertSweep();
    state.lastRunAt = new Date();
    console.log(`[alerts] hourly sweep: ${r.findings} findings → ${r.created} raised, ${r.delivered} email/SMS · ${r.ms} ms`);
  } catch (e) {
    console.error("[alerts] hourly sweep failed:", e);
  } finally {
    state.running = false;
  }
}

export function startAlertSchedule() {
  if (g.__alertSchedule) return;
  const everyMinutes = Number(process.env.ALERT_SWEEP_MINUTES ?? 60);
  if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) return;

  const state: ScheduleState = { everyMinutes, lastRunAt: null, running: false };
  g.__alertSchedule = state;
  // unref: a pending sweep must never keep the process alive on shutdown.
  setTimeout(() => void tick(state), 60_000).unref();
  state.timer = setInterval(() => void tick(state), everyMinutes * 60_000);
  state.timer.unref();
}

/** For the alerts page: how often the server checks, and when it last did. Null when the schedule is off. */
export function alertScheduleStatus(): { everyMinutes: number; lastRunAt: Date | null } | null {
  const s = g.__alertSchedule;
  return s ? { everyMinutes: s.everyMinutes, lastRunAt: s.lastRunAt } : null;
}
