/** Dashboard filters. */
import type { Prisma, ProjectType } from "@prisma/client";

export interface DashboardFilter {
  stateId?: string | null;
  districtId?: string | null;
  projectType?: ProjectType | null;
  ministryId?: string | null;
  /** Only cases that entered their current stage on or after this date. */
  since?: Date | null;
}

export const EMPTY_FILTER: DashboardFilter = {};

export function isFiltered(f: DashboardFilter): boolean {
  return Boolean(f.stateId || f.districtId || f.projectType || f.ministryId || f.since);
}

/** The project-level part of a filter, reused by every shape below. */
function projectClause(f: DashboardFilter): Prisma.ProjectWhereInput {
  return {
    ...(f.projectType ? { type: f.projectType } : {}),
    ...(f.ministryId ? { ministryId: f.ministryId } : {}),
  };
}

export function parcelFilter(f: DashboardFilter): Prisma.LandParcelWhereInput[] {
  const where: Prisma.LandParcelWhereInput[] = [];
  if (f.districtId) where.push({ districtId: f.districtId });
  else if (f.stateId) where.push({ district: { stateId: f.stateId } });
  if (f.projectType || f.ministryId) where.push({ project: projectClause(f) });
  return where;
}

export function proposalFilter(f: DashboardFilter): Prisma.ProposalWhereInput[] {
  const where: Prisma.ProposalWhereInput[] = [];
  if (f.districtId) where.push({ project: { districts: { some: { districtId: f.districtId } } } });
  else if (f.stateId) where.push({ project: { states: { some: { stateId: f.stateId } } } });
  if (f.projectType || f.ministryId) where.push({ project: projectClause(f) });
  if (f.since) where.push({ stages: { some: { exitedAt: null, enteredAt: { gte: f.since } } } });
  return where;
}

export function projectFilter(f: DashboardFilter): Prisma.ProjectWhereInput[] {
  const where: Prisma.ProjectWhereInput[] = [];
  if (f.districtId) where.push({ districts: { some: { districtId: f.districtId } } });
  else if (f.stateId) where.push({ states: { some: { stateId: f.stateId } } });
  if (f.projectType || f.ministryId) where.push(projectClause(f));
  return where;
}

export function familyFilter(f: DashboardFilter): Prisma.AffectedFamilyWhereInput[] {
  const where: Prisma.AffectedFamilyWhereInput[] = [];
  if (f.districtId) where.push({ village: { tehsil: { districtId: f.districtId } } });
  else if (f.stateId) where.push({ village: { tehsil: { district: { stateId: f.stateId } } } });
  // A family belongs to a village, not a project, so project-level filters
  // reach it through the parcels of the village it lives in.
  if (f.projectType || f.ministryId) where.push({ village: { parcels: { some: { project: projectClause(f) } } } });
  return where;
}

const TYPES: ProjectType[] = [
  "HIGHWAY", "RAILWAY", "IRRIGATION", "INDUSTRIAL_CORRIDOR",
  "URBAN_DEVELOPMENT", "RENEWABLE_ENERGY", "MINING", "DEFENCE", "OTHER",
];

/** Read a filter off a URL's query string, ignoring anything unrecognised. */
export function filterFromParams(params: Record<string, string | string[] | undefined>): DashboardFilter {
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]) || null;
  const id = (v: string | null) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
  const days = Number(one("days"));
  return {
    stateId: id(one("state")),
    districtId: id(one("district")),
    projectType: TYPES.find((t) => t === one("type")) ?? null,
    ministryId: id(one("ministry")),
    since: Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 86_400_000) : null,
  };
}
