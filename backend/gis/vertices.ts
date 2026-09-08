/**
 * A parcel's boundary as numbered points — what a revenue officer reads off a
 * survey sketch: point 1, 2, 3… with latitude and longitude, and the length of
 * each side.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/client";

export interface BoundaryPoint {
  seq: number;
  lat: number;
  lng: number;
  /** Ground distance to the next point, metres (geodesic). */
  sideM: number;
  elevationM: number | null;
}

export async function boundaryPoints(parcelId: string): Promise<BoundaryPoint[]> {
  const rows = await prisma.$queryRaw<{ seq: number; lat: number; lng: number; side: number }[]>`
    WITH ring AS (
      SELECT (dp).path[1] AS seq, (dp).geom AS pt, COUNT(*) OVER () AS n
        FROM (SELECT ST_DumpPoints(ST_ExteriorRing(geom)) AS dp FROM "LandParcel" WHERE id = ${parcelId} AND geom IS NOT NULL) d
    )
    SELECT a.seq::int AS seq, ST_Y(a.pt)::float8 AS lat, ST_X(a.pt)::float8 AS lng,
           COALESCE(ST_Distance(a.pt::geography, b.pt::geography), 0)::float8 AS side
      FROM ring a
      LEFT JOIN ring b ON b.seq = a.seq + 1
     WHERE a.seq < a.n           -- the last point repeats the first
     ORDER BY a.seq;
  `;
  const stored = await prisma.$queryRaw<{ seq: number; elevationM: number | null }[]>`
    SELECT seq, "elevationM"::float8 AS "elevationM" FROM "ParcelVertex" WHERE "parcelId" = ${parcelId}
  `;
  const elev = new Map(stored.map((s) => [s.seq, s.elevationM]));
  return rows.map((r) => ({ seq: r.seq, lat: r.lat, lng: r.lng, sideM: r.side, elevationM: elev.get(r.seq) ?? null }));
}

/** Store a parcel's boundary as numbered points, from its geometry. */
export async function writeVertices(
  parcelId: string,
  elevationAt: (lat: number, lng: number) => { metres: number; source: string } | null = () => null,
) {
  const pts = await prisma.$queryRaw<{ seq: number; lat: number; lng: number }[]>`
    SELECT (dp).path[1]::int AS seq, ST_Y((dp).geom)::float8 AS lat, ST_X((dp).geom)::float8 AS lng
      FROM (SELECT ST_DumpPoints(ST_ExteriorRing(geom)) AS dp FROM "LandParcel" WHERE id = ${parcelId}) d
     ORDER BY 1;
  `;
  const ring = pts.slice(0, -1); // last point repeats the first
  await prisma.parcelVertex.createMany({
    data: ring.map((p) => {
      const e = elevationAt(p.lat, p.lng);
      return {
        parcelId,
        seq: p.seq,
        lat: new Prisma.Decimal(p.lat.toFixed(7)),
        lng: new Prisma.Decimal(p.lng.toFixed(7)),
        elevationM: e == null ? null : new Prisma.Decimal(e.metres),
        elevationSource: e?.source ?? null,
      };
    }),
  });
}
