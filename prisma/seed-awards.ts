/** Awards, compensation, payments and affected families. */
import { PrismaClient, Prisma, type FamilyCategory, type RnRStatus } from "@prisma/client";
import { calculateCompensation } from "../backend/compensation/calculator";
import { computeEntitlements } from "../backend/rnr/entitlements";

const prisma = new PrismaClient();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Deterministic pseudo-random, so the demo looks the same every run. */
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];

const FAMILY_NAMES = [
  "Ramlal Yadav", "Shanti Devi", "Abdul Rahman", "Krishnan Nair", "Balwinder Kaur",
  "Sitaram Gond", "Rukmini Bai", "Jagdish Prasad", "Noor Jahan", "Mangal Singh",
  "Savitri Devi", "Ashok Kumar Meena", "Phoolwati", "Ganesh Bhosale", "Zubeida Khatoon",
];

async function main() {
  console.log("Seeding awards, compensation and affected families…\n");

  await prisma.rnRPayment.deleteMany({});
  await prisma.rnREntitlement.deleteMany({});
  await prisma.affectedFamily.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.compensationRecord.deleteMany({});
  await prisma.award.deleteMany({});
  await prisma.possessionRecord.deleteMany({});

  const parcels = await prisma.landParcel.findMany({
    include: {
      district: true,
      village: true,
      owners: { include: { owner: true } },
      project: true,
    },
  });
  if (parcels.length === 0) throw new Error("Run `npm run db:seed:parcels` first.");

  const proposals = await prisma.proposal.findMany();
  let awards = 0, comps = 0, paidCount = 0;
  let totalAssessed = 0, totalPaid = 0;

  for (const p of parcels) {
    // Only parcels that have reached the award stage carry compensation.
    const advanced = ["AWARD_DECLARED", "COMPENSATED", "POSSESSED"].includes(p.status);
    if (!advanced) continue;

    const proposal = proposals.find((x) => x.projectId === p.projectId);
    const rate = Number(p.district.circleRatePerHectare ?? 4_000_000);
    const multiplier = Number(p.district.multiplierFactor);
    const area = Number(p.declaredAreaHectares);

    const breakdown = calculateCompensation({
      areaHectares: area,
      circleRatePerHectare: rate,
      multiplierFactor: multiplier,
      assets: {
        trees: Math.round(rnd() * 400_000),
        wells: rnd() > 0.6 ? 300_000 : 0,
        structures: p.landUse === "HOMESTEAD" ? 1_200_000 : 0,
        standingCrop: p.landUse === "IRRIGATED" ? 85_000 : 0,
      },
      siaNotificationDate: daysAgo(500),
      awardDate: daysAgo(120),
    });

    const award = await prisma.award.create({
      data: {
        awardNo: `AWD/${p.district.lgdCode}/2026/${String(awards + 1).padStart(4, "0")}`,
        proposalId: proposal?.id ?? proposals[0].id,
        parcelId: p.id,
        declaredOn: daysAgo(120),
        publishedOn: daysAgo(115),
        totalAmount: breakdown.total,
        enquiryNotes: "Enquiry held under s.23; objections on valuation heard and disposed.",
      },
    });
    awards++;

    for (const po of p.owners) {
      const share = Number(po.sharePct);
      const owed = breakdown.total.mul(share).div(100);

      const rec = await prisma.compensationRecord.create({
        data: {
          parcelId: p.id,
          ownerId: po.ownerId,
          awardId: award.id,
          marketValuePerHectare: new Prisma.Decimal(rate),
          marketValueBasis: breakdown.marketValueBasis,
          areaHectares: new Prisma.Decimal(area),
          multiplierFactor: new Prisma.Decimal(multiplier),
          landValue: breakdown.landValue,
          treesValue: new Prisma.Decimal(0),
          structuresValue: new Prisma.Decimal(0),
          wellsValue: new Prisma.Decimal(0),
          standingCropValue: new Prisma.Decimal(0),
          assetsSubtotal: breakdown.assetsSubtotal,
          subTotal: breakdown.subTotal,
          solatium: breakdown.solatium,
          interestAmount: breakdown.interestAmount,
          totalCompensation: breakdown.total,
          ownerSharePct: new Prisma.Decimal(share),
          payableToOwner: owed,
          assessedAt: daysAgo(120),
        },
      });
      comps++;
      totalAssessed += Number(owed.toString());

      // COMPENSATED and POSSESSED parcels are paid; AWARD_DECLARED ones are the
      // outstanding cases the reconciliation dashboard and s.38 guard exist for.
      if (p.status === "COMPENSATED" || p.status === "POSSESSED") {
        await prisma.payment.create({
          data: {
            compensationId: rec.id,
            amount: owed,
            status: "PAID",
            utrNumber: `PFMS${Math.floor(rnd() * 9e11 + 1e11)}`,
            instructedAt: daysAgo(90),
            paidAt: daysAgo(85),
          },
        });
        paidCount++;
        totalPaid += Number(owed.toString());
      } else {
        await prisma.payment.create({
          data: { compensationId: rec.id, amount: owed, status: "PENDING", instructedAt: daysAgo(60) },
        });
      }
    }
  }

  // --- affected families, counts derived from real Census households ---------
  // Families in every village where land is actually being acquired.
  const villages = await prisma.village.findMany({
    where: { parcels: { some: {} } },
    include: { parcels: { select: { project: { select: { type: true } } } } },
  });
  const categories: FamilyCategory[] = [
    "LANDOWNER", "AGRICULTURAL_LABOURER", "TENANT", "SHARECROPPER", "ARTISAN", "SC", "ST",
  ];
  const statuses: RnRStatus[] = [
    "IDENTIFIED", "ENTITLEMENT_DETERMINED", "AWARD_PASSED", "PAYMENT_MADE", "RESETTLED", "LIVELIHOOD_RESTORED",
  ];

  let families = 0, displaced = 0, entitlements = 0;
  for (const v of villages) {
    // Roughly 4% of a village's households, which is a plausible share for a
    // corridor acquisition rather than a whole-village submergence.
    const n = Math.max(3, v.censusHouseholds ? Math.round(v.censusHouseholds * 0.04) : Math.ceil(v.parcels.length / 2));
    const irrigation = v.parcels.some((p) => p.project.type === "IRRIGATION");
    for (let i = 0; i < n; i++) {
      const category = pick(categories);
      const isDisplaced = rnd() < 0.35;
      const status = pick(statuses);
      const fam = await prisma.affectedFamily.create({
        data: {
          familyHeadName: `${pick(FAMILY_NAMES)}`,
          villageId: v.id,
          category,
          memberCount: 2 + Math.floor(rnd() * 6),
          isDisplaced,
          livelihoodDependent: rnd() < 0.7,
          status,
        },
      });
      families++;
      if (isDisplaced) displaced++;

      const items = computeEntitlements({
        category,
        isDisplaced,
        livelihoodDependent: true,
        isIrrigationProject: irrigation,
        hadCattleShedOrShop: rnd() < 0.4,
        isArtisanOrTrader: category === "ARTISAN",
      });
      for (const it of items) {
        const ent = await prisma.rnREntitlement.create({
          data: {
            familyId: fam.id,
            entitlementType: it.type,
            description: `${it.label} (${it.scheduleItem})`,
            amount: it.amount != null ? new Prisma.Decimal(it.amount) : null,
            isInKind: it.amount == null,
            status,
          },
        });
        entitlements++;
        if (["PAYMENT_MADE", "RESETTLED", "LIVELIHOOD_RESTORED"].includes(status) && it.amount) {
          await prisma.rnRPayment.create({
            data: {
              entitlementId: ent.id,
              amount: new Prisma.Decimal(it.amount),
              status: "PAID",
              utrNumber: `PFMS${Math.floor(rnd() * 9e11 + 1e11)}`,
              paidAt: daysAgo(40),
            },
          });
        }
      }
    }
  }

  // A resettlement site, deliberately incomplete against the Third Schedule.
  const site = await prisma.resettlementSite.create({
    data: {
      name: "Akbarpur Resettlement Colony",
      lat: new Prisma.Decimal(27.1502), lng: new Prisma.Decimal(77.9901),
      totalPlots: 120, allottedPlots: 74,
      hasRoad: true, hasDrinkingWater: true, hasElectricity: true,
      hasDrainage: false, hasSchool: false, hasHealthCentre: false, hasPanchayatBuilding: false,
    },
  });
  const someFamilies = await prisma.affectedFamily.findMany({ where: { isDisplaced: true }, take: 74 });
  await prisma.affectedFamily.updateMany({
    where: { id: { in: someFamilies.map((f) => f.id) } },
    data: { siteId: site.id },
  });

  const fmt = (n: number) => `₹${(n / 1e7).toFixed(2)} cr`;
  console.log(`  awards declared        ${awards}`);
  console.log(`  compensation records   ${comps}`);
  console.log(`  payments made          ${paidCount}`);
  console.log(`  assessed               ${fmt(totalAssessed)}`);
  console.log(`  disbursed              ${fmt(totalPaid)}`);
  console.log(`  OUTSTANDING            ${fmt(totalAssessed - totalPaid)}  ← blocks possession under s.38`);
  console.log(`  affected families      ${families}  (${displaced} displaced)`);
  console.log(`  R&R entitlements       ${entitlements}`);
  console.log(`  resettlement site      ${site.name} — 3 of 7 Third Schedule amenities`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
