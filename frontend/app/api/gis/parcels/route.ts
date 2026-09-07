import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { scopeForParcel } from "@backend/rbac/scope";
import { prisma } from "@backend/db/client";
import { apiJson } from "@backend/http/respond";

/** Parcels as GeoJSON for the map layer — real boundaries only. */
export async function GET(request: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "parcel", "read")) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }

  const projectId = new URL(request.url).searchParams.get("projectId");
  const visible = await prisma.landParcel.findMany({
    where: projectId ? { AND: [scopeForParcel(s), { projectId }] } : scopeForParcel(s),
    select: { id: true },
  });
  if (visible.length === 0) {
    return await apiJson({ type: "FeatureCollection", features: [] });
  }
  const ids = visible.map((v) => v.id);

  const rows = await prisma.$queryRaw<
    {
      id: string; ulpin: string | null; khasraNo: string; status: string;
      declared: number; computed: number | null; areaFromRecord: boolean; hasConflict: boolean;
      landUse: string; geometryKind: string; accuracy: number | null; chainage: number | null;
      syncedAt: Date | null; village: string; district: string; state: string;
      projectId: string; projectRef: string; project: string; otherProjects: string | null;
      geojson: string;
    }[]
  >`
    SELECT p.id, p.ulpin, p."khasraNo", p.status::text,
           p."declaredAreaHectares"::float8 AS declared,
           p."computedAreaHectares"::float8 AS computed,
           p."areaFromRecord", p."hasConflict", p."landUse"::text AS "landUse",
           p."geometryKind"::text AS "geometryKind",
           p."boundaryAccuracyM"::float8 AS accuracy, p."chainageM" AS chainage,
           p."sourceSyncedAt" AS "syncedAt",
           v.name AS village, d.name AS district, st.name AS state,
           pr.id AS "projectId", pr."referenceNo" AS "projectRef", pr.name AS project,
           -- Which other projects claim the same plot, named in the popup.
           (SELECT string_agg(DISTINCT op.name, '; ')
              FROM "LandParcel" o JOIN "Project" op ON op.id = o."projectId"
             WHERE p."hasConflict" AND o."projectId" <> p."projectId" AND o.geom IS NOT NULL
               AND o."geometryKind" <> 'ENVELOPE'
               AND ST_Intersects(o.geom, p.geom)
               AND ST_Area(ST_Intersection(o.geom, p.geom))
                     >= 0.25 * LEAST(ST_Area(o.geom), ST_Area(p.geom))) AS "otherProjects",
           ST_AsGeoJSON(p.geom, 7) AS geojson
      FROM "LandParcel" p
      JOIN "Village" v  ON v.id = p."villageId"
      JOIN "District" d ON d.id = p."districtId"
      JOIN "State" st   ON st.id = d."stateId"
      JOIN "Project" pr ON pr.id = p."projectId"
     WHERE p.id = ANY(${ids})
       AND p.geom IS NOT NULL
       AND p."geometryKind" <> 'ENVELOPE'
     ORDER BY pr."referenceNo", p."chainageM" NULLS LAST;
  `;

  return await apiJson({
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: JSON.parse(r.geojson),
      properties: {
        id: r.id, ulpin: r.ulpin, khasraNo: r.khasraNo, status: r.status,
        recordHa: r.areaFromRecord ? r.declared : null,
        mapHa: r.computed,
        // The gap between the revenue record and the boundary on the map.
        discrepancyHa:
          r.areaFromRecord && r.computed != null ? Number((r.computed - r.declared).toFixed(4)) : null,
        hasConflict: r.hasConflict, otherProjects: r.otherProjects,
        landUse: r.landUse, geometryKind: r.geometryKind,
        boundaryAccuracyM: r.accuracy, chainageM: r.chainage,
        syncedAt: r.syncedAt, village: r.village, district: r.district, state: r.state,
        projectId: r.projectId, projectRef: r.projectRef, project: r.project,
      },
    })),
  });
}
