/** Smoke test for the compensation calculator (LARR ss.26-30). */
import {
  calculateCompensation, determineMarketValue, interestDays,
  formatIndianScale, SOLATIUM_RATE, INTEREST_RATE_ANNUAL, INTEREST_BASE,
} from "../backend/compensation/calculator";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? "  " + d : ""}`);
  if (ok) pass++;
  else fail++;
};
const num = (d: { toString(): string }) => Number(d.toString());

console.log("\nCOMPENSATION CALCULATOR (LARR ss.26-30)\n======================================================");

// A real-shaped case: 1 ha of irrigated land in Agra.
// circle rate 68,00,000/ha, rural multiplier 1.4.
const base = {
  areaHectares: 1,
  circleRatePerHectare: 6_800_000,
  multiplierFactor: 1.4,
};

console.log("\nSection 26 — market value is the HIGHEST of the three bases:");
check("circle rate alone is used when it is the only basis",
  determineMarketValue(base).basis === "CIRCLE_RATE");
const withDeeds = determineMarketValue({ ...base, saleDeedAveragePerHectare: 9_000_000 });
check("higher sale-deed average wins over circle rate",
  withDeeds.basis === "SALE_DEEDS_TOP_50PCT" && num(withDeeds.value) === 9_000_000,
  "9,00,000/ha beats 68,00,000? no — 90,00,000 beats 68,00,000");
const lowerDeeds = determineMarketValue({ ...base, saleDeedAveragePerHectare: 5_000_000 });
check("lower sale-deed average does NOT reduce the award",
  lowerDeeds.basis === "CIRCLE_RATE",
  "(the Act takes the highest, so officials cannot pick the cheapest)");
const consented = determineMarketValue({ ...base, consentedAmountPerHectare: 12_000_000 });
check("consented amount wins when highest", consented.basis === "CONSENTED_AMOUNT");

console.log("\nThe arithmetic, hand-checked:");
const r = calculateCompensation(base);
// 1 ha x 68,00,000 x 1.4 = 95,20,000
check("land value = area x rate x multiplier", num(r.landValue) === 9_520_000,
  `₹${num(r.landValue).toLocaleString("en-IN")}`);
check("sub-total = land + assets", num(r.subTotal) === 9_520_000);
check("solatium is 100% of the sub-total", num(r.solatium) === 9_520_000,
  `doubles it, as s.30 requires`);
check("total = sub-total + solatium", num(r.total) === 19_040_000,
  `₹${num(r.total).toLocaleString("en-IN")}`);
check("solatium rate constant is 1.0", SOLATIUM_RATE === 1.0);

console.log("\nSection 29 — assets attached to the land:");
const withAssets = calculateCompensation({
  ...base,
  assets: { trees: 450_000, wells: 300_000, structures: 1_200_000, standingCrop: 85_000 },
});
check("assets are itemised and summed", num(withAssets.assetsSubtotal) === 2_035_000,
  `₹${num(withAssets.assetsSubtotal).toLocaleString("en-IN")}`);
check("solatium applies to assets too, not just land",
  num(withAssets.solatium) === num(withAssets.subTotal),
  "(a 30-year orchard can be worth more than the soil)");
check("total includes assets and their solatium",
  num(withAssets.total) === (9_520_000 + 2_035_000) * 2,
  `₹${num(withAssets.total).toLocaleString("en-IN")}`);

console.log("\nSection 30(3) — 12% interest:");
const sia = new Date("2024-01-01");
const award = new Date("2025-01-01"); // 366 days (2024 is a leap year)
check("interest runs from SIA notification to award",
  interestDays({ ...base, siaNotificationDate: sia, awardDate: award }) === 366,
  "366 days");
check("possession ends the period when earlier than the award",
  interestDays({
    ...base, siaNotificationDate: sia,
    awardDate: new Date("2025-06-01"), possessionDate: new Date("2024-07-01"),
  }) === 182, "182 days");
const withInterest = calculateCompensation({ ...base, siaNotificationDate: sia, awardDate: award });
// s.30(3) runs "on such market value": 68,00,000 x 0.12 = 8,16,000; x 366/365 = 8,18,235.62.
check("interest is computed on the market value alone",
  Math.abs(num(withInterest.interestAmount) - 818_235.62) < 0.01,
  `₹${num(withInterest.interestAmount).toLocaleString("en-IN")}`);
check("interest base constant is the s.26(1) market value", INTEREST_BASE === "MARKET_VALUE");
const interestWithAssets = calculateCompensation({
  ...base, siaNotificationDate: sia, awardDate: award,
  assets: { trees: 450_000, structures: 1_200_000 },
});
check("assets do not attract the 12% interest",
  num(interestWithAssets.interestAmount) === num(withInterest.interestAmount),
  "(s.29 assets are compensated, but s.30(3) interest is on land value only)");
check("total = sub-total + solatium + interest",
  num(withInterest.total) === 9_520_000 * 2 + 818_235.62);
check("interest rate constant is 12%", INTEREST_RATE_ANNUAL === 0.12);
check("no interest before any SIA notification",
  calculateCompensation(base).interestDays === 0);

console.log("\nJoint ownership:");
const joint = calculateCompensation({ ...base, ownerSharePct: 33.333 });
check("award is apportioned by share",
  Math.abs(num(joint.payableToOwner) - 19_040_000 * 0.33333) < 1,
  `₹${num(joint.payableToOwner).toLocaleString("en-IN")} of ₹${num(joint.total).toLocaleString("en-IN")}`);

console.log("\nGuard rails:");
check("multiplier above 2.0 is rejected",
  (() => { try { calculateCompensation({ ...base, multiplierFactor: 2.5 }); return false; } catch { return true; } })(),
  "(First Schedule caps it at 2.00)");
check("multiplier below 1.0 is rejected",
  (() => { try { calculateCompensation({ ...base, multiplierFactor: 0.8 }); return false; } catch { return true; } })());
check("zero area is rejected",
  (() => { try { calculateCompensation({ ...base, areaHectares: 0 }); return false; } catch { return true; } })());

console.log("\nTransparency — the breakdown a landowner actually sees:");
const shown = calculateCompensation({
  ...base, assets: { trees: 450_000, wells: 300_000 },
  siaNotificationDate: sia, awardDate: award,
});
check("every line is labelled", shown.lines.every((l) => l.label.length > 0));
check("statutory sections are cited on the lines",
  shown.lines.filter((l) => l.section).length >= 4,
  shown.lines.filter((l) => l.section).map((l) => l.section).join(", "));
check("market value line explains which basis was used",
  /highest of the three bases/.test(shown.lines[0].workings ?? ""));
check("Indian number scale is used", formatIndianScale(19_040_000) === "₹1.90 crore",
  formatIndianScale(19_040_000));

console.log("\n--- worked example a farmer would receive ---");
for (const l of shown.lines) {
  const amt = `₹${num(l.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  console.log(`  ${(l.section ?? "").padEnd(14)} ${l.label.padEnd(36)} ${amt.padStart(18)}`);
}

console.log("\n======================================================");
console.log(`PASSED ${pass}   FAILED ${fail}\n`);
if (fail > 0) process.exitCode = 1;
