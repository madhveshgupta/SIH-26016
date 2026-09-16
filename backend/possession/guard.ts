/** POSSESSION GUARD — LARR s.38. */
import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";

export type PossessionBlockReason =
  | "COMPENSATION_UNPAID"
  | "NO_AWARD"
  | "RNR_OUTSTANDING"
  | "ALREADY_POSSESSED";

export interface PossessionCheck {
  allowed: boolean;
  reason: PossessionBlockReason | null;
  /** Plain-language explanation citing the section, for the UI and the audit log. */
  message: string;
  outstandingAmount: number;
  totalAwarded: number;
  totalPaid: number;
  rnrOutstandingFamilies: number;
}

/** May possession be taken of this parcel? */
export async function checkPossessionAllowed(parcelId: string): Promise<PossessionCheck> {
  const existing = await prisma.possessionRecord.findUnique({ where: { parcelId } });
  if (existing) {
    return {
      allowed: false,
      reason: "ALREADY_POSSESSED",
      message: `Possession was already recorded on ${existing.takenOn.toISOString().slice(0, 10)}.`,
      outstandingAmount: 0, totalAwarded: 0, totalPaid: 0, rnrOutstandingFamilies: 0,
    };
  }

  const compensations = await prisma.compensationRecord.findMany({
    where: { parcelId },
    include: { payments: true },
  });

  if (compensations.length === 0) {
    return {
      allowed: false,
      reason: "NO_AWARD",
      message:
        "No compensation has been assessed for this parcel. Under s.38 possession cannot be taken before an award is made and paid.",
      outstandingAmount: 0, totalAwarded: 0, totalPaid: 0, rnrOutstandingFamilies: 0,
    };
  }

  let awarded = new Prisma.Decimal(0);
  let paid = new Prisma.Decimal(0);
  for (const c of compensations) {
    awarded = awarded.add(c.payableToOwner);
    for (const p of c.payments) {
      // Money deposited with the LARR Authority under s.77 counts as discharged:
      // the owner refused it or the title is disputed, and the Act provides for
      // exactly that so a project is not blocked indefinitely.
      if (p.status === "PAID" || p.status === "DEPOSITED_WITH_AUTHORITY") {
        paid = paid.add(p.amount);
      }
    }
  }

  const outstanding = awarded.sub(paid);
  const parcel = await prisma.landParcel.findUnique({
    where: { id: parcelId },
    select: { villageId: true },
  });

  // s.38 also requires monetary R&R entitlements to have been paid.
  const rnrOutstanding = parcel
    ? await prisma.affectedFamily.count({
        where: {
          villageId: parcel.villageId,
          status: { in: ["IDENTIFIED", "ENTITLEMENT_DETERMINED", "AWARD_PASSED"] },
        },
      })
    : 0;

  const base = {
    outstandingAmount: Number(outstanding.toString()),
    totalAwarded: Number(awarded.toString()),
    totalPaid: Number(paid.toString()),
    rnrOutstandingFamilies: rnrOutstanding,
  };

  if (outstanding.gt(0)) {
    const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
    return {
      ...base,
      allowed: false,
      reason: "COMPENSATION_UNPAID",
      message:
        `Possession refused under LARR s.38: ${fmt(base.outstandingAmount)} of ` +
        `${fmt(base.totalAwarded)} remains unpaid. Compensation must be paid in full before ` +
        `possession is taken.`,
    };
  }

  if (rnrOutstanding > 0) {
    return {
      ...base,
      allowed: false,
      reason: "RNR_OUTSTANDING",
      message:
        `Possession refused under LARR s.38: ${rnrOutstanding} affected famil` +
        `${rnrOutstanding === 1 ? "y has" : "ies have"} outstanding Rehabilitation & Resettlement ` +
        `entitlements. Monetary R&R must be discharged before possession.`,
    };
  }

  return {
    ...base,
    allowed: true,
    reason: null,
    message: "Compensation and R&R entitlements are discharged. Possession may be taken.",
  };
}

export interface TakePossessionInput {
  parcelId: string;
  actorId: string;
  takenOn?: Date;
  handedOverBy?: string;
  receivedBy?: string;
  photoLat?: number;
  photoLng?: number;
  remarks?: string;
}

/** Record possession — but only if s.38 permits it. */
export async function takePossession(
  input: TakePossessionInput,
): Promise<{ ok: true; id: string } | { ok: false; check: PossessionCheck }> {
  const check = await checkPossessionAllowed(input.parcelId);

  if (!check.allowed) {
    await appendAudit({
      actorId: input.actorId,
      action: "UPDATE",
      entityType: "PossessionRecord",
      entityId: input.parcelId,
      afterJson: {
        blocked: true,
        reason: check.reason,
        statutoryBasis: "LARR s.38",
        outstandingAmount: check.outstandingAmount,
      },
    });
    return { ok: false, check };
  }

  const record = await prisma.possessionRecord.create({
    data: {
      parcelId: input.parcelId,
      takenOn: input.takenOn ?? new Date(),
      handedOverBy: input.handedOverBy ?? null,
      receivedBy: input.receivedBy ?? null,
      photoLat: input.photoLat != null ? new Prisma.Decimal(input.photoLat) : null,
      photoLng: input.photoLng != null ? new Prisma.Decimal(input.photoLng) : null,
      remarks: input.remarks ?? null,
    },
  });

  await prisma.landParcel.update({
    where: { id: input.parcelId },
    data: { status: "POSSESSED" },
  });

  await appendAudit({
    actorId: input.actorId,
    action: "CREATE",
    entityType: "PossessionRecord",
    entityId: record.id,
    afterJson: {
      parcelId: input.parcelId,
      takenOn: record.takenOn,
      compensationVerified: check.totalPaid,
    },
  });

  return { ok: true, id: record.id };
}
