/** Public, anonymised figures — the transparency the Act is named for. */
import { prisma } from "@backend/db/client";
import { stageFor } from "@backend/workflow/engine";
import { geoRows, type GeoRow } from "@backend/analytics/geo";
import type { Actor } from "@backend/rbac/scope";

export async function publicStats() {
  try {
    const [projects, parcels, statesWithLand, utsWithLand, notifications, awards, payments, families] = await Promise.all([
      prisma.project.count(),
      prisma.landParcel.aggregate({ _count: { _all: true }, _sum: { computedAreaHectares: true } }),
      // States and Union Territories counted apart, so the page can say "28 states and 8 UTs".
      prisma.state.count({ where: { isUT: false, districts: { some: { parcels: { some: {} } } } } }),
      prisma.state.count({ where: { isUT: true, districts: { some: { parcels: { some: {} } } } } }),
      prisma.notification.count(),
      prisma.award.count(),
      prisma.payment.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
      prisma.affectedFamily.count(),
    ]);
    return {
      projects,
      parcels: parcels._count._all,
      hectares: Number(parcels._sum.computedAreaHectares ?? 0),
      statesWithLand,
      utsWithLand,
      notifications,
      awards,
      paidRupees: Number(payments._sum.amount ?? 0),
      families,
    };
  } catch (err) {
    console.warn("⚠ Database unavailable — returning demo stats:", (err as Error).message);
    return {
      projects: 0,
      parcels: 0,
      hectares: 0,
      statesWithLand: 0,
      utsWithLand: 0,
      notifications: 0,
      awards: 0,
      paidRupees: 0,
      families: 0,
    };
  }
}

/** The public map: land figures by state, or by district within one state. */
export async function publicGeo(stateId?: string | null): Promise<GeoRow[]> {
  const nation: Actor = {
    id: "public",
    role: "CENTRAL_MINISTRY",
    jurisdictionLevel: "NATIONAL",
    stateId: null,
    districtId: null,
    tehsilId: null,
    agencyId: null,
  };
  const rows = await geoRows(nation, stateId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    key: r.key,
    stateKey: r.stateKey,
    projects: r.projects,
    parcels: r.parcels,
    areaProposedHa: r.areaProposedHa,
    areaAcquiredHa: r.areaAcquiredHa,
    possessedPct: r.possessedPct,
    compensationAssessed: 0,
    compensationPaid: 0,
    compensationOutstanding: 0,
    affectedFamilies: 0,
    casesAtRisk: 0,
    conflicts: 0,
  }));
}

/** The metrics the public map may be coloured by — land only. */
export const PUBLIC_GEO_METRICS = ["areaProposedHa", "areaAcquiredHa", "possessedPct", "parcels", "projects"] as const;

/** Public status of one application by its reference number. */
export async function publicTrack(referenceNo: string) {
  const p = await prisma.proposal.findUnique({
    where: { referenceNo: referenceNo.trim().toUpperCase() },
    include: {
      project: { select: { name: true, type: true, governingAct: true, states: { select: { state: { select: { name: true } } } } } },
      stages: { orderBy: { enteredAt: "asc" }, select: { stage: true, enteredAt: true, exitedAt: true, action: true, statutoryDeadline: true } },
      _count: { select: { parcels: true, notifications: true, objections: true } },
    },
  });
  if (!p) return null;
  const act = p.project.governingAct;
  return {
    referenceNo: p.referenceNo,
    act,
    project: p.project.name,
    type: p.project.type,
    states: p.project.states.map((s) => s.state.name),
    status: p.status,
    statusLabel: stageFor(act, p.status)?.label ?? p.status,
    submittedAt: p.submittedAt,
    parcels: p._count.parcels,
    notifications: p._count.notifications,
    objections: p._count.objections,
    stages: p.stages.map((s) => ({
      stage: s.stage,
      label: stageFor(act, s.stage)?.label ?? s.stage,
      section: stageFor(act, s.stage)?.section ?? null,
      enteredAt: s.enteredAt,
      exitedAt: s.exitedAt,
      action: s.action,
      deadline: s.statutoryDeadline,
    })),
  };
}
