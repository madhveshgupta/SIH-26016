/** Getting the money to the person — LARR ss.31, 38, 77. */
import { Prisma, type PaymentStatus } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import { instructPayment, paymentStatus } from "@backend/integrations/adapters/payments";
import { sendMessage } from "@backend/integrations/adapters/notify";
import { scopeForParcel, type Actor } from "@backend/rbac/scope";

export interface DisburseInput {
  compensationId: string;
  actor: Actor;
  /** Where the entitled person cannot be paid, the amount goes to the Authority. */
  depositWithAuthority?: boolean;
  depositReason?: string;
}

export interface DisburseResult {
  status: PaymentStatus;
  utrNumber: string | null;
  amount: number;
  message: string;
}

/** The viewer's plots, narrowed to one project when the page is about one. */
function parcelScope(actor: Actor, projectId?: string) {
  return projectId ? { AND: [scopeForParcel(actor), { projectId }] } : scopeForParcel(actor);
}

/** The records an officer may act on, with everything needed to pay them. */
export async function disbursementQueue(actor: Actor, limit = 100, projectId?: string) {
  return prisma.compensationRecord.findMany({
    where: { parcel: parcelScope(actor, projectId) },
    orderBy: [{ assessedAt: "asc" }],
    take: limit,
    select: {
      id: true, payableToOwner: true, ownerSharePct: true, assessedAt: true, awardId: true,
      owner: { select: { id: true, fullName: true, bankAccountMasked: true, bankIfsc: true, phone: true } },
      parcel: {
        select: {
          id: true, khasraNo: true, status: true,
          village: { select: { name: true } },
          district: { select: { name: true } },
          project: { select: { name: true } },
        },
      },
      award: { select: { awardNo: true, declaredOn: true } },
      payments: { select: { id: true, amount: true, status: true, utrNumber: true, paidAt: true, failureReason: true }, orderBy: { createdAt: "desc" } },
    },
  });
}

/** Assessed, paid and outstanding — the reconciliation the PS asks for. */
export async function reconciliation(actor: Actor, projectId?: string) {
  const records = await prisma.compensationRecord.findMany({
    where: { parcel: parcelScope(actor, projectId) },
    select: {
      payableToOwner: true,
      payments: { select: { amount: true, status: true } },
      parcel: { select: { district: { select: { id: true, name: true, state: { select: { name: true } } } } } },
    },
  });

  let assessed = 0, paid = 0, deposited = 0, instructed = 0, failed = 0;
  const byDistrict = new Map<string, { district: string; state: string; assessed: number; paid: number; outstanding: number; records: number }>();

  for (const r of records) {
    const owed = Number(r.payableToOwner);
    assessed += owed;
    let recordPaid = 0;
    for (const p of r.payments) {
      const amount = Number(p.amount);
      if (p.status === "PAID") { paid += amount; recordPaid += amount; }
      else if (p.status === "DEPOSITED_WITH_AUTHORITY") { deposited += amount; recordPaid += amount; }
      else if (p.status === "INSTRUCTED") instructed += amount;
      else if (p.status === "FAILED") failed += amount;
    }
    const d = r.parcel.district;
    const row = byDistrict.get(d.id) ?? { district: d.name, state: d.state.name, assessed: 0, paid: 0, outstanding: 0, records: 0 };
    row.assessed += owed;
    row.paid += recordPaid;
    row.outstanding += Math.max(0, owed - recordPaid);
    row.records++;
    byDistrict.set(d.id, row);
  }

  return {
    assessed,
    paid,
    deposited,
    instructed,
    failed,
    // Deposits with the Authority discharge the obligation: they are not outstanding.
    outstanding: Math.max(0, assessed - paid - deposited),
    records: records.length,
    byDistrict: [...byDistrict.values()].sort((a, b) => b.outstanding - a.outstanding),
  };
}

/** Instruct payment of one compensation record. */
export async function disburse(input: DisburseInput): Promise<DisburseResult> {
  const record = await prisma.compensationRecord.findFirst({
    where: { AND: [{ id: input.compensationId }, { parcel: scopeForParcel(input.actor) }] },
    select: {
      id: true, payableToOwner: true, awardId: true,
      owner: { select: { fullName: true, bankAccountMasked: true, bankIfsc: true, phone: true } },
      parcel: { select: { id: true, khasraNo: true, project: { select: { name: true } } } },
      payments: { select: { id: true, status: true, amount: true } },
      award: { select: { awardNo: true } },
    },
  });
  if (!record) throw new Error("Compensation record not found");
  if (!record.awardId) throw new Error("Compensation cannot be paid before the award is declared (s.30)");

  const settled = record.payments.find((p) => p.status === "PAID" || p.status === "DEPOSITED_WITH_AUTHORITY");
  if (settled) throw new Error("This compensation has already been settled");
  const inFlight = record.payments.find((p) => p.status === "INSTRUCTED");
  if (inFlight) throw new Error("A payment instruction for this record is already with the bank");

  const amount = Number(record.payableToOwner);
  if (amount <= 0) throw new Error("There is nothing to pay on this record");

  // --- s.77: deposit with the LARR Authority --------------------------------
  if (input.depositWithAuthority) {
    const reason = input.depositReason?.trim();
    if (!reason || reason.length < 10) {
      throw new Error("State why the amount cannot be paid to the person (s.77 requires a reason)");
    }
    const payment = await prisma.payment.create({
      data: {
        compensationId: record.id,
        amount: new Prisma.Decimal(amount),
        status: "DEPOSITED_WITH_AUTHORITY",
        paidAt: new Date(),
        failureReason: reason,
      },
    });
    await appendAudit({
      actorId: input.actor.id,
      action: "CREATE",
      entityType: "Payment",
      entityId: payment.id,
      afterJson: { compensationId: record.id, amount, status: "DEPOSITED_WITH_AUTHORITY", reason },
    });
    return {
      status: "DEPOSITED_WITH_AUTHORITY",
      utrNumber: null,
      amount,
      message: "Deposited with the LARR Authority under s.77. The entitled person may claim it from the Authority at any time.",
    };
  }

  // --- the ordinary path: instruct the bank ---------------------------------
  if (!record.owner.bankAccountMasked || !record.owner.bankIfsc) {
    throw new Error("No bank account is recorded for this person — record one, or deposit with the Authority under s.77");
  }

  const ack = await instructPayment({
    reference: record.id,
    amount,
    beneficiaryName: record.owner.fullName,
    accountMasked: record.owner.bankAccountMasked,
    ifsc: record.owner.bankIfsc,
    purpose: `Land acquisition compensation — khasra ${record.parcel.khasraNo}, ${record.parcel.project.name}`,
  });

  if (!ack.ok || !ack.data) {
    const payment = await prisma.payment.create({
      data: { compensationId: record.id, amount: new Prisma.Decimal(amount), status: "PENDING", failureReason: ack.error },
    });
    await appendAudit({
      actorId: input.actor.id, action: "CREATE", entityType: "Payment", entityId: payment.id,
      afterJson: { compensationId: record.id, amount, status: "PENDING", gatewayError: ack.error },
    });
    return { status: "PENDING", utrNumber: null, amount, message: `The payments gateway could not be reached (${ack.error}). The instruction is queued.` };
  }

  const failed = ack.data.status === "FAILED";
  const payment = await prisma.payment.create({
    data: {
      compensationId: record.id,
      amount: new Prisma.Decimal(amount),
      status: failed ? "FAILED" : "INSTRUCTED",
      utrNumber: ack.data.utrNumber,
      instructedAt: new Date(),
      failureReason: ack.data.failureReason,
    },
  });

  await appendAudit({
    actorId: input.actor.id,
    action: "CREATE",
    entityType: "Payment",
    entityId: payment.id,
    afterJson: { compensationId: record.id, amount, status: payment.status, utr: ack.data.utrNumber, latencyMs: ack.latencyMs },
  });

  // Tell the person their money is on the way — or that it bounced.
  if (record.owner.phone) {
    await sendMessage({
      channel: "SMS",
      to: record.owner.phone,
      about: failed ? "compensation payment failed" : "compensation payment instructed",
      body: failed
        ? `Bhoomi Nayan: payment of your land compensation could not be completed (${ack.data.failureReason}). Please contact the Collector's office.`
        : `Bhoomi Nayan: ₹${amount.toLocaleString("en-IN")} compensation for khasra ${record.parcel.khasraNo} has been sent to your bank. Reference ${ack.data.utrNumber}.`,
    });
  }

  return {
    status: failed ? "FAILED" : "INSTRUCTED",
    utrNumber: ack.data.utrNumber,
    amount,
    message: failed
      ? `The bank rejected the payment: ${ack.data.failureReason}. Correct the details, or deposit with the Authority under s.77.`
      : `Instructed. Reference ${ack.data.utrNumber}; the credit is confirmed when the bank settles it.`,
  };
}

/**
 * Ask the gateway to confirm instructions that are still in flight, and record the ones that
 * have settled.
 */
export async function settleInstructedPayments(actor: Actor, limit = 25, projectId?: string) {
  const pending = await prisma.payment.findMany({
    where: { status: "INSTRUCTED", compensation: { parcel: parcelScope(actor, projectId) } },
    take: limit,
    select: { id: true, utrNumber: true, compensationId: true, amount: true, compensation: { select: { parcelId: true } } },
  });

  let settled = 0;
  for (const p of pending) {
    if (!p.utrNumber) continue;
    const status = await paymentStatus(p.compensationId, p.utrNumber);
    if (!status.ok || status.data?.status !== "PAID") continue;
    await prisma.payment.update({ where: { id: p.id }, data: { status: "PAID", paidAt: new Date() } });
    await appendAudit({
      actorId: actor.id, action: "UPDATE", entityType: "Payment", entityId: p.id,
      beforeJson: { status: "INSTRUCTED" }, afterJson: { status: "PAID", utr: p.utrNumber },
    });
    settled++;
  }

  // A parcel whose compensation is fully settled becomes COMPENSATED — which
  // is what unlocks possession under s.38.
  const touched = [...new Set(pending.map((p) => p.compensation.parcelId))];
  for (const parcelId of touched) {
    const records = await prisma.compensationRecord.findMany({
      where: { parcelId },
      select: { payableToOwner: true, payments: { select: { amount: true, status: true } } },
    });
    const fullySettled = records.every((r) => {
      const credited = r.payments
        .filter((p) => p.status === "PAID" || p.status === "DEPOSITED_WITH_AUTHORITY")
        .reduce((a, p) => a + Number(p.amount), 0);
      return credited >= Number(r.payableToOwner) - 1;
    });
    if (fullySettled && records.length) {
      await prisma.landParcel.updateMany({ where: { id: parcelId, status: "AWARD_DECLARED" }, data: { status: "COMPENSATED" } });
    }
  }

  return { checked: pending.length, settled };
}
