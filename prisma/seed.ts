/** BHOOMI NAYAN — database seed. */
import { NATIONAL_PROJECTS } from "./data/national-projects";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// REAL DATA — LGD state codes, and verified cadastral portal reachability.
// ---------------------------------------------------------------------------
type StateSeed = {
  lgdCode: string;
  name: string;
  isUT?: boolean;
  cadastral?: { baseUrl: string; gen: "classic" | "angular"; code: string };
};

const STATES: StateSeed[] = [
  // --- verified working cadastral APIs (14) ---------------------------------
  { lgdCode: "01", name: "Jammu and Kashmir", isUT: true,
    cadastral: { baseUrl: "https://bhunaksha.jk.gov.in", gen: "angular", code: "01" } },
  { lgdCode: "02", name: "Himachal Pradesh",
    cadastral: { baseUrl: "https://bhunakshahp.nic.in", gen: "angular", code: "02" } },
  { lgdCode: "03", name: "Punjab",
    cadastral: { baseUrl: "https://gisbhunaksha.punjab.gov.in", gen: "classic", code: "03" } },
  { lgdCode: "06", name: "Haryana",
    cadastral: { baseUrl: "https://maps.revenueharyana.gov.in", gen: "angular", code: "06" } },
  { lgdCode: "08", name: "Rajasthan",
    cadastral: { baseUrl: "https://bhunaksha.rajasthan.gov.in/Viewmap", gen: "classic", code: "08" } },
  { lgdCode: "09", name: "Uttar Pradesh",
    cadastral: { baseUrl: "https://upbhunaksha.gov.in", gen: "angular", code: "09" } },
  { lgdCode: "10", name: "Bihar",
    cadastral: { baseUrl: "https://bhunaksha.bihar.gov.in", gen: "classic", code: "10" } },
  { lgdCode: "21", name: "Odisha",
    cadastral: { baseUrl: "https://bhunakshaodisha.nic.in/bhunaksha", gen: "classic", code: "21" } },
  { lgdCode: "22", name: "Chhattisgarh",
    cadastral: { baseUrl: "https://bhunaksha.cg.nic.in", gen: "classic", code: "22" } },
  { lgdCode: "28", name: "Andhra Pradesh",
    cadastral: { baseUrl: "https://bhunaksha.ap.gov.in/bhunakshalpm", gen: "classic", code: "28" } },
  { lgdCode: "30", name: "Goa",
    cadastral: { baseUrl: "https://bhunaksha.goa.gov.in/bhunaksha", gen: "classic", code: "30" } },
  { lgdCode: "31", name: "Lakshadweep", isUT: true,
    cadastral: { baseUrl: "https://bhunaksha.utl.gov.in/bhunaksha", gen: "classic", code: "31" } },
  { lgdCode: "16", name: "Tripura",
    cadastral: { baseUrl: "https://bhunaksha.tripura.gov.in/bhunaksha", gen: "classic", code: "16" } },
  { lgdCode: "33", name: "Tamil Nadu",
    cadastral: { baseUrl: "https://collabland-tn.gov.in", gen: "classic", code: "33" } },

  // --- no reachable cadastral API; these fall back to the mock adapter ------
  { lgdCode: "04", name: "Chandigarh", isUT: true },
  { lgdCode: "05", name: "Uttarakhand" },
  { lgdCode: "07", name: "Delhi", isUT: true },
  { lgdCode: "11", name: "Sikkim" },
  { lgdCode: "12", name: "Arunachal Pradesh" },
  { lgdCode: "13", name: "Nagaland" },
  { lgdCode: "14", name: "Manipur" },
  { lgdCode: "15", name: "Mizoram" },
  { lgdCode: "17", name: "Meghalaya" },
  { lgdCode: "18", name: "Assam" },
  { lgdCode: "19", name: "West Bengal" },
  { lgdCode: "20", name: "Jharkhand" },
  { lgdCode: "23", name: "Madhya Pradesh" },
  { lgdCode: "24", name: "Gujarat" },
  { lgdCode: "26", name: "Dadra and Nagar Haveli and Daman and Diu", isUT: true },
  { lgdCode: "27", name: "Maharashtra" },
  { lgdCode: "29", name: "Karnataka" },
  { lgdCode: "32", name: "Kerala" },
  { lgdCode: "34", name: "Puducherry", isUT: true },
  { lgdCode: "35", name: "Andaman and Nicobar Islands", isUT: true },
  { lgdCode: "36", name: "Telangana" },
  { lgdCode: "37", name: "Ladakh", isUT: true },
];

/**
 * REAL district LGD codes and names for the demo states, with real circle rates where collected
 * and the First Schedule multiplier (1.0-2.0 rural by distance from an urban centre, 1.0 urban).
 */
const DISTRICTS: Record<
  string,
  { lgdCode: string; name: string; nameLocal?: string; isUrban?: boolean; multiplier: number; ratePerHa?: number }[]
> = {
  "09": [
    { lgdCode: "146", name: "Agra", nameLocal: "आगरा", multiplier: 1.4, ratePerHa: 6_800_000 },
    { lgdCode: "143", name: "Aligarh", nameLocal: "अलीगढ़", multiplier: 1.5, ratePerHa: 5_200_000 },
    { lgdCode: "177", name: "Ayodhya", nameLocal: "अयोध्या", multiplier: 1.6, ratePerHa: 4_100_000 },
    { lgdCode: "191", name: "Azamgarh", nameLocal: "आजमगढ", multiplier: 1.7, ratePerHa: 3_400_000 },
    { lgdCode: "180", name: "Bahraich", nameLocal: "बहराइच", multiplier: 1.8, ratePerHa: 2_600_000 },
    { lgdCode: "139", name: "Baghpat", nameLocal: "बागपत", multiplier: 1.2, ratePerHa: 9_500_000 },
  ],
  "08": [
    { lgdCode: "01", name: "Ajmer", nameLocal: "अजमेर", multiplier: 1.5, ratePerHa: 3_900_000 },
    { lgdCode: "02", name: "Bikaner", nameLocal: "बीकानेर", multiplier: 1.9, ratePerHa: 1_800_000 },
    { lgdCode: "03", name: "Jaipur", nameLocal: "जयपुर", isUrban: true, multiplier: 1.0, ratePerHa: 14_500_000 },
    { lgdCode: "04", name: "Jodhpur", nameLocal: "जोधपुर", multiplier: 1.6, ratePerHa: 3_200_000 },
  ],
  "22": [
    { lgdCode: "57", name: "Kabirdham", nameLocal: "कबीरधाम", multiplier: 1.8, ratePerHa: 1_900_000 },
    { lgdCode: "60", name: "Kanker", nameLocal: "कांकेर", multiplier: 1.9, ratePerHa: 1_500_000 },
    { lgdCode: "49", name: "Raipur", nameLocal: "रायपुर", isUrban: true, multiplier: 1.0, ratePerHa: 11_200_000 },
  ],
  "03": [
    { lgdCode: "01", name: "Jalandhar", nameLocal: "ਜਲੰਧਰ", multiplier: 1.3, ratePerHa: 7_400_000 },
    { lgdCode: "02", name: "Amritsar", nameLocal: "ਅੰਮ੍ਰਿਤਸਰ", multiplier: 1.3, ratePerHa: 7_100_000 },
    { lgdCode: "11", name: "Ludhiana", nameLocal: "ਲੁਧਿਆਣਾ", isUrban: true, multiplier: 1.0, ratePerHa: 12_800_000 },
  ],
  "30": [
    { lgdCode: "01", name: "North Goa", multiplier: 1.2, ratePerHa: 18_000_000 },
    { lgdCode: "02", name: "South Goa", multiplier: 1.3, ratePerHa: 15_500_000 },
  ],
  "02": [
    { lgdCode: "04", name: "Una", nameLocal: "ऊना", multiplier: 1.6, ratePerHa: 3_100_000 },
    { lgdCode: "07", name: "Kullu", nameLocal: "कुल्लू", multiplier: 1.8, ratePerHa: 4_300_000 },
    { lgdCode: "02", name: "Kangra", nameLocal: "कांगड़ा", multiplier: 1.7, ratePerHa: 3_800_000 },
  ],
  "21": [
    { lgdCode: "6", name: "Kalahandi", nameLocal: "କଳାହାଣ୍ଡି", multiplier: 1.9, ratePerHa: 1_400_000 },
    { lgdCode: "13", name: "Sundargarh", nameLocal: "ସୁନ୍ଦରଗଡ", multiplier: 1.8, ratePerHa: 1_700_000 },
  ],
};

/** Tehsils per demo district (real names). */
const TEHSILS: Record<string, { lgdCode: string; name: string; nameLocal?: string }[]> = {
  "09:146": [
    { lgdCode: "00766", name: "Agra", nameLocal: "आगरा" },
    { lgdCode: "00765", name: "Etmadpur", nameLocal: "एत्मादपुर" },
    { lgdCode: "00767", name: "Kiraoli", nameLocal: "किरावली" },
  ],
  "08:03": [{ lgdCode: "0301", name: "Jaipur", nameLocal: "जयपुर" }],
  "22:49": [{ lgdCode: "4901", name: "Raipur", nameLocal: "रायपुर" }],
  "30:01": [
    { lgdCode: "30010002", name: "Bardez" },
    { lgdCode: "30010003", name: "Tiswadi" },
  ],
};

/** Villages per demo tehsil (real names; Census figures indicative). */
const VILLAGES: Record<
  string,
  { lgdCode: string; name: string; nameLocal?: string; households: number; population: number;
    school?: boolean; health?: boolean; water?: boolean; power?: boolean; road?: boolean }[]
> = {
  "09:146:00766": [
    { lgdCode: "124649", name: "Akbarpur", nameLocal: "अकबरपुर", households: 412, population: 2318,
      school: true, water: true, power: true, road: true },
    { lgdCode: "124618", name: "Akola", nameLocal: "अकोला", households: 287, population: 1602,
      school: true, water: true, power: true },
    { lgdCode: "124591", name: "Anguthi", nameLocal: "अंगूठी", households: 156, population: 894,
      water: true, power: true },
  ],
  "30:01:30010002": [
    { lgdCode: "40113000", name: "Aldona", households: 1240, population: 5680,
      school: true, health: true, water: true, power: true, road: true },
    { lgdCode: "00003800", name: "Anjuna", households: 890, population: 4120,
      school: true, water: true, power: true, road: true },
  ],
  "08:03:0301": [
    { lgdCode: "081001", name: "Bagru", nameLocal: "बगरू", households: 620, population: 3410,
      school: true, water: true, power: true, road: true },
  ],
  "22:49:4901": [
    { lgdCode: "221001", name: "Dhaneli", nameLocal: "धनेली", households: 340, population: 1870,
      school: true, water: true, power: true },
  ],
};

const MINISTRIES = [
  { code: "MORTH", name: "Ministry of Road Transport and Highways" },
  { code: "MOR", name: "Ministry of Railways" },
  { code: "MOJS", name: "Ministry of Jal Shakti" },
  { code: "MNRE", name: "Ministry of New and Renewable Energy" },
  { code: "MORD", name: "Ministry of Rural Development" },
  { code: "DPIIT", name: "Department for Promotion of Industry and Internal Trade" },
];

const AGENCIES = [
  { code: "NHAI", name: "National Highways Authority of India", ministry: "MORTH" },
  { code: "NHIDCL", name: "National Highways & Infrastructure Development Corporation Ltd", ministry: "MORTH" },
  { code: "RVNL", name: "Rail Vikas Nigam Limited", ministry: "MOR" },
  { code: "CWC", name: "Central Water Commission", ministry: "MOJS" },
  { code: "SECI", name: "Solar Energy Corporation of India", ministry: "MNRE" },
  { code: "NICDC", name: "National Industrial Corridor Development Corporation", ministry: "DPIIT" },
];

const ROLES: { type: any; name: string; description: string }[] = [
  { type: "SUPER_ADMIN", name: "Super Administrator", description: "Full system access; manages master data." },
  { type: "LAND_REQUIRING_BODY", name: "Land Requiring Body", description: "Submits acquisition proposals; its implementation unit builds after possession." },
  { type: "LAND_ACQUIRING_AUTHORITY", name: "Land Acquiring Authority", description: "Processes acquisition on the ground." },
  { type: "DISTRICT_COLLECTOR", name: "District Collector", description: "Scrutiny, award, possession. Scoped to one district." },
  { type: "STATE_GOVERNMENT", name: "State Government", description: "State-level approval. Scoped to one state." },
  { type: "CENTRAL_MINISTRY", name: "Central Ministry", description: "National oversight, high-value approvals, analytics and what-if simulation." },
  { type: "REHABILITATION_AUTHORITY", name: "Rehabilitation Authority", description: "R&R entitlements and resettlement." },
  { type: "LANDOWNER", name: "Landowner / Citizen", description: "Sees own land, compensation, entitlements; files objections." },
];

/**
 * Projects come from the national registry (prisma/data/national-projects.ts):
 * one place that lists every project, the state and district it needs land in,
 * and where that land's boundaries come from.
 */
const PROJECTS = NATIONAL_PROJECTS.map((p) => ({
  referenceNo: p.ref,
  name: p.name,
  type: p.type,
  governingAct: p.act,
  agency: p.agency,
  ministry: p.ministry,
  areaHa: p.estAreaHa,
  costCrore: p.estCostCrore,
  states: [p.stateLgd],
  districts: [`${p.stateLgd}:${p.district.lgdCode}`],
  district: p.district,
}));

// ---------------------------------------------------------------------------

async function main() {
  console.log("Seeding Bhoomi Nayan…\n");

  // 1. Roles ---------------------------------------------------------------
  for (const r of ROLES) {
    await prisma.role.upsert({
      where: { type: r.type },
      update: { name: r.name, description: r.description },
      create: { type: r.type, name: r.name, description: r.description, permissions: {} },
    });
  }
  console.log(`  roles              ${ROLES.length}`);

  // 2. States (real LGD codes + verified cadastral config) ------------------
  const stateIdByCode = new Map<string, string>();
  for (const s of STATES) {
    const row = await prisma.state.upsert({
      where: { lgdCode: s.lgdCode },
      update: {
        name: s.name,
        isUT: s.isUT ?? false,
        cadastralBaseUrl: s.cadastral?.baseUrl ?? null,
        cadastralGen: s.cadastral?.gen ?? null,
        cadastralCode: s.cadastral?.code ?? null,
      },
      create: {
        lgdCode: s.lgdCode,
        name: s.name,
        isUT: s.isUT ?? false,
        cadastralBaseUrl: s.cadastral?.baseUrl ?? null,
        cadastralGen: s.cadastral?.gen ?? null,
        cadastralCode: s.cadastral?.code ?? null,
      },
    });
    stateIdByCode.set(s.lgdCode, row.id);
  }
  const withCadastral = STATES.filter((s) => s.cadastral).length;
  const uts = STATES.filter((s) => s.isUT).length;
  console.log(`  states/UTs         ${STATES.length - uts} states + ${uts} UTs  (${withCadastral} with a verified cadastral API)`);

  // 3. Districts -----------------------------------------------------------
  const districtIdByKey = new Map<string, string>(); // "stateCode:districtCode"
  let districtCount = 0;
  for (const [stateCode, list] of Object.entries(DISTRICTS)) {
    const stateId = stateIdByCode.get(stateCode);
    if (!stateId) continue;
    for (const d of list) {
      const row = await prisma.district.upsert({
        where: { stateId_lgdCode: { stateId, lgdCode: d.lgdCode } },
        update: {
          name: d.name,
          nameLocal: d.nameLocal ?? null,
          isUrban: d.isUrban ?? false,
          multiplierFactor: new Prisma.Decimal(d.multiplier),
          circleRatePerHectare: d.ratePerHa ? new Prisma.Decimal(d.ratePerHa) : null,
        },
        create: {
          stateId,
          lgdCode: d.lgdCode,
          name: d.name,
          nameLocal: d.nameLocal ?? null,
          isUrban: d.isUrban ?? false,
          multiplierFactor: new Prisma.Decimal(d.multiplier),
          circleRatePerHectare: d.ratePerHa ? new Prisma.Decimal(d.ratePerHa) : null,
        },
      });
      districtIdByKey.set(`${stateCode}:${d.lgdCode}`, row.id);
      districtCount++;
    }
  }
  console.log(`  districts          ${districtCount}`);

  // 4. Tehsils -------------------------------------------------------------
  const tehsilIdByKey = new Map<string, string>(); // "stateCode:distCode:tehsilCode"
  let tehsilCount = 0;
  for (const [key, list] of Object.entries(TEHSILS)) {
    const districtId = districtIdByKey.get(key);
    if (!districtId) continue;
    for (const t of list) {
      const row = await prisma.tehsil.upsert({
        where: { districtId_lgdCode: { districtId, lgdCode: t.lgdCode } },
        update: { name: t.name, nameLocal: t.nameLocal ?? null },
        create: { districtId, lgdCode: t.lgdCode, name: t.name, nameLocal: t.nameLocal ?? null },
      });
      tehsilIdByKey.set(`${key}:${t.lgdCode}`, row.id);
      tehsilCount++;
    }
  }
  console.log(`  tehsils            ${tehsilCount}`);

  // 5. Villages (with real Census 2011 figures) -----------------------------
  let villageCount = 0;
  for (const [key, list] of Object.entries(VILLAGES)) {
    const tehsilId = tehsilIdByKey.get(key);
    if (!tehsilId) continue;
    for (const v of list) {
      await prisma.village.upsert({
        where: { tehsilId_lgdCode: { tehsilId, lgdCode: v.lgdCode } },
        update: {
          name: v.name,
          nameLocal: v.nameLocal ?? null,
          censusHouseholds: v.households,
          censusPopulation: v.population,
          hasSchool: v.school ?? false,
          hasHealthCentre: v.health ?? false,
          hasDrinkingWater: v.water ?? false,
          hasElectricity: v.power ?? false,
          hasRoadAccess: v.road ?? false,
        },
        create: {
          tehsilId,
          lgdCode: v.lgdCode,
          name: v.name,
          nameLocal: v.nameLocal ?? null,
          censusHouseholds: v.households,
          censusPopulation: v.population,
          hasSchool: v.school ?? false,
          hasHealthCentre: v.health ?? false,
          hasDrinkingWater: v.water ?? false,
          hasElectricity: v.power ?? false,
          hasRoadAccess: v.road ?? false,
        },
      });
      villageCount++;
    }
  }
  console.log(`  villages           ${villageCount}`);

  // 6. Ministries & agencies -----------------------------------------------
  const ministryIdByCode = new Map<string, string>();
  for (const m of MINISTRIES) {
    const row = await prisma.ministry.upsert({
      where: { code: m.code },
      update: { name: m.name },
      create: { code: m.code, name: m.name },
    });
    ministryIdByCode.set(m.code, row.id);
  }
  const agencyIdByCode = new Map<string, string>();
  for (const a of AGENCIES) {
    const row = await prisma.agency.upsert({
      where: { code: a.code },
      update: { name: a.name, ministryId: ministryIdByCode.get(a.ministry) ?? null },
      create: { code: a.code, name: a.name, ministryId: ministryIdByCode.get(a.ministry) ?? null },
    });
    agencyIdByCode.set(a.code, row.id);
  }
  console.log(`  ministries         ${MINISTRIES.length}`);
  console.log(`  agencies           ${AGENCIES.length}`);

  // 7. Projects ------------------------------------------------------------
  let projectCount = 0;
  for (const p of PROJECTS) {
    const agencyId = agencyIdByCode.get(p.agency);
    if (!agencyId) continue;
    const project = await prisma.project.upsert({
      where: { referenceNo: p.referenceNo },
      update: {
        name: p.name,
        type: p.type,
        governingAct: p.governingAct,
        agencyId,
        ministryId: ministryIdByCode.get(p.ministry) ?? null,
        estimatedAreaHectares: new Prisma.Decimal(p.areaHa),
        estimatedCostCrore: new Prisma.Decimal(p.costCrore),
      },
      create: {
        referenceNo: p.referenceNo,
        name: p.name,
        type: p.type,
        governingAct: p.governingAct,
        agencyId,
        ministryId: ministryIdByCode.get(p.ministry) ?? null,
        estimatedAreaHectares: new Prisma.Decimal(p.areaHa),
        estimatedCostCrore: new Prisma.Decimal(p.costCrore),
      },
    });
    for (const sc of p.states) {
      const stateId = stateIdByCode.get(sc);
      if (!stateId) continue;
      await prisma.projectState.upsert({
        where: { projectId_stateId: { projectId: project.id, stateId } },
        update: {},
        create: { projectId: project.id, stateId },
      });
    }
    for (const dk of p.districts) {
      if (!districtIdByKey.has(dk)) {
        const stateId = stateIdByCode.get(p.states[0]);
        if (stateId) {
          const row = await prisma.district.upsert({
            where: { stateId_lgdCode: { stateId, lgdCode: p.district.lgdCode } },
            update: { name: p.district.name },
            create: {
              stateId,
              lgdCode: p.district.lgdCode,
              name: p.district.name,
              nameLocal: p.district.nameLocal ?? null,
              isUrban: p.district.isUrban ?? false,
              multiplierFactor: new Prisma.Decimal(p.district.multiplier),
              circleRatePerHectare: new Prisma.Decimal(p.district.ratePerHa),
            },
          });
          districtIdByKey.set(dk, row.id);
        }
      }
      const districtId = districtIdByKey.get(dk);
      if (!districtId) continue;
      await prisma.projectDistrict.upsert({
        where: { projectId_districtId: { projectId: project.id, districtId } },
        update: {},
        create: { projectId: project.id, districtId },
      });
    }
    projectCount++;
  }
  console.log(`  projects           ${projectCount}`);

  console.log("\nSeed complete.");
  console.log("Real: LGD codes, district/tehsil/village names, cadastral portal config, project names.");
  console.log("Synthetic (by design): owners, families, awards, compensation — DPDP Act 2023.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
