/** Harvest current district boundaries from OpenStreetMap, one file per state. */
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { prisma } from "@backend/db/client";

const MIRRORS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter"];
const UA = "BhoomiNayan/1.0 (SIH PS 26016 land-acquisition demonstration)";
const CACHE = "node_modules/.cache/bhoomi-osm-districts";
const OUT_DIR = "frontend/public/geo/districts";
const CENSUS_FILE = "frontend/public/geo/india-districts.json";
/** Simplification, scaled to the state: its larger side ÷ 4000, never under ~45 m. */
const TOLERANCE_DIVISOR = 4000;
const MIN_TOLERANCE = 0.0004;
/** Island territories: OSM draws their districts out over the sea, which would paint the ocean. */
const ISLANDS = new Set(["IN-LD"]);
/** OSM district names that differ from ours beyond punctuation. */
const DISTRICT_KEY_ALIAS: Record<string, string> = {
  uttarbastarkanker: "kanker",
};
/**
 * Census geometry is kept for these: J&K and Ladakh for the official depiction (see above);
 * Andaman & Nicobar because OSM draws its districts over hundreds of km of open sea and its
 * islands cannot be reliably cut out of OSM (much of their coastline is not returned by
 * Overpass).
 */
const KEEP_CENSUS = new Set(["jammuandkashmir", "ladakh", "andamanandnicobarislands"]);

/** OSM's state names where they differ from ours after normalising. */
const STATE_ALIAS: Record<string, string> = {
  nctofdelhi: "delhi",
  nationalcapitalterritoryofdelhi: "delhi",
  andamanandnicobar: "andamanandnicobarislands",
  thedadraandnagarhavelianddamananddiu: "dadraandnagarhavelianddamananddiu",
  odisha: "odisha",
  orissa: "odisha",
  pondicherry: "puducherry",
};

/** Must match harvest-boundaries.ts and backend/analytics/geo.ts. (Not imported: that script runs on import.) */
function normalise(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]/g, "");
}

interface OsmMember { type: string; role: string; geometry?: { lat: number; lon: number }[] }
interface OsmRelation { type: "relation"; id: number; tags: Record<string, string>; members: OsmMember[] }

async function overpass(query: string): Promise<{ elements: OsmRelation[] }> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return (await res.json()) as { elements: OsmRelation[] };
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
    }
  }
  throw last;
}

/** A district's name as people write it: English, without the word "district". */
function districtName(tags: Record<string, string>): string {
  return (tags["name:en"] ?? tags.name ?? "").replace(/\s+district$/i, "").trim();
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  const ourStates = await prisma.state.findMany({ select: { name: true, districts: { select: { name: true } } } });
  const ourByKey = new Map(ourStates.map((s) => [normalise(s.name), s]));

  console.log("States in OpenStreetMap…");
  const statesList = await overpass(
    `[out:json][timeout:120];area["ISO3166-1"="IN"][admin_level=2]->.in;` +
      `rel(area.in)[boundary=administrative][admin_level=4]["ISO3166-2"~"^IN-"];out tags;`,
  );
  const osmStates = statesList.elements.map((e) => {
    const raw = normalise(e.tags["name:en"] ?? e.tags.name ?? "");
    return { iso: e.tags["ISO3166-2"], key: STATE_ALIAS[raw] ?? raw, name: e.tags["name:en"] ?? e.tags.name };
  });
  const unmatchedOsm = osmStates.filter((s) => !ourByKey.has(s.key));
  if (unmatchedOsm.length) console.log(`  OSM states not matched to ours: ${unmatchedOsm.map((s) => `${s.name} (${s.iso})`).join(", ")}`);

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS osm_district_lines;`);
  await prisma.$executeRawUnsafe(`CREATE TABLE osm_district_lines (state_key text, rel bigint, name text, line geometry(LineString, 4326));`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS osm_island_lines;`);
  await prisma.$executeRawUnsafe(`CREATE TABLE osm_island_lines (state_key text, osm_id text, coast boolean, line geometry(LineString, 4326));`);

  const report: string[] = [];
  for (const st of osmStates.filter((s) => ourByKey.has(s.key) && !KEEP_CENSUS.has(s.key)).sort((a, b) => a.key.localeCompare(b.key))) {
    const cacheFile = `${CACHE}/${st.iso}.json`;
    let data: { elements: OsmRelation[] };
    if (existsSync(cacheFile)) {
      data = JSON.parse(await readFile(cacheFile, "utf8"));
    } else {
      process.stdout.write(`  ${st.name.padEnd(42)} fetching… `);
      data = await overpass(
        `[out:json][timeout:280];area["ISO3166-2"="${st.iso}"][admin_level=4]->.s;` +
          `rel(area.s)[boundary=administrative][admin_level=5];out geom;`,
      );
      await writeFile(cacheFile, JSON.stringify(data));
      console.log(`${data.elements.length} districts`);
      await new Promise((r) => setTimeout(r, 3_000)); // be a considerate client
    }

    if (ISLANDS.has(st.iso)) {
      const islandFile = `${CACHE}/${st.iso}-islands.json`;
      let islands: { elements: (OsmRelation | { type: "way"; id: number; geometry?: { lat: number; lon: number }[] })[] };
      if (existsSync(islandFile)) {
        islands = JSON.parse(await readFile(islandFile, "utf8"));
      } else {
        islands = (await overpass(
          `[out:json][timeout:280];area["ISO3166-2"="${st.iso}"][admin_level=4]->.s;` +
            `(way[natural=coastline](area.s);way[place~"^(island|islet)$"](area.s);rel[place~"^(island|islet)$"](area.s););out geom;`,
        )) as typeof islands;
        await writeFile(islandFile, JSON.stringify(islands));
      }
      // Coastline ways join into rings around every island, however it is
      // tagged; island outlines add the few whose coastline is not mapped.
      for (const el of islands.elements) {
        const coast = el.type === "way" && (el as { tags?: Record<string, string> }).tags?.natural === "coastline";
        const ways = el.type === "way" ? [el.geometry] : (el as OsmRelation).members.filter((m) => m.type === "way" && m.role !== "inner").map((m) => m.geometry);
        for (const g of ways) {
          if (!g || g.length < 2) continue;
          const wkt = `LINESTRING(${g.map((p) => `${p.lon} ${p.lat}`).join(",")})`;
          await prisma.$executeRaw`INSERT INTO osm_island_lines VALUES (${st.key}, ${coast ? "coast" : `${el.type}/${el.id}`}, ${coast}, ST_GeomFromText(${wkt}, 4326))`;
        }
      }
    }

    for (const rel of data.elements) {
      const name = districtName(rel.tags);
      if (!name) continue;
      for (const m of rel.members) {
        if (m.type !== "way" || !m.geometry || m.geometry.length < 2 || !["outer", "inner", ""].includes(m.role)) continue;
        const wkt = `LINESTRING(${m.geometry.map((p) => `${p.lon} ${p.lat}`).join(",")})`;
        await prisma.$executeRaw`INSERT INTO osm_district_lines VALUES (${st.key}, ${rel.id}, ${name}, ST_GeomFromText(${wkt}, 4326))`;
      }
    }
  }

  // Rings from ways; then every state's districts simplified as one coverage.
  const built = await prisma.$queryRaw<{ state_key: string; name: string; geojson: string | null }[]>`
    WITH areas AS (
      SELECT state_key, rel, min(name) AS name,
             ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_BuildArea(ST_Node(ST_Collect(line)))), 3)) AS geom
        FROM osm_district_lines
       GROUP BY state_key, rel
    ), land AS (
      -- Island territories: the islands' own outlines, joined into one shape.
      -- All of a state's coastline builds its islands in one pass (osm_id
      -- "coast"); each tagged island is built on its own.
      SELECT state_key, ST_MakeValid(ST_BuildArea(ST_Node(ST_Collect(line)))) AS geom
        FROM osm_island_lines
       GROUP BY state_key, osm_id
    ), land_by_state AS (
      SELECT state_key, ST_Union(geom) AS geom FROM land WHERE geom IS NOT NULL GROUP BY state_key
    ), clipped AS (
      SELECT a.state_key, a.name,
             CASE WHEN l.geom IS NULL THEN a.geom
                  ELSE ST_Multi(ST_CollectionExtract(ST_Intersection(a.geom, l.geom), 3)) END AS geom
        FROM areas a LEFT JOIN land_by_state l USING (state_key)
    ), valid AS (
      SELECT * FROM clipped WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
    ), tolerance AS (
      SELECT state_key,
             GREATEST(${MIN_TOLERANCE}::float8,
                      GREATEST(ST_XMax(ST_Extent(geom)) - ST_XMin(ST_Extent(geom)),
                               ST_YMax(ST_Extent(geom)) - ST_YMin(ST_Extent(geom))) / ${TOLERANCE_DIVISOR}::float8) AS tol
        FROM valid GROUP BY state_key
    ), simplified AS (
      SELECT v.state_key, v.name, v.geom, t.tol,
             ST_CoverageSimplify(v.geom, t.tol) OVER (PARTITION BY v.state_key) AS simple
        FROM valid v JOIN tolerance t USING (state_key)
    )
    SELECT state_key, name,
           ST_AsGeoJSON(COALESCE(simple, ST_SimplifyPreserveTopology(geom, tol)), 5) AS geojson
      FROM simplified
     ORDER BY state_key, name;
  `;
  await prisma.$executeRawUnsafe(`DROP TABLE osm_district_lines;`);
  await prisma.$executeRawUnsafe(`DROP TABLE osm_island_lines;`);

  // Census geometry for the states kept on the official depiction.
  const census = JSON.parse(await readFile(CENSUS_FILE, "utf8")) as { features: { properties: { stateKey: string; key: string; name: string; state: string }; geometry: object }[] };

  const byState = new Map<string, { name: string; key: string; geometry: object }[]>();
  for (const b of built) {
    if (!b.geojson) continue;
    const list = byState.get(b.state_key) ?? [];
    const key = normalise(b.name);
    list.push({ name: b.name, key: DISTRICT_KEY_ALIAS[key] ?? key, geometry: JSON.parse(b.geojson) });
    byState.set(b.state_key, list);
  }
  // Census geometry where it is kept on purpose, and wherever OSM gave nothing.
  const censusFallback = new Set<string>(KEEP_CENSUS);
  for (const key of ourByKey.keys()) if (!byState.has(key)) censusFallback.add(key);
  for (const key of censusFallback) {
    const features = census.features.filter((f) => f.properties.stateKey === key);
    if (features.length === 0) {
      byState.delete(key);
      continue;
    }
    byState.set(key, features.map((f) => ({ name: f.properties.name, key: f.properties.key, geometry: f.geometry })));
  }

  let bytes = 0;
  for (const [stateKey, districts] of byState) {
    const state = ourByKey.get(stateKey)!;
    const kept = censusFallback.has(stateKey);
    const fc = {
      type: "FeatureCollection",
      source: kept ? "Census 2011 district boundaries (github.com/udit-001/india-maps-data)" : "OpenStreetMap administrative boundaries, admin_level 5",
      licence: kept ? "ODbL — administrative reference only" : "© OpenStreetMap contributors, ODbL — administrative reference only",
      harvestedAt: new Date().toISOString(),
      features: districts.map((d) => ({
        type: "Feature",
        properties: { name: d.name, state: state.name, key: d.key, stateKey },
        geometry: d.geometry,
      })),
    };
    const file = `${OUT_DIR}/${stateKey}.json`;
    await writeFile(file, JSON.stringify(fc));
    bytes += (await stat(file)).size;

    const have = new Set(districts.map((d) => d.key));
    const missing = state.districts.filter((d) => !have.has(normalise(d.name))).map((d) => d.name);
    report.push(`  ${state.name.padEnd(42)} ${String(districts.length).padStart(3)} districts${kept ? " (Census)" : ""}${missing.length ? `  — not found: ${missing.join(", ")}` : ""}`);
  }

  console.log(`\n${report.sort().join("\n")}`);
  const noFile = ourStates.filter((s) => !byState.has(normalise(s.name))).map((s) => s.name);
  console.log(`\n  ${byState.size} state files, ${(bytes / 1024).toFixed(0)} KB in all`);
  if (noFile.length) console.log(`  no district file (the national file is used): ${noFile.join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
