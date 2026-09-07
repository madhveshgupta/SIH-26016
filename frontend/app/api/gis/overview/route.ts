import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { scopeForParcel } from "@backend/rbac/scope";
import { prisma } from "@backend/db/client";
import { apiJson } from "@backend/http/respond";

/**
 * One point per project in the caller's jurisdiction — the national overview before drilling
 * into a project's parcels.
 */
export async function GET() {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "parcel", "read")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const visible = await prisma.landParcel.findMany({ where: scopeForParcel(s), select: { id: true } });
  if (visible.length === 0) return await apiJson({ projects: [] });

  const rows = await prisma.$queryRaw<
    { id: string; ref: string; name: string; type: string; state: string; district: string; lat: number; lng: number; parcels: bigint; hectares: number; possessed: bigint; conflicts: bigint; traced: bigint; osm: bigint; generated: bigint }[]
  >`
    SELECT pr.id, pr."referenceNo" AS ref, pr.name, pr.type::text AS type,
           min(st.name) AS state, min(d.name) AS district,
           ST_Y(ST_Centroid(ST_Collect(p.geom)))::float8 AS lat,
           ST_X(ST_Centroid(ST_Collect(p.geom)))::float8 AS lng,
           count(*)::bigint AS parcels,
           COALESCE(sum(p."computedAreaHectares"), 0)::float8 AS hectares,
           count(*) FILTER (WHERE p.status = 'POSSESSED')::bigint AS possessed,
           count(*) FILTER (WHERE p."hasConflict")::bigint AS conflicts,
           count(*) FILTER (WHERE p."geometryKind" = 'TRACED')::bigint AS traced,
           count(*) FILTER (WHERE p."geometryKind" = 'OSM_FIELD')::bigint AS osm,
           count(*) FILTER (WHERE p."geometryKind" = 'GENERATED')::bigint AS generated
      FROM "LandParcel" p
      JOIN "Project" pr ON pr.id = p."projectId"
      JOIN "District" d ON d.id = p."districtId"
      JOIN "State" st ON st.id = d."stateId"
     WHERE p.id = ANY(${visible.map((v) => v.id)}) AND p.geom IS NOT NULL
     GROUP BY pr.id, pr."referenceNo", pr.name, pr.type
     ORDER BY min(st.name), pr.name;
  `;

  return await apiJson({
    projects: rows.map((r) => ({
      id: r.id, ref: r.ref, name: r.name, type: r.type, state: r.state, district: r.district,
      lat: r.lat, lng: r.lng,
      parcels: Number(r.parcels), hectares: r.hectares,
      possessedPct: Number(r.parcels) ? Math.round((Number(r.possessed) / Number(r.parcels)) * 100) : 0,
      conflicts: Number(r.conflicts),
      source: Number(r.traced) >= Number(r.osm) && Number(r.traced) >= Number(r.generated) ? "TRACED" : Number(r.osm) >= Number(r.generated) ? "OSM_FIELD" : "GENERATED",
    })),
  });
}
