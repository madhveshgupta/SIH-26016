/** SAARTHI — the charioteer. */
import type { AcquisitionAct, ConsentStatus, ObjectionStatus, ProposalStatus, RoleType } from "@prisma/client";
import type { ClockState } from "@backend/statutory/clock";

/** A translatable line: a dictionary key and the values that fill it. */
export interface Line {
  key: string;
  vars?: Record<string, string | number>;
}

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type Health = "ON_TRACK" | "SLIPPING" | "LATE" | "CRITICAL" | "BREACHED";

/** How much of the diagnosis rests on a complete record. */
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type CauseCode =
  | "DESK_OVERRUN"
  | "REWORK_LOOP"
  | "SLOWER_THAN_PEERS"
  | "OBJECTIONS_UNHEARD"
  | "HEARING_LAPSED"
  | "CONSENT_SHORTFALL"
  | "PUBLICATION_GAP"
  | "SURVEY_INCOMPLETE"
  | "COMPENSATION_UNPAID"
  | "DESK_UNSTAFFED"
  | "DORMANT"
  | "STATUTORY_CLOCK"
  | "MODEL_RISK";

export type RemedyCode =
  | "ESCALATE"
  | "CONSOLIDATE_QUERIES"
  | "BATCH_HEARINGS"
  | "DECIDE_HEARD_OBJECTIONS"
  | "CLOSE_CONSENT_GAP"
  | "COMPLETE_PUBLICATION"
  | "FINISH_SURVEY"
  | "RELEASE_PAYMENTS"
  | "DEPOSIT_WITH_AUTHORITY"
  | "STAFF_DESK"
  | "PARALLELISE"
  | "COMPRESS_SCHEDULE"
  | "REVIEW_URGENCY"
  | "DEADLINE_UNREACHABLE";

/** One hop through the workflow, as Saarthi needs it. */
export interface StageHop {
  stage: ProposalStatus;
  enteredAt: Date;
  exitedAt: Date | null;
  /** The actor who moved the case INTO this stage — i.e. the previous desk. */
  actorRole: RoleType | null;
  actorName: string | null;
  action: string | null;
  remarks: string | null;
  slaDays: number | null;
  statutoryDeadline: Date | null;
}

/** Where the time went, one row per hop the case has actually made. */
export interface StageDelay {
  stage: ProposalStatus;
  label: string;
  section: string | null;
  /** Days the desk was allowed: the SLA, or the statutory window where the
   *  period is a right of the landowner rather than an administrative target. */
  allowedDays: number;
  heldDays: number;
  overrunDays: number;
  open: boolean;
  /** The desk that held it — resolved from who finally acted, not who sent it. */
  holderRole: RoleType | null;
  holderName: string | null;
  /** Share of the case's total overrun, 0–1. */
  share: number;
  /** Median held days for this stage across comparable cases, where known. */
  peerMedianDays: number | null;
}

/** Overrun aggregated to a desk. This is the "who" answer. */
export interface Accountability {
  role: RoleType;
  overrunDays: number;
  stageCount: number;
  share: number;
  /** Named officers who acted, with the days each one's stages ran over. */
  officers: { name: string; overrunDays: number }[];
  /** True when the file is on this desk right now. */
  holdingNow: boolean;
}

export interface Cause {
  code: CauseCode;
  severity: Severity;
  title: Line;
  detail: Line;
  evidence: Line[];
  /** Days attributable to this cause, where the record measures it. */
  delayDays: number | null;
  /** The desk this cause sits with, where it sits with one. */
  role: RoleType | null;
}

export interface Remedy {
  code: RemedyCode;
  /** 1 is most urgent. Ordering is by consequence, not by ease. */
  priority: number;
  title: Line;
  detail: Line;
  /** Whose action this is. */
  owner: RoleType | null;
  /** Days recoverable, only where a stored record supports the estimate. */
  savesDays: number | null;
  /** The section that authorises it, where one does. */
  statutoryBasis: string | null;
  /** Set where the action is lawful but curtails someone's rights. */
  caution: Line | null;
}

export interface ScheduleStep {
  stage: ProposalStatus;
  label: string;
  section: string | null;
  /** The stage's own service level. */
  normalDays: number;
  /** What the recovery plan allows it. */
  plannedDays: number;
  startOn: Date;
  finishBy: Date;
  compressed: boolean;
  /** True where the period may not be shortened — it is a statutory right. */
  protectedWindow: boolean;
}

export interface Recovery {
  /** The controlling statutory deadline, where the current stage has one. */
  deadline: Date | null;
  consequence: "LAPSE" | "RESCIND" | "ESCALATE" | null;
  daysAvailable: number | null;
  /** Days the remaining stages need at their normal service levels. */
  daysNeededAtSla: number;
  /** available − needed. Negative means the plan must compress. */
  slackDays: number | null;
  /** How hard the compressible stages are squeezed, 0–1. Null when not needed. */
  compressionFactor: number | null;
  /** False when even maximum compression cannot reach the deadline. */
  feasible: boolean;
  /** The date the plan lands on, at the planned pace. */
  projectedFinish: Date;
  steps: ScheduleStep[];
}

/** Everything Saarthi reads. Assembled by the loader, consumed by the engine. */
export interface CaseSnapshot {
  referenceNo: string;
  projectName: string;
  act: AcquisitionAct;
  status: ProposalStatus;
  createdAt: Date;
  currentHolderRole: RoleType | null;
  isUrgency: boolean;
  isPPP: boolean;
  isPrivateCompany: boolean;
  hops: StageHop[];
  objections: {
    status: ObjectionStatus;
    filedAt: Date;
    hearingDate: Date | null;
    decidedAt: Date | null;
  }[];
  consents: { status: ConsentStatus }[];
  parcels: { hasBoundary: boolean }[];
  notifications: {
    type: string;
    issuedOn: Date;
    publishedGazette: boolean;
    publishedNewspaper1: boolean;
    publishedNewspaper2: boolean;
    publishedLocalLang: boolean;
  }[];
  compensation: {
    assessed: number;
    paid: number;
    ownerCount: number;
    unpaidOwnerCount: number;
    /** Owners with no bank account on record — the s.77 deposit case. */
    unreachableOwnerCount: number;
  };
  /** Most recent audit-chain entry against this case. Null when never touched. */
  lastActivityAt: Date | null;
  /** Users posted to the holding desk within this case's jurisdiction. */
  holderStaffCount: number | null;
  /** Median held days per stage, learned from closed hops on comparable cases. */
  benchmark: Partial<Record<ProposalStatus, { medianDays: number; sampleSize: number }>>;
  prediction: {
    band: "LOW" | "MEDIUM" | "HIGH";
    delayRisk: number;
    expectedDelayDays: number;
    modelVersion: string;
    topFactors: { humanLabel: string; direction: "raises" | "lowers" | "neutral" }[];
  } | null;
}

export interface Diagnosis {
  referenceNo: string;
  projectName: string;
  generatedAt: Date;
  health: Health;
  confidence: Confidence;
  /** Days since the case opened. */
  elapsedDays: number;
  /** Days it should have taken to reach the current stage, at service levels. */
  expectedDays: number;
  /** elapsed − expected. The headline number. */
  slippageDays: number;
  clock: ClockState;
  stages: StageDelay[];
  accountability: Accountability[];
  causes: Cause[];
  remedies: Remedy[];
  recovery: Recovery;
  prediction: CaseSnapshot["prediction"];
}
