/** The words a report is printed in. */
import { stageKey, translator, type MessageKey } from "@backend/i18n";
import { parcelStatusKey } from "@backend/i18n/scope";

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** English — the PDF, the scheduled emails and anything with no viewer. */
export const english: Translate = translator("en");

/** What a coded column's values are. */
export type CodeNs =
  | "yesNo" | "parcelStatus" | "projectType" | "act" | "landUse" | "paymentStatus" | "rnrCategory" | "rnrStatus"
  | "objectionStatus" | "severity" | "consequence" | "assessment" | "stage" | "geometryKind" | "figure" | "unit" | "account";

/** What a row count in the totals line counts. */
export type CountUnit =
  | "projects" | "states" | "districts" | "plots" | "rows" | "records" | "families" | "categories" | "openCases" | "objections";

const PAYMENT: Record<string, MessageKey> = {
  PAID: "officerCompensation.statusPaid",
  DEPOSITED_WITH_AUTHORITY: "officerCompensation.statusDeposited",
  INSTRUCTED: "officerCompensation.statusInstructed",
  PARTIALLY_PAID: "officerCompensation.statusPartiallyPaid",
  FAILED: "officerCompensation.statusFailed",
  DISPUTED: "officerCompensation.statusDisputed",
  PENDING: "officerCompensation.statusPending",
};

/** The dictionary key for one coded value, or null when it is not a code (a bank account number). */
function codeKey(ns: CodeNs, v: string): MessageKey | null {
  switch (ns) {
    case "yesNo": return v === "YES" ? "common.yes" : v === "NO" ? "common.no" : null;
    case "parcelStatus": return parcelStatusKey(v);
    case "projectType": return `screens.projectType.${v}` as MessageKey;
    case "act": return `screens.act.${v}` as MessageKey;
    case "landUse": return `screens.landUse.${v}` as MessageKey;
    case "paymentStatus": return PAYMENT[v] ?? null;
    case "rnrCategory": return `rnr.category.${v}` as MessageKey;
    case "rnrStatus": return `rnr.status.${v}` as MessageKey;
    case "objectionStatus": return `objectionStatus.${v}` as MessageKey;
    case "severity": return `screens.severity.${v}` as MessageKey;
    case "consequence": return `screens.reportPack.cons_${v}` as MessageKey;
    case "assessment": return `screens.reportPack.assess_${v}` as MessageKey;
    case "geometryKind": return `screens.plotRecord.src_${v}` as MessageKey;
    case "figure": return `screens.reportPack.fig_${v}` as MessageKey;
    case "account": return v === "NOT_ON_RECORD" ? "screens.reportPack.notOnRecord" : null;
    case "stage": {
      const [act, status] = v.split("|");
      return status ? stageKey(act, status) : null;
    }
    case "unit": return null;
  }
}

/** A coded cell in words. Anything the dictionary does not know is shown as it is. */
export function codeText(t: Translate, ns: CodeNs, value: string): string {
  if (ns === "unit") {
    if (value === "HA") return t("screens.units.haShort");
    if (value === "RUPEE") return "₹";
    if (value === "PCT") return "%";
    if (value.startsWith("OF:")) return t("screens.reportPack.unitOf", { n: value.slice(3) });
    return value;
  }
  const key = codeKey(ns, value);
  if (!key) return value;
  const text = t(key);
  return text === key ? value.replaceAll("_", " ").toLowerCase() : text;
}

/** A column header in words, looked up by its English label ("Cost (₹ crore)" → reportCol.costcrore). */
export function columnLabel(t: Translate, label: string): string {
  const key = `screens.reportCol.${label.toLowerCase().replace(/[^a-z0-9]/g, "")}` as MessageKey;
  const text = t(key);
  return text === key ? label : text;
}

/** A standing report's title and description. */
export function reportWords(t: Translate, key: string, fallback: { title: string; description: string }) {
  const base = `screens.reportPack.${key.replaceAll("-", "_")}`;
  const title = t(`${base}_title` as MessageKey);
  const description = t(`${base}_desc` as MessageKey);
  return {
    title: title.startsWith("screens.") ? fallback.title : title,
    description: description.startsWith("screens.") ? fallback.description : description,
  };
}

export function sectionName(t: Translate, section: string): string {
  const key = `screens.reportPack.sec_${section}` as MessageKey;
  const text = t(key);
  return text === key ? section : text;
}

/** "All States and Union Territories", "District jurisdiction" — who a report or brief covers. */
export function jurisdictionName(t: Translate, actor: { role: string; jurisdictionLevel?: string | null }): string {
  if (actor.role === "LANDOWNER") return t("screens.jurisdiction.mine");
  const level = (actor.jurisdictionLevel ?? "NATIONAL").toLowerCase();
  const key = `screens.jurisdiction.${level}` as MessageKey;
  const text = t(key);
  return text === key ? t("screens.jurisdiction.national") : text;
}
