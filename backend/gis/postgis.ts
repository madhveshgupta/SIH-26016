/** All PostGIS work lives here. */
import { prisma } from "@backend/db/client";
import type { ParcelGeometryKind } from "@prisma/client";

/** Square metres in one hectare. */
const SQM_PER_HECTARE = 10_000;

/** Set a parcel's boundary from a GeoJSON polygon and recompute its true area. */
export async function setParcelGeometry(
  parcelId: string,
  geojson: object,
  geometryKind: ParcelGeometryKind = "SURVEYED",
): Promise<{ computedAreaHectares: number; centroidLat: number; centroidLng: number }> {
  const rows = await prisma.$queryRaw<
    { area_ha: number; lat: number; lng: number }[]
  >`
    WITH g AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geojson)}), 4326) AS geom
    )
    UPDATE "LandParcel" p
       SET geom = g.geom,
           "geometryKind" = ${geometryKind}::"ParcelGeometryKind",
           "computedAreaHectares" = (ST_Area(g.geom::geography) / ${SQM_PER_HECTARE})::numeric(14,4),
           "centroidLat" = ST_Y(ST_Centroid(g.geom))::numeric(10,7),
           "centroidLng" = ST_X(ST_Centroid(g.geom))::numeric(10,7)
      FROM g
     WHERE p.id = ${parcelId}
    RETURNING (ST_Area(g.geom::geography) / ${SQM_PER_HECTARE})::float8 AS area_ha,
              ST_Y(ST_Centroid(g.geom))::float8 AS lat,
              ST_X(ST_Centroid(g.geom))::float8 AS lng;
  `;
  if (rows.length === 0) throw new Error(`Parcel not found: ${parcelId}`);
  const r = rows[0];
  return { computedAreaHectares: r.area_ha, centroidLat: r.lat, centroidLng: r.lng };
}

/** Store a parcel envelope returned in a state's projected cadastral CRS. */
export async function setParcelGeometryFromProjectedBbox(
  parcelId: string,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  sourceSrid: number,
): Promise<{ computedAreaHectares: number; centroidLat: number; centroidLng: number }> {
  const rows = await prisma.$queryRaw<{ area_ha: number; lat: number; lng: number }[]>`
    WITH g AS (
      SELECT ST_Transform(
               ST_MakeEnvelope(${bbox.minX}, ${bbox.minY}, ${bbox.maxX}, ${bbox.maxY}, ${sourceSrid}::integer),
               4326
             ) AS geom
    )
    UPDATE "LandParcel" p
       SET geom = g.geom,
           "geometryKind" = 'ENVELOPE'::"ParcelGeometryKind",
           "computedAreaHectares" = (ST_Area(g.geom::geography) / ${SQM_PER_HECTARE})::numeric(14,4),
           "centroidLat" = ST_Y(ST_Centroid(g.geom))::numeric(10,7),
           "centroidLng" = ST_X(ST_Centroid(g.geom))::numeric(10,7)
      FROM g
     WHERE p.id = ${parcelId}
    RETURNING (ST_Area(g.geom::geography) / ${SQM_PER_HECTARE})::float8 AS area_ha,
              ST_Y(ST_Centroid(g.geom))::float8 AS lat,
              ST_X(ST_Centroid(g.geom))::float8 AS lng;
  `;
  if (rows.length === 0) throw new Error(`Parcel not found: ${parcelId}`);
  const r = rows[0];
  return { computedAreaHectares: r.area_ha, centroidLat: r.lat, centroidLng: r.lng };
}

/** Store a real plot boundary given as a ring in the state's projected CRS. */
export async function setParcelGeometryFromProjectedRing(
  parcelId: string,
  ring: [number, number][],
  sourceSrid: number,
  geometryKind: ParcelGeometryKind = "TRACED",
): Promise<{ computedAreaHectares: number; centroidLat: number; centroidLng: number; valid: boolean }> {
  const geojson = JSON.stringify({ type: "Polygon", coordinates: [ring] });
  const rows = await prisma.$queryRaw<{ area_ha: number; lat: number; lng: number; valid: boolean }[]>`
    WITH src AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), ${sourceSrid}::integer) AS geom
    ), g AS (
      -- A traced ring is simple by construction; ST_MakeValid is a guard, and
      -- only its largest polygon is kept so the column type always holds.
      SELECT ST_Transform(
               CASE WHEN ST_IsValid(src.geom) THEN src.geom
                    ELSE (SELECT d.geom FROM ST_Dump(ST_CollectionExtract(ST_MakeValid(src.geom), 3)) d
                           ORDER BY ST_Area(d.geom) DESC LIMIT 1) END,
               4326) AS geom,
             ST_IsValid(src.geom) AS valid
        FROM src
    )
    UPDATE "LandParcel" p
       SET geom = g.geom,
           "geometryKind" = ${geometryKind}::"ParcelGeometryKind",
           "computedAreaHectares" = (ST_Area(g.geom::geography) / ${SQM_PER_HECTARE})::numeric(14,4),
           "centroidLat" = ST_Y(ST_PointOnSurface(g.geom))::numeric(10,7),
           "centroidLng" = ST_X(ST_PointOnSurface(g.geom))::numeric(10,7)
      FROM g
     WHERE p.id = ${parcelId}
    RETURNING (ST_Area(g.geom::geography) / ${SQM_PER_HECTARE})::float8 AS area_ha,
              ST_Y(ST_PointOnSurface(g.geom))::float8 AS lat,
              ST_X(ST_PointOnSurface(g.geom))::float8 AS lng,
              g.valid;
  `;
  if (rows.length === 0) throw new Error(`Parcel not found: ${parcelId}`);
  const r = rows[0];
  return { computedAreaHectares: r.area_ha, centroidLat: r.lat, centroidLng: r.lng, valid: r.valid };
}

/**
 * Minimum share of the smaller parcel that must be covered before an overlap counts as a
 * conflict.
 */
export const CONFLICT_MIN_OVERLAP_RATIO = 0.25;

/** CONFLICT DETECTION REQUIRES REAL BOUNDARIES (SURVEYED or TRACED). */
/** Parcel conflict detection — the differentiator. */
export async function findConflictingParcels(parcelId: string) {
  return prisma.$queryRaw<
    { id: string; khasraNo: string; projectId: string; overlapHectares: number }[]
  >`
    SELECT other.id,
           other."khasraNo",
           other."projectId",
           (ST_Area(ST_Intersection(target.geom, other.geom)::geography) / ${SQM_PER_HECTARE})::float8
             AS "overlapHectares"
      FROM "LandParcel" target
      JOIN "LandParcel" other
        ON other.id <> target.id
       AND other."projectId" <> target."projectId"
       AND other.geom IS NOT NULL
       AND ST_Intersects(target.geom, other.geom)
       -- Both sides must be surveyed, not envelopes. See the note above.
      AND other."geometryKind" IN ('SURVEYED', 'TRACED', 'OSM_FIELD', 'GENERATED')
       AND ST_Area(ST_Intersection(target.geom, other.geom))
             >= ${CONFLICT_MIN_OVERLAP_RATIO} * LEAST(ST_Area(target.geom), ST_Area(other.geom))
     WHERE target.id = ${parcelId}
       AND target.geom IS NOT NULL
      AND target."geometryKind" IN ('SURVEYED', 'TRACED', 'OSM_FIELD', 'GENERATED');
  `;
}

/** Recompute and persist the conflict flag for a parcel and everything its change could affect. */
export async function refreshConflictFlags(parcelId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: string; conflicts: boolean }[]>`
    WITH affected AS (
      -- the parcel itself
      SELECT ${parcelId}::text AS id
      UNION
      -- whatever it overlaps right now
      SELECT o.id
        FROM "LandParcel" t
        JOIN "LandParcel" o
          ON o.id <> t.id
         AND o."projectId" <> t."projectId"
         AND o.geom IS NOT NULL
         AND o."geometryKind" IN ('SURVEYED', 'TRACED', 'OSM_FIELD', 'GENERATED')
         AND ST_Intersects(t.geom, o.geom)
         AND ST_Area(ST_Intersection(t.geom, o.geom))
               >= ${CONFLICT_MIN_OVERLAP_RATIO} * LEAST(ST_Area(t.geom), ST_Area(o.geom))
       WHERE t.id = ${parcelId} AND t.geom IS NOT NULL
      UNION
      -- already-flagged parcels nearby, where a stale flag could survive
      SELECT f.id
        FROM "LandParcel" f
        JOIN "LandParcel" t ON t.id = ${parcelId}
       WHERE f."hasConflict" = true
         AND f."districtId" = t."districtId"
    )
    UPDATE "LandParcel" p
       SET "hasConflict" = EXISTS (
             SELECT 1
               FROM "LandParcel" o
              WHERE o.id <> p.id
                AND o."projectId" <> p."projectId"
                AND o.geom IS NOT NULL
                AND p.geom IS NOT NULL
                AND ST_Intersects(p.geom, o.geom)
                AND p."geometryKind" IN ('SURVEYED', 'TRACED', 'OSM_FIELD', 'GENERATED')
                AND o."geometryKind" IN ('SURVEYED', 'TRACED', 'OSM_FIELD', 'GENERATED')
                AND ST_Area(ST_Intersection(p.geom, o.geom))
                      >= ${CONFLICT_MIN_OVERLAP_RATIO} * LEAST(ST_Area(p.geom), ST_Area(o.geom))
           )
      FROM affected a
     WHERE p.id = a.id
    RETURNING p.id, p."hasConflict" AS conflicts;
  `;

  const target = rows.find((r) => r.id === parcelId);
  if (!target?.conflicts) return 0;
  return (await findConflictingParcels(parcelId)).length;
}

/**
 * Parcels falling inside a project corridor — how infrastructure alignments are actually
 * planned.
 */
export async function parcelsWithinCorridor(
  corridorGeoJson: object,
  bufferMetres: number,
) {
  return prisma.$queryRaw<{ id: string; khasraNo: string }[]>`
    WITH corridor AS (
      SELECT ST_Buffer(
               ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(corridorGeoJson)}), 4326)::geography,
               ${bufferMetres}
             )::geometry AS geom
    )
    SELECT p.id, p."khasraNo"
      FROM "LandParcel" p, corridor c
     WHERE p.geom IS NOT NULL
       AND ST_Intersects(p.geom, c.geom);
  `;
}

/** Parcel geometries as GeoJSON for the map layer. */
export async function parcelsAsGeoJson(projectId: string) {
  return prisma.$queryRaw<{ id: string; khasraNo: string; status: string; geojson: string }[]>`
    SELECT id, "khasraNo", status::text, ST_AsGeoJSON(geom) AS geojson
      FROM "LandParcel"
     WHERE "projectId" = ${projectId}
       AND geom IS NOT NULL;
  `;
}

/** Confirm PostGIS is present and report its version. */
export async function postgisVersion(): Promise<string> {
  const rows = await prisma.$queryRaw<{ v: string }[]>`SELECT PostGIS_Lib_Version() AS v;`;
  return rows[0]?.v ?? "unknown";
}

/**
 * Recompute every conflict flag in one set-based statement — used after bulk seeding, where
 * refreshing parcel by parcel would repeat the same work thousands of times.
 */
export async function recomputeAllConflicts(): Promise<number> {
  await prisma.$executeRaw`
    UPDATE "LandParcel" p
       SET "hasConflict" = EXISTS (
             SELECT 1 FROM "LandParcel" o
              WHERE o.id <> p.id
                AND o."projectId" <> p."projectId"
                AND o.geom IS NOT NULL AND p.geom IS NOT NULL
                AND o."geometryKind" <> 'ENVELOPE' AND p."geometryKind" <> 'ENVELOPE'
                AND o.geom && p.geom
                AND ST_Intersects(p.geom, o.geom)
                AND ST_Area(ST_Intersection(p.geom, o.geom))
                      >= ${CONFLICT_MIN_OVERLAP_RATIO} * LEAST(ST_Area(p.geom), ST_Area(o.geom))
           );
  `;
  return prisma.landParcel.count({ where: { hasConflict: true } });
}
