/** The national map's numbers: one row per state, or per district of a state. */
import { prisma } from "@backend/db/client";
import type { Actor } from "@backend/rbac/scope";
import { scopeForFamily, scopeForParcel, scopeForProposal } from "@backend/rbac/scope";
import { EMPTY_FILTER, familyFilter, parcelFilter, proposalFilter, type DashboardFilter } from "@backend/analytics/filters";

/** Must match the normalisation used by scripts/harvest-boundaries.ts. */
export function normalise(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

export interface GeoRow {
  id: string;
  name: string;
  /** Join key for the boundary file. */
  key: string;
  /** Present on districts: which state's map they belong to. */
  stateKey?: string;
  projects: number;
  parcels: number;
  areaProposedHa: number;
  areaAcquiredHa: number;
  possessedPct: number;
  compensationAssessed: number;
  compensationPaid: number;
  compensationOutstanding: number;
  affectedFamilies: number;
  casesAtRisk: number;
  conflicts: number;
}

/** Every metric the map can be coloured by. */
export const GEO_METRICS = {
  areaProposedHa: { label: "Area proposed (ha)", format: "area" },
  areaAcquiredHa: { label: "Area acquired (ha)", format: "area" },
  possessedPct: { label: "Possession (%)", format: "pct" },
  compensationPaid: { label: "Compensation paid", format: "money" },
  compensationOutstanding: { label: "Compensation outstanding", format: "money" },
  affectedFamilies: { label: "Affected families", format: "count" },
  casesAtRisk: { label: "Cases at risk of lapse", format: "count" },
  conflicts: { label: "Plots claimed twice", format: "count" },
  parcels: { label: "Parcels", format: "count" },
  projects: { label: "Projects", format: "count" },
} as const;

export type GeoMetric = keyof typeof GEO_METRICS;

function blank(id: string, name: string, key: string, stateKey?: string): GeoRow {
  return {
    id, name, key, stateKey,
    projects: 0, parcels: 0, areaProposedHa: 0, areaAcquiredHa: 0, possessedPct: 0,
    compensationAssessed: 0, compensationPaid: 0, compensationOutstanding: 0,
    affectedFamilies: 0, casesAtRisk: 0, conflicts: 0,
  };
}

const ACQUIRED = new Set(["COMPENSATED", "POSSESSED"]);

/** Figures per state, or per district within one state. */
export async function geoRows(actor: Actor, stateId?: string | null, filter: DashboardFilter = EMPTY_FILTER): Promise<GeoRow[]> {
  const byDistrict = Boolean(stateId);

  const parcels = await prisma.landParcel.findMany({
    where: { AND: [scopeForParcel(actor), ...parcelFilter(filter), stateId ? { district: { stateId } } : {}] },
    select: {
      status: true, hasConflict: true, projectId: true, declaredAreaHectares: true,
      district: { select: { id: true, name: true, state: { select: { id: true, name: true } } } },
    },
  });

  const rows = new Map<string, GeoRow>();
  const projectsSeen = new Map<string, Set<string>>();
  for (const p of parcels) {
    const unit = byDistrict
      ? { id: p.district.id, name: p.district.name }
      : { id: p.district.state.id, name: p.district.state.name };
    const row =
      rows.get(unit.id) ??
      blank(unit.id, unit.name, normalise(unit.name), byDistrict ? normalise(p.district.state.name) : undefined);
    row.parcels++;
    row.areaProposedHa += Number(p.declaredAreaHectares);
    if (ACQUIRED.has(p.status)) row.areaAcquiredHa += Number(p.declaredAreaHectares);
    if (p.status === "POSSESSED") row.possessedPct++; // counted here, turned into a share below
    if (p.hasConflict) row.conflicts++;
    rows.set(unit.id, row);
    const seen = projectsSeen.get(unit.id) ?? new Set<string>();
    seen.add(p.projectId);
    projectsSeen.set(unit.id, seen);
  }

  // --- compensation, by the district the parcel sits in ---------------------
  const comps = await prisma.compensationRecord.findMany({
    where: { parcel: { AND: [scopeForParcel(actor), ...parcelFilter(filter), stateId ? { district: { stateId } } : {}] } },
    select: {
      // Assessed is the owner's share, and paid counts a s.77 deposit with the
      // LARR Authority as paid — the same definition the KPI tiles use.
      payableToOwner: true,
      payments: { select: { amount: true, status: true } },
      parcel: { select: { districtId: true, district: { select: { stateId: true } } } },
    },
  });
  for (const c of comps) {
    const key = byDistrict ? c.parcel.districtId : c.parcel.district.stateId;
    const row = rows.get(key);
    if (!row) continue;
    row.compensationAssessed += Number(c.payableToOwner);
    for (const p of c.payments) {
      if (p.status === "PAID" || p.status === "DEPOSITED_WITH_AUTHORITY") row.compensationPaid += Number(p.amount);
    }
  }

  // --- affected families, by the village's district ------------------------
  const families = await prisma.affectedFamily.findMany({
    where: { AND: [scopeForFamily(actor), ...familyFilter(filter), stateId ? { village: { tehsil: { district: { stateId } } } } : {}] },
    select: { village: { select: { tehsil: { select: { districtId: true, district: { select: { stateId: true } } } } } } },
  });
  for (const f of families) {
    const key = byDistrict ? f.village.tehsil.districtId : f.village.tehsil.district.stateId;
    const row = rows.get(key);
    if (row) row.affectedFamilies++;
  }

  // --- cases whose statutory deadline is close or gone ---------------------
  const atRisk = await prisma.proposal.findMany({
    where: {
      AND: [
        scopeForProposal(actor),
        ...proposalFilter(filter),
        { status: { notIn: ["CLOSED", "REJECTED", "LAPSED"] } },
        { stages: { some: { exitedAt: null, statutoryDeadline: { lte: new Date(Date.now() + 30 * 86_400_000) } } } },
        stateId ? { project: { districts: { some: { district: { stateId } } } } } : {},
      ],
    },
    select: { project: { select: { districts: { select: { district: { select: { id: true, stateId: true } } } } } } },
  });
  for (const p of atRisk) {
    // A multi-district project's risk is counted in each district it touches.
    for (const d of p.project.districts) {
      const row = rows.get(byDistrict ? d.district.id : d.district.stateId);
      if (row) row.casesAtRisk++;
    }
  }

  for (const [id, row] of rows) {
    row.projects = projectsSeen.get(id)?.size ?? 0;
    row.possessedPct = row.parcels ? Math.round((row.possessedPct / row.parcels) * 100) : 0;
    row.compensationOutstanding = Math.max(0, row.compensationAssessed - row.compensationPaid);
    row.areaProposedHa = Number(row.areaProposedHa.toFixed(2));
    row.areaAcquiredHa = Number(row.areaAcquiredHa.toFixed(2));
  }

  return [...rows.values()].sort((a, b) => b.areaProposedHa - a.areaProposedHa);
}

/** Compensation assessed against compensation actually paid, by month. */
export async function compensationTrend(actor: Actor, months = 12, filter: DashboardFilter = EMPTY_FILTER) {
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1), 1);
  since.setHours(0, 0, 0, 0);

  const rows = await prisma.compensationRecord.findMany({
    where: { parcel: { AND: [scopeForParcel(actor), ...parcelFilter(filter)] } },
    select: { payableToOwner: true, assessedAt: true, payments: { select: { amount: true, status: true, paidAt: true } } },
  });

  const buckets = new Map<string, { month: string; assessed: number; paid: number }>();
  for (let i = 0; i < months; i++) {
    const d = new Date(since);
    d.setMonth(since.getMonth() + i);
    const key = d.toISOString().slice(0, 7);
    buckets.set(key, { month: key, assessed: 0, paid: 0 });
  }
  for (const r of rows) {
    const assessed = buckets.get(r.assessedAt.toISOString().slice(0, 7));
    if (assessed) assessed.assessed += Number(r.payableToOwner);
    for (const p of r.payments) {
      if (!p.paidAt || !(p.status === "PAID" || p.status === "DEPOSITED_WITH_AUTHORITY")) continue;
      const paid = buckets.get(p.paidAt.toISOString().slice(0, 7));
      if (paid) paid.paid += Number(p.amount);
    }
  }
  return [...buckets.values()];
}

/** How long cases have been sitting at their current stage — the delay distribution. */
export async function delayDistribution(actor: Actor, filter: DashboardFilter = EMPTY_FILTER) {
  const proposals = await prisma.proposal.findMany({
    where: { AND: [scopeForProposal(actor), ...proposalFilter(filter), { status: { notIn: ["CLOSED", "REJECTED", "LAPSED"] } }] },
    select: { stages: { where: { exitedAt: null }, select: { enteredAt: true }, take: 1, orderBy: { enteredAt: "desc" } } },
  });
  const bands = [
    { key: "b0_30", band: "0–30 days", max: 30, cases: 0 },
    { key: "b31_90", band: "31–90", max: 90, cases: 0 },
    { key: "b91_180", band: "91–180", max: 180, cases: 0 },
    { key: "b181_365", band: "181–365", max: 365, cases: 0 },
    { key: "over", band: "over a year", max: Infinity, cases: 0 },
  ];
  const now = Date.now();
  for (const p of proposals) {
    const entered = p.stages[0]?.enteredAt;
    if (!entered) continue;
    const days = (now - entered.getTime()) / 86_400_000;
    (bands.find((b) => days <= b.max) ?? bands[bands.length - 1]).cases++;
  }
  return bands.map(({ key, band, cases }) => ({ key, band, cases }));
}
