/**
 * Smoke test: parcel service, ULPIN, conflict detection and the area-discrepancy report,
 * against the real seeded data.
 */
import { PrismaClient } from "@prisma/client";
import { generateUlpin, areaDiscrepancies, parcelStatusSummary } from "../backend/gis/parcels";
import { findConflictingParcels } from "../backend/gis/postgis";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? "  " + d : ""}`);
  if (ok) pass++;
  else fail++;
};

async function main() {
  console.log("\nGIS / PARCELS SMOKE TEST\n======================================================");

  console.log("\nULPIN (the national parcel identifier):");
  const a = generateUlpin("09", "146", "124649", "347/4");
  check("is 14 characters", a.length === 14, a);
  check("encodes state, district and village", a.startsWith("09146124649"), a);
  check("is deterministic for the same plot", generateUlpin("09", "146", "124649", "347/4") === a);
  check("differs for a different khasra",
    generateUlpin("09", "146", "124649", "348/1") !== a);
  check("differs across districts",
    generateUlpin("09", "147", "124649", "347/4") !== a);

  console.log("\nSeeded parcels:");
  const total = await prisma.landParcel.count();
  check("parcels are seeded", total >= 13, `${total}`);
  const withGeom = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "LandParcel" WHERE geom IS NOT NULL`;
  check("all parcels carry geometry", Number(withGeom[0].n) === total,
    `${withGeom[0].n}/${total}`);

  console.log("\nConflict detection (two projects, same land):");
  const flagged = await prisma.landParcel.count({ where: { hasConflict: true } });
  check("conflicting parcels are flagged", flagged > 0, `${flagged} parcels`);
  const conflicted = await prisma.landParcel.findFirst({ where: { hasConflict: true } });
  if (conflicted) {
    const overlaps = await findConflictingParcels(conflicted.id);
    check("each flagged parcel really overlaps another project's land",
      overlaps.length > 0, `${overlaps.length} overlap(s), ${overlaps[0]?.overlapHectares?.toFixed(4)} ha`);
    const other = await prisma.landParcel.findUnique({ where: { id: overlaps[0].id } });
    check("the overlap is across DIFFERENT projects",
      other?.projectId !== conflicted.projectId,
      "(parcels within one project may legitimately adjoin)");
  }
  const clean = await prisma.landParcel.findFirst({ where: { hasConflict: false } });
  if (clean) {
    check("non-conflicting parcels have no overlaps",
      (await findConflictingParcels(clean.id)).length === 0);
  }

  console.log("\nArea discrepancy (revenue record vs the mapped boundary):");
  const disc = await areaDiscrepancies(0.01);
  // Plot 452, Akbarpur: the record says 0.0250 ha under one khata; the state's own map measures
  // ~0.106 ha.
  const p452 = disc.find((d) => d.khasraNo === "452");
  check("a real record-vs-map gap is reported (Akbarpur 452)", Boolean(p452),
    p452 ? `record ${p452.declared} ha vs map ${p452.computed.toFixed(4)} ha` : "missing");
  check("it is reported as larger on the map than on record", (p452?.difference ?? 0) > 0);
  const kinds = await prisma.landParcel.findMany({
    where: { id: { in: disc.map((d) => d.id) } },
    select: { geometryKind: true, areaFromRecord: true },
  });
  check("only real boundaries are compared (never an envelope)",
    kinds.every((k) => k.geometryKind !== "ENVELOPE"));
  check("plots with no published area are never reported",
    kinds.every((k) => k.areaFromRecord), `${disc.length} reported above 0.01 ha`);
  const goaIds = await prisma.landParcel.findMany({
    where: { village: { name: "Aldona" } }, select: { id: true },
  });
  const scoped = await areaDiscrepancies(0.01, goaIds.map((g) => g.id));
  check("a scoped report stays inside its jurisdiction",
    !scoped.some((d) => d.khasraNo === "452"), `${scoped.length} in Aldona`);

  console.log("\nStatus summary (drives the map legend):");
  const summary = await parcelStatusSummary();
  check("statuses are grouped with areas", summary.length >= 3,
    summary.map((r) => `${r.status}:${r.count}`).join(" "));
  const ha = summary.reduce((s, r) => s + r.hectares, 0);
  check("total area is sane", ha > 5 && ha < 5000, `${ha.toFixed(2)} ha`);

  console.log("\n======================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error("\n\x1b[31mError:\x1b[0m", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
