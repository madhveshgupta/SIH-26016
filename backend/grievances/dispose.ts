/** Answering a citizen's representation. */
import type { GrievanceStatus, RoleType } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import { CATEGORY_LABEL, STATUS_LABEL } from "./catalogue";

/** Statuses that close a grievance, and so require reasons. */
const TERMINAL: GrievanceStatus[] = ["RESOLVED", "REJECTED", "REFERRED"];

export interface DisposeGrievanceInput {
  grievanceId: string;
  status: GrievanceStatus;
  decision?: string | null;
  decisionReasons?: string | null;
  actorId: string;
  actorRole: RoleType;
}

export async function disposeGrievance(input: DisposeGrievanceInput) {
  const grievance = await prisma.grievance.findUnique({
    where: { id: input.grievanceId },
    include: { parcel: { select: { khasraNo: true } } },
  });
  if (!grievance) throw new Error("Grievance not found");

  if (input.actorRole !== "SUPER_ADMIN" && input.actorRole !== grievance.authorityRole) {
    throw new Error(`This is for ${grievance.authorityLabel} to answer, under ${grievance.statuteSection}.`);
  }
  if (grievance.decidedAt) throw new Error("This has already been disposed of");

  const closing = TERMINAL.includes(input.status);
  const reasons = input.decisionReasons?.trim() ?? "";
  if (closing && reasons.length < 20) {
    throw new Error(
      "Written reasons are required to close a representation. The citizen is entitled to read why.",
    );
  }

  const before = { status: grievance.status, decidedAt: grievance.decidedAt };
  const updated = await prisma.grievance.update({
    where: { id: grievance.id },
    data: {
      status: input.status,
      decision: closing ? input.decision?.trim() || STATUS_LABEL[input.status] : null,
      decisionReasons: closing ? reasons : null,
      decidedAt: closing ? new Date() : null,
    },
  });

  // Tell the person who raised it.
  await prisma.alert.create({
    data: {
      type: closing ? "GRIEVANCE_DECIDED" : "GRIEVANCE_PROGRESS",
      severity: "INFO",
      title: `${CATEGORY_LABEL[grievance.category]} — ${STATUS_LABEL[input.status]}`,
      message: closing
        ? `${grievance.referenceNo} has been disposed of by ${grievance.authorityLabel}: ${updated.decision}. Reasons are on the case record.`
        : `${grievance.referenceNo} is now ${STATUS_LABEL[input.status].toLowerCase()} with ${grievance.authorityLabel}.`,
      proposalId: grievance.proposalId,
      recipientId: grievance.filedByUserId,
      channels: ["IN_APP"],
    },
  });

  await appendAudit({
    actorId: input.actorId,
    action: "UPDATE",
    entityType: "Grievance",
    entityId: grievance.id,
    beforeJson: before,
    afterJson: { status: updated.status, decision: updated.decision, decidedAt: updated.decidedAt },
  });

  return updated;
}
