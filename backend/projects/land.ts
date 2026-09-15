/**
 * Project → state → district → village: what land each project requires, where, and how far
 * acquisition has got.
 */
import type { ParcelStatus } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForParcel, scopeForProject, type Actor } from "@backend/rbac/scope";

export interface LandTotals {
  parcels: number;
  /** Area on the revenue record, where the record publishes one. */
  recordHa: number;
  /** Area measured from the mapped boundaries. */
  mapHa: number;
  byStatus: Partial<Record<ParcelStatus, number>>;
  conflicts: number;
  /** Share of parcels already in possession, 0–100. */
  possessedPct: number;
}

export interface VillageLand extends LandTotals { villageId: string; village: string }
export interface DistrictLand extends LandTotals { districtId: string; district: string; villages: VillageLand[] }
export interface StateLand extends LandTotals {
  stateId: string;
  state: string;
  districts: DistrictLand[];
  /** The project needs land here, but none of it is inside the viewer's jurisdiction. */
  outsideScope: boolean;
}

export interface ProjectLand {
  id: string;
  referenceNo: string;
  name: string;
  type: string;
  governingAct: string;
  agency: string;
  ministry: string | null;
  estimatedAreaHectares: number | null;
  estimatedCostCrore: number | null;
  rightOfWayM: number | null;
  totals: LandTotals;
  states: StateLand[];
}

function emptyTotals(): LandTotals {
  return { parcels: 0, recordHa: 0, mapHa: 0, byStatus: {}, conflicts: 0, possessedPct: 0 };
}

function add(t: LandTotals, p: { status: ParcelStatus; record: number | null; map: number | null; conflict: boolean }) {
  t.parcels++;
  t.recordHa += p.record ?? 0;
  t.mapHa += p.map ?? 0;
  t.byStatus[p.status] = (t.byStatus[p.status] ?? 0) + 1;
  if (p.conflict) t.conflicts++;
}

function finish(t: LandTotals) {
  t.possessedPct = t.parcels ? Math.round(((t.byStatus.POSSESSED ?? 0) / t.parcels) * 100) : 0;
  t.recordHa = Number(t.recordHa.toFixed(4));
  t.mapHa = Number(t.mapHa.toFixed(4));
}

/** Projects the actor may see, each with its land broken down by state. */
export async function projectsWithLand(actor: Actor, onlyProjectId?: string): Promise<ProjectLand[]> {
  const parcelScope = scopeForParcel(actor);
  const projectWhere = can(actor.role, "project", "read")
    ? scopeForProject(actor)
    : { parcels: { some: parcelScope } };

  const projects = await prisma.project.findMany({
    where: { AND: [projectWhere, onlyProjectId ? { id: onlyProjectId } : {}] },
    include: {
      agency: { select: { code: true } },
      ministry: { select: { code: true } },
      states: { include: { state: { select: { id: true, name: true } } } },
    },
    orderBy: { referenceNo: "asc" },
  });
  if (projects.length === 0) return [];

  const parcels = await prisma.landParcel.findMany({
    where: { AND: [parcelScope, { projectId: { in: projects.map((p) => p.id) } }] },
    select: {
      projectId: true, status: true, hasConflict: true, areaFromRecord: true,
      declaredAreaHectares: true, computedAreaHectares: true,
      village: { select: { id: true, name: true } },
      district: { select: { id: true, name: true, state: { select: { id: true, name: true } } } },
    },
  });

  const alignment = await prisma.$queryRaw<{ id: string; row: number | null }[]>`
    SELECT id, "rightOfWayM" AS row FROM "Project" WHERE id = ANY(${projects.map((p) => p.id)});
  `;

  return projects.map((p) => {
    const totals = emptyTotals();
    const states = new Map<string, StateLand>();
    // Every state the project is recorded as needing land in, even with no
    // visible parcels, so "which state requires what" is always complete.
    for (const s of p.states) {
      states.set(s.state.id, { stateId: s.state.id, state: s.state.name, districts: [], outsideScope: true, ...emptyTotals() });
    }

    for (const x of parcels.filter((q) => q.projectId === p.id)) {
      const row = {
        status: x.status,
        record: x.areaFromRecord ? Number(x.declaredAreaHectares) : null,
        map: x.computedAreaHectares == null ? null : Number(x.computedAreaHectares),
        conflict: x.hasConflict,
      };
      add(totals, row);

      const st = x.district.state;
      let s = states.get(st.id);
      if (!s) {
        s = { stateId: st.id, state: st.name, districts: [], outsideScope: false, ...emptyTotals() };
        states.set(st.id, s);
      }
      s.outsideScope = false;
      add(s, row);

      let d = s.districts.find((q) => q.districtId === x.district.id);
      if (!d) {
        d = { districtId: x.district.id, district: x.district.name, villages: [], ...emptyTotals() };
        s.districts.push(d);
      }
      add(d, row);

      let v = d.villages.find((q) => q.villageId === x.village.id);
      if (!v) {
        v = { villageId: x.village.id, village: x.village.name, ...emptyTotals() };
        d.villages.push(v);
      }
      add(v, row);
    }

    finish(totals);
    for (const s of states.values()) {
      finish(s);
      for (const d of s.districts) {
        finish(d);
        d.villages.forEach(finish);
      }
    }

    return {
      id: p.id,
      referenceNo: p.referenceNo,
      name: p.name,
      type: p.type,
      governingAct: p.governingAct,
      agency: p.agency.code,
      ministry: p.ministry?.code ?? null,
      estimatedAreaHectares: p.estimatedAreaHectares == null ? null : Number(p.estimatedAreaHectares),
      estimatedCostCrore: p.estimatedCostCrore == null ? null : Number(p.estimatedCostCrore),
      rightOfWayM: alignment.find((a) => a.id === p.id)?.row ?? null,
      totals,
      states: [...states.values()].sort((a, b) => b.parcels - a.parcels || a.state.localeCompare(b.state)),
    };
  });
}

/** One parcel register row for a project page. */
export async function projectParcelRegister(actor: Actor, projectId: string) {
  return prisma.landParcel.findMany({
    where: { AND: [scopeForParcel(actor), { projectId }] },
    select: {
      id: true, khasraNo: true, ulpin: true, status: true, hasConflict: true, areaFromRecord: true,
      declaredAreaHectares: true, computedAreaHectares: true, chainageM: true, geometryKind: true,
      village: { select: { name: true } },
      district: { select: { name: true, state: { select: { name: true } } } },
    },
    orderBy: [{ chainageM: "asc" }, { khasraNo: "asc" }],
  });
}
