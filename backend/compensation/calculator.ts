/** THE COMPENSATION CALCULATOR — LARR 2013, ss.26–30. */
import { Prisma } from "@prisma/client";

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

/** s.26 — the three ways market value may be established. */
export type MarketValueBasis =
  | "CIRCLE_RATE"
  | "SALE_DEEDS_TOP_50PCT"
  | "CONSENTED_AMOUNT";

export interface AssetValues {
  /** s.29 — trees, standing crops, wells, structures attached to the land. */
  trees?: number;
  structures?: number;
  wells?: number;
  standingCrop?: number;
}

export interface CompensationInput {
  areaHectares: number;
  /** Candidate market values per hectare. The Act takes the HIGHEST. */
  circleRatePerHectare: number;
  saleDeedAveragePerHectare?: number;
  consentedAmountPerHectare?: number;
  /** First Schedule: 1.00–2.00 rural by distance from an urban centre, 1.00 urban. */
  multiplierFactor: number;
  assets?: AssetValues;
  /**
   * s.30(3) — 12% p.a. on the market value, from publication of the s.4(2) SIA
   * notification until the award or the taking of possession, whichever is
   * earlier.
   */
  siaNotificationDate?: Date | null;
  awardDate?: Date | null;
  possessionDate?: Date | null;
  /** Share of this parcel held by this owner, as a percentage. */
  ownerSharePct?: number;
}

export interface CompensationLine {
  key: string;
  label: string;
  /** The statutory hook, shown next to the number. */
  section?: string;
  amount: Dec;
  /** How this line was arrived at, in words a landowner can check. */
  workings?: string;
  /** The figures in the label and workings, so a screen can word the line in the reader's language. */
  vars?: Record<string, string | number>;
}

export interface CompensationBreakdown {
  lines: CompensationLine[];
  marketValuePerHectare: Dec;
  marketValueBasis: MarketValueBasis;
  landValue: Dec;
  assetsSubtotal: Dec;
  subTotal: Dec;
  solatium: Dec;
  interestAmount: Dec;
  interestDays: number;
  total: Dec;
  ownerSharePct: Dec;
  payableToOwner: Dec;
}

/** Solatium is 100% of the sub-total — it literally doubles it (s.30). */
export const SOLATIUM_RATE = 1.0;
/** s.30(3). */
export const INTEREST_RATE_ANNUAL = 0.12;

/** What the s.30(3) 12% runs on. */
export const INTEREST_BASE: "MARKET_VALUE" | "MARKET_VALUE_WITH_MULTIPLIER" = "MARKET_VALUE";

export const MIN_MULTIPLIER = 1.0;
export const MAX_MULTIPLIER = 2.0;

function round2(d: Dec): Dec {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** s.26 — market value is the HIGHEST of the available bases. */
export function determineMarketValue(input: CompensationInput): {
  value: Dec;
  basis: MarketValueBasis;
} {
  const candidates: { basis: MarketValueBasis; value: Dec }[] = [
    { basis: "CIRCLE_RATE", value: new D(input.circleRatePerHectare) },
  ];
  if (input.saleDeedAveragePerHectare != null) {
    candidates.push({
      basis: "SALE_DEEDS_TOP_50PCT",
      value: new D(input.saleDeedAveragePerHectare),
    });
  }
  if (input.consentedAmountPerHectare != null) {
    candidates.push({
      basis: "CONSENTED_AMOUNT",
      value: new D(input.consentedAmountPerHectare),
    });
  }
  return candidates.reduce((best, c) => (c.value.gt(best.value) ? c : best));
}

/** Days the 12% interest runs for: SIA notification → award or possession, whichever is earlier. */
export function interestDays(input: CompensationInput): number {
  if (!input.siaNotificationDate) return 0;
  const ends = [input.awardDate, input.possessionDate].filter(Boolean) as Date[];
  if (ends.length === 0) return 0;
  const end = new Date(Math.min(...ends.map((d) => d.getTime())));
  const days = Math.floor(
    (end.getTime() - input.siaNotificationDate.getTime()) / 86_400_000,
  );
  return Math.max(0, days);
}

export function calculateCompensation(input: CompensationInput): CompensationBreakdown {
  if (input.areaHectares <= 0) throw new Error("Area must be greater than zero");
  if (input.multiplierFactor < MIN_MULTIPLIER || input.multiplierFactor > MAX_MULTIPLIER) {
    throw new Error(
      `Multiplier factor must be between ${MIN_MULTIPLIER} and ${MAX_MULTIPLIER} (LARR First Schedule)`,
    );
  }

  const area = new D(input.areaHectares);
  const { value: marketValuePerHectare, basis } = determineMarketValue(input);
  const multiplier = new D(input.multiplierFactor);

  const marketValue = round2(marketValuePerHectare.mul(area));
  const landValue = round2(marketValuePerHectare.mul(area).mul(multiplier));

  const a = input.assets ?? {};
  const trees = new D(a.trees ?? 0);
  const structures = new D(a.structures ?? 0);
  const wells = new D(a.wells ?? 0);
  const crop = new D(a.standingCrop ?? 0);
  const assetsSubtotal = round2(trees.add(structures).add(wells).add(crop));

  const subTotal = round2(landValue.add(assetsSubtotal));
  const solatium = round2(subTotal.mul(SOLATIUM_RATE));

  const days = interestDays(input);
  const interestBase = INTEREST_BASE === "MARKET_VALUE" ? marketValue : landValue;
  const interestAmount = round2(
    interestBase.mul(INTEREST_RATE_ANNUAL).mul(new D(days)).div(new D(365)),
  );

  const total = round2(subTotal.add(solatium).add(interestAmount));

  const sharePct = new D(input.ownerSharePct ?? 100);
  const payableToOwner = round2(total.mul(sharePct).div(100));

  const lines: CompensationLine[] = [
    {
      key: "marketValue",
      label: "Market value of land",
      section: "s.26",
      amount: marketValue,
      workings: `${area.toFixed(4)} ha × ₹${marketValuePerHectare.toFixed(2)}/ha (${
        basis === "CIRCLE_RATE"
          ? "circle rate"
          : basis === "SALE_DEEDS_TOP_50PCT"
            ? "average of top 50% of sale deeds"
            : "consented amount"
      } — the highest of the three bases the Act allows)`,
      vars: { area: area.toFixed(4), rate: marketValuePerHectare.toFixed(2), basis },
    },
    {
      key: "multiplier",
      label: `Multiplier factor (×${multiplier.toFixed(2)})`,
      section: "First Schedule",
      amount: round2(landValue.sub(marketValue)),
      workings: `Rural land attracts 1.00–2.00 by distance from an urban centre; urban land 1.00`,
      vars: { m: multiplier.toFixed(2) },
    },
    { key: "landValue", label: "Value of land", amount: landValue },
  ];

  if (trees.gt(0)) lines.push({ key: "trees", label: "Trees and plantation", section: "s.29", amount: trees });
  if (structures.gt(0)) lines.push({ key: "structures", label: "Structures and buildings", section: "s.29", amount: structures });
  if (wells.gt(0)) lines.push({ key: "wells", label: "Wells and irrigation works", section: "s.29", amount: wells });
  if (crop.gt(0)) lines.push({ key: "crop", label: "Standing crop", section: "s.29", amount: crop });

  lines.push(
    { key: "subTotal", label: "Sub-total", amount: subTotal },
    {
      key: "solatium",
      label: "Solatium (100%)",
      section: "s.30",
      amount: solatium,
      workings:
        "Paid in recognition of the compulsory nature of the acquisition. It doubles the sub-total.",
    },
  );

  if (days > 0) {
    lines.push({
      key: "interest",
      label: `Interest @12% p.a. for ${days} days`,
      section: "s.30(3)",
      amount: interestAmount,
      workings: `12% a year on the market value of the land (₹${interestBase.toFixed(2)}${
        INTEREST_BASE === "MARKET_VALUE" ? ", before the multiplier" : ""
      }), not on the assets or the solatium — from the s.4(2) SIA notification to the award or possession, whichever is earlier`,
      vars: { days, base: interestBase.toFixed(2) },
    });
  }

  lines.push({ key: "total", label: "Total compensation", amount: total });

  if (!sharePct.eq(100)) {
    lines.push({
      key: "share",
      label: `Your share (${sharePct.toFixed(3)}%)`,
      amount: payableToOwner,
      workings: "This parcel is jointly held; the award is apportioned between the recorded owners.",
      vars: { pct: sharePct.toFixed(3) },
    });
  }

  return {
    lines,
    marketValuePerHectare,
    marketValueBasis: basis,
    landValue,
    assetsSubtotal,
    subTotal,
    solatium,
    interestAmount,
    interestDays: days,
    total,
    ownerSharePct: sharePct,
    payableToOwner,
  };
}

// Money formatting lives in ./format so client components can import it
// without pulling Prisma into the browser bundle.
export { formatINR, formatIndianScale } from "./format";
