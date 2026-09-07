import { NextResponse } from "next/server";
import { getSession } from "@backend/auth/session";
import { can } from "@backend/rbac/permissions";
import { scopeForParcel } from "@backend/rbac/scope";
import { prisma } from "@backend/db/client";
import { boundaryPoints } from "@backend/gis/vertices";
import { appendAudit } from "@backend/audit/chain";
import { apiJson } from "@backend/http/respond";

/** Download one parcel's boundary as GeoJSON, KML or a CSV of its points. Scoped and audited. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "parcel", "read")) return await apiJson({ error: "Not permitted" }, { status: 403 });
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") ?? "geojson";

  const parcel = await prisma.landParcel.findFirst({
    where: { AND: [{ id }, scopeForParcel(s)] },
    select: { id: true, khasraNo: true, ulpin: true, geometryKind: true, village: { select: { name: true } } },
  });
  if (!parcel) return await apiJson({ error: "Not found" }, { status: 404 });

  const points = await boundaryPoints(id);
  if (points.length === 0) return await apiJson({ error: "This parcel has no mapped boundary" }, { status: 404 });
  await appendAudit({ actorId: s.id, action: "DOWNLOAD", entityType: "LandParcel", entityId: id, afterJson: { format } });

  const name = `khasra-${parcel.khasraNo.replace(/[^\w-]/g, "_")}-${parcel.village.name.replace(/\W/g, "")}`;
  const ring = [...points.map((p) => [p.lng, p.lat]), [points[0].lng, points[0].lat]];

  if (format === "csv") {
    const csv = ["point,latitude,longitude,elevation_m,side_to_next_m", ...points.map((p) => `${p.seq},${p.lat.toFixed(7)},${p.lng.toFixed(7)},${p.elevationM ?? ""},${p.sideM.toFixed(2)}`)].join("\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${name}.csv"` } });
  }
  if (format === "kml") {
    const coords = ring.map(([lng, lat]) => `${lng.toFixed(7)},${lat.toFixed(7)},0`).join(" ");
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>
<name>Khasra ${parcel.khasraNo}, ${parcel.village.name}</name>
<description>Boundary source: ${parcel.geometryKind}. ULPIN ${parcel.ulpin ?? "—"}</description>
<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark></Document></kml>`;
    return new NextResponse(kml, { headers: { "Content-Type": "application/vnd.google-earth.kml+xml", "Content-Disposition": `attachment; filename="${name}.kml"` } });
  }
  const geojson = {
    type: "Feature",
    properties: { khasraNo: parcel.khasraNo, ulpin: parcel.ulpin, village: parcel.village.name, boundarySource: parcel.geometryKind },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
  return new NextResponse(JSON.stringify(geojson, null, 2), { headers: { "Content-Type": "application/geo+json", "Content-Disposition": `attachment; filename="${name}.geojson"` } });
}
