/**
 * Every figure the dashboard shows must be reproducible by a plain SQL
 * query, and every figure must obey scope.
 */
import { prisma } from "@backend/db/client";
import { compensationTrend, delayDistribution, geoRows, normalise } from "@backend/analytics/geo";
import { computeKpis, parcelStatusCounts, stageFunnel } from "@backend/analytics/kpi";
import { filterFromParams } from "@backend/analytics/filters";
import { DEFAULT_LAYOUT, layoutFor, resetLayout, saveLayout } from "@backend/analytics/layout";
import type { Actor } from "@backend/rbac/scope";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? `  ${d}` : ""}`);
  if (ok) pass++;
  else fail++;
};
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

async function actorFor(email: string): Promise<Actor> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true, ownerProfile: true } });
  return {
    id: u.id, role: u.role.type, jurisdictionLevel: u.jurisdictionLevel,
    stateId: u.stateId, districtId: u.districtId, tehsilId: u.tehsilId, agencyId: u.agencyId,
    ownerId: u.ownerProfile?.id ?? null,
  };
}

async function main() {
  console.log("\nANALYTICS SMOKE TEST\n======================================================");

  const admin = await actorFor("admin@bhoominayan.gov.in");
  const collector = await actorFor("collector.agra@bhoominayan.gov.in");

  console.log("\nKPIs reconcile against SQL:");
  const k = await computeKpis(admin);
  const [{ parcels, hectares }] = await prisma.$queryRaw<{ parcels: bigint; hectares: number }[]>`
    SELECT COUNT(*)::bigint AS parcels, COALESCE(SUM("declaredAreaHectares"), 0)::float8 AS hectares FROM "LandParcel";`;
  check("parcel count matches SQL", k.parcelsTotal === Number(parcels), `${k.parcelsTotal} vs ${parcels}`);
  check("area proposed matches SQL", near(k.areaProposedHa, hectares, 0.05), `${k.areaProposedHa} vs ${hectares.toFixed(2)}`);

  const [{ possessed }] = await prisma.$queryRaw<{ possessed: bigint }[]>`
    SELECT COUNT(*)::bigint AS possessed FROM "LandParcel" WHERE status = 'POSSESSED';`;
  check("parcels possessed matches SQL", k.parcelsPossessed === Number(possessed), `${k.parcelsPossessed} vs ${possessed}`);

  const [{ paid }] = await prisma.$queryRaw<{ paid: number }[]>`
    SELECT COALESCE(SUM(p.amount), 0)::float8 AS paid
      FROM "Payment" p WHERE p.status IN ('PAID', 'DEPOSITED_WITH_AUTHORITY');`;
  check("compensation paid matches SQL", near(k.compensationPaid, paid, 1), `${Math.round(k.compensationPaid)} vs ${Math.round(paid)}`);

  const [{ families }] = await prisma.$queryRaw<{ families: bigint }[]>`SELECT COUNT(*)::bigint AS families FROM "AffectedFamily";`;
  check("affected families matches SQL", k.affectedFamilies === Number(families), `${k.affectedFamilies} vs ${families}`);

  const [{ conflicts }] = await prisma.$queryRaw<{ conflicts: bigint }[]>`SELECT COUNT(*)::bigint AS conflicts FROM "LandParcel" WHERE "hasConflict";`;
  check("conflicting parcels matches SQL", k.conflictingParcels === Number(conflicts), `${k.conflictingParcels} vs ${conflicts}`);

  const statuses = await parcelStatusCounts(admin);
  check("status counts sum to the parcel total", statuses.reduce((a, s) => a + s.count, 0) === Number(parcels));
  const funnel = await stageFunnel(admin);
  const [{ proposals }] = await prisma.$queryRaw<{ proposals: bigint }[]>`SELECT COUNT(*)::bigint AS proposals FROM "Proposal";`;
  check("stage funnel covers every proposal", funnel.reduce((a, f) => a + f.count, 0) === Number(proposals));

  console.log("\nScope holds:");
  const dk = await computeKpis(collector);
  const [{ agra }] = await prisma.$queryRaw<{ agra: bigint }[]>`
    SELECT COUNT(*)::bigint AS agra FROM "LandParcel" p JOIN "District" d ON d.id = p."districtId" WHERE d.name = 'Agra';`;
  check("a collector's parcels are their district's only", dk.parcelsTotal === Number(agra), `${dk.parcelsTotal} vs ${agra}`);
  check("a collector sees less than the nation", dk.parcelsTotal < k.parcelsTotal);
  const collectorGeo = await geoRows(collector);
  check("a collector's map covers one state", collectorGeo.length <= 1, `${collectorGeo.length} states`);

  console.log("\nThe map's figures:");
  const geo = await geoRows(admin);
  check("state rows sum to the national parcel count", geo.reduce((a, r) => a + r.parcels, 0) === Number(parcels));
  check("every state row carries a boundary join key", geo.every((r) => r.key === normalise(r.name) && r.key.length > 0));
  const biggest = geo[0];
  const districts = await geoRows(admin, biggest.id);
  const [{ inState }] = await prisma.$queryRaw<{ inState: bigint }[]>`
    SELECT COUNT(*)::bigint AS "inState" FROM "LandParcel" p JOIN "District" d ON d.id = p."districtId" WHERE d."stateId" = ${biggest.id};`;
  check("drilling into a state reconciles with SQL", districts.reduce((a, r) => a + r.parcels, 0) === Number(inState), `${biggest.name}`);
  check("districts carry their state's key", districts.every((d) => d.stateKey === biggest.key));

  const boundaries = JSON.parse(await (await import("node:fs/promises")).readFile("frontend/public/geo/india-states.json", "utf8")) as { features: { properties: { key: string } }[] };
  const boundaryKeys = new Set(boundaries.features.map((f) => f.properties.key));
  const unmatched = geo.filter((r) => !boundaryKeys.has(r.key));
  check("every state with land has a boundary to draw it on", unmatched.length === 0, unmatched.map((u) => u.name).join(", "));

  // Each state's own district file (scripts/harvest-district-boundaries.ts).
  const { readFile } = await import("node:fs/promises");
  const undrawn: string[] = [];
  for (const st of geo) {
    const file = JSON.parse(await readFile(`frontend/public/geo/districts/${st.key}.json`, "utf8").catch(() => '{"features":[]}')) as { features: { properties: { key: string } }[] };
    const keys = new Set(file.features.map((f) => f.properties.key));
    for (const d of await geoRows(admin, st.id)) if (d.parcels > 0 && !keys.has(d.key)) undrawn.push(`${d.name} (${st.name})`);
  }
  check("every district with land has a boundary in its state's file", undrawn.length === 0, undrawn.join(", "));

  console.log("\nFilters only ever narrow:");
  const filter = filterFromParams({ state: biggest.id });
  const filtered = await computeKpis(admin, filter);
  check("a state filter narrows the national figure", filtered.parcelsTotal < k.parcelsTotal && filtered.parcelsTotal > 0, `${filtered.parcelsTotal} of ${k.parcelsTotal}`);
  check("the filtered figure matches that state's own row", filtered.parcelsTotal === biggest.parcels);
  const crossFilter = await computeKpis(collector, filterFromParams({ state: biggest.id }));
  const agraInBiggest = collectorGeo[0]?.id === biggest.id;
  check("a filter cannot widen a collector's scope", crossFilter.parcelsTotal <= dk.parcelsTotal, agraInBiggest ? "(same state)" : "(other state — expect zero)");
  const rubbish = await computeKpis(admin, filterFromParams({ state: "'; DROP TABLE x; --", days: "abc" }));
  check("an unreadable filter is ignored, not obeyed", rubbish.parcelsTotal === k.parcelsTotal);

  console.log("\nTrend and distribution:");
  const trend = await compensationTrend(admin);
  check("the trend has one point per month", trend.length === 12);
  check("assessed is never below paid in total", trend.reduce((a, t) => a + t.assessed, 0) >= 0);
  const delays = await delayDistribution(admin);
  const [{ open }] = await prisma.$queryRaw<{ open: bigint }[]>`
    SELECT COUNT(*)::bigint AS open FROM "Proposal" p
     WHERE p.status NOT IN ('CLOSED', 'REJECTED', 'LAPSED')
       AND EXISTS (SELECT 1 FROM "ProposalStage" s WHERE s."proposalId" = p.id AND s."exitedAt" IS NULL);`;
  check("every open case falls in exactly one delay band", delays.reduce((a, d) => a + d.cases, 0) === Number(open), `${delays.reduce((a, d) => a + d.cases, 0)} vs ${open}`);

  console.log("\nA user's own dashboard arrangement:");
  const user = await prisma.user.findFirstOrThrow({ where: { email: "policy@bhoominayan.gov.in" } });
  check("defaults to every widget", (await layoutFor(user.id)).length === DEFAULT_LAYOUT.length);
  const saved = await saveLayout(user.id, ["map", "kpis", "not-a-widget", "map"]);
  check("saves order, drops unknown widgets and duplicates", saved.join(",") === "map,kpis", saved.join(","));
  check("reads back what was saved", (await layoutFor(user.id)).join(",") === "map,kpis");
  await resetLayout(user.id);
  check("resets to the default", (await layoutFor(user.id)).length === DEFAULT_LAYOUT.length);

  console.log("\n======================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
