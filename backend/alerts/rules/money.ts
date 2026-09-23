/** Rules about money reaching the people whose land is taken. */
import { prisma } from "@backend/db/client";
import { daysBetween } from "@backend/statutory/clock";
import { SUPERIOR } from "@backend/alerts/recipients";
import { geographyOf, inr, plural, PROJECT_GEO_SELECT, type Finding, type Rule } from "./types";

/** Payment statuses that discharge the award (s.77 deposit included). */
const SETTLED = new Set(["PAID", "DEPOSITED_WITH_AUTHORITY"]);

/** Warn at two months, so there is a month left to pay before s.38(1) is missed. */
const WARN_DAYS = 60;
const DUE_DAYS = 90;

/**
 * Compensation still unpaid 60 and 90 days after the award, one alert per case rather than per
 * owner.
 */
export const compensationUnpaid: Rule = async (now) => {
  const cutoff = new Date(now.getTime() - WARN_DAYS * 86_400_000);
  const records = await prisma.compensationRecord.findMany({
    where: { award: { declaredOn: { lte: cutoff } } },
    select: {
      payableToOwner: true,
      payments: { select: { status: true, amount: true } },
      award: {
        select: {
          id: true,
          awardNo: true,
          declaredOn: true,
          proposal: { select: { id: true, referenceNo: true, project: { select: { name: true, ...PROJECT_GEO_SELECT } } } },
        },
      },
    },
  });

  type Case = { proposal: NonNullable<(typeof records)[number]["award"]>["proposal"]; owners: number; outstanding: number; oldest: { id: string; awardNo: string; declaredOn: Date } };
  const byCase = new Map<string, Case>();
  for (const r of records) {
    if (!r.award) continue;
    const paid = r.payments.filter((p) => SETTLED.has(p.status)).reduce((s, p) => s + Number(p.amount), 0);
    const outstanding = Number(r.payableToOwner) - paid;
    if (outstanding < 1) continue;
    const c = byCase.get(r.award.proposal.id) ?? { proposal: r.award.proposal, owners: 0, outstanding: 0, oldest: r.award };
    c.owners += 1;
    c.outstanding += outstanding;
    if (r.award.declaredOn < c.oldest.declaredOn) c.oldest = r.award;
    byCase.set(c.proposal.id, c);
  }

  const out: Finding[] = [];
  for (const c of byCase.values()) {
    const days = daysBetween(c.oldest.declaredOn, now);
    const overdue = days > DUE_DAYS;
    out.push({
      key: `PAY:${c.oldest.id}:${overdue ? DUE_DAYS : WARN_DAYS}`,
      type: overdue ? "COMPENSATION_OVERDUE" : "COMPENSATION_UNPAID",
      severity: overdue ? "CRITICAL" : "WARNING",
      title: `${overdue ? "Overdue" : "Due soon"}: compensation unpaid — ${c.proposal.referenceNo}`,
      message:
        `${inr(c.outstanding)} is still owed to ${plural(c.owners, "owner")}. Award ${c.oldest.awardNo} was declared ${plural(days, "day")} ago; ` +
        (overdue
          ? `s.38(1) requires payment within ${DUE_DAYS} days, and possession cannot be taken until it is made.`
          : `s.38(1) requires payment within ${DUE_DAYS} days — ${plural(DUE_DAYS - days, "day")} left.`) +
        ` ${c.proposal.project.name}.`,
      proposalId: c.proposal.id,
      to: ["DISTRICT_COLLECTOR"],
      geo: geographyOf(c.proposal.project),
      escalateTo: overdue ? SUPERIOR.DISTRICT_COLLECTOR : null,
    });
  }
  return out;
};

/** A payment the treasury rejected. Nobody is paid until someone re-issues it. */
export const paymentFailed: Rule = async () => {
  const failed = await prisma.payment.findMany({
    where: { status: "FAILED" },
    select: {
      id: true,
      amount: true,
      failureReason: true,
      compensation: {
        select: {
          owner: { select: { fullName: true } },
          parcel: {
            select: {
              khasraNo: true,
              proposal: { select: { id: true, referenceNo: true, project: { select: { name: true, ...PROJECT_GEO_SELECT } } } },
            },
          },
        },
      },
    },
  });
  return failed.flatMap((p): Finding[] => {
    const proposal = p.compensation.parcel.proposal;
    if (!proposal) return [];
    return [{
      key: `PAYFAIL:${p.id}`,
      type: "PAYMENT_FAILED",
      severity: "WARNING",
      title: `Payment failed — ${proposal.referenceNo}`,
      message:
        `${inr(Number(p.amount))} to ${p.compensation.owner.fullName} for khasra ${p.compensation.parcel.khasraNo} was not credited` +
        `${p.failureReason ? `: ${p.failureReason}` : ""}. Correct the account details and re-issue it. ${proposal.project.name}.`,
      proposalId: proposal.id,
      to: ["DISTRICT_COLLECTOR"],
      geo: geographyOf(proposal.project),
    }];
  });
};

/**
 * Possession recorded on a plot whose compensation is not fully paid. s.38
 * forbids exactly this, so it goes to the Collector and the State at once.
 */
export const possessionBeforePayment: Rule = async () => {
  const taken = await prisma.possessionRecord.findMany({
    select: {
      parcelId: true,
      takenOn: true,
      parcel: {
        select: {
          khasraNo: true,
          compensations: { select: { payableToOwner: true, payments: { select: { status: true, amount: true } } } },
          proposal: { select: { id: true, referenceNo: true, project: { select: { name: true, ...PROJECT_GEO_SELECT } } } },
        },
      },
    },
  });
  const out: Finding[] = [];
  for (const t of taken) {
    const { parcel } = t;
    if (!parcel.proposal) continue;
    const owed = parcel.compensations.reduce(
      (s, c) => s + Number(c.payableToOwner) - c.payments.filter((p) => SETTLED.has(p.status)).reduce((a, p) => a + Number(p.amount), 0),
      0,
    );
    if (owed < 1 && parcel.compensations.length > 0) continue;
    out.push({
      key: `POSS:${t.parcelId}`,
      type: "POSSESSION_BEFORE_PAYMENT",
      severity: "CRITICAL",
      title: `Possession before payment — khasra ${parcel.khasraNo}, ${parcel.proposal.referenceNo}`,
      message:
        `Possession was recorded on ${t.takenOn.toISOString().slice(0, 10)} while ` +
        (parcel.compensations.length ? `${inr(owed)} of compensation is unpaid` : "no compensation has been assessed") +
        `. s.38 allows possession only after payment. ${parcel.proposal.project.name}.`,
      proposalId: parcel.proposal.id,
      to: ["DISTRICT_COLLECTOR"],
      geo: geographyOf(parcel.proposal.project),
      escalateTo: SUPERIOR.DISTRICT_COLLECTOR,
    });
  }
  return out;
};
