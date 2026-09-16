/** REHABILITATION & RESETTLEMENT — LARR 2013 s.31 and the Second Schedule. */
import type { FamilyCategory } from "@prisma/client";

export interface EntitlementRule {
  type: string;
  label: string;
  /** Second Schedule item number, so an officer can check it against the Act. */
  scheduleItem: string;
  amount?: number;
  inKind?: string;
  /** Who gets it. */
  appliesTo: (f: FamilyContext) => boolean;
  /** `appliesTo` in words, for the screen. Keep the two in step. */
  who: string;
  note?: string;
}

export interface FamilyContext {
  category: FamilyCategory;
  isDisplaced: boolean;
  livelihoodDependent: boolean;
  /** Irrigation projects owe land-for-land, not just money. */
  isIrrigationProject: boolean;
  /** Cattle shed / small shop allowance depends on having had one. */
  hadCattleShedOrShop?: boolean;
  isArtisanOrTrader?: boolean;
}

const isScheduled = (c: FamilyCategory) => c === "SC" || c === "ST";

/** The Second Schedule, as rules. */
export const SECOND_SCHEDULE: EntitlementRule[] = [
  {
    type: "HOUSING_UNIT",
    label: "Constructed house, or cash in lieu",
    scheduleItem: "Item 1",
    amount: 500_000,
    inKind: "House as per Indira Awas Yojana specification",
    appliesTo: (f) => f.isDisplaced,
    who: "Displaced families",
    note: "Only for families losing their homestead and having to physically move.",
  },
  {
    type: "LAND_FOR_LAND",
    label: "Land for land in the command area",
    scheduleItem: "Item 2",
    inKind: "Minimum 1 acre in the command area (2.5 acres for SC/ST)",
    appliesTo: (f) => f.isIrrigationProject && f.category === "LANDOWNER",
    who: "Landowners, irrigation projects only",
    note: "Irrigation projects owe replacement land, because cash does not restore a farming livelihood.",
  },
  {
    type: "RESETTLEMENT_ALLOWANCE",
    label: "One-time resettlement allowance",
    scheduleItem: "Item 6",
    amount: 50_000,
    appliesTo: (f) => f.isDisplaced,
    who: "Displaced families",
  },
  {
    type: "TRANSPORTATION_ALLOWANCE",
    label: "Transportation cost for shifting",
    scheduleItem: "Item 5",
    amount: 50_000,
    appliesTo: (f) => f.isDisplaced,
    who: "Displaced families",
  },
  {
    type: "SUBSISTENCE_GRANT",
    label: "Subsistence grant, 12 months",
    scheduleItem: "Item 3",
    amount: 36_000,
    appliesTo: (f) => f.isDisplaced,
    who: "Displaced families",
    note: "₹3,000 per month for one year, to bridge the gap while livelihood is re-established.",
  },
  {
    type: "SC_ST_ADDITIONAL_SUBSISTENCE",
    label: "Additional SC/ST resettlement assistance",
    scheduleItem: "Item 3 proviso",
    amount: 50_000,
    appliesTo: (f) => f.isDisplaced && isScheduled(f.category),
    who: "Displaced SC/ST families",
    note: "ss.41–42 give scheduled families additional protection; they are disproportionately displaced and least able to recover.",
  },
  {
    type: "ANNUITY_OR_EMPLOYMENT",
    label: "Employment, or one-time payment, or annuity",
    scheduleItem: "Item 4",
    amount: 500_000,
    appliesTo: (f) => f.livelihoodDependent || f.category === "LANDOWNER",
    who: "Landowners and livelihood-dependent families",
    note: "The family chooses: a job, ₹5 lakh one-time, or ₹2,000/month indexed for 20 years.",
  },
  {
    type: "CATTLE_SHED_OR_SHOP",
    label: "Cattle shed or small shop allowance",
    scheduleItem: "Item 7",
    amount: 25_000,
    appliesTo: (f) => f.isDisplaced && Boolean(f.hadCattleShedOrShop),
    who: "Displaced families who had a cattle shed or shop",
  },
  {
    type: "ARTISAN_WORKSHOP",
    label: "Artisan / small trader one-time grant",
    scheduleItem: "Item 8",
    amount: 25_000,
    appliesTo: (f) => Boolean(f.isArtisanOrTrader) || f.category === "ARTISAN",
    who: "Artisans and small traders",
  },
  {
    type: "FISHING_RIGHTS",
    label: "Fishing rights in the reservoir",
    scheduleItem: "Item 9",
    inKind: "Fishing rights in the project reservoir",
    appliesTo: (f) => f.isIrrigationProject && f.isDisplaced,
    who: "Displaced families, irrigation projects only",
  },
  {
    type: "TRANSPORT_ALLOWANCE_CATTLE",
    label: "Cattle transport allowance",
    scheduleItem: "Item 5 proviso",
    amount: 25_000,
    appliesTo: (f) => f.isDisplaced && f.category !== "ARTISAN",
    who: "Displaced families, except artisans",
  },
];

export interface ComputedEntitlement {
  type: string;
  label: string;
  scheduleItem: string;
  amount: number | null;
  inKind: string | null;
  note?: string;
}

/** Everything this family is entitled to under the Second Schedule. */
export function computeEntitlements(ctx: FamilyContext): ComputedEntitlement[] {
  return SECOND_SCHEDULE.filter((r) => r.appliesTo(ctx)).map((r) => ({
    type: r.type,
    label: r.label,
    scheduleItem: r.scheduleItem,
    amount: r.amount ?? null,
    inKind: r.inKind ?? null,
    note: r.note,
  }));
}

export function entitlementTotal(items: ComputedEntitlement[]): number {
  return items.reduce((sum, i) => sum + (i.amount ?? 0), 0);
}

/** Third Schedule — amenities a resettlement site must provide. */
export const THIRD_SCHEDULE_AMENITIES = [
  { key: "hasRoad", label: "All-weather road access" },
  { key: "hasDrainage", label: "Drainage and sanitation" },
  { key: "hasDrinkingWater", label: "Safe drinking water" },
  { key: "hasElectricity", label: "Electricity supply" },
  { key: "hasSchool", label: "Primary school" },
  { key: "hasHealthCentre", label: "Health centre" },
  { key: "hasPanchayatBuilding", label: "Panchayat / community building" },
] as const;

export function amenityCompletion(site: Record<string, unknown>): {
  done: number;
  total: number;
  pct: number;
  missing: string[];
} {
  const missing = THIRD_SCHEDULE_AMENITIES.filter((a) => !site[a.key]).map((a) => a.label);
  const done = THIRD_SCHEDULE_AMENITIES.length - missing.length;
  return {
    done,
    total: THIRD_SCHEDULE_AMENITIES.length,
    pct: Math.round((done / THIRD_SCHEDULE_AMENITIES.length) * 100),
    missing,
  };
}

/** The per-family pipeline. The last stage is the one the Act intends and nobody measures. */
export const RNR_PIPELINE = [
  "IDENTIFIED",
  "ENTITLEMENT_DETERMINED",
  "AWARD_PASSED",
  "PAYMENT_MADE",
  "RESETTLED",
  "LIVELIHOOD_RESTORED",
] as const;

export const RNR_LABEL: Record<string, string> = {
  IDENTIFIED: "Identified",
  ENTITLEMENT_DETERMINED: "Entitlement determined",
  AWARD_PASSED: "R&R award passed",
  PAYMENT_MADE: "Payment made",
  RESETTLED: "Resettled",
  LIVELIHOOD_RESTORED: "Livelihood restored",
  DISPUTED: "Disputed",
};
