"""
The prediction service.

  POST /predict   — delay risk, likely slippage, compensation, litigation risk
  POST /simulate  — what a policy change would do to a whole portfolio
  GET  /models    — the model card: metrics, training set, feature importances
  GET  /health    — is the service up, and which model version is loaded

Explanations re-score the case with one feature moved to the population median
(a local explanation, not SHAP).

Run:  uvicorn app:app --port 8000 --app-dir ml-service
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).parent
MODELS = ROOT / "models"

app = FastAPI(title="Bhoomi Nayan prediction service", version="1.0.0")

# --- load once at startup ---------------------------------------------------

def _load():
    if not (MODELS / "model-card.json").exists():
        return None
    card = json.loads((MODELS / "model-card.json").read_text(encoding="utf-8"))
    columns = json.loads((MODELS / "columns.json").read_text(encoding="utf-8"))
    return {
        "card": card,
        "columns": columns,
        "delay_risk": joblib.load(MODELS / "delay_risk.joblib"),
        "delay_days": joblib.load(MODELS / "delay_days.joblib"),
        "compensation": joblib.load(MODELS / "compensation.joblib"),
        "litigation_risk": joblib.load(MODELS / "litigation_risk.joblib"),
        "anomaly": joblib.load(MODELS / "anomaly.joblib"),
    }


STATE = _load()
# The population medians the explanation compares against.
MEDIANS = (
    pd.read_csv(ROOT / "data" / "cases.csv").median(numeric_only=True)
    if (ROOT / "data" / "cases.csv").exists()
    else None
)


class Case(BaseModel):
    """One acquisition case, as the platform knows it at proposal time."""
    project_type: str = Field(default="HIGHWAY")
    act: str = Field(default="LARR_2013")
    parcels: int = Field(ge=0, default=0)
    area_ha: float = Field(ge=0, default=0)
    owners: int = Field(ge=0, default=0)
    is_urban: int = Field(ge=0, le=1, default=0)
    circle_rate_per_ha: float = Field(ge=0, default=1_000_000)
    multiplier_factor: float = Field(ge=1, le=2, default=1.5)
    consent_pct: float = Field(ge=0, le=100, default=70)
    objections: int = Field(ge=0, default=0)
    digitised: int = Field(ge=0, le=1, default=1)


class Factor(BaseModel):
    feature: str
    humanLabel: str
    value: float
    typicalValue: float
    contribution: float
    direction: Literal["raises", "lowers", "neutral"]


class Prediction(BaseModel):
    delayRisk: float
    delayRiskBand: Literal["LOW", "MEDIUM", "HIGH"]
    expectedDelayDays: int
    compensationPerHa: float
    litigationRisk: float
    anomalyScore: float
    isAnomaly: bool
    factors: list[Factor]
    modelVersion: str


def _frame(case: Case) -> pd.DataFrame:
    """Turn a case into the exact feature vector the models were trained on."""
    parcels = max(1, case.parcels)
    row = {
        "parcels": case.parcels,
        "area_ha": case.area_ha,
        "owners": case.owners,
        "owners_per_parcel": round(case.owners / parcels, 3),
        "is_urban": case.is_urban,
        "circle_rate_per_ha": case.circle_rate_per_ha,
        "multiplier_factor": case.multiplier_factor,
        "consent_pct": case.consent_pct,
        "objections": case.objections,
        "objections_per_100_parcels": round(100 * case.objections / parcels, 2),
        "objection_window_days": 21 if case.act == "NH_ACT_1956" else 60,
        "digitised": case.digitised,
    }
    df = pd.DataFrame([row])
    for column in STATE["columns"]:
        if column.startswith("project_type_"):
            df[column] = int(column == f"project_type_{case.project_type}")
        elif column.startswith("act_"):
            df[column] = int(column == f"act_{case.act}")
    return df[STATE["columns"]]


def _explain(df: pd.DataFrame, top: int = 4) -> list[Factor]:
    """Why this case scores as it does, one feature at a time."""
    model = STATE["delay_risk"]
    base = float(model.predict_proba(df)[0, 1])
    importances = STATE["card"]["importances"]["delay_risk"]
    labels = STATE["card"]["humanLabels"]

    factors: list[Factor] = []
    for feature in importances:
        if feature not in df.columns:
            continue
        typical = float(MEDIANS[feature]) if MEDIANS is not None and feature in MEDIANS else 0.0
        counterfactual = df.copy()
        counterfactual.loc[:, feature] = typical
        moved = float(model.predict_proba(counterfactual)[0, 1])
        delta = base - moved
        if abs(delta) < 0.005:
            continue
        label = labels.get(feature) or labels.get(feature.split("_")[0] + "_") or feature.replace("_", " ")
        factors.append(Factor(
            feature=feature,
            humanLabel=label,
            value=float(df[feature].iloc[0]),
            typicalValue=typical,
            contribution=round(delta, 4),
            direction="raises" if delta > 0 else "lowers",
        ))
    factors.sort(key=lambda f: -abs(f.contribution))
    return factors[:top]


@app.get("/health")
def health() -> dict:
    return {
        "ok": STATE is not None,
        "modelVersion": STATE["card"]["version"] if STATE else None,
        "trainedAt": STATE["card"]["trainedAt"] if STATE else None,
        "rows": STATE["card"]["rows"] if STATE else 0,
    }


@app.get("/models")
def models() -> dict:
    if STATE is None:
        raise HTTPException(503, "No trained models. Run: python ml-service/train.py")
    return STATE["card"]


@app.post("/predict", response_model=Prediction)
def predict(case: Case) -> Prediction:
    if STATE is None:
        raise HTTPException(503, "No trained models. Run: python ml-service/train.py")
    df = _frame(case)
    risk = float(STATE["delay_risk"].predict_proba(df)[0, 1])
    days = float(STATE["delay_days"].predict(df)[0])
    compensation = float(STATE["compensation"].predict(df)[0])
    litigation = float(STATE["litigation_risk"].predict_proba(df)[0, 1])
    anomaly_score = float(STATE["anomaly"].decision_function(df)[0])

    return Prediction(
        delayRisk=round(risk, 4),
        delayRiskBand="HIGH" if risk >= 0.66 else "MEDIUM" if risk >= 0.33 else "LOW",
        # A case predicted to keep its deadline has no slippage to report.
        expectedDelayDays=int(max(0, days)) if risk >= 0.5 else 0,
        compensationPerHa=round(max(0.0, compensation), 2),
        litigationRisk=round(litigation, 4),
        anomalyScore=round(anomaly_score, 4),
        isAnomaly=bool(STATE["anomaly"].predict(df)[0] == -1),
        factors=_explain(df),
        modelVersion=STATE["card"]["version"],
    )


class SimulationRequest(BaseModel):
    """A portfolio of cases, and the policy levers to move."""
    cases: list[Case]
    multiplierFactor: float | None = Field(default=None, ge=1, le=2)
    solatiumPct: float | None = Field(default=None, ge=0, le=200)
    slaDays: int | None = Field(default=None, ge=30, le=1095)
    consentThresholdPct: float | None = Field(default=None, ge=0, le=100)


@app.post("/simulate")
def simulate(request: SimulationRequest) -> dict:
    """
    What a policy change would do across a portfolio.
    """
    if STATE is None:
        raise HTTPException(503, "No trained models. Run: python ml-service/train.py")
    if not request.cases:
        raise HTTPException(400, "Give at least one case to simulate")

    baseline_total = 0.0
    changed_total = 0.0
    baseline_risk: list[float] = []
    changed_risk: list[float] = []
    baseline_days: list[float] = []
    changed_days: list[float] = []

    for case in request.cases:
        base_df = _frame(case)
        baseline_total += float(STATE["compensation"].predict(base_df)[0]) * max(case.area_ha, 0)
        baseline_risk.append(float(STATE["delay_risk"].predict_proba(base_df)[0, 1]))
        baseline_days.append(float(max(0, STATE["delay_days"].predict(base_df)[0])))

        moved = case.model_copy()
        if request.multiplierFactor is not None:
            moved.multiplier_factor = request.multiplierFactor
        if request.consentThresholdPct is not None:
            # A higher consent requirement means cases proceed only where consent is at least the
            # threshold; model it as consent rising to it.
            moved.consent_pct = max(moved.consent_pct, request.consentThresholdPct)
        moved_df = _frame(moved)

        predicted = float(STATE["compensation"].predict(moved_df)[0])
        if request.solatiumPct is not None:
            # Unwind the statutory 100% and apply the new rate.
            without_solatium = predicted / 2.0
            predicted = without_solatium * (1 + request.solatiumPct / 100)
        changed_total += predicted * max(case.area_ha, 0)
        changed_risk.append(float(STATE["delay_risk"].predict_proba(moved_df)[0, 1]))
        changed_days.append(float(max(0, STATE["delay_days"].predict(moved_df)[0])))

    # A tighter SLA does not change a model trained on statutory deadlines; it changes what counts
    # as late.
    sla = request.slaDays
    breach_share = None
    if sla is not None:
        breach_share = round(float(np.mean([1.0 if d > 0 and d + 730 > sla else 0.0 for d in changed_days])), 4)

    return {
        "cases": len(request.cases),
        "compensation": {
            "baseline": round(baseline_total, 2),
            "simulated": round(changed_total, 2),
            "changePct": round(100 * (changed_total - baseline_total) / baseline_total, 2) if baseline_total else 0,
        },
        "delayRisk": {
            "baseline": round(float(np.mean(baseline_risk)), 4),
            "simulated": round(float(np.mean(changed_risk)), 4),
        },
        "expectedDelayDays": {
            "baseline": round(float(np.mean(baseline_days)), 1),
            "simulated": round(float(np.mean(changed_days)), 1),
        },
        "slaBreachShare": breach_share,
        "modelVersion": STATE["card"]["version"],
    }
