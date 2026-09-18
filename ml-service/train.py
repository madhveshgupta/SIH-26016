"""
Train the four models, and report honest metrics on a held-out split.

  1. Delay risk       — will this case miss its statutory deadline?  (classifier)
  2. Delay length     — by how many days?                            (regressor)
  3. Compensation     — likely final compensation per hectare        (regressor)
  4. Litigation risk  — will it end up in court?                     (classifier)
  5. Anomaly          — is this award unlike anything else?          (IsolationForest)

Run:  python ml-service/train.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor, IsolationForest
from sklearn.metrics import (
    accuracy_score, classification_report, f1_score, mean_absolute_error,
    r2_score, roc_auc_score,
)
from sklearn.model_selection import train_test_split

import joblib

ROOT = Path(__file__).parent
DATA = ROOT / "data" / "cases.csv"
MODELS = ROOT / "models"
VERSION = "1.0.0"

CATEGORICAL = ["project_type", "act"]
FEATURES = [
    "parcels", "area_ha", "owners", "owners_per_parcel", "is_urban",
    "circle_rate_per_ha", "multiplier_factor", "consent_pct", "objections",
    "objections_per_100_parcels", "objection_window_days", "digitised",
]

# What each feature means in words, for the explanation shown to an officer.
HUMAN_LABELS = {
    "parcels": "number of plots",
    "area_ha": "area being acquired",
    "owners": "number of owners",
    "owners_per_parcel": "owners per plot (joint holdings)",
    "is_urban": "urban land",
    "circle_rate_per_ha": "circle rate",
    "multiplier_factor": "First Schedule multiplier",
    "consent_pct": "landowner consent",
    "objections": "objections filed",
    "objections_per_100_parcels": "objections per 100 plots",
    "objection_window_days": "objection window (21d NH Act / 60d LARR)",
    "digitised": "case handled digitally",
    "project_type_": "project type",
    "act_": "governing Act",
}


def load() -> pd.DataFrame:
    if not DATA.exists():
        raise SystemExit(f"No training data at {DATA}. Run: python ml-service/data/generator.py")
    return pd.read_csv(DATA)


def encode(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """One-hot the two categoricals; everything else is already numeric."""
    encoded = pd.get_dummies(df[FEATURES + CATEGORICAL], columns=CATEGORICAL)
    return encoded, list(encoded.columns)


def main() -> None:
    df = load()
    X, columns = encode(df)
    MODELS.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "version": VERSION,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "rows": int(len(df)),
        "features": columns,
        "dataset": {
            "source": "synthetic, calibrated to published government figures",
            "calibration": [
                "CAG Performance Audit 2021 Table 3.2 — stage durations of 11 to 46 months",
                "CAG Table 3.3 — observed cost-of-delay escalation per sqm",
                "Parliament — 174,387 pending compensation cases across ~1,467 NH projects",
                "PIB — 9,464 notifications 2018-2022; 2,842 in FY18-19 against ~1,000/year before",
                "LARR Act 2013 — statutory windows, solatium and First Schedule multipliers",
            ],
            "why_synthetic": (
                "No public dataset of case-level acquisition outcomes exists; those records name "
                "landowners and their compensation and are protected under the DPDP Act 2023."
            ),
        },
        "models": {},
    }

    # --- 1 & 2. delay -------------------------------------------------------
    y_missed = df["missed_deadline"]
    Xtr, Xte, ytr, yte = train_test_split(X, y_missed, test_size=0.2, random_state=42, stratify=y_missed)
    delay_clf = GradientBoostingClassifier(n_estimators=200, max_depth=3, learning_rate=0.08, random_state=42)
    delay_clf.fit(Xtr, ytr)
    proba = delay_clf.predict_proba(Xte)[:, 1]
    pred = (proba >= 0.5).astype(int)
    report["models"]["delay_risk"] = {
        "task": "Will this case miss its statutory deadline?",
        "algorithm": "GradientBoostingClassifier",
        "auc": round(float(roc_auc_score(yte, proba)), 4),
        "f1": round(float(f1_score(yte, pred)), 4),
        "accuracy": round(float(accuracy_score(yte, pred)), 4),
        "positiveRate": round(float(y_missed.mean()), 4),
        "confusion": classification_report(yte, pred, output_dict=True, zero_division=0),
    }
    joblib.dump(delay_clf, MODELS / "delay_risk.joblib")

    late = df[df["missed_deadline"] == 1]
    Xl, _ = encode(late)
    Xltr, Xlte, yltr, ylte = train_test_split(Xl, late["delay_days"], test_size=0.2, random_state=42)
    delay_reg = GradientBoostingRegressor(n_estimators=200, max_depth=3, learning_rate=0.08, random_state=42)
    delay_reg.fit(Xltr, yltr)
    lpred = delay_reg.predict(Xlte)
    report["models"]["delay_days"] = {
        "task": "If it slips, by how many days?",
        "algorithm": "GradientBoostingRegressor",
        "mae_days": round(float(mean_absolute_error(ylte, lpred)), 1),
        "r2": round(float(r2_score(ylte, lpred)), 4),
        "trainedOn": int(len(late)),
    }
    joblib.dump(delay_reg, MODELS / "delay_days.joblib")

    # --- 3. compensation ----------------------------------------------------
    Xctr, Xcte, yctr, ycte = train_test_split(X, df["compensation_per_ha"], test_size=0.2, random_state=42)
    comp = GradientBoostingRegressor(n_estimators=250, max_depth=3, learning_rate=0.08, random_state=42)
    comp.fit(Xctr, yctr)
    cpred = comp.predict(Xcte)
    mape = float(np.mean(np.abs((ycte - cpred) / ycte)) * 100)
    report["models"]["compensation_per_ha"] = {
        "task": "Likely final compensation per hectare, at proposal time",
        "algorithm": "GradientBoostingRegressor",
        "mae_rupees": round(float(mean_absolute_error(ycte, cpred)), 2),
        "mape_pct": round(mape, 2),
        "r2": round(float(r2_score(ycte, cpred)), 4),
    }
    joblib.dump(comp, MODELS / "compensation.joblib")

    # --- 4. litigation ------------------------------------------------------
    y_court = df["went_to_court"]
    Xjtr, Xjte, yjtr, yjte = train_test_split(X, y_court, test_size=0.2, random_state=42, stratify=y_court)
    lit = GradientBoostingClassifier(n_estimators=200, max_depth=3, learning_rate=0.08, random_state=42)
    lit.fit(Xjtr, yjtr)
    jproba = lit.predict_proba(Xjte)[:, 1]
    jpred = (jproba >= 0.5).astype(int)
    report["models"]["litigation_risk"] = {
        "task": "Will this case end up in court?",
        "algorithm": "GradientBoostingClassifier",
        "auc": round(float(roc_auc_score(yjte, jproba)), 4),
        "f1": round(float(f1_score(yjte, jpred)), 4),
        "accuracy": round(float(accuracy_score(yjte, jpred)), 4),
        "positiveRate": round(float(y_court.mean()), 4),
    }
    joblib.dump(lit, MODELS / "litigation_risk.joblib")

    # --- 5. anomaly ---------------------------------------------------------
    anomaly = IsolationForest(n_estimators=200, contamination=0.03, random_state=42)
    anomaly.fit(X)
    scores = anomaly.decision_function(X)
    flagged = int((anomaly.predict(X) == -1).sum())
    report["models"]["anomaly"] = {
        "task": "Is this award unlike anything else on the books?",
        "algorithm": "IsolationForest",
        "contamination": 0.03,
        "flagged": flagged,
        "flaggedPct": round(100 * flagged / len(df), 2),
        "scoreRange": [round(float(scores.min()), 4), round(float(scores.max()), 4)],
    }
    joblib.dump(anomaly, MODELS / "anomaly.joblib")

    # Feature importances, shared by the explanation endpoint.
    report["importances"] = {
        name: {c: round(float(v), 5) for c, v in sorted(zip(columns, model.feature_importances_), key=lambda x: -x[1])[:10]}
        for name, model in [("delay_risk", delay_clf), ("compensation_per_ha", comp), ("litigation_risk", lit)]
    }
    report["humanLabels"] = HUMAN_LABELS

    (MODELS / "model-card.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (MODELS / "columns.json").write_text(json.dumps(columns), encoding="utf-8")

    print(f"Trained on {len(df):,} cases -> {MODELS}")
    for name, m in report["models"].items():
        metrics = {k: v for k, v in m.items() if k in {"auc", "f1", "accuracy", "mae_days", "mae_rupees", "mape_pct", "r2", "flaggedPct"}}
        print(f"  {name:22} {metrics}")


if __name__ == "__main__":
    main()
