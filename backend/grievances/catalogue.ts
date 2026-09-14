/** What a citizen can raise, and where each one legally goes. */
import type { AcquisitionAct, GrievanceCategory, RoleType } from "@prisma/client";

/** Who has to answer, resolved against the case's governing Act at filing time. */
export type AuthorityKind =
  /** Whoever hears objections under this Act: the Collector, or the CALA. */
  | "ACT_AUTHORITY"
  /** Always the Collector — awards, payment and possession are theirs. */
  | "COLLECTOR"
  /** R&R entitlements under the Second and Third Schedules. */
  | "RNR_AUTHORITY";

export interface GrievanceField {
  key: string;
  label: string;
  hint?: string;
  kind: "text" | "textarea" | "number" | "money" | "date" | "select";
  required?: boolean;
  options?: string[];
  /** Characters for text, or the largest sane value for a number. */
  max?: number;
}

export interface GrievanceRoute {
  /** The statutory citation, in the words the citizen and the officer both see. */
  section: string;
  authority: AuthorityKind;
  authorityLabel: string;
  /** Said to the citizen before they submit, so nobody is surprised. */
  note: string;
}

export interface GrievanceCategoryDef {
  key: GrievanceCategory;
  /** Lucide icon name, rendered by the picker. */
  icon: string;
  /** English; other languages come from the dictionary (see localise.ts). */
  title: { en: string };
  /** One line: is this my problem? */
  blurb: { en: string };
  /** True where this is an objection to the acquisition itself. */
  statutoryObjection?: boolean;
  route: (act: AcquisitionAct) => GrievanceRoute;
  fields: GrievanceField[];
}

const isLarr = (act: AcquisitionAct) => act === "LARR_2013" || act === "STATE_ACT";

/** Objections are heard by the Collector under LARR, by the CALA under the NH Act. */
function actAuthorityLabel(act: AcquisitionAct): string {
  return isLarr(act) ? "the Collector" : "the competent authority (CALA)";
}

export const CATEGORIES: GrievanceCategoryDef[] = [
  {
    key: "COMPENSATION_AMOUNT",
    icon: "IndianRupee",
    title: { en: "The compensation amount is too low or wrongly worked out" },
    blurb: {
      en: "The award figure, the rate used, the multiplier, solatium, or the value put on your house, well, trees or crop.",
    },
    route: (act) =>
      isLarr(act)
        ? {
            section: "s.64 of the LARR Act 2013 — reference to the LARR Authority",
            authority: "COLLECTOR",
            authorityLabel: "the Collector, for reference to the LARR Authority",
            note:
              "The Collector must refer a compensation dispute to the LARR Authority; they cannot simply refuse it. Apply within six weeks of the award if you were present when it was made, otherwise within six months of the notice.",
          }
        : {
            section: "s.3G(5) of the National Highways Act 1956 — determination by an arbitrator",
            authority: "ACT_AUTHORITY",
            authorityLabel: "the competent authority (CALA)",
            note:
              "Where the amount is disputed under the NH Act, it is determined by an arbitrator appointed by the Central Government. The competent authority records your application and moves it on.",
          },
    fields: [
      { key: "awardRef", label: "Award reference number, if you have it", kind: "text", max: 60 },
      { key: "amountAwarded", label: "Amount stated in the award (₹)", kind: "money", required: true },
      { key: "amountClaimed", label: "Amount you say is due (₹)", kind: "money", required: true },
      {
        key: "basis",
        label: "What is wrong with the calculation",
        kind: "select",
        required: true,
        options: [
          "The market value used is below what land nearby actually sells for",
          "The circle rate or the First Schedule multiplier was applied wrongly",
          "Solatium (100%) was not added, or was added to the wrong base",
          "My house, well, trees, crop or other assets were undervalued or left out",
          "Interest under s.30(3) has not been added",
          "Something else about the calculation",
        ],
      },
      {
        key: "evidence",
        label: "What you can produce in support",
        hint: "Sale deeds of nearby land, a valuer's report, photographs, receipts — list what you have.",
        kind: "textarea",
        max: 1500,
      },
      { key: "explanation", label: "Explain in your own words", kind: "textarea", required: true, max: 3000 },
    ],
  },
  {
    key: "AREA_MEASUREMENT",
    icon: "Ruler",
    title: { en: "The area of my land is recorded wrongly" },
    blurb: {
      en: "The hectares in the notification or the award do not match your patta, jamabandi or what was measured on the ground.",
    },
    route: (act) => ({
      section: isLarr(act)
        ? "LARR Act 2013 s.15 — objection to the extent of land, and correction of the record"
        : "National Highways Act 1956 s.3C — objection to the extent of land",
      authority: "ACT_AUTHORITY",
      authorityLabel: actAuthorityLabel(act),
      note:
        "Area decides the money, because compensation is paid per hectare. This is checked against the revenue record and the measured boundary before the award is finalised.",
    }),
    statutoryObjection: true,
    fields: [
      { key: "areaOnRecord", label: "Area shown in the record (hectares)", kind: "number", required: true, max: 10000 },
      { key: "areaClaimed", label: "Area you say is correct (hectares)", kind: "number", required: true, max: 10000 },
      {
        key: "source",
        label: "Where your figure comes from",
        kind: "select",
        required: true,
        options: [
          "Jamabandi / record of rights",
          "Patta or title deed",
          "Measurement by a revenue officer",
          "A private survey I had done",
          "Measured on the ground in my presence",
          "Other",
        ],
      },
      { key: "measuredOn", label: "Date it was measured, if it was", kind: "date" },
      { key: "explanation", label: "Explain in your own words", kind: "textarea", required: true, max: 3000 },
    ],
  },
  {
    key: "MAP_BOUNDARY",
    icon: "MapPinned",
    title: { en: "The map or boundary of my plot is wrong" },
    blurb: {
      en: "The outline on the map covers land that is not yours, misses land that is, or sits in the wrong place altogether.",
    },
    route: (act) => ({
      section: "Correction of the cadastral record — no statutory time limit",
      authority: "ACT_AUTHORITY",
      authorityLabel: actAuthorityLabel(act),
      note:
        "This is a record correction, not an objection, so there is no deadline on it. The mapped boundary is checked against the state cadastral portal and, where needed, a field survey.",
    }),
    fields: [
      {
        key: "whatIsWrong",
        label: "What is wrong with it",
        kind: "select",
        required: true,
        options: [
          "The plot is shown in the wrong place entirely",
          "The northern boundary is wrong",
          "The southern boundary is wrong",
          "The eastern boundary is wrong",
          "The western boundary is wrong",
          "The outline covers land belonging to someone else",
          "Part of my land is missing from the outline",
          "My plot has been merged with, or split from, another",
        ],
      },
      {
        key: "neighbours",
        label: "Khasra numbers of the neighbouring plots",
        hint: "This is how the office finds the error quickly.",
        kind: "text",
        max: 200,
      },
      { key: "landmark", label: "A landmark on or beside your land", hint: "A well, a road, a canal, a tree line.", kind: "text", max: 200 },
      { key: "explanation", label: "Describe what the boundary should be", kind: "textarea", required: true, max: 3000 },
    ],
  },
  {
    key: "ACQUISITION_ITSELF",
    icon: "Scale",
    title: { en: "My land should not be acquired at all" },
    blurb: {
      en: "The stated public purpose does not need this land, a less damaging alternative exists, or the law protects this land.",
    },
    statutoryObjection: true,
    route: (act) => ({
      section: isLarr(act)
        ? "LARR Act 2013 s.15 — objection to the acquisition"
        : "National Highways Act 1956 s.3C — objection to the acquisition",
      authority: "ACT_AUTHORITY",
      authorityLabel: actAuthorityLabel(act),
      note: isLarr(act)
        ? "You must be given a hearing before this is decided, and the decision must carry written reasons. Objections close 60 days after the preliminary notification."
        : "You must be given a hearing before this is decided, and the decision must carry written reasons. Objections close 21 days after the s.3A notification.",
    }),
    fields: [
      {
        key: "ground",
        label: "Your ground",
        kind: "select",
        required: true,
        options: [
          "The land is not needed for the stated public purpose",
          "A less damaging alignment or site exists",
          "This is my only holding and I will be left landless",
          "It is multi-cropped irrigated land, which s.10 protects",
          "More land is being taken than the purpose requires",
          "The purpose stated is not the purpose it will actually be used for",
          "Other",
        ],
      },
      {
        key: "alternative",
        label: "The alternative you propose, if you have one",
        hint: "An objection that names a workable alternative is far harder to dismiss.",
        kind: "textarea",
        max: 2000,
      },
      { key: "hardship", label: "What losing this land would mean for your household", kind: "textarea", max: 2000 },
      { key: "explanation", label: "Explain in your own words", kind: "textarea", required: true, max: 3000 },
    ],
  },
  {
    key: "ASSETS_NOT_RECORDED",
    icon: "Trees",
    title: { en: "Things standing on my land have not been counted" },
    blurb: {
      en: "A house, shed, well, borewell, pump, standing crop, orchard or trees left out of the valuation.",
    },
    route: (act) => ({
      section: isLarr(act)
        ? "LARR Act 2013 s.29 — value of the assets attached to the land, read with the s.21 claim"
        : "National Highways Act 1956 s.3G, read with LARR ss.26–30 for the valuation principles",
      authority: "ACT_AUTHORITY",
      authorityLabel: actAuthorityLabel(act),
      note:
        "The value of everything attached to the land is part of the compensation, not a favour. List each item — the officer has to account for each one.",
    }),
    fields: [
      {
        key: "assets",
        label: "What has been left out",
        hint: "One per line, with how many and roughly how old. e.g. '12 mango trees, about 20 years old'.",
        kind: "textarea",
        required: true,
        max: 2000,
      },
      { key: "estimatedValue", label: "What you believe they are worth (₹)", kind: "money" },
      { key: "explanation", label: "Anything else the officer should know", kind: "textarea", max: 2000 },
    ],
  },
  {
    key: "INTERESTED_PERSON",
    icon: "Users",
    title: { en: "The owner, tenant or sharecropper details are wrong" },
    blurb: {
      en: "A co-owner, tenant, sharecropper, labourer or mortgagee has been left out, or the name on the record is wrong.",
    },
    route: () => ({
      section: "LARR Act 2013 s.21 read with s.3(x) — every person interested must be named and given notice",
      authority: "COLLECTOR",
      authorityLabel: "the Collector",
      note:
        "A person left off the record gets no notice, no hearing and no money. This is one of the most common and most damaging errors in an acquisition, and it is corrected by the Collector.",
    }),
    fields: [
      { key: "personName", label: "Name of the person left out, or the correct name", kind: "text", required: true, max: 200 },
      {
        key: "relationship",
        label: "How they are connected to the land",
        kind: "select",
        required: true,
        options: [
          "Co-owner",
          "Tenant",
          "Sharecropper",
          "Agricultural labourer dependent on this land",
          "Mortgagee",
          "Heir or successor",
          "Other",
        ],
      },
      { key: "recordSays", label: "What the record says now", kind: "text", max: 400 },
      { key: "explanation", label: "What is correct, and how it can be proved", kind: "textarea", required: true, max: 3000 },
    ],
  },
  {
    key: "PAYMENT_NOT_RECEIVED",
    icon: "Banknote",
    title: { en: "Compensation has not reached me, or came late" },
    blurb: {
      en: "The award was made but the money has not arrived, only part arrived, or it went to the wrong account.",
    },
    route: () => ({
      section: "LARR Act 2013 ss.69, 77 and 80 — payment, deposit with the LARR Authority, and interest",
      authority: "COLLECTOR",
      authorityLabel: "the Collector",
      note:
        "Where compensation cannot be paid to you it must be deposited with the LARR Authority with written reasons, not simply held. Delay carries interest.",
    }),
    fields: [
      { key: "awardRef", label: "Award reference number, if you have it", kind: "text", max: 60 },
      { key: "amountAwarded", label: "Amount awarded to you (₹)", kind: "money", required: true },
      { key: "amountReceived", label: "Amount actually received (₹)", kind: "money", required: true },
      { key: "receivedOn", label: "Date the last payment arrived, if any", kind: "date" },
      {
        key: "accountIssue",
        label: "What you think went wrong",
        kind: "select",
        options: [
          "Nothing has arrived at all",
          "Only part of it arrived",
          "It went to the wrong bank account",
          "My bank details on the record are wrong",
          "I was told it was deposited somewhere, but not where",
          "I do not know",
        ],
      },
      { key: "explanation", label: "Explain in your own words", kind: "textarea", required: true, max: 3000 },
    ],
  },
  {
    key: "RNR_ENTITLEMENT",
    icon: "Home",
    title: { en: "My rehabilitation and resettlement entitlement is wrong or missing" },
    blurb: {
      en: "A house site, annuity, transport allowance, subsistence allowance, job or other Second Schedule entitlement.",
    },
    route: () => ({
      section: "LARR Act 2013 s.31 and the Second & Third Schedules — the R&R entitlement package",
      authority: "RNR_AUTHORITY",
      authorityLabel: "the Rehabilitation and Resettlement Authority",
      note:
        "R&R is a separate award from the land compensation, and it is decided by the R&R authority rather than by the land acquisition office.",
    }),
    fields: [
      {
        key: "missing",
        label: "What is wrong or missing",
        kind: "select",
        required: true,
        options: [
          "My family is not listed as an affected family at all",
          "House site or constructed house",
          "One-time resettlement allowance",
          "Annuity or one-time payment in lieu of a job",
          "Transport allowance / shifting allowance",
          "Subsistence allowance for the transition",
          "Employment or skill training for a family member",
          "Cattle shed or small-shop allowance",
          "Other",
        ],
      },
      {
        key: "familyCategory",
        label: "Your family's category",
        kind: "select",
        options: [
          "Landowner",
          "Tenant",
          "Sharecropper",
          "Agricultural labourer",
          "Artisan",
          "Forest dweller",
          "Scheduled Caste",
          "Scheduled Tribe",
          "Other",
        ],
      },
      { key: "familySize", label: "Number of people in your family", kind: "number", max: 50 },
      { key: "displaced", label: "Are you being displaced from your home?", kind: "select", options: ["Yes", "No"] },
      { key: "explanation", label: "Explain in your own words", kind: "textarea", required: true, max: 3000 },
    ],
  },
  {
    key: "POSSESSION_BEFORE_PAYMENT",
    icon: "ShieldAlert",
    title: { en: "Possession was taken before I was paid" },
    blurb: {
      en: "The land was fenced, levelled, dug or occupied before the compensation was paid to you.",
    },
    route: () => ({
      section: "LARR Act 2013 s.38 — possession only after full payment of compensation",
      authority: "COLLECTOR",
      authorityLabel: "the Collector",
      note:
        "Taking possession before compensation has been paid is unlawful under s.38. This is recorded as urgent and the Collector is alerted immediately.",
    }),
    fields: [
      { key: "takenOn", label: "Date possession was taken", kind: "date", required: true },
      { key: "takenBy", label: "Who took it", hint: "The department, contractor or agency, if you know.", kind: "text", max: 200 },
      { key: "amountPaidBefore", label: "Amount paid to you before that date (₹)", kind: "money", required: true },
      {
        key: "whatHappened",
        label: "What was done to the land",
        kind: "select",
        options: [
          "It was fenced or barricaded",
          "It was levelled or dug up",
          "Construction has started",
          "Standing crop was destroyed",
          "A structure was demolished",
          "Other",
        ],
      },
      { key: "explanation", label: "Explain in your own words", kind: "textarea", required: true, max: 3000 },
    ],
  },
  {
    key: "OTHER",
    icon: "MessageSquareWarning",
    title: { en: "Something else" },
    blurb: {
      en: "Anything about your acquisition that none of the above covers.",
    },
    route: (act) => ({
      section: "Recorded as a representation on the case record",
      authority: "ACT_AUTHORITY",
      authorityLabel: actAuthorityLabel(act),
      note:
        "It is placed on the case record and routed to the office handling your acquisition, who must respond to it.",
    }),
    fields: [
      { key: "subject", label: "In one line, what is this about", kind: "text", required: true, max: 200 },
      { key: "explanation", label: "Explain in your own words", kind: "textarea", required: true, max: 4000 },
    ],
  },
];

export function categoryFor(key: GrievanceCategory): GrievanceCategoryDef {
  const def = CATEGORIES.find((c) => c.key === key);
  if (!def) throw new Error(`Unknown grievance category: ${key}`);
  return def;
}

/** The role that must answer, once the case's governing Act is known. */
export const AUTHORITY_ROLE: Record<AuthorityKind, (act: AcquisitionAct) => RoleType> = {
  ACT_AUTHORITY: (act) => (isLarr(act) ? "DISTRICT_COLLECTOR" : "LAND_ACQUIRING_AUTHORITY"),
  COLLECTOR: () => "DISTRICT_COLLECTOR",
  RNR_AUTHORITY: () => "REHABILITATION_AUTHORITY",
};

/** Short label per category, for lists and tables. */
export const CATEGORY_LABEL: Record<GrievanceCategory, string> = {
  COMPENSATION_AMOUNT: "Compensation amount",
  AREA_MEASUREMENT: "Area / measurement",
  MAP_BOUNDARY: "Map / boundary",
  ACQUISITION_ITSELF: "Objection to the acquisition",
  ASSETS_NOT_RECORDED: "Assets not recorded",
  INTERESTED_PERSON: "Owner / tenant details",
  PAYMENT_NOT_RECEIVED: "Payment not received",
  RNR_ENTITLEMENT: "R&R entitlement",
  POSSESSION_BEFORE_PAYMENT: "Possession before payment",
  OTHER: "Other",
};

export const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  ACKNOWLEDGED: "Acknowledged",
  UNDER_EXAMINATION: "Under examination",
  REFERRED: "Referred onward",
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

/** The ones that need answering now, for the officer's inbox count. */
export const OPEN_GRIEVANCE = {
  decidedAt: null,
  status: { notIn: ["WITHDRAWN", "RESOLVED", "REJECTED"] as const },
};
