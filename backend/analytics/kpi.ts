/** NATIONAL DASHBOARD KPIs. */
import { prisma } from "@backend/db/client";
import type { Actor } from "@backend/rbac/scope";
import { rollupLevel, scopeForFamily, scopeForParcel, scopeForProposal, scopeForProject } from "@backend/rbac/scope";
import { computeClock } from "@backend/statutory/clock";
import { EMPTY_FILTER, familyFilter, parcelFilter, projectFilter, proposalFilter, type DashboardFilter } from "@backend/analytics/filters";

export interface Kpis {
  // --- the eight the PS names -------------------------------------------
  areaNotifiedHa: number;
  areaAcquiredHa: number;
  compensationAssessed: number;
  compensationPaid: number;
  affectedFamilies: number;
  displacedFamilies: number;
  rnrCompletionPct: number;
  projectProgressPct: number;
  parcelsPossessed: number;
  parcelsTotal: number;
  timelineAdherencePct: number;
  // --- ours, and the one nobody else can produce -------------------------
  areaProposedHa: number;
  compensationOutstanding: number;
  notificationsIssued: number;
  awardsDeclared: number;
  casesAtRiskOfLapse: number;
  casesBreached: number;
  conflictingParcels: number;
}

export async function computeKpis(actor: Actor, filter: DashboardFilter = EMPTY_FILTER): Promise<Kpis> {
  // Scope AND filter: the filter can only narrow what the scope already allows.
  const parcelWhere = { AND: [scopeForParcel(actor), ...parcelFilter(filter)] };
  const proposalWhere = { AND: [scopeForProposal(actor), ...proposalFilter(filter)] };
  const projectWhere = { AND: [scopeForProject(actor), ...projectFilter(filter)] };
  const familyWhere = { AND: [scopeForFamily(actor), ...familyFilter(filter)] };

  const [
    parcels, proposals, projects, comps, families, displaced,
    rnrDone, rnrTotal, notifications, awards, conflicts,
  ] = await Promise.all([
    prisma.landParcel.findMany({
      where: parcelWhere,
      select: { status: true, declaredAreaHectares: true },
    }),
    prisma.proposal.findMany({
      where: proposalWhere,
      select: {
        status: true, proposedAreaHectares: true, createdAt: true,
        project: { select: { governingAct: true } },
        stages: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" } },
      },
    }),
    prisma.project.count({ where: projectWhere }),
    // Every figure below is scoped too.
    prisma.compensationRecord.findMany({
      where: { parcel: parcelWhere },
      select: { payableToOwner: true, payments: { select: { amount: true, status: true } } },
    }),
    prisma.affectedFamily.count({ where: familyWhere }),
    prisma.affectedFamily.count({ where: { AND: [familyWhere, { isDisplaced: true }] } }),
    prisma.affectedFamily.count({ where: { AND: [familyWhere, { status: { in: ["RESETTLED", "LIVELIHOOD_RESTORED"] } }] } }),
    prisma.affectedFamily.count({ where: familyWhere }),
    prisma.notification.count({ where: { proposal: proposalWhere } }),
    prisma.award.count({ where: { proposal: proposalWhere } }),
    prisma.landParcel.count({ where: { AND: [parcelWhere, { hasConflict: true }] } }),
  ]);

  const ha = (s: string[]) =>
    parcels.filter((p) => s.includes(p.status)).reduce((a, p) => a + Number(p.declaredAreaHectares), 0);

  // "Notified" means the acquisition has been publicly announced — everything
  // from notification onward, not just parcels sitting at NOTIFIED today.
  const areaNotifiedHa = ha([
    "NOTIFIED", "OBJECTED", "AWARD_DECLARED", "COMPENSATED", "POSSESSED",
  ]);
  // "Acquired" is the meaningful end state: paid for, or in hand.
  const areaAcquiredHa = ha(["COMPENSATED", "POSSESSED"]);
  const areaProposedHa = parcels.reduce((a, p) => a + Number(p.declaredAreaHectares), 0);

  let assessed = 0, paid = 0;
  for (const c of comps) {
    assessed += Number(c.payableToOwner);
    for (const p of c.payments) {
      if (p.status === "PAID" || p.status === "DEPOSITED_WITH_AUTHORITY") paid += Number(p.amount);
    }
  }

  // Statutory risk — the number no existing system can produce.
  let atRisk = 0, breached = 0, onTime = 0, withDeadline = 0;
  for (const p of proposals) {
    const open = p.stages[0];
    const clock = computeClock(
      p.project.governingAct, p.status,
      open?.enteredAt ?? p.createdAt, open?.statutoryDeadline ?? null,
    );
    if (!clock.deadline) continue;
    withDeadline++;
    if (clock.severity === "BREACHED") breached++;
    else {
      onTime++;
      if (clock.isFatal && clock.severity === "CRITICAL") atRisk++;
    }
  }

  const possessed = parcels.filter((p) => p.status === "POSSESSED").length;

  return {
    areaNotifiedHa,
    areaAcquiredHa,
    areaProposedHa,
    compensationAssessed: assessed,
    compensationPaid: paid,
    compensationOutstanding: Math.max(0, assessed - paid),
    affectedFamilies: families,
    displacedFamilies: displaced,
    rnrCompletionPct: rnrTotal === 0 ? 0 : Math.round((rnrDone / rnrTotal) * 100),
    projectProgressPct:
      areaProposedHa === 0 ? 0 : Math.round((areaAcquiredHa / areaProposedHa) * 100),
    parcelsPossessed: possessed,
    parcelsTotal: parcels.length,
    timelineAdherencePct: withDeadline === 0 ? 100 : Math.round((onTime / withDeadline) * 100),
    notificationsIssued: notifications,
    awardsDeclared: awards,
    casesAtRiskOfLapse: atRisk,
    casesBreached: breached,
    conflictingParcels: conflicts,
    projectProgressProjects: projects,
  } as Kpis & { projectProgressProjects: number };
}

/**
 * Rollup one level below the viewer: states for a national officer, districts for a state
 * officer, projects for a district officer.
 */
export async function jurisdictionRollup(actor: Actor, filter: DashboardFilter = EMPTY_FILTER) {
  const parcels = await prisma.landParcel.findMany({
    where: { AND: [scopeForParcel(actor), ...parcelFilter(filter)] },
    select: {
      status: true,
      declaredAreaHectares: true,
      hasConflict: true,
      project: { select: { id: true, name: true } },
      district: { select: { id: true, name: true, state: { select: { id: true, name: true } } } },
    },
  });
  const level = rollupLevel(actor);
  const rows = new Map<string, { id: string; name: string; parcels: number; hectares: number; possessed: number; conflicts: number }>();
  for (const p of parcels) {
    const key =
      level === "state" ? p.district.state : level === "district" ? { id: p.district.id, name: p.district.name } : p.project;
    const r = rows.get(key.id) ?? { id: key.id, name: key.name, parcels: 0, hectares: 0, possessed: 0, conflicts: 0 };
    r.parcels++;
    r.hectares += Number(p.declaredAreaHectares);
    if (p.status === "POSSESSED") r.possessed++;
    if (p.hasConflict) r.conflicts++;
    rows.set(key.id, r);
  }
  return { level, rows: [...rows.values()].sort((a, b) => b.hectares - a.hectares) };
}

/** Parcel counts by acquisition status, scoped. */
export async function parcelStatusCounts(actor: Actor, filter: DashboardFilter = EMPTY_FILTER) {
  const rows = await prisma.landParcel.groupBy({
    by: ["status"],
    where: { AND: [scopeForParcel(actor), ...parcelFilter(filter)] },
    _count: { _all: true },
  });
  return rows.map((r) => ({ status: r.status, count: r._count._all }));
}

/** Stage-wise funnel — the most revealing chart on the dashboard. */
export async function stageFunnel(actor: Actor, filter: DashboardFilter = EMPTY_FILTER) {
  const rows = await prisma.proposal.groupBy({
    by: ["status"],
    where: { AND: [scopeForProposal(actor), ...proposalFilter(filter)] },
    _count: { _all: true },
    _sum: { proposedAreaHectares: true },
  });
  return rows.map((r) => ({
    status: r.status,
    count: r._count._all,
    hectares: Number(r._sum.proposedAreaHectares ?? 0),
  }));
}

/** Bottleneck detection — average days cases sit at each stage. */
export async function stageDwellTimes(actor: Actor, filter: DashboardFilter = EMPTY_FILTER) {
  const proposals = await prisma.proposal.findMany({ where: { AND: [scopeForProposal(actor), ...proposalFilter(filter)] }, select: { id: true } });
  const ids = proposals.map((p) => p.id);
  if (ids.length === 0) return [];
  return prisma.$queryRaw<{ stage: string; avgDays: number; cases: bigint }[]>`
    SELECT stage::text,
           AVG(EXTRACT(EPOCH FROM (COALESCE("exitedAt", NOW()) - "enteredAt")) / 86400)::float8 AS "avgDays",
           COUNT(*)::bigint AS cases
      FROM "ProposalStage"
     WHERE "proposalId" = ANY(${ids})
     GROUP BY stage
     ORDER BY "avgDays" DESC;
  `;
}
