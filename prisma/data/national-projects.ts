/**
 * The national project registry — one place that says, for every State and UT, which project
 * needs land there, where, and where that land's boundaries come from.
 */
import type { AcquisitionAct, ProjectType, ProposalStatus } from "@prisma/client";

export interface DistrictDef {
  lgdCode: string;
  name: string;
  nameLocal?: string;
  multiplier: number;
  ratePerHa: number;
  isUrban?: boolean;
}

export type LandSource =
  | {
      tier: "cadastral";
      /** Snapshot file in prisma/data/cadastral/. */
      corridorId: string;
      /** Portal profile (prisma/data/portals/<lgd>.json) to harvest with. */
      portalLgd: string;
      /** Portal's own district code to search under (if not the profile's). */
      portalDistrictCode?: string;
      /** A known georeferenced village path, when one has been verified. */
      portalPath?: string[];
      /**
       * The alignment itself, in the portal's UTM CRS, when the default (a
       * straight line through the first plot found) would cross the village
       * settlement or a single vast government parcel instead of farm plots.
       */
      alignmentUtm?: [number, number][];
      rightOfWayM: number;
      maxPlots: number;
      /** If the portal yields no georeferenced plots here, use OSM fields / generated plots near this place. */
      fallbackPlace: string;
    }
  | {
      tier: "fields";
      /** A real place to geocode (Nominatim), near which the corridor runs. */
      placeQuery: string;
      rightOfWayM: number;
      maxPlots: number;
    };

export interface NationalProject {
  ref: string;
  name: string;
  type: ProjectType;
  act: AcquisitionAct;
  agency: string;
  ministry: string;
  stateLgd: string;
  district: DistrictDef;
  estAreaHa: number;
  estCostCrore: number;
  land: LandSource;
  /** The case that moves this land through the workflow. */
  proposal: { status: ProposalStatus; enteredDaysAgo: number; purpose: string; publicInterest: string };
  /** Kept from the original seed; everything else is a demonstration project. */
  original?: boolean;
}

const hw = (ref: string, name: string, stateLgd: string, district: DistrictDef, placeQuery: string, status: ProposalStatus, days: number, agency = "NHAI"): NationalProject => ({
  ref, name, type: "HIGHWAY", act: "NH_ACT_1956", agency, ministry: "MORTH", stateLgd, district,
  estAreaHa: 60 + (days % 90), estCostCrore: 220 + (days % 400),
  land: { tier: "fields", placeQuery, rightOfWayM: 60, maxPlots: 40 },
  proposal: {
    status, enteredDaysAgo: days,
    purpose: `Land for ${name}.`,
    publicInterest: "Improves connectivity and road safety on a corridor carrying heavy freight and passenger traffic.",
  },
});
const rail = (ref: string, name: string, stateLgd: string, district: DistrictDef, placeQuery: string, status: ProposalStatus, days: number): NationalProject => ({
  ref, name, type: "RAILWAY", act: "RAILWAYS_ACT_1989", agency: "RVNL", ministry: "MOR", stateLgd, district,
  estAreaHa: 40 + (days % 70), estCostCrore: 400 + (days % 900),
  land: { tier: "fields", placeQuery, rightOfWayM: 40, maxPlots: 40 },
  proposal: { status, enteredDaysAgo: days, purpose: `Land for ${name}.`, publicInterest: "Brings rail connectivity to a region currently served only by road." },
});
const irr = (ref: string, name: string, stateLgd: string, district: DistrictDef, placeQuery: string, status: ProposalStatus, days: number): NationalProject => ({
  ref, name, type: "IRRIGATION", act: "LARR_2013", agency: "CWC", ministry: "MOJS", stateLgd, district,
  estAreaHa: 80 + (days % 120), estCostCrore: 300 + (days % 600),
  land: { tier: "fields", placeQuery, rightOfWayM: 45, maxPlots: 40 },
  proposal: { status, enteredDaysAgo: days, purpose: `Land for ${name}.`, publicInterest: "Assured irrigation for villages that now depend on the monsoon." },
});
const solar = (ref: string, name: string, stateLgd: string, district: DistrictDef, placeQuery: string, status: ProposalStatus, days: number): NationalProject => ({
  ref, name, type: "RENEWABLE_ENERGY", act: "LARR_2013", agency: "SECI", ministry: "MNRE", stateLgd, district,
  estAreaHa: 30 + (days % 60), estCostCrore: 150 + (days % 300),
  land: { tier: "fields", placeQuery, rightOfWayM: 250, maxPlots: 35 },
  proposal: { status, enteredDaysAgo: days, purpose: `Land for ${name}.`, publicInterest: "Adds renewable generation capacity toward the national solar mission." },
});
const d = (lgdCode: string, name: string, multiplier: number, ratePerHa: number, nameLocal?: string): DistrictDef => ({ lgdCode, name, multiplier, ratePerHa, nameLocal });

export const NATIONAL_PROJECTS: NationalProject[] = [
  // --- The original six (land now in each project's own district) -----------
  {
    ref: "PRJ/MORTH/2026/0001", name: "Delhi–Mumbai Expressway, Package 14 (Rajasthan section)", type: "HIGHWAY", act: "NH_ACT_1956",
    agency: "NHAI", ministry: "MORTH", stateLgd: "08", district: d("03", "Jaipur", 1.0, 14_500_000, "जयपुर"),
    estAreaHa: 842.5, estCostCrore: 2950, original: true,
    land: { tier: "cadastral", corridorId: "rj-jaipur-bagru-kalan-expressway", portalLgd: "08", portalPath: ["09", "295", "1316", "05240", "19686", "001"], rightOfWayM: 70, maxPlots: 45, fallbackPlace: "Bagru, Jaipur, Rajasthan" },
    proposal: { status: "DISTRICT_SCRUTINY", enteredDaysAgo: 26, purpose: "Acquisition for the Delhi–Mumbai Expressway, package 14.", publicInterest: "The expressway reduces the Delhi–Mumbai freight corridor journey by an estimated nine hours and is a designated project of national importance." },
  },
  {
    ref: "PRJ/MOJS/2026/0002", name: "Kanhar Irrigation Project — canal network extension", type: "IRRIGATION", act: "LARR_2013",
    agency: "CWC", ministry: "MOJS", stateLgd: "09", district: d("180", "Bahraich", 1.8, 2_600_000, "बहराइच"),
    estAreaHa: 1265, estCostCrore: 2180, original: true,
    land: { tier: "cadastral", corridorId: "up-bahraich-kanhar-canal", portalLgd: "09", portalDistrictCode: "180", rightOfWayM: 45, maxPlots: 45, fallbackPlace: "Kaiserganj, Bahraich, Uttar Pradesh" },
    proposal: { status: "AWARD_DECLARED", enteredDaysAgo: 353, purpose: "Acquisition for the Kanhar irrigation canal network extension.", publicInterest: "The canal extension will bring assured irrigation to 41 villages currently dependent on monsoon rainfall, and is part of the state's command area development programme." },
  },
  {
    ref: "PRJ/MORTH/2026/0003", name: "Agra Ring Road, Phase III", type: "HIGHWAY", act: "NH_ACT_1956",
    agency: "NHAI", ministry: "MORTH", stateLgd: "09", district: d("146", "Agra", 1.4, 6_800_000, "आगरा"),
    estAreaHa: 318.75, estCostCrore: 1540, original: true,
    land: { tier: "cadastral", corridorId: "up-agra-akbarpur-ring-road", portalLgd: "09", rightOfWayM: 60, maxPlots: 70, fallbackPlace: "Akbarpur, Agra, Uttar Pradesh" },
    proposal: { status: "OBJECTIONS", enteredDaysAgo: 14, purpose: "Acquisition for the Agra Ring Road phase III alignment.", publicInterest: "The ring road diverts through-traffic from the city core, reducing congestion and journey times on the Agra–Gwalior corridor." },
  },
  {
    ref: "PRJ/MNRE/2026/0004", name: "Bhadla-adjacent Solar Park, Phase II", type: "RENEWABLE_ENERGY", act: "LARR_2013",
    agency: "SECI", ministry: "MNRE", stateLgd: "08", district: d("02", "Bikaner", 1.9, 1_800_000, "बीकानेर"),
    estAreaHa: 2100, estCostCrore: 3300, original: true,
    land: { tier: "cadastral", corridorId: "rj-bikaner-solar-park", portalLgd: "08", portalDistrictCode: "02", rightOfWayM: 300, maxPlots: 35, fallbackPlace: "Bajju, Bikaner, Rajasthan" },
    proposal: { status: "AWARD_DECLARED", enteredDaysAgo: 402, purpose: "Acquisition of barren revenue land for a solar park, phase II.", publicInterest: "The park adds 750 MW of renewable capacity against the state's solar mission target, on land classified as barren and non-irrigable." },
  },
  {
    ref: "PRJ/MORTH/2026/0005", name: "NH-66 Aldona bypass", type: "HIGHWAY", act: "NH_ACT_1956",
    agency: "NHAI", ministry: "MORTH", stateLgd: "30", district: d("01", "North Goa", 1.2, 18_000_000),
    estAreaHa: 3.5, estCostCrore: 180, original: true,
    land: { tier: "cadastral", corridorId: "goa-aldona-nh66-bypass", portalLgd: "30", rightOfWayM: 30, maxPlots: 50, fallbackPlace: "Aldona, Goa" },
    proposal: { status: "SEC_19_DECLARATION", enteredDaysAgo: 120, purpose: "Acquisition for the NH-66 Aldona bypass.", publicInterest: "Takes national highway traffic out of Aldona's village centre." },
  },
  {
    ref: "PRJ/MOR/2026/0006", name: "Agra outer rail bypass (alignment option B)", type: "RAILWAY", act: "RAILWAYS_ACT_1989",
    agency: "RVNL", ministry: "MOR", stateLgd: "09", district: d("146", "Agra", 1.4, 6_800_000, "आगरा"),
    estAreaHa: 42, estCostCrore: 610, original: true,
    land: { tier: "cadastral", corridorId: "up-agra-akbarpur-rail-bypass", portalLgd: "09", rightOfWayM: 30, maxPlots: 30, fallbackPlace: "Akbarpur, Agra, Uttar Pradesh" },
    proposal: { status: "DISTRICT_SCRUTINY", enteredDaysAgo: 9, purpose: "Land for a proposed rail bypass around Agra.", publicInterest: "Separates freight trains from Agra's passenger stations." },
  },

  // --- Real cadastral land in the other verified portal states ---------------
  {
    ref: "PRJ/MORTH/2026/0007", name: "NH-344 Ambala–Yamunanagar widening, Barara section", type: "HIGHWAY", act: "NH_ACT_1956",
    agency: "NHAI", ministry: "MORTH", stateLgd: "06", district: d("BN-Ambala", "Ambala", 1.3, 6_200_000, "अंबाला"),
    estAreaHa: 74, estCostCrore: 410,
    land: { tier: "cadastral", corridorId: "hr-ambala-barara-nh344", portalLgd: "06", rightOfWayM: 45, maxPlots: 40, fallbackPlace: "Barara, Ambala, Haryana" },
    proposal: { status: "SEC_11_PRELIM_NOTIFICATION", enteredDaysAgo: 48, purpose: "Land for widening NH-344 through Barara tehsil.", publicInterest: "Relieves a two-lane bottleneck on the Ambala–Yamunanagar freight route." },
  },
  {
    ref: "PRJ/MOR/2026/0008", name: "Una–Hamirpur new rail line, Una section", type: "RAILWAY", act: "RAILWAYS_ACT_1989",
    agency: "RVNL", ministry: "MOR", stateLgd: "02", district: d("04", "Una", 1.6, 3_100_000, "ऊना"),
    estAreaHa: 51, estCostCrore: 980,
    land: { tier: "cadastral", corridorId: "hp-una-rail-line", portalLgd: "02", rightOfWayM: 35, maxPlots: 40, fallbackPlace: "Amb, Una, Himachal Pradesh" },
    proposal: { status: "SIA_STUDY", enteredDaysAgo: 131, purpose: "Land for the Una–Hamirpur new broad-gauge line.", publicInterest: "First rail link for Hamirpur district." },
  },
  {
    ref: "PRJ/MORTH/2026/0009", name: "Jalandhar Ring Road, Package 2", type: "HIGHWAY", act: "NH_ACT_1956",
    agency: "NHAI", ministry: "MORTH", stateLgd: "03", district: d("01", "Jalandhar", 1.3, 7_400_000, "ਜਲੰਧਰ"),
    estAreaHa: 96, estCostCrore: 720,
    land: { tier: "cadastral", corridorId: "pb-jalandhar-ring-road", portalLgd: "03", rightOfWayM: 45, maxPlots: 45, fallbackPlace: "Kartarpur, Jalandhar, Punjab" },
    proposal: { status: "AWARD_ENQUIRY", enteredDaysAgo: 210, purpose: "Land for the Jalandhar ring road, package 2.", publicInterest: "Diverts NH-44 through-traffic around Jalandhar city." },
  },
  {
    ref: "PRJ/MOJS/2026/0010", name: "Kanker minor irrigation canal, Antagarh reach", type: "IRRIGATION", act: "LARR_2013",
    agency: "CWC", ministry: "MOJS", stateLgd: "22", district: d("60", "Kanker", 1.9, 1_500_000, "कांकेर"),
    estAreaHa: 64, estCostCrore: 190,
    land: { tier: "cadastral", corridorId: "cg-kanker-antagarh-canal", portalLgd: "22", portalPath: ["60", "05", "03", "159"], rightOfWayM: 35, maxPlots: 35, fallbackPlace: "Antagarh, Kanker, Chhattisgarh" },
    proposal: { status: "OBJECTIONS", enteredDaysAgo: 40, purpose: "Land for the Antagarh minor irrigation canal.", publicInterest: "Irrigation for tribal villages in a rain-fed block." },
  },
  {
    ref: "PRJ/MORTH/2026/0011", name: "NH-208 upgrade, Gandachhara section", type: "HIGHWAY", act: "NH_ACT_1956",
    agency: "NHIDCL", ministry: "MORTH", stateLgd: "16", district: d("BN-269", "Dhalai", 1.8, 1_200_000),
    estAreaHa: 38, estCostCrore: 260,
    land: { tier: "cadastral", corridorId: "tr-dhalai-gandachhara-nh208", portalLgd: "16", portalPath: ["269", "6686", "151114", "2473754", "272565", "06_02"], rightOfWayM: 30, maxPlots: 30, fallbackPlace: "Gandachhara, Dhalai, Tripura" },
    proposal: { status: "POSSESSION", enteredDaysAgo: 22, purpose: "Land for upgrading NH-208 near Gandachhara.", publicInterest: "All-weather access for a hill subdivision cut off in the monsoon." },
  },

  // --- Every other State and UT: OSM field boundaries (or generated) --------
  hw("PRJ/MORTH/2026/0012", "Jammu–Kathua expressway spur, Hiranagar", "01", d("BN-Kathua", "Kathua", 1.7, 2_900_000), "Hiranagar, Kathua, Jammu and Kashmir", "SEC_11_PRELIM_NOTIFICATION", 61),
  rail("PRJ/MOR/2026/0013", "Tricity metro depot and link, Maloya", "04", d("BN-Chandigarh", "Chandigarh", 1.0, 22_000_000), "Maloya, Chandigarh", "DISTRICT_SCRUTINY", 18),
  hw("PRJ/MORTH/2026/0014", "NH-74 Kashipur–Rudrapur widening, Kichha", "05", d("BN-UdhamSinghNagar", "Udham Singh Nagar", 1.4, 4_800_000), "Kichha, Udham Singh Nagar, Uttarakhand", "AWARD_ENQUIRY", 190),
  hw("PRJ/MORTH/2026/0015", "Urban Extension Road-II, Najafgarh link", "07", d("BN-SouthWestDelhi", "South West Delhi", 1.0, 45_000_000), "Najafgarh, South West Delhi, Delhi", "SEC_19_DECLARATION", 240),
  hw("PRJ/MORTH/2026/0016", "Bihar Sharif bypass, NH-20", "10", d("BN-Nalanda", "Nalanda", 1.7, 2_400_000), "Asthawan, Nalanda, Bihar", "OBJECTIONS", 33),
  rail("PRJ/MOR/2026/0017", "Sivok–Rangpo rail extension, Melli", "11", d("BN-Namchi", "Namchi", 1.9, 3_600_000), "Melli, Sikkim", "SIA_APPRAISAL", 70),
  hw("PRJ/MORTH/2026/0018", "Trans-Arunachal Highway, Pasighat section", "12", d("BN-EastSiang", "East Siang", 2.0, 900_000), "Mebo, East Siang, Arunachal Pradesh", "POSSESSION", 12, "NHIDCL"),
  rail("PRJ/MOR/2026/0019", "Dhansiri–Kohima new rail line, Chümoukedima section", "13", d("BN-Chumoukedima", "Chümoukedima", 1.8, 1_600_000), "Chümoukedima, Nagaland", "COMPENSATION_DISBURSEMENT", 95),
  rail("PRJ/MOR/2026/0020", "Jiribam–Imphal rail line, Moirang section", "14", d("BN-Bishnupur", "Bishnupur", 1.8, 1_500_000), "Moirang, Bishnupur, Manipur", "AWARD_DECLARED", 150),
  rail("PRJ/MOR/2026/0021", "Bairabi–Sairang rail line, Kawnpui section", "15", d("BN-Kolasib", "Kolasib", 1.9, 1_100_000), "Kawnpui, Kolasib, Mizoram", "RNR_IMPLEMENTATION", 60),
  hw("PRJ/MORTH/2026/0022", "Tura–Dalu road upgrade (NH-51)", "17", d("BN-WestGaroHills", "West Garo Hills", 1.9, 1_000_000), "Rongram, West Garo Hills, Meghalaya", "SEC_11_PRELIM_NOTIFICATION", 110, "NHIDCL"),
  {
    ...hw("PRJ/MORTH/2026/0023", "Nagaon bypass, NH-27", "18", d("BN-Nagaon", "Nagaon", 1.6, 2_700_000), "Raha, Nagaon, Assam", "AWARD_DECLARED", 330),
    // Assam Bhu-Naksha: Nagaon (33) › Raha circle (330103) › Buraraja Gaon — east–west through its farm dags.
    land: { tier: "cadastral", corridorId: "as-nagaon-raha-nh27", portalLgd: "18", portalPath: ["33", "330103", "330103010210003"], alignmentUtm: [[443550, 2892250], [444400, 2892250], [445250, 2892250]], rightOfWayM: 60, maxPlots: 40, fallbackPlace: "Raha, Nagaon, Assam" },
  },
  irr("PRJ/MOJS/2026/0024", "Damodar left bank canal modernisation, Memari", "19", d("BN-PurbaBardhaman", "Purba Bardhaman", 1.5, 4_100_000), "Memari, Purba Bardhaman, West Bengal", "SIA_STUDY", 150),
  hw("PRJ/MORTH/2026/0025", "Hazaribagh–Barhi NH-33 widening", "20", d("BN-Hazaribagh", "Hazaribagh", 1.8, 1_900_000), "Barhi, Hazaribagh, Jharkhand", "SEC_19_DECLARATION", 300),
  irr("PRJ/MOJS/2026/0026", "Upper Indravati irrigation extension, Dharmagarh", "21", d("6", "Kalahandi", 1.9, 1_400_000, "କଳାହାଣ୍ଡି"), "Dharmagarh, Kalahandi, Odisha", "AWARD_ENQUIRY", 280),
  irr("PRJ/MOJS/2026/0027", "Kolar left bank canal, Ichhawar", "23", d("BN-Sehore", "Sehore", 1.7, 2_200_000), "Ichhawar, Sehore, Madhya Pradesh", "OBJECTIONS", 55),
  {
    ...hw("PRJ/DPIIT/2026/0028", "Delhi–Mumbai Industrial Corridor node, Borsad", "24", d("BN-Anand", "Anand", 1.4, 5_600_000), "Borsad, Anand, Gujarat", "STATE_APPROVAL", 44),
    type: "INDUSTRIAL_CORRIDOR", act: "LARR_2013", agency: "NICDC", ministry: "DPIIT",
    land: { tier: "fields", placeQuery: "Borsad, Anand, Gujarat", rightOfWayM: 200, maxPlots: 40 },
  },
  hw("PRJ/MORTH/2026/0029", "Silvassa–Naroli road widening", "26", d("BN-DadraNagarHaveli", "Dadra and Nagar Haveli", 1.3, 7_000_000), "Naroli, Dadra and Nagar Haveli", "COMPENSATION_DISBURSEMENT", 80),
  {
    ...hw("PRJ/MORTH/2026/0030", "Pune Ring Road, eastern alignment (Supe)", "27", d("BN-Pune", "Pune", 1.4, 9_000_000), "Supe, Baramati, Pune, Maharashtra", "SEC_19_DECLARATION", 355),
    // Maharashtra Bhu-Naksha: Rural › पुणे (25) › बारामती (13) › सुपा
    land: { tier: "cadastral", corridorId: "mh-pune-supe-ring-road", portalLgd: "27", portalPath: ["R", "25", "13", "272500130317110000"],
      // North–south through the village's farm plots (the west half is the settlement and one vast parcel).
      alignmentUtm: [[435018, 2029300], [435018, 2028100], [435018, 2026950]], rightOfWayM: 60, maxPlots: 40, fallbackPlace: "Supe, Baramati, Pune, Maharashtra" },
  },
  hw("PRJ/MORTH/2026/0031", "Amaravati–Anantapur expressway, Tadikonda section", "28", d("BN-Guntur", "Guntur", 1.5, 6_500_000), "Tadikonda, Guntur, Andhra Pradesh", "OBJECTIONS", 20),
  hw("PRJ/MORTH/2026/0032", "Bengaluru–Mysuru expressway service roads, Maddur", "29", d("BN-Mandya", "Mandya", 1.5, 5_200_000), "Maddur, Mandya, Karnataka", "POSSESSION", 35),
  solar("PRJ/MNRE/2026/0033", "Kavaratti island solar plant", "31", d("BN-Lakshadweep", "Lakshadweep", 1.2, 8_000_000), "Kavaratti, Lakshadweep", "SIA_STUDY", 90),
  hw("PRJ/MORTH/2026/0034", "Palakkad–Kozhikode greenfield highway, Mannarkkad", "32", d("BN-Palakkad", "Palakkad", 1.6, 8_800_000), "Mannarkkad, Palakkad, Kerala", "SEC_11_PRELIM_NOTIFICATION", 150),
  irr("PRJ/MOJS/2026/0035", "Grand Anicut canal rehabilitation, Orathanadu", "33", d("BN-Thanjavur", "Thanjavur", 1.6, 4_300_000), "Orathanadu, Thanjavur, Tamil Nadu", "AWARD_DECLARED", 340),
  hw("PRJ/MORTH/2026/0036", "Villupuram–Puducherry NH-332A widening, Villianur", "34", d("BN-Puducherry", "Puducherry", 1.2, 12_000_000), "Villianur, Puducherry", "COMPENSATION_DISBURSEMENT", 65),
  hw("PRJ/MORTH/2026/0037", "Andaman Trunk Road upgrade, Ferrargunj", "35", d("BN-SouthAndaman", "South Andaman", 1.6, 3_000_000), "Ferrargunj, South Andaman", "DISTRICT_SCRUTINY", 40, "NHIDCL"),
  irr("PRJ/MOJS/2026/0038", "Kaleshwaram lift irrigation distributary, Gajwel", "36", d("BN-Siddipet", "Siddipet", 1.6, 3_900_000), "Gajwel, Siddipet, Telangana", "RNR_IMPLEMENTATION", 120),
  solar("PRJ/MNRE/2026/0039", "Leh solar park, Phyang", "37", d("BN-Leh", "Leh", 2.0, 1_000_000), "Phyang, Leh, Ladakh", "SEC_11_PRELIM_NOTIFICATION", 75),
];

export const CORRIDOR_PROJECTS = NATIONAL_PROJECTS.filter((p) => p.land.tier === "cadastral");
export const FIELD_PROJECTS = NATIONAL_PROJECTS.filter((p) => p.land.tier === "fields");

/** Where a project's fields snapshot lives (one per project). */
export function fieldsSnapshotPath(ref: string): string {
  return `prisma/data/fields/${ref.replace(/[^A-Za-z0-9]+/g, "-")}.json`;
}
