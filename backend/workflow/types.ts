/** Workflow definitions as DATA, not code. */
import type { ProposalStatus, RoleType, AcquisitionAct } from "@prisma/client";

export interface StageDefinition {
  status: ProposalStatus;
  /** Shown to users. Includes the statutory section, which is what officers cite. */
  label: string;
  /** e.g. "s.11" or "s.3A" — the legal hook for this stage. */
  section?: string;
  /** Roles permitted to act at this stage. */
  actors: RoleType[];
  /** Administrative service-level target, in days. Internal, not statutory. */
  slaDays: number;
  /** Statutory deadline in days from entering this stage. */
  statutoryDays?: number;
  /** What happens if the statutory deadline passes. */
  onBreach?: "LAPSE" | "RESCIND" | "ESCALATE";
  /** Allowed next stages. The last entry is the default "approve" path. */
  next: ProposalStatus[];
  /** Human note explaining the legal significance — surfaced in the UI. */
  note?: string;
}

export interface WorkflowDefinition {
  act: AcquisitionAct;
  name: string;
  citation: string;
  stages: StageDefinition[];
}

/** Terminal states — no further transitions. */
export const TERMINAL: ProposalStatus[] = ["CLOSED", "REJECTED", "LAPSED"];

/** Exception transitions available from almost any active stage. */
export const EXCEPTION_STAGES: ProposalStatus[] = [
  "RETURNED_FOR_CLARIFICATION",
  "REJECTED",
];
