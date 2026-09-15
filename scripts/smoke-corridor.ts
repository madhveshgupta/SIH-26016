/** Corridor readiness: the arithmetic behind "X km of Y can be built today". */
import { prisma } from "@backend/db/client";
import { analyseCorridor, corridorReadiness, type PlotSpan } from "@backend/projects/corridor";
import type { Actor } from "@backend/rbac/scope";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? `  ${d}` : ""}`);
  if (ok) pass++;
  else fail++;
};

async function actorFor(email: string): Promise<Actor> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true, ownerProfile: true } });
  return {
    id: u.id, role: u.role.type, jurisdictionLevel: u.jurisdictionLevel,
    stateId: u.stateId, districtId: u.districtId, tehsilId: u.tehsilId, agencyId: u.agencyId,
    ownerId: u.ownerProfile?.id ?? null,
  };
}

function handDrawn() {
  console.log("\nHand-drawn corridors");

  // 0–410 ready, three plots blocking 410–470, 470–600 ready — the pitch.
  const pitch: PlotSpan[] = [
    { id: "a", fromM: 0, toM: 210, readiness: "READY" },
    { id: "a2", fromM: 0, toM: 200, readiness: "READY" }, // the other side of the centreline
    { id: "b", fromM: 208, toM: 410, readiness: "READY" },
    { id: "x", fromM: 410, toM: 430, readiness: "BLOCKED" },
    { id: "y", fromM: 425, toM: 455, readiness: "PAID" },
    { id: "z", fromM: 452, toM: 470, readiness: "IN_PROCESS" },
    { id: "c", fromM: 470, toM: 600, readiness: "READY" },
  ];
  let r = analyseCorridor(600, pitch);
  check("longest buildable stretch is 0–410", r.longest?.fromM === 0 && r.longest?.toM === 410, JSON.stringify(r.longest));
  check("in hand in total: 540 m", r.totals.READY === 540, String(r.totals.READY));
  check("one gap, 410–470", r.gaps.length === 1 && r.gaps[0].fromM === 410 && r.gaps[0].toM === 470);
  check("its blockers are exactly x, y, z", [...r.gaps[0].blockers].sort().join() === "x,y,z", r.gaps[0].blockers.join());
  check("settling them joins the whole 600 m", r.gaps[0].joinsM === 600 && r.gaps[0].gainM === 190);
  check("the stretch is as bad as its worst plot", r.segments.some((s) => s.fromM <= 425 && s.toM >= 430 && s.state === "BLOCKED"));
  check("every metre accounted for", Object.values(r.totals).reduce((a, b) => a + b, 0) === 600);

  // One side of the road in hand, the other not: the stretch is not ready.
  r = analyseCorridor(100, [
    { id: "left", fromM: 0, toM: 100, readiness: "READY" },
    { id: "right", fromM: 30, toM: 60, readiness: "IN_PROCESS" },
  ]);
  check("a plot across the centreline blocks the full width", r.totals.IN_PROCESS === 30 && r.stretches.length === 2 && r.longest?.fromM === 60);

  // A 3 m sliver between two plots is boundary noise; a 40 m hole is not.
  r = analyseCorridor(200, [
    { id: "p", fromM: 0, toM: 97, readiness: "READY" },
    { id: "q", fromM: 100, toM: 150, readiness: "READY" },
  ]);
  check("a 3 m sliver between ready plots is closed", r.longest?.fromM === 0 && r.longest?.toM === 150, JSON.stringify(r.longest));
  check("an uncovered 50 m end is unmapped, not ready", r.totals.UNMAPPED === 50 && r.totals.READY === 150);
  check("a gap with unmapped land cannot be cleared by settling plots", r.gaps[0].joinsM === null && r.gaps[0].gainM === 0);

  r = analyseCorridor(300, [
    { id: "p", fromM: 0, toM: 100, readiness: "READY" },
    { id: "n", fromM: 100, toM: 250, readiness: "IN_PROCESS" },
  ]);
  check("settling a gap that ends in unmapped land joins up to where the record stops", r.gaps[0].joinsM === 250 && r.gaps[0].unmappedM === 50 && r.gaps[0].gainM === 150);

  r = analyseCorridor(200, [
    { id: "p", fromM: 0, toM: 97, readiness: "READY" },
    { id: "s", fromM: 97, toM: 100, readiness: "IN_PROCESS" },
    { id: "q", fromM: 100, toM: 200, readiness: "READY" },
  ]);
  check("a 3 m plot not in hand still breaks the stretch", r.longest?.toM === 200 && r.longest.fromM === 100 && r.gaps[0].blockers.join() === "s");

  // Two gaps: the cheap one ranks first.
  r = analyseCorridor(1000, [
    { id: "r1", fromM: 0, toM: 300, readiness: "READY" },
    { id: "g1", fromM: 300, toM: 320, readiness: "BLOCKED" },
    { id: "r2", fromM: 320, toM: 600, readiness: "READY" },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `g2-${i}`, fromM: 600 + i * 25, toM: 625 + i * 25, readiness: "IN_PROCESS" as const })),
    { id: "r3", fromM: 800, toM: 1000, readiness: "READY" },
  ]);
  const best = r.gaps.find((g) => g.rank === 1)!;
  check("one blocked plot joining 600 m outranks eight plots joining 480 m", best.fromM === 300 && best.blockers.length === 1, JSON.stringify(best));

  // Paid plots are one step from ready.
  r = analyseCorridor(300, [
    { id: "r", fromM: 0, toM: 100, readiness: "READY" },
    { id: "p1", fromM: 100, toM: 200, readiness: "PAID" },
    { id: "p2", fromM: 150, toM: 250, readiness: "PAID" },
    { id: "n", fromM: 250, toM: 300, readiness: "IN_PROCESS" },
  ]);
  check("possession of 2 paid plots would give 250 m", r.longestAfterPossession?.toM === 250 && r.longestAfterPossession.plots === 2);

  r = analyseCorridor(500, []);
  check("a route with no plots is all unmapped, nothing buildable", r.totals.UNMAPPED === 500 && r.longest === null);
}

async function database() {
  console.log("\nEvery project in the database");
  const admin = await actorFor("admin@bhoominayan.gov.in");
  const projects = await prisma.project.findMany({ select: { id: true, referenceNo: true }, orderBy: { referenceNo: "asc" } });
  const rows: { ref: string; route: string; buildable: string; blockers: number }[] = [];
  let problems = 0;

  for (const p of projects) {
    const r = await corridorReadiness(admin, p.id);
    if (!r) continue;
    const covered = Object.values(r.totals).reduce((a, b) => a + b, 0);
    if (covered !== r.lengthM) problems++;

    // Independent: possessed plots counted in SQL.
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "LandParcel" WHERE "projectId" = ${p.id} AND status = 'POSSESSED' AND geom IS NOT NULL;
    `;
    if (r.plots.filter((x) => x.readiness === "READY").length !== n) problems++;
    // Ready land only where every covering plot is possessed.
    for (const s of r.segments.filter((x) => x.state === "READY")) {
      const bad = r.plots.some((x) => x.readiness !== "READY" && x.fromM < s.toM && x.toM > s.fromM);
      if (bad) problems++;
    }
    rows.push({
      ref: p.referenceNo,
      route: `${r.lengthM} m`,
      buildable: `${r.longest ? r.longest.toM - r.longest.fromM : 0} m`,
      blockers: r.gaps.find((g) => g.rank === 1)?.blockers.length ?? 0,
    });
  }
  check(`${rows.length} corridors: every metre accounted for, possession counts match SQL, no ready stretch overlaps a plot not in hand`, problems === 0, `${problems} problems`);
  console.table(rows.filter((x) => x.buildable !== "0 m"));

  // A district collector sees the whole strip but only their own plots by name.
  const collector = await actorFor("collector.agra@bhoominayan.gov.in").catch(() => null);
  const elsewhere = await prisma.project.findFirst({ where: { referenceNo: "PRJ/MORTH/2026/0018" }, select: { id: true } });
  if (collector && elsewhere) {
    const r = await corridorReadiness(collector, elsewhere.id);
    check(
      "outside the viewer's jurisdiction, plots count on the strip but are not named",
      !!r && r.plots.some((x) => !x.visible) && r.plots.every((x) => x.visible || (x.khasraNo === null && x.village === null && x.desk === null)),
    );
  }
}

async function main() {
  console.log("\nCORRIDOR READINESS SMOKE TEST\n======================================================");
  handDrawn();
  await database();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}

main().finally(() => prisma.$disconnect());
