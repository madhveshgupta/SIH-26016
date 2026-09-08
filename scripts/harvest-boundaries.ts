/** Harvest India's state and district boundaries for the national choropleth. */
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "@backend/db/client";

const SOURCE = "https://raw.githubusercontent.com/udit-001/india-maps-data/main/geojson/india.geojson";
const OUT_DIR = "frontend/public/geo";
/** Degrees of simplification. 0.01° ≈ 1.1 km — a national map cannot show finer. */
const TOLERANCE = 0.01;

interface DistrictFeature {
  type: "Feature";
  properties: { district?: string; st_nm?: string; dt_code?: string; st_code?: string };
  geometry: object;
}

/** Match the boundary file's names to ours: case, punctuation and spacing differ. */
export function normalise(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

async function main() {
  console.log(`Downloading district boundaries…\n  ${SOURCE}`);
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`Source returned HTTP ${res.status}`);
  const collection = (await res.json()) as { features: DistrictFeature[] };
  console.log(`  ${collection.features.length} district features`);

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS boundary_import;`);
  await prisma.$executeRawUnsafe(`CREATE TABLE boundary_import (state text, district text, geom geometry(MultiPolygon, 4326));`);

  let loaded = 0;
  for (const f of collection.features) {
    const state = f.properties.st_nm?.trim();
    const district = f.properties.district?.trim();
    if (!state || !f.geometry) continue;
    await prisma.$executeRaw`
      INSERT INTO boundary_import (state, district, geom)
      VALUES (
        ${state}, ${district ?? null},
        ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), 4326)), 3))
      );
    `;
    loaded++;
  }
  console.log(`  loaded ${loaded} into PostGIS`);

  await mkdir(OUT_DIR, { recursive: true });

  // --- states: dissolved from their districts ------------------------------
  const states = await prisma.$queryRaw<{ name: string; geojson: string }[]>`
    SELECT state AS name,
           ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Union(geom), ${TOLERANCE}::float8), 5) AS geojson
      FROM boundary_import
     GROUP BY state
     ORDER BY state;
  `;
  const stateFc = {
    type: "FeatureCollection",
    source: SOURCE,
    licence: "Census 2011 district boundaries, ODbL — administrative reference only",
    harvestedAt: new Date().toISOString(),
    features: states.map((s) => ({
      type: "Feature",
      properties: { name: s.name, key: normalise(s.name) },
      geometry: JSON.parse(s.geojson),
    })),
  };
  await writeFile(`${OUT_DIR}/india-states.json`, JSON.stringify(stateFc));

  // --- districts -----------------------------------------------------------
  const districts = await prisma.$queryRaw<{ state: string; district: string; geojson: string }[]>`
    SELECT state, district,
           ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, ${TOLERANCE / 2}::float8), 5) AS geojson
      FROM boundary_import
     WHERE district IS NOT NULL
     ORDER BY state, district;
  `;
  const districtFc = {
    type: "FeatureCollection",
    source: SOURCE,
    licence: "Census 2011 district boundaries, ODbL — administrative reference only",
    harvestedAt: new Date().toISOString(),
    features: districts.map((d) => ({
      type: "Feature",
      properties: { name: d.district, state: d.state, key: normalise(d.district), stateKey: normalise(d.state) },
      geometry: JSON.parse(d.geojson),
    })),
  };
  await writeFile(`${OUT_DIR}/india-districts.json`, JSON.stringify(districtFc));

  await prisma.$executeRawUnsafe(`DROP TABLE boundary_import;`);

  // --- how much of our own master data these boundaries actually cover -----
  const ourStates = await prisma.state.findMany({ select: { name: true } });
  const ourDistricts = await prisma.district.findMany({ select: { name: true } });
  const stateKeys = new Set(stateFc.features.map((f) => f.properties.key));
  const districtKeys = new Set(districtFc.features.map((f) => f.properties.key));
  const missedStates = ourStates.filter((s) => !stateKeys.has(normalise(s.name)));
  const missedDistricts = ourDistricts.filter((d) => !districtKeys.has(normalise(d.name)));

  const sizes = await Promise.all(
    ["india-states.json", "india-districts.json"].map(async (f) => {
      const { size } = await (await import("node:fs/promises")).stat(`${OUT_DIR}/${f}`);
      return `${f} ${(size / 1024).toFixed(0)} KB`;
    }),
  );
  console.log(`\n  ${sizes.join(" · ")}`);
  console.log(`  states ${stateFc.features.length} · districts ${districtFc.features.length}`);
  console.log(`  matched: ${ourStates.length - missedStates.length}/${ourStates.length} of our states, ${ourDistricts.length - missedDistricts.length}/${ourDistricts.length} of our districts`);
  if (missedStates.length) console.log(`  states with no boundary: ${missedStates.map((s) => s.name).join(", ")}`);
  if (missedDistricts.length) console.log(`  districts with no boundary (drawn at state level instead): ${missedDistricts.map((d) => d.name).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
