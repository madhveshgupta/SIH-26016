/**
 * Choosing a new project's land: candidates, corridor selection, live lookup, creating the
 * project, changing its land at draft, and the guards on each.
 */
import { prisma } from "@backend/db/client";
import { recomputeAllConflicts } from "@backend/gis/postgis";
import {
  changeProjectLand, createProjectWithLand, lookupLivePlot, mayChangeProjectLand, mayCreateProjects,
  recordCandidates, recordPlotsInCorridor, selectableDistricts,
} from "@backend/projects/land-selection";
import type { Actor } from "@backend/rbac/scope";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? "  " + d : ""}`);
  if (ok) pass++;
  else fail++;
};
const refused = (p: Promise<unknown>) => p.then(() => "", (e: Error) => e.message);

async function main() {
  console.log("\nLAND SELECTION SMOKE TEST\n======================================================");
  const conflictsBefore = await recomputeAllConflicts();

  console.log("\nWho chooses land:");
  check("a land requiring body may create projects", mayCreateProjects("LAND_REQUIRING_BODY"));
  check("a collector may not", !mayCreateProjects("DISTRICT_COLLECTOR"));
  check("a CALA may not", !mayCreateProjects("LAND_ACQUIRING_AUTHORITY"));
  check("a landowner may not change project land", !mayChangeProjectLand("LANDOWNER"));

  console.log("\nCandidates:");
  const districts = await selectableDistricts();
  const goa = districts.find((d) => d.name === "North Goa")!;
  const agra = districts.find((d) => d.name === "Agra")!;
  check("districts with mapped land are offered", districts.length > 10, `${districts.length}`);
  check("live cadastre flagged where a portal is verified", goa.liveCadastre && agra.liveCadastre);
  const agraPlots = await recordCandidates(agra.id);
  check("a plot two projects record is listed once, naming both",
    agraPlots.some((p) => p.claimedBy.length === 2) &&
      new Set(agraPlots.map((p) => `${p.village}|${p.khasraNo}`)).size === agraPlots.length);
  const goaPlots = await recordCandidates(goa.id);
  const a = goaPlots[0].geometry.coordinates[0][0];
  const b = goaPlots[12].geometry.coordinates[0][0];
  const corridor = await recordPlotsInCorridor(goa.id, [a, b], 30);
  check("an alignment's right-of-way selects the plots it crosses", corridor.length > 0, `${corridor.length} plots`);
  const wider = await recordPlotsInCorridor(goa.id, [a, b], 120);
  check("a wider right-of-way takes at least as many", wider.length >= corridor.length, `${wider.length}`);

  const [pt] = await prisma.$queryRaw<{ lat: number; lng: number }[]>`
    SELECT ST_Y(g)::float8 lat, ST_X(g)::float8 lng FROM ST_Transform(ST_SetSRID(ST_MakePoint(377975, 1724940), 32643), 4326) g`;
  const live = await lookupLivePlot(goa.id, pt.lat, pt.lng);
  if (live.plot?.live) check("live lookup traces a plot from the state cadastre", live.plot.source === "LIVE" && (live.plot.mapHa ?? 0) > 0, live.message);
  else console.log(`  skip live lookup — ${live.message}`);
  const noPortal = districts.find((d) => !d.liveCadastre)!;
  check("a district without a portal says so", (await lookupLivePlot(noPortal.id, 20, 80)).plot === null);

  console.log("\nCreating a project:");
  const officer = await prisma.user.findFirstOrThrow({ where: { email: "nhai.officer@bhoominayan.gov.in" }, include: { role: true } });
  const actor: Actor = { id: officer.id, role: officer.role.type, jurisdictionLevel: officer.jurisdictionLevel, stateId: null, districtId: null, tehsilId: null, agencyId: officer.agencyId };
  const base = { type: "HIGHWAY" as const, governingAct: "NH_ACT_1956" as const, agencyId: officer.agencyId! };
  check("no land is refused", (await refused(createProjectWithLand({ ...base, name: "SMOKE land test", picks: { record: [], live: [] } }, actor))).includes("at least one"));
  check("a vague name is refused", (await refused(createProjectWithLand({ ...base, name: "x", picks: { record: corridor, live: [] } }, actor))).length > 0);
  if (live.plot?.live) {
    const forged = { ...live.plot.live, ringUtm: live.plot.live.ringUtm.map(([x, y]) => [x + 40, y] as [number, number]) };
    check("a boundary altered after lookup is refused",
      (await refused(createProjectWithLand({ ...base, name: "SMOKE land test", picks: { record: [], live: [{ live: forged, signature: live.plot.signature! }] } }, actor))).includes("verification"));
  }

  const created = await createProjectWithLand({
    ...base, name: "SMOKE land test", alignment: [a, b], rightOfWayM: 30,
    picks: { record: [...corridor, corridor[0]], live: live.plot?.live ? [{ live: live.plot.live, signature: live.plot.signature! }] : [] },
  }, actor);
  try {
    const expected = corridor.length + (live.plot?.live ? 1 : 0);
    check("one parcel per plot, duplicates ignored", created.parcels === expected, `${created.parcels}`);
    const proposals = await prisma.proposal.findMany({ where: { projectId: created.id }, include: { stages: true } });
    check("a draft proposal per district, with its stage", proposals.length === 1 && proposals[0].status === "DRAFT" && proposals[0].stages.length === 1);
    const parcels = await prisma.landParcel.findMany({ where: { projectId: created.id }, include: { _count: { select: { owners: true, vertices: true } } } });
    check("parcels start as proposed", parcels.every((p) => p.status === "PROPOSED"));
    check("recorded plots keep their owners and boundary points",
      // Recorded plots carry no ULPIN of their own (the first project holds it); the live one does.
      parcels.filter((p) => p.ulpin == null).every((p) => p._count.owners > 0 && p._count.vertices > 2));
    check("plots already claimed are flagged as conflicts", created.conflicts > 0 && created.conflicts <= corridor.length, `${created.conflicts}`);
    check("parcels are ordered along the alignment", parcels.every((p) => p.chainageM != null));

    console.log("\nChanging land at draft:");
    const extra = goaPlots.find((p) => !corridor.includes(p.key))!;
    const removeOne = parcels.find((p) => p.hasConflict)!;
    const change = await changeProjectLand(created.id, { add: { record: [extra.key, corridor[1]], live: [] }, remove: [removeOne.id] }, actor);
    check("adds new plots, skips ones already held, removes", change.added === 1 && change.removed === 1, JSON.stringify(change));
    await prisma.proposal.updateMany({ where: { projectId: created.id }, data: { status: "SUBMITTED" } });
    const lockedId = (await prisma.landParcel.findFirstOrThrow({ where: { projectId: created.id } })).id;
    check("land on a submitted proposal is locked",
      (await refused(changeProjectLand(created.id, { add: { record: [], live: [] }, remove: [lockedId] }, actor))).includes("return it for clarification"));
  } finally {
    await prisma.project.delete({ where: { id: created.id } });
  }
  check("conflict flags restored after cleanup", (await recomputeAllConflicts()) === conflictsBefore);

  console.log("\n======================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
