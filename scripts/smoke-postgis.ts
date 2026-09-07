/** End-to-end smoke test for the PostGIS layer. */
import { PrismaClient, Prisma } from "@prisma/client";
import {
  setParcelGeometry,
  findConflictingParcels,
  refreshConflictFlags,
  postgisVersion,
} from "../backend/gis/postgis";

const prisma = new PrismaClient();
const TAG = "__SMOKE__";

/** A square of `size` degrees with its lower-left corner at (lng, lat). */
function square(lng: number, lat: number, size: number) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [lng, lat],
        [lng + size, lat],
        [lng + size, lat + size],
        [lng, lat + size],
        [lng, lat],
      ],
    ],
  };
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  \x1b[32mok  \x1b[0m ${label}${detail ? "  " + detail : ""}`);
    pass++;
  } else {
    console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? "  " + detail : ""}`);
    fail++;
  }
}

async function cleanup() {
  await prisma.landParcel.deleteMany({ where: { khasraNo: { startsWith: TAG } } });
  await prisma.project.deleteMany({ where: { referenceNo: { startsWith: TAG } } });
}

async function main() {
  console.log("\nPOSTGIS SMOKE TEST\n==================================================");

  console.log(`  PostGIS ${await postgisVersion()}`);

  // Needs somewhere real to hang the parcels off.
  const village = await prisma.village.findFirst({ include: { tehsil: true } });
  if (!village) throw new Error("No villages seeded — run `npm run db:seed` first.");
  const tehsil = await prisma.tehsil.findUnique({
    where: { id: village.tehsilId },
    select: { districtId: true },
  });
  if (!tehsil) throw new Error("Village has no tehsil.");
  const agency = await prisma.agency.findFirst();
  if (!agency) throw new Error("No agencies seeded.");

  await cleanup();

  // Two DIFFERENT projects — conflict detection only fires across projects,
  // because one project legitimately owns adjacent parcels.
  const mk = (n: number) =>
    prisma.project.create({
      data: {
        referenceNo: `${TAG}/PRJ/${n}`,
        name: `Smoke project ${n}`,
        type: "HIGHWAY",
        governingAct: "NH_ACT_1956",
        agencyId: agency.id,
      },
    });
  const [projA, projB] = await Promise.all([mk(1), mk(2)]);

  const mkParcel = (projectId: string, khasra: string) =>
    prisma.landParcel.create({
      data: {
        khasraNo: `${TAG}${khasra}`,
        projectId,
        villageId: village.id,
        districtId: tehsil.districtId,
        declaredAreaHectares: new Prisma.Decimal("1.0000"),
        dataSource: "SIMULATED",
      },
    });

  const a = await mkParcel(projA.id, "A");
  const b = await mkParcel(projB.id, "B");

  // --- 1. area computed from geometry -------------------------------------
  // Deliberately somewhere no seeded parcel lives.
  const EMPTY_LNG = 75.5;
  const EMPTY_LAT = 20.5;
  // ~0.01 deg is ~1.11 km, so the square is ~120 ha.
  const geomA = await setParcelGeometry(a.id, square(EMPTY_LNG, EMPTY_LAT, 0.01));
  check(
    "ST_Area computes a real area from geometry",
    geomA.computedAreaHectares > 100 && geomA.computedAreaHectares < 150,
    `${geomA.computedAreaHectares.toFixed(2)} ha`,
  );
  check(
    "centroid is inside the polygon",
    Math.abs(geomA.centroidLng - (EMPTY_LNG + 0.005)) < 0.001 &&
      Math.abs(geomA.centroidLat - (EMPTY_LAT + 0.005)) < 0.001,
    `${geomA.centroidLat.toFixed(4)}, ${geomA.centroidLng.toFixed(4)}`,
  );

  const declared = Number(a.declaredAreaHectares);
  check(
    "declared vs computed gap is detectable",
    Math.abs(geomA.computedAreaHectares - declared) > 1,
    `declared ${declared} ha vs computed ${geomA.computedAreaHectares.toFixed(2)} ha`,
  );

  // --- 2. conflict detection ----------------------------------------------
  // B overlaps A's lower-left quadrant.
  await setParcelGeometry(b.id, square(EMPTY_LNG + 0.005, EMPTY_LAT + 0.005, 0.01));
  const conflicts = await findConflictingParcels(a.id);
  check(
    "overlapping parcels from different projects are detected",
    conflicts.length === 1 && conflicts[0].id === b.id,
    `${conflicts.length} conflict(s), overlap ${conflicts[0]?.overlapHectares?.toFixed(2) ?? "?"} ha`,
  );

  const n = await refreshConflictFlags(a.id);
  const [fa, fb] = await Promise.all([
    prisma.landParcel.findUnique({ where: { id: a.id }, select: { hasConflict: true } }),
    prisma.landParcel.findUnique({ where: { id: b.id }, select: { hasConflict: true } }),
  ]);
  check("both parcels get flagged", fa?.hasConflict === true && fb?.hasConflict === true, `n=${n}`);

  // --- 3. stale flags clear ------------------------------------------------
  // This is the bug that a naive implementation leaves behind: move B far away
  // and B must stop being flagged, not just A.
  await setParcelGeometry(b.id, square(EMPTY_LNG + 3, EMPTY_LAT + 3, 0.01));
  await refreshConflictFlags(b.id);
  const [ca, cb] = await Promise.all([
    prisma.landParcel.findUnique({ where: { id: a.id }, select: { hasConflict: true } }),
    prisma.landParcel.findUnique({ where: { id: b.id }, select: { hasConflict: true } }),
  ]);
  check("moved-away parcel clears its own flag", cb?.hasConflict === false);
  check("the OTHER parcel's stale flag also clears", ca?.hasConflict === false);

  // --- 4. invalid geometry is refused --------------------------------------
  // A self-intersecting polygon silently breaks ST_Area, so the DB constraint
  // must reject it rather than let us pay compensation on a wrong area.
  let rejected = false;
  try {
    await setParcelGeometry(a.id, {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]], // bow-tie
    });
  } catch {
    rejected = true;
  }
  check("self-intersecting geometry is rejected by the DB constraint", rejected);

  await cleanup();
  console.log("==================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch(async (e) => {
    console.error("\n\x1b[31mSmoke test error:\x1b[0m", e instanceof Error ? e.message : e);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
