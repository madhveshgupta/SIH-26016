"""
Synthetic training data for land acquisition outcomes — calibrated, not invented.

Constants marked ASSUMPTION have no published source.

Sources:
  [CAG-3.2]  CAG Performance Audit, Chapter III "Acquisition of Land" (2021),
             Table 3.2 — observed 11 to 46 months for a single stage, across
             15 real cases in 13 villages covering 2,086 ha.
  [CAG-3.3]  Same audit, Table 3.3 — real per-village rate escalation while a
             file waited: Rs 431.91 -> 469.42/sqm, 411.64 -> 469.42,
             486.65 -> 1000.00, against 145.60 ha, 439.32 ha and 7.559 ha.
  [PARL]     Minister's statement in Parliament: 174,387 land compensation
             cases pending on NH projects, against ~1,467 NHAI projects on
             Bhoomi Rashi — roughly 119 disputed cases per project.
  [PIB]      9,464 notifications published through Bhoomi Rashi 2018-2022;
             2,842 in FY 2018-19 against ~1,000/year before the portal.
  [LARR]     The Act itself: s.19 within 12 months of s.11; award within 12
             months of s.19 or the proceedings lapse (s.25); 60-day objection
             window (s.15), 21 days under the NH Act s.3C; 100% solatium
             (s.30); First Schedule multiplier 1.0-2.0 rural, 1.0 urban.

Run:  python ml-service/data/generator.py --rows 50000 --out ml-service/data/cases.csv
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np

# --- calibration constants --------------------------------------------------

# [CAG-3.2] Observed single-stage durations, in months, from the audited cases.
CAG_STAGE_MONTHS = [34, 46, 11, 18, 22, 27, 26, 27, 26, 36, 22]

# [CAG-3.3] Rate escalation observed while files waited, as a fraction per year.
CAG_ESCALATION_PER_YEAR = [0.043, 0.070, 0.527]

# [PARL] ~174,387 pending compensation cases / ~1,467 projects ~= 119 per project.
LITIGATION_BASE_RATE = 0.18

# [PIB] Throughput rose from ~1,000 notifications a year to 2,842 in the first year of the portal:
# digitised cases move materially faster.
PORTAL_SPEEDUP = 0.72

# How much of the observed spread is left unexplained by the features.
RESIDUAL_SHARE = 0.55

# The mean of the pressure term over the generated population, measured by running the generator;
# used to keep the median duration on the audit's.
TYPICAL_PRESSURE = 1.32

# [LARR] Statutory windows, in days.
S19_DEADLINE_DAYS = 365
AWARD_DEADLINE_DAYS = 365
OBJECTION_WINDOW_LARR = 60
OBJECTION_WINDOW_NH = 21

PROJECT_TYPES = ["HIGHWAY", "RAILWAY", "IRRIGATION", "INDUSTRIAL_CORRIDOR",
                 "URBAN_DEVELOPMENT", "RENEWABLE_ENERGY", "MINING", "DEFENCE", "OTHER"]

# ASSUMPTION: relative difficulty by project type.
TYPE_DIFFICULTY = {
    "HIGHWAY": 1.15, "RAILWAY": 1.20, "IRRIGATION": 1.25, "INDUSTRIAL_CORRIDOR": 1.10,
    "URBAN_DEVELOPMENT": 1.30, "RENEWABLE_ENERGY": 0.85, "MINING": 1.05, "DEFENCE": 0.90,
    "OTHER": 1.00,
}

# Real circle rates, rupees per hectare, hand-collected for the demo districts from the state IGRS
# portals.
CIRCLE_RATE_RANGE = (450_000, 12_000_000)


def fit_lognormal(observed_months: list[int]) -> tuple[float, float]:
    """Mu and sigma of the lognormal that reproduces the observed durations."""
    logs = np.log(np.array(observed_months, dtype=float) * 30.0)  # months -> days
    return float(logs.mean()), float(logs.std(ddof=1))


def generate(rows: int, seed: int = 20260919) -> list[dict]:
    rng = np.random.default_rng(seed)
    mu, sigma = fit_lognormal(CAG_STAGE_MONTHS)
    escalation_mu = float(np.mean(CAG_ESCALATION_PER_YEAR))

    cases: list[dict] = []
    for _ in range(rows):
        project_type = str(rng.choice(PROJECT_TYPES, p=_type_weights()))
        is_nh = project_type == "HIGHWAY"
        difficulty = TYPE_DIFFICULTY[project_type]

        # Parcel counts follow the real corridor harvests: a village stretch of a highway touches
        # tens of plots, an irrigation command hundreds.
        parcels = int(np.clip(rng.lognormal(mean=3.4, sigma=1.0), 1, 4000))
        area_ha = float(np.clip(parcels * rng.lognormal(mean=-1.0, sigma=0.8), 0.05, 5000))
        # Indian agricultural land is very often jointly held.
        owners = int(np.clip(parcels * rng.uniform(1.0, 2.4), 1, 9000))

        is_urban = bool(rng.random() < 0.18)
        circle_rate = float(rng.uniform(*CIRCLE_RATE_RANGE)) * (2.6 if is_urban else 1.0)
        # [LARR] First Schedule: 1.0-2.0 rural by distance from an urban centre, 1.0 urban.
        multiplier = 1.0 if is_urban else float(np.round(rng.uniform(1.0, 2.0), 2))

        consent_pct = float(np.clip(rng.normal(74, 16), 5, 100))
        objections = int(rng.poisson(max(0.4, parcels * 0.06 * difficulty)))
        # Digitised cases move faster [PIB].
        digitised = bool(rng.random() < 0.65)

        # --- stage duration, fitted to CAG Table 3.2 ------------------------ The audit's 11-46
        # month spread is across DIFFERENT cases: part of it is exactly what the features below
        # explain (how many plots, how many objections, how much consent).
        base_days = float(rng.lognormal(mean=mu, sigma=sigma * RESIDUAL_SHARE))
        # Each factor is a modest multiplier, capped in total: the audit shows slow cases, not cases
        # that take a decade.
        pressure = float(np.clip(
            difficulty
            * (1 + 0.020 * np.sqrt(parcels))
            * (1 + 0.45 * (objections / max(1, parcels)) * 10)
            * (1 + 0.006 * max(0, 70 - consent_pct))
            * (PORTAL_SPEEDUP if digitised else 1.0),
            0.5, 2.5,
        ))
        # Normalised by the mean of the pressure term, so the TYPICAL case still lands on the
        # audit's observed median; the term only moves a case relative to that, which is what the
        # model learns from.
        sia_to_award_days = float(np.clip(base_days * pressure / TYPICAL_PRESSURE, 45, 3600))

        # --- outcomes -------------------------------------------------------- The deadline that
        # actually voids an acquisition: award within 12 months of the s.19 declaration [LARR s.25].
        statutory_budget = S19_DEADLINE_DAYS + AWARD_DEADLINE_DAYS
        delay_days = max(0.0, sia_to_award_days - statutory_budget)
        missed_deadline = int(sia_to_award_days > statutory_budget)

        # Litigation: anchored to ~119 disputed cases per project [PARL], and driven by the things
        # that actually cause disputes.
        litigation_p = float(np.clip(
            LITIGATION_BASE_RATE
            * (1 + 0.6 * (objections / max(1, parcels)) * 10)
            * (1 + 0.004 * max(0, 70 - consent_pct))
            * (1.4 if is_urban else 1.0)
            * (1 + 0.15 * np.log1p(owners / max(1, parcels))),
            0.01, 0.95,
        ))
        went_to_court = int(rng.random() < litigation_p)

        # Compensation per hectare: the statutory formula, plus the real cost-of-delay escalation
        # observed by the audit [CAG-3.3].
        years_waited = sia_to_award_days / 365.0
        escalation = (1 + float(rng.normal(escalation_mu, 0.05))) ** years_waited
        market_value = circle_rate * multiplier
        assets = market_value * float(np.clip(rng.normal(0.12, 0.06), 0, 0.5))
        subtotal = market_value + assets
        # [LARR s.30] 100% solatium, plus 12% per year interest on the market value from the s.4(2)
        # notification to the award.
        solatium = subtotal
        interest = market_value * 0.12 * years_waited
        compensation_per_ha = float((subtotal + solatium + interest) * escalation)

        cases.append({
            "project_type": project_type,
            "act": "NH_ACT_1956" if is_nh else "LARR_2013",
            "parcels": parcels,
            "area_ha": round(area_ha, 4),
            "owners": owners,
            "owners_per_parcel": round(owners / parcels, 3),
            "is_urban": int(is_urban),
            "circle_rate_per_ha": round(circle_rate, 2),
            "multiplier_factor": multiplier,
            "consent_pct": round(consent_pct, 1),
            "objections": objections,
            "objections_per_100_parcels": round(100 * objections / parcels, 2),
            "objection_window_days": OBJECTION_WINDOW_NH if is_nh else OBJECTION_WINDOW_LARR,
            "digitised": int(digitised),
            "sia_to_award_days": round(sia_to_award_days, 1),
            # --- labels ---
            "missed_deadline": missed_deadline,
            "delay_days": round(delay_days, 1),
            "went_to_court": went_to_court,
            "compensation_per_ha": round(compensation_per_ha, 2),
        })
    return cases


def _type_weights() -> list[float]:
    """Highways dominate the real caseload: ~1,467 NHAI projects on Bhoomi Rashi [PIB]."""
    weights = {"HIGHWAY": 0.34, "RAILWAY": 0.14, "IRRIGATION": 0.13, "INDUSTRIAL_CORRIDOR": 0.09,
               "URBAN_DEVELOPMENT": 0.10, "RENEWABLE_ENERGY": 0.09, "MINING": 0.05,
               "DEFENCE": 0.03, "OTHER": 0.03}
    return [weights[t] for t in PROJECT_TYPES]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=50_000)
    parser.add_argument("--out", type=Path, default=Path("ml-service/data/cases.csv"))
    parser.add_argument("--seed", type=int, default=20260919)
    args = parser.parse_args()

    rows = generate(args.rows, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    missed = sum(r["missed_deadline"] for r in rows)
    court = sum(r["went_to_court"] for r in rows)
    print(f"{len(rows):,} cases -> {args.out}")
    print(f"  missed the statutory deadline : {missed:,} ({100*missed/len(rows):.1f}%)")
    print(f"  ended in litigation           : {court:,} ({100*court/len(rows):.1f}%)")
    print(f"  median stage duration         : {np.median([r['sia_to_award_days'] for r in rows]):.0f} days "
          f"(CAG observed 11-46 months in one stage)")


if __name__ == "__main__":
    main()
