/** Plain-language wording for the prediction page. */

import type { MessageKey } from "@backend/i18n/types";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export interface Factor {
  feature?: string;
  humanLabel: string;
  contribution: number;
  direction: string;
  value: number;
  typicalValue: number;
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** One factor as a short phrase, e.g. "many objections filed (12; a typical case has 2)". */
export function describeFactor(t: T, f: Factor): string {
  const up = f.value > f.typicalValue;
  const vars = { value: n(f.value), typical: n(f.typicalValue) };
  const feature = f.feature ?? "";
  const raises = f.direction === "raises";

  if (feature.startsWith("project_type_")) {
    const type = t(`screens.projectType.${feature.slice("project_type_".length)}` as MessageKey);
    return t(raises ? "screens.factor.typeSlower" : "screens.factor.typeFaster", { type });
  }
  if (feature.startsWith("act_")) {
    const act = t(`screens.act.${feature.slice("act_".length)}` as MessageKey);
    return t(raises ? "screens.factor.actSlower" : "screens.factor.actFaster", { act });
  }

  switch (feature) {
    case "objections_per_100_parcels":
      return t(up ? "screens.factor.objPer100Up" : "screens.factor.objPer100Down", vars);
    case "objections":
      return t(up ? "screens.factor.objUp" : "screens.factor.objDown", vars);
    case "parcels":
      return t(up ? "screens.factor.parcelsUp" : f.value === 1 ? "screens.factor.parcelsDownOne" : "screens.factor.parcelsDownMany", vars);
    case "area_ha":
      return t(up ? "screens.factor.areaUp" : "screens.factor.areaDown", vars);
    case "owners":
      return t(up ? "screens.factor.ownersUp" : "screens.factor.ownersDown", vars);
    case "owners_per_parcel":
      return t(up ? "screens.factor.jointUp" : "screens.factor.jointDown", vars);
    case "is_urban":
      return t(f.value ? "screens.factor.urban" : "screens.factor.rural");
    case "circle_rate_per_ha":
      return t(up ? "screens.factor.valueHigh" : "screens.factor.valueLow");
    case "multiplier_factor":
      return t(up ? "screens.factor.multUp" : "screens.factor.multDown", vars);
    case "consent_pct":
      return t(up ? "screens.factor.consentUp" : "screens.factor.consentDown", vars);
    case "digitised":
      return t(f.value ? "screens.factor.digital" : "screens.factor.paper");
    case "objection_window_days":
      return t(up ? "screens.factor.windowUp" : "screens.factor.windowDown", vars);
    default:
      // Every feature the model is trained on is worded above; this is for a
      // feature added to the model before it is added here.
      return f.humanLabel;
  }
}

/** "about 4 months", "about 3 weeks" — a delay in days as people say it. */
export function inWords(t: T, days: number): string {
  const d = Math.round(days);
  if (days < 14) return t(d === 1 ? "screens.predictions.aboutDaysOne" : "screens.predictions.aboutDaysMany", { n: d });
  if (days < 60) return t("screens.predictions.aboutWeeks", { n: Math.round(days / 7) });
  const months = Math.round(days / 30);
  return months < 18
    ? t("screens.predictions.aboutMonths", { n: months })
    : t("screens.predictions.aboutYears", { n: (days / 365).toFixed(1) });
}

/** Joins phrases as each language does: "a, b and c", "a, b और c", "a, b மற்றும் c". */
export function listOf(intl: string, parts: string[]): string {
  return new Intl.ListFormat(intl, { style: "long", type: "conjunction" }).format(parts);
}
