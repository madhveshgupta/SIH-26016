import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { scopeForParcel } from "@backend/rbac/scope";
import { SHEETS } from "@backend/integrations/adapters/cadastral-tile";
import { apiJson } from "@backend/http/respond";

/** Cadastral sheets the caller is entitled to see. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return await apiJson({ error: "Unauthenticated" }, { status: 401 });

  // Only villages the caller actually has parcels in.
  const projectId = new URL(request.url).searchParams.get("projectId");
  const parcels = await prisma.landParcel.findMany({
    // The project filter narrows an already-authorised scope; it cannot turn
    // a guessed project id into access to a different jurisdiction.
    where: projectId
      ? { AND: [scopeForParcel(session), { projectId }] }
      : scopeForParcel(session),
    select: { villageId: true },
    distinct: ["villageId"],
  });
  const villageIds = parcels.map((p) => p.villageId);
  if (villageIds.length === 0) return await apiJson({ layers: [] });

  const villages = await prisma.village.findMany({
    where: { id: { in: villageIds }, cadastralGisCode: { not: null } },
    include: { tehsil: { include: { district: { include: { state: true } } } } },
  });

  const boundsByGis = new Map<string, [[number, number], [number, number]]>();
  for (const village of villages) {
    const sheet = SHEETS[village.cadastralGisCode!];
    if (!sheet) continue;
    const [minX, minY, maxX, maxY] = sheet.utmBbox;
    const rows = await prisma.$queryRaw<{ south: number; west: number; north: number; east: number }[]>`
      WITH envelope AS (
        SELECT ST_Transform(
          ST_MakeEnvelope(${minX}::float8, ${minY}::float8, ${maxX}::float8, ${maxY}::float8, ${sheet.srs.replace("EPSG:", "")}::integer),
          4326
        ) AS geom
      )
      SELECT ST_YMin(geom)::float8 AS south,
             ST_XMin(geom)::float8 AS west,
             ST_YMax(geom)::float8 AS north,
             ST_XMax(geom)::float8 AS east
        FROM envelope;
    `;
    const bounds = rows[0];
    if (bounds) boundsByGis.set(village.cadastralGisCode!, [[bounds.south, bounds.west], [bounds.north, bounds.east]]);
  }

  const layers = villages.flatMap((v) => {
    const gisCode = v.cadastralGisCode!;
    const sheet = SHEETS[gisCode];
    const bounds = boundsByGis.get(gisCode);
    if (!sheet || !bounds) return [];
    return [{
      village: v.name,
      district: v.tehsil.district.name,
      state: v.tehsil.district.state.name,
      // Proxied: the portal needs a Referer a browser will not send, and the
      // demo must not depend on it being reachable.
      imageUrl: `/api/gis/cadastral/sheet?gis=${encodeURIComponent(gisCode)}`,
      bounds,
    }];
  });

  return await apiJson({ layers });
}
