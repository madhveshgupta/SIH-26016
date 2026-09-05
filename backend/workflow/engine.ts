/** The workflow engine. */
import type { AcquisitionAct, ProposalStatus, RoleType } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import { LARR_2013 } from "./definitions/larr-2013";
import { NH_ACT_1956 } from "./definitions/nh-act-1956";
import { TERMINAL, EXCEPTION_STAGES, type StageDefinition, type WorkflowDefinition } from "./types";

const DEFINITIONS: Record<string, WorkflowDefinition> = {
  LARR_2013,
  NH_ACT_1956,
  // Not yet modelled; fall back to LARR so nothing crashes mid-demo.
  RAILWAYS_ACT_1989: LARR_2013,
  STATE_ACT: LARR_2013,
};

export function definitionFor(act: AcquisitionAct): WorkflowDefinition {
  return DEFINITIONS[act] ?? LARR_2013;
}

export function stageFor(act: AcquisitionAct, status: ProposalStatus): StageDefinition | undefined {
  return definitionFor(act).stages.find((s) => s.status === status);
}

/** Cost above which approval escalates to the Central Ministry (₹ crore). */
export const CENTRAL_ESCALATION_CRORE = 100;

export interface TransitionRequest {
  proposalId: string;
  to: ProposalStatus;
  actorId: string;
  actorRole: RoleType;
  action: "APPROVE" | "REJECT" | "RETURN" | "FORWARD";
  remarks?: string;
  checklist?: unknown;
}

export type TransitionError =
  | "PROPOSAL_NOT_FOUND"
  | "TERMINAL_STATE"
  | "ILLEGAL_TRANSITION"
  | "ROLE_NOT_PERMITTED"
  | "REMARKS_REQUIRED";

export interface TransitionResult {
  ok: boolean;
  error?: TransitionError;
  message?: string;
  from?: ProposalStatus;
  to?: ProposalStatus;
  /** Statutory deadline attached to the new stage, if the Act sets one. */
  statutoryDeadline?: Date | null;
}

/** Which stages may this proposal move to next, for this role? */
export async function allowedTransitions(
  proposalId: string,
  role: RoleType,
): Promise<{ stage: StageDefinition; targets: ProposalStatus[] } | null> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: { project: { select: { governingAct: true } } },
  });
  if (!proposal) return null;

  const stage = stageFor(proposal.project.governingAct, proposal.status);
  if (!stage) return null;
  if (!stage.actors.includes(role)) return { stage, targets: [] };

  const targets = [...stage.next];
  // Return-for-clarification and rejection are available from most active
  // stages, not just where they are listed explicitly.
  if (!TERMINAL.includes(proposal.status) && proposal.status !== "DRAFT") {
    for (const ex of EXCEPTION_STAGES) if (!targets.includes(ex)) targets.push(ex);
  }
  return { stage, targets };
}

/** Who should hold this proposal at a given stage? */
export function routeTo(
  stage: StageDefinition,
  opts: { estimatedCostCrore?: number | null },
): RoleType {
  const cost = opts.estimatedCostCrore ?? 0;
  if (
    stage.status === "STATE_APPROVAL" &&
    cost > CENTRAL_ESCALATION_CRORE &&
    stage.actors.includes("CENTRAL_MINISTRY")
  ) {
    return "CENTRAL_MINISTRY";
  }
  return stage.actors[0];
}

/** Move a proposal to a new stage. */
export async function transition(req: TransitionRequest): Promise<TransitionResult> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: req.proposalId },
    include: { project: { select: { governingAct: true, estimatedCostCrore: true } } },
  });
  if (!proposal) return { ok: false, error: "PROPOSAL_NOT_FOUND" };
  if (TERMINAL.includes(proposal.status)) {
    return { ok: false, error: "TERMINAL_STATE", message: `Proposal is ${proposal.status}` };
  }

  const act = proposal.project.governingAct;
  const current = stageFor(act, proposal.status);
  if (!current) {
    return { ok: false, error: "ILLEGAL_TRANSITION", message: `No stage definition for ${proposal.status}` };
  }

  if (!current.actors.includes(req.actorRole)) {
    return {
      ok: false,
      error: "ROLE_NOT_PERMITTED",
      message: `${req.actorRole} may not act at ${current.label}`,
    };
  }

  const permitted = [...current.next, ...EXCEPTION_STAGES];
  if (!permitted.includes(req.to)) {
    return {
      ok: false,
      error: "ILLEGAL_TRANSITION",
      message: `Cannot move from ${proposal.status} to ${req.to}`,
    };
  }

  // Rejections and returns must carry reasons.
  if ((req.action === "REJECT" || req.action === "RETURN") && !req.remarks?.trim()) {
    return {
      ok: false,
      error: "REMARKS_REQUIRED",
      message: "Written reasons are required when rejecting or returning a proposal",
    };
  }

  const nextStage = stageFor(act, req.to);
  const now = new Date();
  const statutoryDeadline = nextStage?.statutoryDays
    ? new Date(now.getTime() + nextStage.statutoryDays * 86_400_000)
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.proposalStage.updateMany({
      where: { proposalId: proposal.id, exitedAt: null },
      data: { exitedAt: now, action: req.action, remarks: req.remarks ?? null },
    });

    await tx.proposalStage.create({
      data: {
        proposalId: proposal.id,
        stage: req.to,
        actorId: req.actorId,
        actorRole: req.actorRole,
        enteredAt: now,
        slaDays: nextStage?.slaDays ?? null,
        statutoryDeadline,
        checklist: (req.checklist ?? undefined) as never,
      },
    });

    await tx.proposal.update({
      where: { id: proposal.id },
      data: {
        status: req.to,
        currentHolderRole: nextStage
          ? routeTo(nextStage, { estimatedCostCrore: Number(proposal.project.estimatedCostCrore ?? 0) })
          : null,
        submittedAt: req.to === "SUBMITTED" ? now : proposal.submittedAt,
        closedAt: TERMINAL.includes(req.to) ? now : null,
      },
    });
  });

  await appendAudit({
    actorId: req.actorId,
    action: "UPDATE",
    entityType: "Proposal",
    entityId: proposal.id,
    beforeJson: { status: proposal.status },
    afterJson: {
      status: req.to,
      action: req.action,
      remarks: req.remarks ?? null,
      statutoryDeadline,
    },
  });

  return { ok: true, from: proposal.status, to: req.to, statutoryDeadline };
}
