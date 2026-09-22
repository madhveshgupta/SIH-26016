/** Bhoomi Mitra — the tools it may call. */
import { prisma } from "@backend/db/client";
import { scopeForProposal, scopeForParcel, type Actor } from "@backend/rbac/scope";
import { computeClock } from "@backend/statutory/clock";
import { diagnoseProposal } from "@backend/saarthi";

/** Cap every list a tool can return; a model that asks for "all" gets a page. */
const MAX_ROWS = 20;

/** Trim and bound a model-supplied string before it reaches a query. */
function text(v: unknown, max = 120): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length === 0 || s.length > max ? null : s;
}

function rupees(v: unknown): number {
  return v == null ? 0 : Number(v);
}

/** A provider-neutral tool definition: JSON Schema, no vendor types. */
export interface MitraTool {
  name: string;
  description: string;
  /** Kept for parity with strict-schema providers. */
  strict: true;
  parameters: {
    type: "object";
    additionalProperties: false;
    required: string[];
    properties: Record<string, { type: string; description: string }>;
  };
}

/** The tool schemas the model sees. */
export const MITRA_TOOLS: MitraTool[] = [
  {
    name: "find_cases",
    description:
      "Find acquisition cases (proposals) the asking user is allowed to see, by reference number, project name, or village/district name. Use this first when the user names a case, a project or a place. Returns at most 20 matches with their reference number, project, stage and district.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description:
            "Reference number (e.g. LA/UP/AGR/2026/0003), project name, or a place name. Partial text is fine.",
        },
      },
    },
  },
  {
    name: "case_status",
    description:
      "The full current status of one case: its stage, who holds it, the Statutory Compliance Clock (deadline, days remaining, severity, and what happens if it is breached), area, objections and notifications. Use this for 'where does case X stand', 'is it late', 'what is the deadline'.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["reference_no"],
      properties: {
        reference_no: {
          type: "string",
          description: "The case reference number exactly as find_cases returned it.",
        },
      },
    },
  },
  {
    name: "diagnose_case",
    description:
      "Diagnose WHY a case is delayed: which stages lost time, who is accountable, the causes, and the prescribed remedies with a recovery plan. Use this for 'why is this late', 'what is blocking it', 'what should we do'. This is a deterministic engine, not a guess.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["reference_no"],
      properties: {
        reference_no: {
          type: "string",
          description: "The case reference number exactly as find_cases returned it.",
        },
      },
    },
  },
  {
    name: "compensation_summary",
    description:
      "Money for one case: total awarded, total actually paid, what is still outstanding, and how many affected families and R&R entitlements are recorded. Outstanding compensation blocks possession under s.38, so this answers 'can we take possession'.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["reference_no"],
      properties: {
        reference_no: {
          type: "string",
          description: "The case reference number exactly as find_cases returned it.",
        },
      },
    },
  },
  {
    name: "my_land",
    description:
      "The land parcels this user may see — for a landowner, the plots they own, with khasra number, area, village, the project acquiring them and what they have been paid. Use this when a citizen asks about 'my land' or 'my compensation'.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
  },
];

/** A tool result, already shaped for the model: plain JSON, no Prisma objects. */
type ToolResult = Record<string, unknown> | { not_found: string };

async function findCases(actor: Actor, input: Record<string, unknown>): Promise<ToolResult> {
  const q = text(input.query);
  if (!q) return { not_found: "No usable search text was given." };

  const rows = await prisma.proposal.findMany({
    where: {
      AND: [
        scopeForProposal(actor),
        {
          OR: [
            { referenceNo: { contains: q, mode: "insensitive" } },
            { project: { name: { contains: q, mode: "insensitive" } } },
            { project: { referenceNo: { contains: q, mode: "insensitive" } } },
            { parcels: { some: { village: { name: { contains: q, mode: "insensitive" } } } } },
            { parcels: { some: { district: { name: { contains: q, mode: "insensitive" } } } } },
          ],
        },
      ],
    },
    take: MAX_ROWS,
    orderBy: { updatedAt: "desc" },
    select: {
      referenceNo: true,
      status: true,
      currentHolderRole: true,
      project: { select: { name: true, referenceNo: true, governingAct: true } },
      parcels: { take: 1, select: { district: { select: { name: true } } } },
    },
  });

  if (rows.length === 0) {
    return { not_found: `No case matching "${q}" is visible to this user.` };
  }

  return {
    count: rows.length,
    cases: rows.map((r) => ({
      reference_no: r.referenceNo,
      stage: r.status,
      held_by: r.currentHolderRole,
      project: r.project.name,
      project_ref: r.project.referenceNo,
      act: r.project.governingAct,
      district: r.parcels[0]?.district?.name ?? null,
    })),
  };
}

/** Load one proposal under scope, with the fields every case tool needs. */
async function loadCase(actor: Actor, reference: string) {
  return prisma.proposal.findFirst({
    where: { AND: [scopeForProposal(actor), { referenceNo: reference }] },
    select: {
      id: true,
      referenceNo: true,
      status: true,
      currentHolderRole: true,
      purpose: true,
      proposedAreaHectares: true,
      acquiredAreaHectares: true,
      isUrgency: true,
      submittedAt: true,
      project: { select: { name: true, referenceNo: true, governingAct: true, estimatedCostCrore: true } },
      stages: {
        where: { exitedAt: null },
        orderBy: { enteredAt: "desc" },
        take: 1,
        select: { enteredAt: true, statutoryDeadline: true },
      },
      _count: { select: { objections: true, notifications: true, parcels: true } },
    },
  });
}

async function caseStatus(actor: Actor, input: Record<string, unknown>): Promise<ToolResult> {
  const ref = text(input.reference_no);
  if (!ref) return { not_found: "No reference number was given." };

  const c = await loadCase(actor, ref);
  if (!c) return { not_found: `Case ${ref} is not visible to this user.` };

  const open = c.stages[0];
  const clock = open
    ? computeClock(c.project.governingAct, c.status, open.enteredAt, open.statutoryDeadline)
    : null;

  return {
    reference_no: c.referenceNo,
    project: c.project.name,
    act: c.project.governingAct,
    stage: c.status,
    held_by: c.currentHolderRole,
    purpose: c.purpose,
    urgency_clause: c.isUrgency,
    proposed_hectares: c.proposedAreaHectares ? Number(c.proposedAreaHectares) : null,
    acquired_hectares: c.acquiredAreaHectares ? Number(c.acquiredAreaHectares) : null,
    parcels: c._count.parcels,
    objections_filed: c._count.objections,
    notifications_issued: c._count.notifications,
    entered_stage_on: open?.enteredAt ?? null,
    compliance_clock: clock
      ? {
          deadline: clock.deadline,
          days_remaining: clock.daysRemaining,
          severity: clock.severity,
          consequence_if_missed: clock.consequence,
          voids_the_acquisition: clock.isFatal,
          section: clock.section,
          message: clock.message,
        }
      : { message: "This stage has no statutory deadline." },
  };
}

async function diagnoseCase(actor: Actor, input: Record<string, unknown>): Promise<ToolResult> {
  const ref = text(input.reference_no);
  if (!ref) return { not_found: "No reference number was given." };

  const c = await prisma.proposal.findFirst({
    where: { AND: [scopeForProposal(actor), { referenceNo: ref }] },
    select: { id: true },
  });
  if (!c) return { not_found: `Case ${ref} is not visible to this user.` };

  const d = await diagnoseProposal(c.id, actor);
  if (!d) return { not_found: `Case ${ref} could not be diagnosed.` };

  // The Diagnosis object is rich; hand the model the decision-relevant parts.
  return { reference_no: ref, diagnosis: d as unknown as Record<string, unknown> };
}

async function compensationSummary(actor: Actor, input: Record<string, unknown>): Promise<ToolResult> {
  const ref = text(input.reference_no);
  if (!ref) return { not_found: "No reference number was given." };

  const c = await prisma.proposal.findFirst({
    where: { AND: [scopeForProposal(actor), { referenceNo: ref }] },
    select: { id: true, referenceNo: true },
  });
  if (!c) return { not_found: `Case ${ref} is not visible to this user.` };

  // AffectedFamily hangs off Village, not Proposal, so the families for a case are those in the
  // villages its parcels fall in — the same join the R&R pages use.
  const villages = await prisma.landParcel.findMany({
    where: { proposalId: c.id },
    select: { villageId: true },
    distinct: ["villageId"],
  });
  const villageIds = villages.map((v) => v.villageId);

  const [awards, paid, families, entitlements] = await Promise.all([
    prisma.award.aggregate({ where: { proposalId: c.id }, _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.payment.aggregate({
      where: { status: "PAID", compensation: { award: { proposalId: c.id } } },
      _sum: { amount: true },
    }),
    prisma.affectedFamily.count({ where: { villageId: { in: villageIds } } }),
    prisma.rnREntitlement.count({ where: { family: { villageId: { in: villageIds } } } }),
  ]);

  const assessed = rupees(awards._sum.totalAmount);
  const disbursed = rupees(paid._sum.amount);

  return {
    reference_no: c.referenceNo,
    awards_made: awards._count._all,
    assessed_rupees: assessed,
    paid_rupees: disbursed,
    outstanding_rupees: Math.max(0, assessed - disbursed),
    affected_families: families,
    rnr_entitlements: entitlements,
    possession_note:
      assessed - disbursed > 0
        ? "Compensation is outstanding — possession is blocked under LARR s.38 until it is paid."
        : "No outstanding compensation recorded against this case.",
  };
}

async function myLand(actor: Actor): Promise<ToolResult> {
  const rows = await prisma.landParcel.findMany({
    where: scopeForParcel(actor),
    take: MAX_ROWS,
    orderBy: { updatedAt: "desc" },
    select: {
      khasraNo: true,
      ulpin: true,
      computedAreaHectares: true,
      landUse: true,
      village: { select: { name: true } },
      district: { select: { name: true } },
      project: { select: { name: true, referenceNo: true } },
      proposal: { select: { referenceNo: true, status: true } },
    },
  });

  if (rows.length === 0) return { not_found: "No land parcels are visible to this user." };

  return {
    count: rows.length,
    parcels: rows.map((p) => ({
      khasra: p.khasraNo,
      ulpin: p.ulpin,
      hectares: p.computedAreaHectares ? Number(p.computedAreaHectares) : null,
      land_use: p.landUse,
      village: p.village?.name ?? null,
      district: p.district?.name ?? null,
      project: p.project?.name ?? null,
      case_ref: p.proposal?.referenceNo ?? null,
      case_stage: p.proposal?.status ?? null,
    })),
  };
}

/** Run one tool call under the actor's scope. */
export async function runTool(
  actor: Actor,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "find_cases":
        return await findCases(actor, input);
      case "case_status":
        return await caseStatus(actor, input);
      case "diagnose_case":
        return await diagnoseCase(actor, input);
      case "compensation_summary":
        return await compensationSummary(actor, input);
      case "my_land":
        return await myLand(actor);
      default:
        return { not_found: `No such tool: ${name}` };
    }
  } catch (err) {
    console.error(`[mitra] tool ${name} failed:`, err);
    return { not_found: `The ${name} lookup failed. Tell the user the system could not read that record.` };
  }
}
