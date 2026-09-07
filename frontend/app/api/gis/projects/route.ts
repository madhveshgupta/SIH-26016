import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { scopeForParcel, scopeForProject } from "@backend/rbac/scope";
import { prisma } from "@backend/db/client";
import { apiJson } from "@backend/http/respond";

/** Project alignments (centreline + right-of-way band) as GeoJSON. */
export async function GET(request: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "parcel", "read")) {
    return await apiJson({ error: "Not permitted" }, { status: 403 });
  }
  const projectId = new URL(request.url).searchParams.get("projectId");

  const inScope = await prisma.landParcel.findMany({
    where: {
      AND: [
        scopeForParcel(s),
        projectId ? { projectId } : {},
        can(s.role, "project", "read") ? { project: scopeForProject(s) } : {},
      ],
    },
    select: { projectId: true },
    distinct: ["projectId"],
  });
  const ids = inScope.map((p) => p.projectId);
  if (ids.length === 0) return await apiJson({ type: "FeatureCollection", features: [] });

  const rows = await prisma.$queryRaw<
    { id: string; ref: string; name: string; type: string; row: number | null; line: string; band: string | null }[]
  >`
    SELECT id, "referenceNo" AS ref, name, type::text, "rightOfWayM" AS row,
           ST_AsGeoJSON(alignment, 7) AS line,
           CASE WHEN "rightOfWayM" IS NULL THEN NULL
                ELSE ST_AsGeoJSON(ST_Buffer(alignment::geography, "rightOfWayM" / 2.0, 'endcap=flat')::geometry, 7) END AS band
      FROM "Project"
     WHERE id = ANY(${ids}) AND alignment IS NOT NULL;
  `;

  return await apiJson({
    type: "FeatureCollection",
    features: rows.flatMap((r) => {
      const props = { projectId: r.id, projectRef: r.ref, project: r.name, type: r.type, rightOfWayM: r.row };
      return [
        ...(r.band ? [{ type: "Feature", geometry: JSON.parse(r.band), properties: { ...props, role: "band" } }] : []),
        { type: "Feature", geometry: JSON.parse(r.line), properties: { ...props, role: "centreline" } },
      ];
    }),
  });
}
