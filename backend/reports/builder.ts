/** The custom report builder. */
import { prisma } from "@backend/db/client";
import { EMPTY_FILTER, familyFilter, parcelFilter, proposalFilter, type DashboardFilter } from "@backend/analytics/filters";
import { describeFilter, wordReport, type Cell, type ReportColumn, type ReportResult } from "@backend/reports/registry";
import { columnLabel, english, type Translate } from "@backend/reports/words";
import { scopeForFamily, scopeForParcel, scopeForProject, scopeForProposal, type Actor } from "@backend/rbac/scope";

export type Entity = "parcel" | "proposal" | "project" | "family" | "compensation";

interface FieldDef extends ReportColumn {
  /** Pull the value out of the loaded row. */
  get: (row: Record<string, unknown>) => Cell;
}

type Loader = (actor: Actor, filter: DashboardFilter, take: number) => Promise<Record<string, unknown>[]>;

const text = (v: unknown) => (v == null ? null : String(v));
/** An enum value, kept as its code; the column's `code` says how to word it. */
const code = (v: unknown) => (v == null ? null : String(v));
const yesNo = (v: unknown) => (v ? "YES" : "NO");
const num = (v: unknown) => (v == null ? null : Number(v));
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);
const nested = (row: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, k) => (acc == null ? null : (acc as Record<string, unknown>)[k]), row);

/** Every entity a report can be built on, and every field it may show. */
export const ENTITIES: Record<Entity, { label: string; description: string; fields: FieldDef[]; load: Loader }> = {
  parcel: {
    label: "Land parcels",
    description: "One row per plot",
    fields: [
      { key: "khasraNo", label: "Khasra", get: (r) => text(r.khasraNo) },
      { key: "ulpin", label: "ULPIN", get: (r) => text(r.ulpin) },
      { key: "village", label: "Village", get: (r) => text(nested(r, "village.name")) },
      { key: "district", label: "District", get: (r) => text(nested(r, "district.name")) },
      { key: "state", label: "State", get: (r) => text(nested(r, "district.state.name")) },
      { key: "project", label: "Project", get: (r) => text(nested(r, "project.name")) },
      { key: "status", label: "Status", code: "parcelStatus", get: (r) => code(r.status) },
      { key: "landUse", label: "Land use", code: "landUse", get: (r) => code(r.landUse) },
      { key: "declaredAreaHectares", label: "Area on record (ha)", numeric: true, format: "area", get: (r) => num(r.declaredAreaHectares) },
      { key: "computedAreaHectares", label: "Area on map (ha)", numeric: true, format: "area", get: (r) => num(r.computedAreaHectares) },
      { key: "hasConflict", label: "Claimed twice", code: "yesNo", get: (r) => yesNo(r.hasConflict) },
      { key: "geometryKind", label: "Boundary source", code: "geometryKind", get: (r) => code(r.geometryKind) },
    ],
    load: (actor, filter, take) =>
      prisma.landParcel.findMany({
        where: { AND: [scopeForParcel(actor), ...parcelFilter(filter)] },
        take,
        select: {
          khasraNo: true, ulpin: true, status: true, landUse: true, declaredAreaHectares: true,
          computedAreaHectares: true, hasConflict: true, geometryKind: true,
          village: { select: { name: true } },
          district: { select: { name: true, state: { select: { name: true } } } },
          project: { select: { name: true } },
        },
      }) as unknown as Promise<Record<string, unknown>[]>,
  },

  proposal: {
    label: "Acquisition cases",
    description: "One row per proposal",
    fields: [
      { key: "referenceNo", label: "Reference", get: (r) => text(r.referenceNo) },
      { key: "project", label: "Project", get: (r) => text(nested(r, "project.name")) },
      { key: "status", label: "Stage", code: "stage", get: (r) => `${nested(r, "project.governingAct")}|${r.status}` },
      { key: "act", label: "Act", code: "act", get: (r) => code(nested(r, "project.governingAct")) },
      { key: "proposedAreaHectares", label: "Area proposed (ha)", numeric: true, format: "area", get: (r) => num(r.proposedAreaHectares) },
      { key: "parcels", label: "Parcels", numeric: true, get: (r) => num(nested(r, "_count.parcels")) },
      { key: "objections", label: "Objections", numeric: true, get: (r) => num(nested(r, "_count.objections")) },
      { key: "isUrgency", label: "Urgency (s.40)", code: "yesNo", get: (r) => yesNo(r.isUrgency) },
      { key: "submittedAt", label: "Submitted", format: "date", get: (r) => day(r.submittedAt) },
      { key: "createdAt", label: "Created", format: "date", get: (r) => day(r.createdAt) },
    ],
    load: (actor, filter, take) =>
      prisma.proposal.findMany({
        where: { AND: [scopeForProposal(actor), ...proposalFilter(filter)] },
        take,
        select: {
          referenceNo: true, status: true, proposedAreaHectares: true, isUrgency: true, submittedAt: true, createdAt: true,
          project: { select: { name: true, governingAct: true } },
          _count: { select: { parcels: true, objections: true } },
        },
      }) as unknown as Promise<Record<string, unknown>[]>,
  },

  project: {
    label: "Projects",
    description: "One row per project",
    fields: [
      { key: "referenceNo", label: "Reference", get: (r) => text(r.referenceNo) },
      { key: "name", label: "Project", get: (r) => text(r.name) },
      { key: "type", label: "Type", code: "projectType", get: (r) => code(r.type) },
      { key: "agency", label: "Agency", get: (r) => text(nested(r, "agency.code")) },
      { key: "ministry", label: "Ministry", get: (r) => text(nested(r, "ministry.code")) },
      { key: "governingAct", label: "Act", code: "act", get: (r) => code(r.governingAct) },
      { key: "estimatedCostCrore", label: "Cost (₹ crore)", numeric: true, get: (r) => num(r.estimatedCostCrore) },
      { key: "estimatedAreaHectares", label: "Area (ha)", numeric: true, format: "area", get: (r) => num(r.estimatedAreaHectares) },
      { key: "parcels", label: "Parcels", numeric: true, get: (r) => num(nested(r, "_count.parcels")) },
    ],
    load: (actor, filter, take) =>
      prisma.project.findMany({
        where: { AND: [scopeForProject(actor), ...(filter.projectType ? [{ type: filter.projectType }] : []), ...(filter.ministryId ? [{ ministryId: filter.ministryId }] : [])] },
        take,
        select: {
          referenceNo: true, name: true, type: true, governingAct: true, estimatedCostCrore: true, estimatedAreaHectares: true,
          agency: { select: { code: true } }, ministry: { select: { code: true } }, _count: { select: { parcels: true } },
        },
      }) as unknown as Promise<Record<string, unknown>[]>,
  },

  family: {
    label: "Affected families",
    description: "One row per family",
    fields: [
      { key: "familyHeadName", label: "Family head", get: (r) => text(r.familyHeadName) },
      { key: "village", label: "Village", get: (r) => text(nested(r, "village.name")) },
      { key: "district", label: "District", get: (r) => text(nested(r, "village.tehsil.district.name")) },
      { key: "category", label: "Category", code: "rnrCategory", get: (r) => code(r.category) },
      { key: "memberCount", label: "Members", numeric: true, get: (r) => num(r.memberCount) },
      { key: "isDisplaced", label: "Displaced", code: "yesNo", get: (r) => yesNo(r.isDisplaced) },
      { key: "status", label: "R&R status", code: "rnrStatus", get: (r) => code(r.status) },
    ],
    load: (actor, filter, take) =>
      prisma.affectedFamily.findMany({
        where: { AND: [scopeForFamily(actor), ...familyFilter(filter)] },
        take,
        select: {
          familyHeadName: true, category: true, memberCount: true, isDisplaced: true, status: true,
          village: { select: { name: true, tehsil: { select: { district: { select: { name: true } } } } } },
        },
      }) as unknown as Promise<Record<string, unknown>[]>,
  },

  compensation: {
    label: "Compensation records",
    description: "One row per owner per plot",
    fields: [
      { key: "owner", label: "Owner", get: (r) => text(nested(r, "owner.fullName")) },
      { key: "khasra", label: "Khasra", get: (r) => text(nested(r, "parcel.khasraNo")) },
      { key: "district", label: "District", get: (r) => text(nested(r, "parcel.district.name")) },
      { key: "project", label: "Project", get: (r) => text(nested(r, "parcel.project.name")) },
      { key: "landValue", label: "Land value", numeric: true, format: "money", get: (r) => num(r.landValue) },
      { key: "totalCompensation", label: "Total assessed", numeric: true, format: "money", get: (r) => num(r.totalCompensation) },
      { key: "payableToOwner", label: "Payable to owner", numeric: true, format: "money", get: (r) => num(r.payableToOwner) },
      { key: "ownerSharePct", label: "Share", numeric: true, format: "pct", get: (r) => num(r.ownerSharePct) },
      { key: "assessedAt", label: "Assessed", format: "date", get: (r) => day(r.assessedAt) },
    ],
    load: (actor, filter, take) =>
      prisma.compensationRecord.findMany({
        where: { parcel: { AND: [scopeForParcel(actor), ...parcelFilter(filter)] } },
        take,
        select: {
          landValue: true, totalCompensation: true, payableToOwner: true, ownerSharePct: true, assessedAt: true,
          owner: { select: { fullName: true } },
          parcel: { select: { khasraNo: true, district: { select: { name: true } }, project: { select: { name: true } } } },
        },
      }) as unknown as Promise<Record<string, unknown>[]>,
  },
};

export type Aggregate = "count" | "sum" | "avg" | "min" | "max";

export interface BuilderDefinition {
  entity: Entity;
  /** Field keys, in the order they should appear. */
  columns: string[];
  /** Group by these fields; the rest are aggregated. */
  groupBy?: string[];
  aggregate?: { field: string; as: Aggregate }[];
  sortBy?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
}

export const MAX_ROWS = 5000;

/** Reject anything not in the whitelist before it can reach a query. */
export function validateDefinition(input: unknown): BuilderDefinition {
  const d = (input ?? {}) as Partial<BuilderDefinition>;
  const entity = (Object.keys(ENTITIES) as Entity[]).find((e) => e === d.entity);
  if (!entity) throw new Error("Choose what the report is about");
  const known = new Set(ENTITIES[entity].fields.map((f) => f.key));
  const columns = (Array.isArray(d.columns) ? d.columns : []).map(String).filter((c) => known.has(c));
  if (columns.length === 0) throw new Error("Choose at least one column");
  const groupBy = (Array.isArray(d.groupBy) ? d.groupBy : []).map(String).filter((c) => known.has(c));
  const aggregate = (Array.isArray(d.aggregate) ? d.aggregate : [])
    .filter((a) => a && known.has(String(a.field)) && ["count", "sum", "avg", "min", "max"].includes(String(a.as)))
    .map((a) => ({ field: String(a.field), as: a.as as Aggregate }));
  return {
    entity,
    columns,
    groupBy,
    aggregate,
    sortBy: d.sortBy && known.has(String(d.sortBy)) ? String(d.sortBy) : undefined,
    sortDir: d.sortDir === "asc" ? "asc" : "desc",
    limit: Math.min(Math.max(1, Number(d.limit) || 500), MAX_ROWS),
  };
}

/** Run a built report. */
export async function runBuilder(
  definition: BuilderDefinition,
  actor: Actor,
  filter: DashboardFilter = EMPTY_FILTER,
  title?: string,
  t: Translate = english,
): Promise<ReportResult> {
  const entity = ENTITIES[definition.entity];
  const fields = new Map(entity.fields.map((f) => [f.key, f]));
  const raw = await entity.load(actor, filter, definition.limit ?? 500);
  const flat = raw.map((row) => {
    const out: Record<string, Cell> = {};
    for (const key of definition.columns) out[key] = fields.get(key)!.get(row);
    for (const g of definition.groupBy ?? []) out[g] = fields.get(g)!.get(row);
    for (const a of definition.aggregate ?? []) out[a.field] = fields.get(a.field)!.get(row);
    return out;
  });

  let columns: ReportColumn[] = definition.columns.map((c) => ({ ...fields.get(c)!, get: undefined } as ReportColumn));
  let rows = flat;
  let totals: Record<string, Cell> | undefined;

  if (definition.groupBy?.length) {
    // Grouped: the group keys, then one column per aggregate.
    const groups = new Map<string, { key: Record<string, Cell>; members: Record<string, Cell>[] }>();
    for (const row of flat) {
      const key = definition.groupBy.map((g) => String(row[g] ?? "")).join("|");
      const g = groups.get(key) ?? { key: Object.fromEntries(definition.groupBy.map((k) => [k, row[k] ?? null])), members: [] };
      g.members.push(row);
      groups.set(key, g);
    }
    columns = [
      ...definition.groupBy.map((g) => ({ ...fields.get(g)!, get: undefined } as ReportColumn)),
      ...(definition.aggregate ?? []).map((a) => ({
        key: `${a.as}_${a.field}`,
        label: t(`screens.reportPack.agg_${a.as}`, { field: columnLabel(t, fields.get(a.field)!.label) }),
        numeric: true,
        format: a.as === "count" ? undefined : fields.get(a.field)!.format,
      })),
    ];
    rows = [...groups.values()].map((g) => {
      const out: Record<string, Cell> = { ...g.key };
      for (const a of definition.aggregate ?? []) {
        const values = g.members.map((m) => Number(m[a.field])).filter((n) => Number.isFinite(n));
        out[`${a.as}_${a.field}`] =
          a.as === "count" ? g.members.length
          : values.length === 0 ? null
          : a.as === "sum" ? Number(values.reduce((x, y) => x + y, 0).toFixed(4))
          : a.as === "avg" ? Number((values.reduce((x, y) => x + y, 0) / values.length).toFixed(4))
          : a.as === "min" ? Math.min(...values)
          : Math.max(...values);
      }
      return out;
    });
  }

  const sortKey = definition.sortBy && columns.some((c) => c.key === definition.sortBy) ? definition.sortBy : columns[0]?.key;
  if (sortKey) {
    const dir = definition.sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x ?? "").localeCompare(String(y ?? "")) * dir;
    });
  }

  // A total is only meaningful for a summable column.
  const summable = columns.filter((c) => c.numeric && !c.key.startsWith("avg_") && c.format !== "pct");
  if (summable.length) {
    totals = {};
    for (const c of summable) {
      const sum = rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
      totals[c.key] = Number(sum.toFixed(4));
    }
  }

  // Aggregate labels are already worded; wordReport must not look them up again.
  const aggregated = new Set(columns.filter((c) => /^(count|sum|avg|min|max)_/.test(c.key)).map((c) => c.key));
  const worded = wordReport(
    { columns, rows, totals, count: summable.length ? { key: columns[0].key, unit: "rows", n: rows.length } : undefined },
    t,
  );
  worded.columns = worded.columns.map((c, i) => (aggregated.has(c.key) ? { ...c, label: columns[i].label } : c));
  return {
    key: "custom",
    title: title ?? t("screens.reportPack.custom"),
    description: `${t(`screens.reportPack.ent_${definition.entity}`)} — ${t(`screens.reportPack.entDesc_${definition.entity}`)}`,
    ...worded,
    generatedAt: new Date(),
    filterNote: await describeFilter(filter, t),
  };
}
