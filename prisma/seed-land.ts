/** Land for every project in the national registry. */
import { existsSync, readFileSync } from "node:fs";
import { Prisma, PrismaClient, type ParcelGeometryKind, type ParcelStatus, type ProposalStatus } from "@prisma/client";
import { createParcel } from "../backend/gis/parcels";
import { recomputeAllConflicts, setParcelGeometry, setParcelGeometryFromProjectedRing } from "../backend/gis/postgis";
import { writeVertices } from "../backend/gis/vertices";
import { definitionFor } from "../backend/workflow/engine";
import type { HarvestedPlot } from "../backend/integrations/adapters/cadastral-corridor";
import { NATIONAL_PROJECTS, fieldsSnapshotPath, type NationalProject } from "./data/national-projects";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Status: consistent with the case
// ---------------------------------------------------------------------------

/**
 * Parcel status given the stage its case has reached, and the parcel's position along the
 * alignment (0 = start).
 */
function parcelStatus(stage: ProposalStatus, f: number, i: number): ParcelStatus {
  switch (stage) {
    // "Under objection" is never seeded here: a plot is only under objection
    // when an objection is actually on file (seed-notifications.ts files them),
    // otherwise it shows a dispute nobody can hear or decide.
    case "SEC_11_PRELIM_NOTIFICATION":
    case "OBJECTIONS":
    case "SEC_19_DECLARATION":
    case "SEC_21_NOTICE":
    case "AWARD_ENQUIRY":
      return "NOTIFIED";
    case "AWARD_DECLARED":
      return i % 17 === 8 ? "DISPUTED" : "AWARD_DECLARED";
    case "COMPENSATION_DISBURSEMENT":
      return f < 0.5 ? "COMPENSATED" : "AWARD_DECLARED";
    case "RNR_IMPLEMENTATION":
      return f < 0.7 ? "COMPENSATED" : "AWARD_DECLARED";
    case "POSSESSION":
      return f < 0.45 ? "POSSESSED" : f < 0.85 ? "COMPENSATED" : "AWARD_DECLARED";
    case "CLOSED":
      return "POSSESSED";
    default:
      return "PROPOSED";
  }
}

// ---------------------------------------------------------------------------
// Synthetic owners, named for the region
// ---------------------------------------------------------------------------
const NAMES: Record<string, string[]> = {
  north: ["Ram Prakash Yadav", "Sunita Devi", "Mahesh Chand Sharma", "Kamla Devi", "Rajendra Singh", "Geeta Kumari", "Om Prakash Verma", "Shanti Devi", "Harish Chandra", "Phoolwati", "Suresh Kumar Meena", "Bhagwati Devi"],
  punjab: ["Gurpreet Singh Gill", "Harjinder Kaur", "Balwinder Singh Sandhu", "Manjit Kaur", "Sukhdev Singh", "Paramjit Kaur", "Jaswant Singh", "Kuldeep Kaur"],
  west: ["Prakash Naik", "Shalini Kamat", "Joaquim Fernandes", "Rukmini Shetye", "Sandeep Patil", "Vaishali Jadhav", "Ganesh Bhosale", "Meera Desai", "Kiran Patel", "Hansaben Chaudhary"],
  south: ["Venkatesh Reddy", "Lakshmi Devi", "Murugan Pillai", "Saraswathi Ammal", "Ramesh Gowda", "Shobha Nair", "Srinivas Rao", "Kamala Kumari", "Rajan Menon", "Parvathi Iyer"],
  east: ["Bikash Mahato", "Sabita Behera", "Nirmal Das", "Anjali Mondal", "Prasanta Sahoo", "Mamata Pradhan", "Dilip Debbarma", "Rina Kalita", "Tapan Ghosh", "Minati Nayak"],
  hills: ["Lalremruata", "Vanlalhmangaihi", "Thangjam Ibomcha", "Keneilhouno Angami", "Tashi Dorjee", "Pema Lhamu", "Rikam Tayeng", "Dilseng Sangma", "Stanzin Dorjay", "Mohammad Yousuf Bhat"],
};
const REGION: Record<string, keyof typeof NAMES> = {
  "09": "north", "08": "north", "06": "north", "02": "north", "05": "north", "07": "north", "04": "north", "23": "north", "10": "north", "20": "north",
  "03": "punjab",
  "30": "west", "27": "west", "24": "west", "26": "west",
  "28": "south", "29": "south", "32": "south", "33": "south", "34": "south", "36": "south", "31": "south", "35": "south",
  "19": "east", "21": "east", "22": "east", "18": "east", "16": "east",
  "11": "hills", "12": "hills", "13": "hills", "14": "hills", "15": "hills", "17": "hills", "01": "hills", "37": "hills",
};

/** A plausible account and IFSC, or none at all. Never a real account. */
function bankDetails(i: number, stateLgd: string): { bankAccountMasked: string | null; bankIfsc: string | null } {
  if ((i + Number(stateLgd)) % 7 === 3) return { bankAccountMasked: null, bankIfsc: null };
  const banks = ["SBIN", "PUNB", "BARB", "CNRB", "HDFC", "UBIN"];
  const bank = banks[(i + Number(stateLgd)) % banks.length];
  const branch = String(100000 + ((i * 7919 + Number(stateLgd) * 31) % 899999));
  return { bankAccountMasked: `XXXXXX${String(4000 + i * 37).slice(-4)}`, bankIfsc: `${bank}0${branch}` };
}

async function ownerPool(stateLgd: string): Promise<string[]> {
  const names = NAMES[REGION[stateLgd] ?? "north"];
  const ids: string[] = [];
  for (const [i, name] of names.entries()) {
    const fullName = `${name}`;
    const address = `State ${stateLgd}`;
    const found = await prisma.owner.findFirst({ where: { fullName, address, userId: null } });
    ids.push(
      found?.id ??
        (await prisma.owner.create({
          data: {
            fullName,
            address,
            aadhaarLast4: String(1000 + ((i * 7919 + Number(stateLgd) * 31) % 9000)),
            // Synthetic, and deliberately incomplete for roughly one owner in
            // seven: an owner with no bank account on record is the ordinary
            // case that LARR s.77 exists for, and the demo must show it.
            ...bankDetails(i, stateLgd),
          },
        })).id,
    );
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Jurisdiction rows for a snapshot's village
// ---------------------------------------------------------------------------
async function ensureVillage(districtId: string, tehsil: { code: string; name: string }, village: { code: string; name: string }, gisCode?: string) {
  const t = await prisma.tehsil.upsert({
    where: { districtId_lgdCode: { districtId, lgdCode: tehsil.code } },
    update: {},
    create: { districtId, lgdCode: tehsil.code, name: tehsil.name },
  });
  return prisma.village.upsert({
    where: { tehsilId_lgdCode: { tehsilId: t.id, lgdCode: village.code } },
    update: gisCode ? { cadastralGisCode: gisCode } : {},
    create: { tehsilId: t.id, lgdCode: village.code, name: village.name, cadastralGisCode: gisCode ?? null },
  });
}

const SHEET = /डिजिटाइज्ड|digiti[sz]ed|^sheet|^\d{1,3}$|VILLAGE$/i;
const strip = (s: string) => s.replace(/^\s*\d+\s+/, "").replace(/\(चालु\)/g, "").trim() || s;

interface CadastralSnap {
  corridorId: string;
  srid: number;
  gisCode: string;
  harvestedAt: string;
  centreline: [number, number][];
  rightOfWayM: number;
  adminPath?: { code: string; name: string }[];
  plots: HarvestedPlot[];
}

interface FieldSnap {
  tier: "OSM_FIELD" | "GENERATED";
  place: { lat: number; lng: number; village: string | null; subdistrict: string | null; district: string | null };
  centreline: [number, number][];
  rightOfWayM: number;
  harvestedAt: string;
  fields: { ring: [number, number][]; chainageM: number; osmWayId?: number; landuse?: string }[];
}

/** Villages the original corridors were seeded against, before snapshots recorded their path. */
const LEGACY_VILLAGES: Record<string, { tehsil: string; village: string }> = {
  "up-agra-akbarpur-ring-road": { tehsil: "Agra", village: "Akbarpur" },
  "up-agra-akbarpur-rail-bypass": { tehsil: "Agra", village: "Akbarpur" },
  "goa-aldona-nh66-bypass": { tehsil: "Bardez", village: "Aldona" },
};

// ---------------------------------------------------------------------------
// Elevation cache (filled by scripts/fill-elevations.ts)
// ---------------------------------------------------------------------------
const ELEVATION_CACHE = "prisma/data/elevation-cache.json";
const elevations: Record<string, number> = existsSync(ELEVATION_CACHE) ? JSON.parse(readFileSync(ELEVATION_CACHE, "utf8")) : {};
export const elevationKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

const elevationAt = (lat: number, lng: number) => {
  const e = elevations[elevationKey(lat, lng)];
  return e == null ? null : { metres: e, source: "Open-Meteo (Copernicus DEM GLO-90)" };
};

// ---------------------------------------------------------------------------
async function seedProject(p: NationalProject) {
  const project = await prisma.project.findUniqueOrThrow({ where: { referenceNo: p.ref } });
  const state = await prisma.state.findUniqueOrThrow({ where: { lgdCode: p.stateLgd } });
  const district = await prisma.district.findUniqueOrThrow({ where: { stateId_lgdCode: { stateId: state.id, lgdCode: p.district.lgdCode } } });

  // Cases, most advanced first, share the alignment in stretches.
  const chain = definitionFor(p.act).stages.map((s) => s.status);
  const proposals = (await prisma.proposal.findMany({ where: { projectId: project.id, status: { not: "DRAFT" } }, select: { id: true, status: true } }))
    .sort((a, b) => chain.indexOf(b.status) - chain.indexOf(a.status));

  await prisma.parcelVertex.deleteMany({ where: { parcel: { projectId: project.id } } });
  await prisma.landParcel.deleteMany({ where: { projectId: project.id } });
  const owners = await ownerPool(p.stateLgd);

  let villageId: string;
  let tier: ParcelGeometryKind;
  let rows: { key: string; khasraNo: string; chainageM: number; declaredHa: number | null; write: (id: string) => Promise<void>; extra: Prisma.LandParcelUpdateInput }[] = [];
  let alignment: { line: [number, number][]; srid: number; rightOfWayM: number };

  const cadastralFile = p.land.tier === "cadastral" ? `prisma/data/cadastral/${p.land.corridorId}.json` : null;
  if (p.land.tier === "cadastral" && cadastralFile && existsSync(cadastralFile)) {
    const file = cadastralFile;
    const snap = JSON.parse(readFileSync(file, "utf8")) as CadastralSnap;
    tier = "TRACED";
    if (snap.adminPath && snap.adminPath.length >= 3) {
      const path = snap.adminPath;
      const villageNode = SHEET.test(path[path.length - 1].name) ? path[path.length - 2] : path[path.length - 1];
      // Maharashtra's path opens with a Rural/Urban category before the district.
      const tehsilNode = /^(R|U)$/.test(path[0].code) ? path[2] : path[1];
      villageId = (await ensureVillage(district.id, { code: `BN-${tehsilNode.code}`, name: strip(tehsilNode.name) }, { code: `BN-${snap.gisCode}`, name: strip(villageNode.name) }, snap.gisCode)).id;
    } else {
      const legacy = LEGACY_VILLAGES[snap.corridorId];
      const v = await prisma.village.findFirstOrThrow({ where: { name: legacy.village, tehsil: { districtId: district.id } } });
      await prisma.village.update({ where: { id: v.id }, data: { cadastralGisCode: snap.gisCode } });
      villageId = v.id;
    }
    alignment = { line: snap.centreline, srid: snap.srid, rightOfWayM: snap.rightOfWayM };
    const seen = new Set<string>();
    rows = snap.plots
      .map((pl) => ({ pl, khasraNo: pl.khasraNo.startsWith("/") ? `unnumbered${pl.khasraNo}` : pl.khasraNo }))
      .filter(({ khasraNo }) => (seen.has(khasraNo) ? false : (seen.add(khasraNo), true)))
      .map(({ pl, khasraNo }) => {
        const hasRecord = pl.recordedAreaSqm != null && pl.recordedAreaSqm > 0;
        return {
          key: pl.plotId,
          khasraNo,
          chainageM: pl.chainageM,
          declaredHa: hasRecord ? pl.recordedAreaSqm! / 10_000 : null,
          write: async (id: string) => void (await setParcelGeometryFromProjectedRing(id, pl.ringUtm, snap.srid, "TRACED")),
          extra: {
            ulpin: pl.pniu ?? undefined,
            boundaryAccuracyM: new Prisma.Decimal(pl.extentErrorM),
            sourcePlotId: pl.plotId,
            sourceSyncedAt: new Date(snap.harvestedAt),
            dataSource: "LIVE",
          },
        };
      });
  } else {
    const file = fieldsSnapshotPath(p.ref);
    if (!existsSync(file)) return { ref: p.ref, skipped: "no snapshot yet (run scripts/harvest-national.ts)" };
    const snap = JSON.parse(readFileSync(file, "utf8")) as FieldSnap;
    tier = snap.tier;
    const placeQuery = p.land.tier === "fields" ? p.land.placeQuery : p.land.fallbackPlace;
    const villageName = snap.place.village ?? placeQuery.split(",")[0];
    const tehsilName = snap.place.subdistrict ?? district.name;
    villageId = (await ensureVillage(district.id, { code: `OSM-${tehsilName}`.slice(0, 60), name: tehsilName }, { code: `OSM-${villageName}`.slice(0, 60), name: villageName })).id;
    alignment = { line: snap.centreline, srid: 4326, rightOfWayM: snap.rightOfWayM };
    const prefix = snap.tier === "OSM_FIELD" ? "OSM" : "GEN";
    rows = snap.fields.map((f, i) => ({
      key: `${prefix}-${i}`,
      khasraNo: `${prefix}-${String(i + 1).padStart(2, "0")}`,
      chainageM: f.chainageM,
      declaredHa: null,
      write: async (id: string) => void (await setParcelGeometry(id, { type: "Polygon", coordinates: [f.ring] }, snap.tier)),
      extra: {
        sourcePlotId: f.osmWayId ? `osm:way/${f.osmWayId}` : null,
        sourceSyncedAt: new Date(snap.harvestedAt),
        dataSource: snap.tier === "OSM_FIELD" ? "LIVE" : "SIMULATED",
      },
    }));
  }

  // The project's alignment, drawn as its right-of-way on the map.
  const line = JSON.stringify({ type: "LineString", coordinates: alignment.line });
  await prisma.$executeRaw`
    UPDATE "Project"
       SET alignment = ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${line}), ${alignment.srid}::integer), 4326),
           "rightOfWayM" = ${alignment.rightOfWayM}
     WHERE id = ${project.id};
  `;

  rows.sort((a, b) => a.chainageM - b.chainageM);
  const maxChainage = Math.max(1, ...rows.map((r) => r.chainageM));
  let made = 0;
  for (const [i, r] of rows.entries()) {
    const f = r.chainageM / maxChainage;
    const segment = proposals.length ? Math.min(proposals.length - 1, Math.floor(f * proposals.length)) : -1;
    const proposal = segment >= 0 ? proposals[segment] : null;
    // A plot another project already records (the rail bypass crossing the ring road) keeps one ULPIN.
    const claimedElsewhere = await prisma.landParcel.findFirst({ where: { villageId, khasraNo: r.khasraNo, projectId: { not: project.id } }, select: { id: true } });

    const parcel = await createParcel({
      projectId: project.id,
      proposalId: proposal?.id ?? null,
      villageId,
      khasraNo: r.khasraNo,
      declaredAreaHectares: Math.max(r.declaredHa ?? 0.0001, 0.0001),
      landUse: tier === "TRACED" ? (r.declaredHa == null ? "BARREN" : r.declaredHa >= 0.5 ? "IRRIGATED" : r.declaredHa >= 0.15 ? "DRY" : "HOMESTEAD") : i % 4 === 0 ? "IRRIGATED" : "DRY",
      withoutUlpin: Boolean(claimedElsewhere) || tier !== "TRACED",
    });
    await r.write(parcel.id);
    const computed = await prisma.landParcel.findUniqueOrThrow({ where: { id: parcel.id }, select: { computedAreaHectares: true } });
    await prisma.landParcel.update({
      where: { id: parcel.id },
      data: {
        ...r.extra,
        ulpin: claimedElsewhere ? null : (r.extra.ulpin as string | undefined) ?? (tier === "TRACED" ? parcel.ulpin : null),
        status: proposal ? parcelStatus(proposal.status, (f * proposals.length) % 1, i) : "PROPOSED",
        chainageM: r.chainageM,
        areaFromRecord: r.declaredHa != null,
        // Without a revenue record the mapped area is the only area there is.
        declaredAreaHectares: r.declaredHa != null ? new Prisma.Decimal(r.declaredHa.toFixed(4)) : computed.computedAreaHectares ?? new Prisma.Decimal(0.0001),
      },
    });
    await writeVertices(parcel.id, elevationAt);

    // One owner, or joint holders on every fifth plot — Indian farmland is very often jointly held.
    const holders = i % 5 === 2 ? [owners[i % owners.length], owners[(i + 3) % owners.length]] : [owners[i % owners.length]];
    for (const ownerId of [...new Set(holders)]) {
      await prisma.parcelOwner.create({ data: { parcelId: parcel.id, ownerId, sharePct: new Prisma.Decimal(holders.length === 2 ? 50 : 100) } });
    }
    made++;
  }

  // The district's citizen account owns the first plot on the alignment.
  const citizens = await prisma.user.findMany({ where: { role: { type: "LANDOWNER" }, districtId: district.id, isActive: true }, include: { ownerProfile: true } });
  const first = await prisma.landParcel.findFirst({ where: { projectId: project.id, hasConflict: false }, orderBy: { chainageM: "asc" } });
  for (const c of citizens) {
    if (!c.ownerProfile || !first) continue;
    if (await prisma.parcelOwner.count({ where: { ownerId: c.ownerProfile.id } })) continue;
    await prisma.parcelOwner.deleteMany({ where: { parcelId: first.id } });
    await prisma.parcelOwner.create({ data: { parcelId: first.id, ownerId: c.ownerProfile.id, sharePct: new Prisma.Decimal(100) } });
  }
  return { ref: p.ref, made, tier };
}

async function main() {
  console.log("Seeding land for every project in the national registry…\n");
  const only = process.argv.slice(2);
  const summary = new Map<string, number>();
  for (const p of NATIONAL_PROJECTS) {
    if (only.length && !only.includes(p.ref)) continue;
    const r = await seedProject(p);
    if ("skipped" in r) {
      console.log(`  – ${p.ref.padEnd(22)} ${p.name.slice(0, 48).padEnd(48)} skipped: ${r.skipped}`);
      continue;
    }
    summary.set(r.tier, (summary.get(r.tier) ?? 0) + r.made);
    console.log(`  ✓ ${p.ref.padEnd(22)} ${p.name.slice(0, 48).padEnd(48)} ${String(r.made).padStart(3)} ${r.tier}`);
  }
  const flagged = await recomputeAllConflicts();
  console.log(`\n${[...summary].map(([k, v]) => `${v} ${k}`).join(" · ")} parcels · ${flagged} parcel records claimed by two projects`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
