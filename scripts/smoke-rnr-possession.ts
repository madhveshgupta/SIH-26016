/** Phases 9 & 10: Second Schedule entitlements and the s.38 possession guard. */
import { PrismaClient } from "@prisma/client";
import { computeEntitlements, entitlementTotal, amenityCompletion } from "../backend/rnr/entitlements";
import { checkPossessionAllowed, takePossession } from "../backend/possession/guard";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? "  " + d : ""}`);
  if (ok) pass++;
  else fail++;
};

async function main() {
  console.log("\nR&R / POSSESSION SMOKE TEST\n======================================================");

  console.log("\nSecond Schedule entitlements:");
  const displacedOwner = computeEntitlements({
    category: "LANDOWNER", isDisplaced: true, livelihoodDependent: true, isIrrigationProject: false,
  });
  const affectedOnly = computeEntitlements({
    category: "AGRICULTURAL_LABOURER", isDisplaced: false, livelihoodDependent: true, isIrrigationProject: false,
  });
  check("a displaced family gets far more than an affected one",
    displacedOwner.length > affectedOnly.length,
    `${displacedOwner.length} vs ${affectedOnly.length} entitlements`);
  check("housing is only for the displaced",
    displacedOwner.some((e) => e.type === "HOUSING_UNIT") &&
      !affectedOnly.some((e) => e.type === "HOUSING_UNIT"));
  check("a landless labourer still gets livelihood support",
    affectedOnly.some((e) => e.type === "ANNUITY_OR_EMPLOYMENT"),
    "(they never owned land, but lost their work)");

  const scFamily = computeEntitlements({
    category: "SC", isDisplaced: true, livelihoodDependent: true, isIrrigationProject: false,
  });
  const generalFamily = computeEntitlements({
    category: "LANDOWNER", isDisplaced: true, livelihoodDependent: true, isIrrigationProject: false,
  });
  check("SC/ST families receive additional protection (ss.41–42)",
    entitlementTotal(scFamily) > entitlementTotal(generalFamily),
    `₹${entitlementTotal(scFamily).toLocaleString("en-IN")} vs ₹${entitlementTotal(generalFamily).toLocaleString("en-IN")}`);

  const irrigation = computeEntitlements({
    category: "LANDOWNER", isDisplaced: true, livelihoodDependent: true, isIrrigationProject: true,
  });
  check("irrigation projects owe land-for-land, not just cash",
    irrigation.some((e) => e.type === "LAND_FOR_LAND"),
    "(cash does not restore a farming livelihood)");
  check("every entitlement cites its Schedule item",
    displacedOwner.every((e) => e.scheduleItem.length > 0),
    displacedOwner.map((e) => e.scheduleItem).join(", "));

  console.log("\nThird Schedule amenities:");
  const bare = amenityCompletion({ hasRoad: true, hasDrinkingWater: true, hasElectricity: true });
  check("an incomplete site reports what is missing", bare.missing.length === 4,
    `${bare.pct}% — missing ${bare.missing.length}`);
  const complete = amenityCompletion({
    hasRoad: true, hasDrainage: true, hasDrinkingWater: true, hasElectricity: true,
    hasSchool: true, hasHealthCentre: true, hasPanchayatBuilding: true,
  });
  check("a complete site reports 100%", complete.pct === 100);

  console.log("\nPossession guard (LARR s.38) — against real data:");
  const unpaid = await prisma.landParcel.findFirst({
    where: { status: "AWARD_DECLARED", compensations: { some: {} } },
  });
  if (!unpaid) {
    check("an awarded-but-unpaid parcel exists to test", false, "run db:seed:awards");
  } else {
    const c = await checkPossessionAllowed(unpaid.id);
    check("🚫 POSSESSION IS REFUSED while compensation is unpaid", !c.allowed,
      c.reason ?? "");
    check("the refusal cites the statutory basis", /s\.38/.test(c.message));
    check("it states the exact amount outstanding", c.outstandingAmount > 0,
      `₹${c.outstandingAmount.toLocaleString("en-IN")} of ₹${c.totalAwarded.toLocaleString("en-IN")}`);

    const officer = await prisma.user.findUnique({ where: { email: "collector.agra@bhoominayan.gov.in" } });
    const attempt = await takePossession({ parcelId: unpaid.id, actorId: officer!.id });
    check("the write itself is blocked, not just warned about", !attempt.ok);
    const created = await prisma.possessionRecord.findUnique({ where: { parcelId: unpaid.id } });
    check("no possession record was created", created === null);

    const audited = await prisma.auditLog.findFirst({
      where: { entityType: "PossessionRecord", entityId: unpaid.id },
      orderBy: { sequence: "desc" },
    });
    check("the blocked attempt is written to the audit chain", audited !== null,
      "(an attempt to take land over unpaid compensation is what an auditor needs to see)");
  }

  console.log("\nPossession guard — the paid case:");
  const paidParcel = await prisma.landParcel.findFirst({
    where: { status: "COMPENSATED", compensations: { some: { payments: { some: { status: "PAID" } } } } },
  });
  if (paidParcel) {
    // R&R may still be outstanding in that village, which s.38 also covers.
    const c = await checkPossessionAllowed(paidParcel.id);
    check("a fully paid parcel clears the compensation test", c.outstandingAmount === 0,
      `outstanding ₹${c.outstandingAmount}`);
    if (!c.allowed) {
      check("but R&R entitlements still block it", c.reason === "RNR_OUTSTANDING",
        `${c.rnrOutstandingFamilies} families outstanding — s.38 covers R&R too`);
    } else {
      check("and possession is permitted", c.allowed, c.message);
    }
  }

  console.log("\nSeeded R&R data:");
  const [fams, disp, ents] = await Promise.all([
    prisma.affectedFamily.count(),
    prisma.affectedFamily.count({ where: { isDisplaced: true } }),
    prisma.rnREntitlement.count(),
  ]);
  check("families are recorded", fams > 50, `${fams}`);
  check("affected and displaced are counted separately", disp > 0 && disp < fams,
    `${disp} displaced of ${fams} affected — the PS asks for both`);
  check("entitlements are computed per family", ents > fams, `${ents} entitlements`);

  console.log("\n======================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error("\n\x1b[31mError:\x1b[0m", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
