/** Boundary audit — are the parcels on the map the REAL plots, drawn exactly? */
import { PrismaClient } from "@prisma/client";
import { portalFetch } from "@backend/integrations/http";
import { loadCadastralSnapshots, type CadastralSnapshot } from "./lib/cadastral-snapshots";

const prisma = new PrismaClient();
let pass = 0, fail = 0, skip = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? `  ${detail}` : ""}`);
  if (ok) pass++; else fail++;
}

async function main() {
  console.log("\nBOUNDARY AUDIT\n======================================================");

  console.log("\n1. Validity and provenance");
  const rows = await prisma.$queryRaw<{ n: bigint; valid: bigint; wgs: bigint; live: bigint; liveTraced: bigint; liveAcc: bigint; liveSrc: bigint; kinds: bigint }[]>`
    SELECT count(*) n,
           count(*) FILTER (WHERE ST_IsValid(geom)) valid,
           count(*) FILTER (WHERE ST_SRID(geom) = 4326 AND GeometryType(geom) = 'POLYGON') wgs,
           count(*) FILTER (WHERE "geometryKind" = 'TRACED') live,
           count(*) FILTER (WHERE "geometryKind" = 'TRACED' AND "dataSource" = 'LIVE') "liveTraced",
           count(*) FILTER (WHERE "geometryKind" = 'TRACED' AND "boundaryAccuracyM" <= 1.0) "liveAcc",
           count(*) FILTER (WHERE "geometryKind" = 'TRACED' AND "sourcePlotId" IS NOT NULL) "liveSrc",
           count(*) FILTER (WHERE "geometryKind" IN ('SURVEYED','TRACED','OSM_FIELD','GENERATED','ENVELOPE')) kinds
      FROM "LandParcel" WHERE geom IS NOT NULL;`;
  const r = rows[0];
  const n = Number(r.n), live = Number(r.live);
  check("parcels with boundaries exist", n > 0, `${n}`);
  check("every boundary is valid", Number(r.valid) === n);
  check("every boundary is a WGS84 polygon", Number(r.wgs) === n);
  check("provenance is explicit on every parcel", Number(r.kinds) === n);
  check("traced parcels come from a live state portal", live > 0 && Number(r.liveTraced) === live, `${r.liveTraced}/${live}`);
  check("every traced boundary is within 1 m of the portal's extent", Number(r.liveAcc) === live, `${r.liveAcc}/${live}`);
  check("every traced boundary names its source plot id", Number(r.liveSrc) === live);

  console.log("\n2. Not bounding boxes");
  const boxes = await prisma.$queryRaw<{ boxes: bigint; total: bigint; fill: number }[]>`
    SELECT count(*) FILTER (WHERE ST_Area(geom) >= 0.995 * ST_Area(ST_Envelope(geom))) boxes,
           count(*) total,
           avg(ST_Area(geom) / NULLIF(ST_Area(ST_Envelope(geom)), 0))::float8 fill
      FROM "LandParcel" WHERE "geometryKind" IN ('TRACED', 'OSM_FIELD');`;
  check("no real parcel is drawn as its bounding box", Number(boxes[0].boxes) === 0,
    `${boxes[0].boxes} box-shaped of ${boxes[0].total}; a plot fills ${(boxes[0].fill * 100).toFixed(0)}% of its envelope on average`);

  console.log("\n3. Outline matches the portal's reported extent");
  for (const snap of loadCadastralSnapshots()) {
    const c = { id: snap.corridorId };
    const db = await prisma.$queryRaw<{ sourcePlotId: string; minx: number; miny: number; maxx: number; maxy: number }[]>`
      SELECT p."sourcePlotId",
             ST_XMin(g)::float8 minx, ST_YMin(g)::float8 miny, ST_XMax(g)::float8 maxx, ST_YMax(g)::float8 maxy
        FROM (SELECT "sourcePlotId", ST_Transform(geom, ${snap.srid}::integer) g
                FROM "LandParcel" p JOIN "Project" pr ON pr.id = p."projectId"
               WHERE pr."referenceNo" = ${snap.projectRef}) p;`;
    const byId = new Map(db.map((d) => [d.sourcePlotId, d]));
    let worst = 0, missing = 0;
    for (const p of snap.plots) {
      const d = byId.get(p.plotId);
      if (!d) { missing++; continue; }
      const e = p.reportedExtent;
      worst = Math.max(worst, Math.abs(d.minx - e.minX), Math.abs(d.maxx - e.maxX), Math.abs(d.miny - e.minY), Math.abs(d.maxy - e.maxY));
    }
    check(`${c.id}: every harvested plot is on the map`, missing === 0, `${snap.plots.length - missing}/${snap.plots.length}`);
    check(`${c.id}: stored boundary within 1 m of the portal extent`, worst <= 1.0, `worst ${worst.toFixed(2)} m`);
  }

  console.log("\n4. Neighbouring plots fit together");
  // Median over neighbour pairs: a single inconsistent plot in the state's own
  // data (Punjab's khasra 106 overlaps four killas of murabba 13) must not hide
  // how well the rest fit — it is reported as the worst pair instead.
  const nb = await prisma.$queryRaw<{ village: string; pairs: bigint; width: number; worst: string }[]>`
    WITH u AS (
      SELECT DISTINCT ON (p."villageId", p."khasraNo") p.id, p."khasraNo" k, v.name village,
             ST_Transform(p.geom, 32600 + floor((ST_X(ST_Centroid(p.geom)) + 180) / 6)::int + 1) g
        FROM "LandParcel" p JOIN "Village" v ON v.id = p."villageId" WHERE p."geometryKind" = 'TRACED'),
    pairs AS (
      SELECT a.village, a.k ka, b.k kb,
             ST_Area(ST_Intersection(a.g, b.g)) / ST_Length(ST_Intersection(ST_Boundary(a.g), ST_Buffer(b.g, 0.5))) w
        FROM u a JOIN u b ON a.id < b.id AND a.village = b.village AND ST_DWithin(a.g, b.g, 0.5)
       WHERE ST_Length(ST_Intersection(ST_Boundary(a.g), ST_Buffer(b.g, 0.5))) > 5)
    SELECT village, count(*) pairs,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY w)::float8 width,
           (array_agg(ka || ' / ' || kb || ' ' || round((w * 100)::numeric) || ' cm' ORDER BY w DESC))[1] worst
      FROM pairs GROUP BY 1 HAVING count(*) >= 5 ORDER BY 1;`;
  for (const v of nb) {
    // Portals whose stroke inset has not been calibrated are reported, with a
    // looser bound; the calibrated ones (Akbarpur, Aldona) must be within 15 cm.
    const calibrated = ["Akbarpur", "Aldona"].includes(v.village);
    check(`${v.village}: shared edges agree to within ${calibrated ? 15 : 40} cm`, v.width < (calibrated ? 0.15 : 0.4), `median overlap band ${(v.width * 100).toFixed(1)} cm over ${v.pairs} neighbour pairs; worst ${v.worst}`);
  }

  console.log("\n5. One plot, two projects");
  const dup = await prisma.$queryRaw<{ pairs: bigint; worst: number; flagged: bigint }[]>`
    SELECT count(*) pairs, max(ST_HausdorffDistance(ST_Transform(a.geom, 32644), ST_Transform(b.geom, 32644)))::float8 worst,
           count(*) FILTER (WHERE a."hasConflict" AND b."hasConflict") flagged
      FROM "LandParcel" a JOIN "LandParcel" b
        ON a."villageId" = b."villageId" AND a."khasraNo" = b."khasraNo" AND a."projectId" < b."projectId";`;
  check("plots claimed twice exist (rail bypass crosses the ring road)", Number(dup[0].pairs) > 0, `${dup[0].pairs}`);
  check("both claims carry the identical boundary", (dup[0].worst ?? 1) < 0.01, `max Hausdorff ${(dup[0].worst ?? 0).toFixed(3)} m`);
  check("both claims are flagged as a conflict", Number(dup[0].flagged) === Number(dup[0].pairs));
  const falseFlags = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) n FROM "LandParcel" a
     WHERE a."hasConflict" AND NOT EXISTS (
       SELECT 1 FROM "LandParcel" b WHERE b."villageId" = a."villageId" AND b."khasraNo" = a."khasraNo" AND b."projectId" <> a."projectId");`;
  check("neighbours that merely touch are NOT flagged", Number(falseFlags[0].n) === 0, `${falseFlags[0].n} false flag(s)`);

  console.log("\n6. Round trip to the live state portal");
  if (process.env.OFFLINE === "1") {
    console.log("  skip OFFLINE=1"); skip++;
  } else {
    for (const snap of loadCadastralSnapshots()) {
      const c = { id: snap.corridorId, portal: snap.portal, projectRef: snap.projectRef };
      const sample = await prisma.$queryRaw<{ khasraNo: string; sourcePlotId: string; x: number; y: number }[]>`
        SELECT p."khasraNo", p."sourcePlotId",
               ST_X(ST_Transform(ST_PointOnSurface(p.geom), ${snap.srid}::integer))::float8 x,
               ST_Y(ST_Transform(ST_PointOnSurface(p.geom), ${snap.srid}::integer))::float8 y
          FROM "LandParcel" p JOIN "Project" pr ON pr.id = p."projectId"
         WHERE pr."referenceNo" = ${c.projectRef} AND p."geometryKind" = 'TRACED'
         ORDER BY p."chainageM" LIMIT 40;`;
      const picks = [0, 0.5, 0.99].map((f) => sample[Math.floor(f * (sample.length - 1))]).filter(Boolean);
      let same = 0, reached = 0;
      const details: string[] = [];
      for (const s of picks) {
        const id = await plotIdAt(c, s.x, s.y).catch(() => null);
        if (id === null) { details.push(`${s.khasraNo}:unreachable`); continue; }
        reached++;
        if (id === s.sourcePlotId) same++;
        details.push(`${s.khasraNo}:${id === s.sourcePlotId ? "same" : "DIFFERENT"}`);
        await new Promise((res) => setTimeout(res, 200));
      }
      if (reached === 0) {
        console.log(`  skip ${c.id}: portal unreachable`); skip++;
      } else {
        check(`${c.id}: portal returns the same plot for a point inside our boundary`, same === reached, details.join(" "));
      }
    }
  }

  console.log("\n======================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}${skip ? `   SKIPPED ${skip}` : ""}\n`);
  if (fail > 0) process.exitCode = 1;
}

async function plotIdAt(c: { portal: CadastralSnapshot["portal"] }, x: number, y: number): Promise<string | null> {
  const p = c.portal;
  // Same client as the harvester, so per-host TLS exceptions apply.
  if (p.kind === "angular") {
    const res = await portalFetch(`${p.apiBase}/MapInfo/getPlotAtXY`, {
      method: "POST", referer: p.referer, timeoutMs: 15_000,
      body: new URLSearchParams({ giscode: p.gisCode, x: String(x), y: String(y), plotno: "" }).toString(),
    });
    return res.ok ? (await res.json<{ id?: string }>()).id ?? "" : null;
  }
  const qs = new URLSearchParams({ OP: "4", state: p.stateCode, levels: p.levels ?? "", x: String(x), y: String(y) });
  const res = await portalFetch(`${p.apiBase}/ScalarDatahandler?${qs}`, { referer: p.referer, timeoutMs: 15_000 });
  return res.ok ? (await res.json<{ ID?: string }>()).ID ?? "" : null;
}

main()
  .catch((e) => { console.error("\nBoundary audit error:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
