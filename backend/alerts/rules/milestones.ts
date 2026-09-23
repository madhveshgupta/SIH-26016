/** Project milestones past their planned date. */
import { prisma } from "@backend/db/client";
import { daysBetween } from "@backend/statutory/clock";
import { geographyOf, plural, PROJECT_GEO_SELECT, type Finding, type Rule } from "./types";

/** A month late is no longer slippage; it moves the project's end date. */
const SERIOUS_DAYS = 30;

export const milestonesOverdue: Rule = async (now) => {
  const late = await prisma.milestone.findMany({
    where: { plannedDate: { lt: now }, status: { not: "COMPLETED" } },
    select: {
      id: true,
      name: true,
      plannedDate: true,
      percentComplete: true,
      project: { select: { name: true, referenceNo: true, ...PROJECT_GEO_SELECT } },
    },
  });
  return late.map((m): Finding => {
    const days = daysBetween(m.plannedDate, now);
    const serious = days > SERIOUS_DAYS;
    return {
      key: `MS:${m.id}:${serious ? "30" : "0"}`,
      type: "MILESTONE_OVERDUE",
      severity: serious ? "CRITICAL" : "WARNING",
      title: `Milestone ${plural(days, "day")} late: ${m.name} — ${m.project.referenceNo}`,
      message: `"${m.name}" was planned for ${m.plannedDate.toISOString().slice(0, 10)} and is ${m.percentComplete}% complete. ${m.project.name}.`,
      proposalId: null,
      to: ["LAND_REQUIRING_BODY"],
      geo: geographyOf(m.project),
    };
  });
};
