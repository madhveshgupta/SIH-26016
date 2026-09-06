/** Fill every project in the national registry with land. */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { NATIONAL_PROJECTS, fieldsSnapshotPath, type NationalProject } from "../prisma/data/national-projects";
import { PORTALS, probe } from "./probe-portals";
import { harvestCorridor, type CorridorPortal } from "@backend/integrations/adapters/cadastral-corridor";
import { fieldsAlongCorridor, geocode } from "@backend/integrations/adapters/osm-fields";
import { generatePlots } from "@backend/gis/generate-plots";

const PORTAL_INSET_PX: Record<string, number> = { angular: 0.5, classic: 0 };

async function harvestCadastral(p: NationalProject) {
  const land = p.land;
  if (land.tier !== "cadastral") return;
  const def = PORTALS.find((x) => x.lgd === land.portalLgd);
  if (!def) throw new Error(`no portal definition for ${land.portalLgd}`);
  const prof = await probe(def, { districtCode: land.portalDistrictCode, path: land.portalPath });
  if (!prof.ok || !prof.extent || !prof.hitPoint || !prof.srid) throw new Error(`portal probe failed: ${prof.reason ?? prof.failedAt}`);

  const portal: CorridorPortal = prof.kind === "assam"
    ? { kind: "assam", apiBase: `${def.base}/bhunakshaBackEnd/proxy`, wmsUrl: `${def.base}/bhunakshaBackEnd/proxy/wms`, referer: `${def.base}/`, wmsVersion: "1.3.0", stateCode: def.lgd, gisCode: prof.gisCode!, srid: prof.srid }
    : prof.kind === "georef"
    ? { kind: "georef", apiBase: `${def.base}/rest`, wmsUrl: `${def.base}/WMS`, referer: `${def.base}/${def.lgd}/index.html`, wmsVersion: "1.1.1", stateCode: def.lgd, gisCode: prof.gisCode!, srid: prof.srid }
    : prof.kind === "angular"
    ? { kind: "angular", apiBase: `${def.base}/bhunakshaserver`, wmsUrl: `${def.base}/bhunakshaserver/WMS`, referer: `${def.base}/`, wmsVersion: "1.3.0", stateCode: "", gisCode: prof.gisCode!, srid: prof.srid, wmsCrs: prof.wmsCrs, insetPx: PORTAL_INSET_PX.angular }
    : { kind: "classic", apiBase: def.base, wmsUrl: `${def.base}/WMS`, referer: `${def.base}/`, wmsVersion: "1.1.1", stateCode: prof.stateCode!, levels: prof.levels, gisCode: prof.gisCode!, srid: prof.srid, wmsCrs: prof.wmsCrs, insetPx: PORTAL_INSET_PX.classic };

  // Alignment along the village's longer side, centred on a real plot.
  const e = prof.extent;
  const wide = e.maxX - e.minX >= e.maxY - e.minY;
  const half = Math.min(700, 0.3 * Math.max(e.maxX - e.minX, e.maxY - e.minY));
  const { x, y } = prof.hitPoint;
  const centreline: [number, number][] = land.alignmentUtm ?? (wide ? [[x - half, y], [x, y + 1], [x + half, y]] : [[x, y - half], [x + 1, y], [x, y + half]]);

  console.log(`  ${p.ref} ${prof.path?.map((l) => l.name).join(" › ")} · EPSG:${prof.srid}`);
  const { plots, rejected, lookups } = await harvestCorridor(portal, { centreline, rightOfWayM: land.rightOfWayM, maxPlots: land.maxPlots, stepM: Math.max(10, Math.round(land.rightOfWayM / 3)) }, { pauseMs: 150 });
  if (plots.length < 5) throw new Error(`only ${plots.length} plots traced`);

  await writeFile(`prisma/data/cadastral/${land.corridorId}.json`, JSON.stringify({
    corridorId: land.corridorId,
    projectRef: p.ref,
    label: `${p.name} — ${prof.path?.slice(-2).map((l) => l.name).join(", ")}`,
    source: portal.apiBase,
    srid: prof.srid,
    gisCode: prof.gisCode,
    portal,
    adminPath: prof.path,
    method: portal.kind === "assam"
      ? "Plot-at-XY lookups (click_info) along the centreline; each dag's boundary is the portal's own surveyed polygon (vector WKT) with its ULPIN, and its recorded area is Dharitree's (bigha-katha-lessa)."
      : portal.kind === "georef"
      ? "Plot-at-XY lookups along the centreline; each plot's boundary is the portal's own surveyed polygon (getPlotInfo the_geom, vector WKT), checked against the extent the portal reports."
      : "Plot-at-XY lookups along the centreline; each plot's boundary traced from the portal's PLOT_LIST/PLOT_SELECTION rendering of that single plot and verified against the portal's reported extent.",
    harvestedAt: new Date().toISOString(),
    centreline,
    rightOfWayM: land.rightOfWayM,
    lookups,
    rejected,
    plots,
  }, null, 1));
  return plots.length;
}

async function harvestFields(p: NationalProject, placeQuery: string, rightOfWayM: number, maxPlots: number, note?: string) {
  const place = await geocode(placeQuery);
  await delay(1100);
  if (!place) throw new Error(`could not geocode "${placeQuery}"`);

  let tier: "OSM_FIELD" | "GENERATED" = "GENERATED";
  let fields: { ring: [number, number][]; chainageM: number; osmWayId?: number; landuse?: string; crop?: string | null }[] = [];
  let centreline: [number, number][] = [];
  let osmNote = "";
  try {
    const osm = await fieldsAlongCorridor({ osmId: 0, name: place.village ?? "", lat: place.lat, lng: place.lng }, { rightOfWayM, maxFields: maxPlots, radiusM: 1800 });
    if (osm.fields.length >= 10) {
      tier = "OSM_FIELD";
      fields = osm.fields;
      centreline = osm.centreline;
    } else {
      osmNote = `OSM has ${osm.fields.length} mapped fields on an alignment here`;
    }
  } catch (err) {
    osmNote = `OSM unavailable: ${err instanceof Error ? err.message.slice(0, 80) : err}`;
  }
  if (tier === "GENERATED") {
    const gen = generatePlots({ seed: p.ref, centre: place, maxPlots, lengthM: p.type === "RENEWABLE_ENERGY" || p.type === "INDUSTRIAL_CORRIDOR" ? 500 : 1100 });
    fields = gen.plots;
    centreline = gen.centreline;
  }

  await writeFile(fieldsSnapshotPath(p.ref), JSON.stringify({
    projectRef: p.ref,
    stateLgd: p.stateLgd,
    tier,
    source: tier === "OSM_FIELD" ? "OpenStreetMap (Overpass API)" : "Generated beside a real, geocoded village (Nominatim)",
    licence: "Place data © OpenStreetMap contributors, ODbL 1.0",
    note: [note, osmNote].filter(Boolean).join(" · ") || undefined,
    place: { query: placeQuery, ...place },
    rightOfWayM,
    centreline,
    fields,
    harvestedAt: new Date().toISOString(),
  }, null, 1));
  return { tier, count: fields.length, village: place.village, district: place.district };
}

async function main() {
  const only = process.argv.slice(2);
  await mkdir("prisma/data/cadastral", { recursive: true });
  await mkdir("prisma/data/fields", { recursive: true });
  for (const p of NATIONAL_PROJECTS) {
    const cadastralFile = p.land.tier === "cadastral" ? `prisma/data/cadastral/${p.land.corridorId}.json` : null;
    const fieldsFile = fieldsSnapshotPath(p.ref);
    const done = (cadastralFile && existsSync(cadastralFile)) || existsSync(fieldsFile);
    if (only.length ? !only.includes(p.ref) : done) continue;
    const t0 = Date.now();
    try {
      if (p.land.tier === "cadastral") {
        try {
          const n = await harvestCadastral(p);
          console.log(`✓ ${p.ref} cadastral · ${n} traced plots · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
          continue;
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          console.log(`  ${p.ref} portal gave no usable plots (${why}) — falling back to fields near ${p.land.fallbackPlace}`);
          const r = await harvestFields(p, p.land.fallbackPlace, p.land.rightOfWayM, p.land.maxPlots, `State portal: ${why}`);
          console.log(`✓ ${p.ref} ${r?.tier} (fallback) · ${r?.count} plots · ${r?.village}, ${r?.district} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        }
      } else {
        const r = await harvestFields(p, p.land.placeQuery, p.land.rightOfWayM, p.land.maxPlots);
        console.log(`✓ ${p.ref} ${r?.tier} · ${r?.count} plots · ${r?.village}, ${r?.district} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      }
    } catch (err) {
      console.log(`✗ ${p.ref} ${p.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
