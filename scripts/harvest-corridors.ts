/**
 * Harvest the REAL plots each demo project's alignment crosses, with their exact traced
 * boundaries, into prisma/data/cadastral/<corridor>.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { harvestCorridor, type CorridorPortal, type CorridorSpec } from "@backend/integrations/adapters/cadastral-corridor";
import { GOA_ALDONA, UP_AKBARPUR } from "@backend/integrations/adapters/village-portals";

export interface CorridorDefinition {
  id: string;
  projectRef: string;
  label: string;
  portal: CorridorPortal;
  spec: CorridorSpec;
}

export const CORRIDORS: CorridorDefinition[] = [
  {
    // Village extent from the portal: x 209254–210801, y 3000949–3003635.
    id: "up-agra-akbarpur-ring-road",
    projectRef: "PRJ/MORTH/2026/0003",
    label: "Agra Ring Road, Phase III — Akbarpur, Agra, Uttar Pradesh",
    portal: UP_AKBARPUR,
    spec: { centreline: [[209360, 3002370], [210000, 3001950], [210760, 3001480]], rightOfWayM: 60, maxPlots: 70, stepM: 12 },
  },
  {
    // A proposed rail bypass crossing the Ring Road near chainage 770 m.
    id: "up-agra-akbarpur-rail-bypass",
    projectRef: "PRJ/MOR/2026/0006",
    label: "Agra outer rail bypass (alignment option B) — Akbarpur, Agra, Uttar Pradesh",
    portal: UP_AKBARPUR,
    spec: { centreline: [[209960, 3002450], [210020, 3001950], [210100, 3001450]], rightOfWayM: 30, maxPlots: 30, stepM: 10 },
  },
  {
    // Village extent from the portal: x 377557–380474, y 1721275–1726656.
    id: "goa-aldona-nh66-bypass",
    projectRef: "PRJ/MORTH/2026/0005",
    label: "NH-66 Aldona bypass — Aldona, North Goa, Goa",
    portal: GOA_ALDONA,
    spec: { centreline: [[377873, 1724288], [378650, 1724300], [379435, 1724342]], rightOfWayM: 30, maxPlots: 50, stepM: 8 },
  },
];

async function main() {
  const [only, max] = process.argv.slice(2);
  await mkdir("prisma/data/cadastral", { recursive: true });
  for (const c of CORRIDORS) {
    if (only && c.id !== only) continue;
    const spec = max ? { ...c.spec, maxPlots: Number(max) } : c.spec;
    console.log(`\n${c.label}\n  ${spec.rightOfWayM} m right-of-way, up to ${spec.maxPlots} plots`);
    const t0 = Date.now();
    const { plots, rejected, lookups } = await harvestCorridor(c.portal, spec, { log: console.log });
    if (plots.length === 0) {
      console.error("  nothing harvested — portal down? snapshot left untouched");
      continue;
    }
    const snapshot = {
      corridorId: c.id,
      projectRef: c.projectRef,
      label: c.label,
      source: c.portal.apiBase,
      srid: c.portal.srid,
      gisCode: c.portal.gisCode,
      method:
        "Plot-at-XY lookups along the centreline; each plot's boundary traced from the portal's " +
        "PLOT_LIST/PLOT_SELECTION rendering of that single plot and verified against the portal's reported extent.",
      harvestedAt: new Date().toISOString(),
      centreline: spec.centreline,
      rightOfWayM: spec.rightOfWayM,
      lookups,
      rejected,
      plots,
    };
    const file = `prisma/data/cadastral/${c.id}.json`;
    await writeFile(file, JSON.stringify(snapshot, null, 1));
    console.log(`  → ${plots.length} plots, ${rejected.length} rejected, ${lookups} lookups, ${((Date.now() - t0) / 1000).toFixed(0)} s → ${file}`);
  }
}

if (process.argv[1]?.includes("harvest-corridors")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
