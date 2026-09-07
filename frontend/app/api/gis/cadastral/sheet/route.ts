import { NextResponse } from "next/server";
import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { scopeForParcel } from "@backend/rbac/scope";
import { getCadastralSheet, SHEETS } from "@backend/integrations/adapters/cadastral-tile";
import { apiJson } from "@backend/http/respond";

/** Serve a village's cadastral sheet, cached. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return await apiJson({ error: "Unauthenticated" }, { status: 401 });

  const gis = new URL(req.url).searchParams.get("gis");
  const def = gis ? SHEETS[gis] : undefined;
  if (!def) return await apiJson({ error: "Unknown cadastral sheet" }, { status: 404 });

  // A sheet is only served for a village the caller holds parcels in — the map
  // must not become a way around the jurisdiction guard.
  const allowed = await prisma.landParcel.count({
    where: { AND: [scopeForParcel(session), { village: { cadastralGisCode: gis } }] },
  });
  if (allowed === 0) {
    return await apiJson({ error: "Outside your jurisdiction" }, { status: 403 });
  }

  const sheet = await getCadastralSheet({
    baseUrl: def.baseUrl,
    stateCode: def.stateCode,
    gisCode: def.gisCode,
    srs: def.srs,
    bbox: def.utmBbox.join(","),
    variant: def.variant,
    width: 1400,
    height: 1400,
  });

  if (!sheet) {
    return await apiJson(
      { error: "Cadastral portal unreachable and nothing cached" },
      { status: 503 },
    );
  }

  return new NextResponse(new Uint8Array(sheet.png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=86400",
      "X-Sheet-Source": sheet.source,
      "X-Sheet-Fetched": sheet.fetchedAt.toISOString(),
    },
  });
}
