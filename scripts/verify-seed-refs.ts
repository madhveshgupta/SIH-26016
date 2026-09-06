/** Static referential-integrity check on the seed registry. */
import { existsSync, readFileSync } from "node:fs";
import { NATIONAL_PROJECTS, fieldsSnapshotPath } from "../prisma/data/national-projects";
import { STATE_CODE } from "../backend/geo/state-codes";

const problems: string[] = [];
const warnings: string[] = [];

// --- project references -----------------------------------------------------
const refs = NATIONAL_PROJECTS.map((p) => p.ref);
for (const ref of refs) {
  if (!/^PRJ\/[A-Z]+\/\d{4}\/\d{4}$/.test(ref)) problems.push(`malformed project reference: ${ref}`);
}
const duplicates = refs.filter((r, i) => refs.indexOf(r) !== i);
if (duplicates.length) problems.push(`duplicate project references: ${[...new Set(duplicates)].join(", ")}`);

// --- states and districts ---------------------------------------------------
const states = new Set(NATIONAL_PROJECTS.map((p) => p.stateLgd));
for (const p of NATIONAL_PROJECTS) {
  if (!/^\d{2}$/.test(p.stateLgd)) problems.push(`${p.ref}: state LGD code is not two digits (${p.stateLgd})`);
  if (!p.district.lgdCode) problems.push(`${p.ref}: district "${p.district.name}" has no LGD code`);
  if (!(p.district.multiplier >= 1 && p.district.multiplier <= 2)) {
    problems.push(`${p.ref}: First Schedule multiplier ${p.district.multiplier} is outside the statutory 1.0–2.0`);
  }
  if (!(p.district.ratePerHa > 0)) problems.push(`${p.ref}: district ${p.district.name} has no circle rate`);
  if (p.district.isUrban && p.district.multiplier !== 1) {
    problems.push(`${p.ref}: ${p.district.name} is urban, where the First Schedule fixes the multiplier at 1.0`);
  }
}
if (states.size < 36) problems.push(`only ${states.size} states/UTs have a project (expected all 28 states and 8 UTs)`);
if (Object.keys(STATE_CODE).length < 36) problems.push(`STATE_CODE covers ${Object.keys(STATE_CODE).length} states/UTs (expected 28 states and 8 UTs)`);

// --- the land each project draws on -----------------------------------------
let cadastral = 0;
let fields = 0;
for (const p of NATIONAL_PROJECTS) {
  if (p.land.tier === "cadastral") {
    cadastral++;
    const snapshot = `prisma/data/cadastral/${p.land.corridorId}.json`;
    if (existsSync(snapshot)) {
      const snap = JSON.parse(readFileSync(snapshot, "utf8")) as { plots?: unknown[]; centreline?: unknown[]; srid?: number };
      if (!snap.plots?.length) problems.push(`${snapshot} contains no plots`);
      if (!snap.centreline || snap.centreline.length < 2) problems.push(`${snapshot} has no usable centreline`);
      if (!snap.srid) problems.push(`${snapshot} does not say which CRS its coordinates are in`);
    } else if (existsSync(fieldsSnapshotPath(p.ref))) {
      // Designed for: where a portal yields nothing, the project falls back to
      // OSM fields or generated plots, and the tier is shown to users.
      warnings.push(`${p.ref}: no cadastral snapshot (${p.land.corridorId}.json) — falls back to its fields snapshot`);
    } else {
      problems.push(`${p.ref}: neither a cadastral snapshot (${p.land.corridorId}.json) nor a fields snapshot exists — this project would seed no land`);
    }
    if (!existsSync(`prisma/data/portals/${p.land.portalLgd}.json`)) {
      warnings.push(`${p.ref}: portal profile ${p.land.portalLgd}.json has not been probed`);
    }
  } else {
    fields++;
    if (!existsSync(fieldsSnapshotPath(p.ref))) {
      problems.push(`${p.ref}: fields snapshot missing — run scripts/harvest-national.ts ${p.ref}`);
    }
  }
}

for (const w of warnings) console.log(`  note: ${w}`);
if (problems.length) {
  console.error("Seed referential integrity — problems found:");
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(
  `Seed references check out: ${refs.length} projects across ${states.size} states/UTs ` +
    `(${cadastral} cadastral, ${fields} fields), every district coded and rated.`,
);
