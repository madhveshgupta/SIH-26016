/**
 * Rules about a case's current desk: statutory deadlines, and how long it has been waiting for
 * someone to act.
 */
import type { AlertSeverity } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { computeClock, daysBetween, SEVERITY_LABEL } from "@backend/statutory/clock";
import { stageFor } from "@backend/workflow/engine";
import { TERMINAL } from "@backend/workflow/types";
import { SUPERIOR } from "@backend/alerts/recipients";
import { geographyOf, plural, PROJECT_GEO_SELECT, type Finding, type Rule } from "./types";

async function openCases() {
  return prisma.proposal.findMany({
    where: { status: { notIn: TERMINAL } },
    select: {
      id: true,
      referenceNo: true,
      status: true,
      currentHolderRole: true,
      createdAt: true,
      project: { select: { name: true, governingAct: true, ...PROJECT_GEO_SELECT } },
      stages: { where: { exitedAt: null }, orderBy: { enteredAt: "desc" }, take: 1 },
    },
  });
}

/** Statutory deadlines — URGENT and worse. */
export const statutoryDeadlines: Rule = async (now) => {
  const out: Finding[] = [];
  for (const c of await openCases()) {
    const open = c.stages[0];
    const act = c.project.governingAct;
    const clock = computeClock(act, c.status, open?.enteredAt ?? c.createdAt, open?.statutoryDeadline ?? null, now);
    if (clock.severity === "SAFE" || clock.severity === "WATCH") continue;

    const stage = stageFor(act, c.status);
    const holder = c.currentHolderRole ?? stage?.actors[0];
    if (!holder) continue;

    const breached = clock.severity === "BREACHED";
    const severity: AlertSeverity = clock.isFatal && clock.severity !== "URGENT" ? "STATUTORY_LAPSE_RISK" : breached || clock.severity === "CRITICAL" ? "CRITICAL" : "WARNING";
    out.push({
      key: `STAT:${open?.id ?? `${c.id}:${c.status}`}:${clock.severity}`,
      type: breached ? "STATUTORY_BREACH" : clock.isFatal && clock.severity === "CRITICAL" ? "LAPSE_IMMINENT" : "STATUTORY_DEADLINE",
      severity,
      title: `${SEVERITY_LABEL[clock.severity]}: ${stage?.label ?? c.status} — ${c.referenceNo}`,
      message: `${clock.message} ${c.project.name}.`,
      proposalId: c.id,
      to: [holder],
      geo: geographyOf(c.project),
      escalateTo: breached || (clock.isFatal && clock.severity === "CRITICAL") ? SUPERIOR[holder] : null,
    });
  }
  return out;
};

/** Pending approvals — a case sitting on one desk past the service standard for that stage. */
export const pendingBeyondSla: Rule = async (now) => {
  const out: Finding[] = [];
  for (const c of await openCases()) {
    const open = c.stages[0];
    if (!open?.slaDays || open.slaDays <= 0) continue;
    const days = daysBetween(open.enteredAt, now);
    if (days <= open.slaDays) continue;

    // A statutory clock that is already critical or breached says the same
    // thing louder; one alert about one case is enough.
    const act = c.project.governingAct;
    const clock = computeClock(act, c.status, open.enteredAt, open.statutoryDeadline, now);
    if (clock.severity === "CRITICAL" || clock.severity === "BREACHED") continue;

    const stage = stageFor(act, c.status);
    const holder = c.currentHolderRole ?? stage?.actors[0];
    if (!holder) continue;

    const band = days > open.slaDays * 2 ? 2 : 1;
    const label = stage?.label ?? c.status.replaceAll("_", " ").toLowerCase();
    out.push({
      key: `SLA:${open.id}:${band}`,
      type: band === 2 ? "SLA_ESCALATION" : "SLA_BREACH",
      severity: band === 2 ? "CRITICAL" : "WARNING",
      title: `Pending ${plural(days, "day")}: ${label} — ${c.referenceNo}`,
      message:
        `${c.referenceNo} has waited ${plural(days, "day")} at "${label}" against a ${plural(open.slaDays, "day")} service standard` +
        `${band === 2 ? " — more than twice the standard, so it has been raised with the next level" : ""}. ${c.project.name}.`,
      proposalId: c.id,
      to: [holder],
      geo: geographyOf(c.project),
      escalateTo: band === 2 ? SUPERIOR[holder] : null,
    });
  }
  return out;
};
