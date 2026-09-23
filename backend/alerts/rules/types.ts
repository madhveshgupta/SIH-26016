import type { AlertSeverity, RoleType } from "@prisma/client";
import type { Geography } from "@backend/alerts/recipients";

/** Something a rule found. */
export interface Finding {
  /** Identity of the condition, e.g. "SLA:<stageId>:2". */
  key: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  proposalId: string | null;
  to: RoleType[];
  geo: Geography;
  escalateTo?: RoleType | null;
}

export type Rule = (now: Date) => Promise<Finding[]>;

/** A project's reach, for routing: every state and district it touches. */
export function geographyOf(project: {
  agencyId: string;
  states: { stateId: string }[];
  districts: { districtId: string; district: { stateId: string } }[];
}): Geography {
  return {
    agencyId: project.agencyId,
    districtIds: project.districts.map((d) => d.districtId),
    stateIds: [...new Set([...project.states.map((s) => s.stateId), ...project.districts.map((d) => d.district.stateId)])],
  };
}

export const PROJECT_GEO_SELECT = {
  agencyId: true,
  states: { select: { stateId: true } },
  districts: { select: { districtId: true, district: { select: { stateId: true } } } },
} as const;

export function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
