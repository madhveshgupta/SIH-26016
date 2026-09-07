/** Parcel service — the application layer over the raw PostGIS in postgis.ts. */
import { Prisma, type LandUseType, type ParcelStatus } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { setParcelGeometry, refreshConflictFlags } from "@backend/gis/postgis";

/** A 14-character ULPIN-style parcel identifier. */
export function generateUlpin(
  stateLgd: string,
  districtLgd: string,
  villageLgd: string,
  khasraNo: string,
): string {
  const st = stateLgd.padStart(2, "0").slice(-2);
  const dt = districtLgd.padStart(3, "0").slice(-3);
  const vl = villageLgd.padStart(6, "0").slice(-6);
  // Deterministic suffix from the khasra, so the same plot always yields the
  // same ULPIN — an identifier that changed on re-import would be useless.
  let h = 0;
  for (const ch of khasraNo) h = (h * 31 + ch.charCodeAt(0)) % 46656; // 36^3
  const suffix = h.toString(36).toUpperCase().padStart(3, "0");
  return `${st}${dt}${vl}${suffix}`;
}

export interface CreateParcelInput {
  projectId: string;
  proposalId?: string | null;
  villageId: string;
  khasraNo: string;
  declaredAreaHectares: number;
  landUse?: LandUseType;
  /** GeoJSON Polygon in WGS84. Optional — a parcel can be recorded before survey. */
  geometry?: object | null;
  dataSource?: "LIVE" | "CACHED" | "SIMULATED";
  /** Leave the ULPIN empty. */
  withoutUlpin?: boolean;
}

export interface CreateParcelResult {
  id: string;
  ulpin: string;
  computedAreaHectares: number | null;
  /** Difference between the revenue record and the geometry, in hectares. */
  areaDiscrepancy: number | null;
  conflicts: number;
}

/**
 * Record a parcel, compute its true area, and check it against every other
 * project's land.
 */
export async function createParcel(input: CreateParcelInput): Promise<CreateParcelResult> {
  const village = await prisma.village.findUnique({
    where: { id: input.villageId },
    include: { tehsil: { include: { district: { include: { state: true } } } } },
  });
  if (!village) throw new Error(`Unknown village: ${input.villageId}`);

  const district = village.tehsil.district;
  const ulpin = generateUlpin(
    district.state.lgdCode,
    district.lgdCode,
    village.lgdCode,
    input.khasraNo,
  );

  const parcel = await prisma.landParcel.create({
    data: {
      ulpin: input.withoutUlpin ? null : ulpin,
      khasraNo: input.khasraNo,
      projectId: input.projectId,
      proposalId: input.proposalId ?? null,
      villageId: village.id,
      districtId: district.id,
      declaredAreaHectares: new Prisma.Decimal(input.declaredAreaHectares),
      landUse: input.landUse ?? "DRY",
      dataSource: input.dataSource ?? "SIMULATED",
      sourceSyncedAt: input.dataSource === "LIVE" ? new Date() : null,
    },
  });

  let computedAreaHectares: number | null = null;
  let conflicts = 0;

  if (input.geometry) {
    const geo = await setParcelGeometry(parcel.id, input.geometry);
    computedAreaHectares = geo.computedAreaHectares;
    conflicts = await refreshConflictFlags(parcel.id);
  }

  return {
    id: parcel.id,
    ulpin: input.withoutUlpin ? "" : ulpin,
    computedAreaHectares,
    areaDiscrepancy:
      computedAreaHectares === null
        ? null
        : Number((computedAreaHectares - input.declaredAreaHectares).toFixed(4)),
    conflicts,
  };
}

/** Area-discrepancy report. */
export async function areaDiscrepancies(minHectares = 0.05, parcelIds?: string[]) {
  // Callers pass the ids their jurisdiction allows; without them this is a
  // national report, which only a national role should be shown.
  const scoped = parcelIds !== undefined;
  const ids = parcelIds ?? [];
  return prisma.$queryRaw<
    {
      id: string;
      khasraNo: string;
      declared: number;
      computed: number;
      difference: number;
      pctDifference: number;
    }[]
  >`
    SELECT id,
           "khasraNo",
           "declaredAreaHectares"::float8 AS declared,
           "computedAreaHectares"::float8 AS computed,
           ("computedAreaHectares" - "declaredAreaHectares")::float8 AS difference,
           (100.0 * ("computedAreaHectares" - "declaredAreaHectares")
             / NULLIF("declaredAreaHectares", 0))::float8 AS "pctDifference"
      FROM "LandParcel"
     WHERE "computedAreaHectares" IS NOT NULL
       -- An envelope always exceeds the shape it encloses, so comparing a
       -- record against one would flag every plot. Real boundaries only, and
       -- only where the record actually publishes an area.
       AND "geometryKind" <> 'ENVELOPE'
       AND "areaFromRecord" = true
       AND (${!scoped} OR id = ANY(${ids}))
       AND ABS("computedAreaHectares" - "declaredAreaHectares") >= ${minHectares}
     ORDER BY ABS("computedAreaHectares" - "declaredAreaHectares") DESC
     LIMIT 100;
  `;
}

/** Status counts for the map legend and dashboard tiles. */
export async function parcelStatusSummary(where: Record<string, unknown> = {}) {
  const rows = await prisma.landParcel.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
    _sum: { declaredAreaHectares: true },
  });
  return rows.map((r) => ({
    status: r.status as ParcelStatus,
    count: r._count._all,
    hectares: Number(r._sum.declaredAreaHectares ?? 0),
  }));
}

/** Colour per status — one definition, used by both the map and the legend. */
export const STATUS_COLOUR: Record<ParcelStatus, string> = {
  PROPOSED: "#94a3b8",
  NOTIFIED: "#f59e0b",
  OBJECTED: "#a855f7",
  AWARD_DECLARED: "#3b82f6",
  COMPENSATED: "#10b981",
  POSSESSED: "#047857",
  DISPUTED: "#ef4444",
  WITHDRAWN: "#d4d4d8",
};

export const STATUS_LABEL: Record<ParcelStatus, string> = {
  PROPOSED: "Proposed",
  NOTIFIED: "Notified",
  OBJECTED: "Under objection",
  AWARD_DECLARED: "Award declared",
  COMPENSATED: "Compensated",
  POSSESSED: "Possessed",
  DISPUTED: "Disputed",
  WITHDRAWN: "Withdrawn",
};

/** A parcel reduced to what a map needs: a readable coordinate and an outline. */
export interface ParcelShape {
  id: string;
  khasraNo: string;
  status: ParcelStatus;
  village: string;
  district: string;
  project: string;
  geometryKind: string;
  /** A point guaranteed to lie inside the plot, WGS84. */
  lat: number;
  lng: number;
  /** Outer ring(s) as [lat, lng] pairs, ready for Leaflet. Empty for an extent-only record. */
  rings: [number, number][][];
}

/** Map-ready shapes for the given parcels. Callers pass ids their scope allows. */
export async function parcelShapes(parcelIds: string[]): Promise<ParcelShape[]> {
  if (parcelIds.length === 0) return [];
  const rows = await prisma.$queryRaw<
    {
      id: string; khasraNo: string; status: ParcelStatus; geometryKind: string;
      village: string; district: string; project: string;
      lat: number; lng: number; geojson: string | null;
    }[]
  >`
    SELECT p.id, p."khasraNo", p.status::text AS status, p."geometryKind"::text AS "geometryKind",
           v.name AS village, d.name AS district, pr.name AS project,
           ST_Y(ST_PointOnSurface(p.geom))::float8 AS lat,
           ST_X(ST_PointOnSurface(p.geom))::float8 AS lng,
           CASE WHEN p."geometryKind" <> 'ENVELOPE' THEN ST_AsGeoJSON(p.geom, 7) END AS geojson
      FROM "LandParcel" p
      JOIN "Village" v  ON v.id = p."villageId"
      JOIN "District" d ON d.id = p."districtId"
      JOIN "Project" pr ON pr.id = p."projectId"
     WHERE p.id = ANY(${parcelIds}) AND p.geom IS NOT NULL
     ORDER BY p."khasraNo";
  `;
  return rows.map((r) => ({
    id: r.id,
    khasraNo: r.khasraNo,
    status: r.status,
    village: r.village,
    district: r.district,
    project: r.project,
    geometryKind: r.geometryKind,
    lat: r.lat,
    lng: r.lng,
    rings: r.geojson ? outerRings(JSON.parse(r.geojson)) : [],
  }));
}

/** GeoJSON [lng, lat] rings → Leaflet [lat, lng] rings. Holes are not drawn. */
function outerRings(geometry: { type: string; coordinates: unknown }): [number, number][][] {
  const flip = (ring: number[][]): [number, number][] => ring.map(([lng, lat]) => [lat, lng]);
  if (geometry.type === "Polygon") {
    const [outer] = geometry.coordinates as number[][][];
    return outer ? [flip(outer)] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][]).flatMap((poly) => (poly[0] ? [flip(poly[0])] : []));
  }
  return [];
}
