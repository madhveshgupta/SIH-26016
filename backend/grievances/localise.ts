/** The grievance catalogue, in the reader's language. */
import en from "@backend/i18n/locales/en";
import type { MessageKey } from "@backend/i18n";
import type { GrievanceCategoryDef, GrievanceField, GrievanceRoute } from "./catalogue";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function reverse(section: Record<string, string>, prefix: string): Map<string, MessageKey> {
  return new Map(Object.entries(section).map(([k, v]) => [v, `${prefix}.${k}` as MessageKey]));
}

const FIELD = reverse(en.grievance.field, "grievance.field");
const OPTION = reverse(en.grievance.option, "grievance.option");
const ROUTE = reverse(en.grievance.route, "grievance.route");
const WHO = reverse(en.grievance.who, "grievance.who");

/** Every English string the catalogue shows, and whether the dictionary has it. For the smoke test. */
export function untranslatable(defs: GrievanceCategoryDef[], routes: GrievanceRoute[]): string[] {
  const texts = [
    ...defs.flatMap((d) => d.fields.flatMap((f) => [f.label, f.hint, ...(f.options ?? [])])),
    ...routes.flatMap((r) => [r.section, r.note, r.authorityLabel]),
  ].filter((x): x is string => Boolean(x));
  const known = new Set([...FIELD.keys(), ...OPTION.keys(), ...ROUTE.keys(), ...WHO.keys()]);
  return [...new Set(texts)].filter((x) => !known.has(x));
}

export interface LocalisedField extends Omit<GrievanceField, "options"> {
  /** The stored value stays English; only the label is translated. */
  options?: { value: string; label: string }[];
}

/**
 * A grievance's stored section and authority ("s.64 of the LARR Act 2013 …",
 * "the Collector") in the reader's language — the grievance row keeps the
 * English it was filed with.
 */
export function storedRouteText(t: Translate, english: string): string {
  const key = ROUTE.get(english) ?? WHO.get(english);
  return key ? t(key) : english;
}

export function grievanceText(t: Translate) {
  const tr = (map: Map<string, MessageKey>, english: string) => {
    const key = map.get(english);
    return key ? t(key) : english;
  };
  return {
    title: (def: GrievanceCategoryDef) => t(`grievance.cat.${def.key}` as MessageKey),
    blurb: (def: GrievanceCategoryDef) => t(`grievance.cat.${def.key}_BLURB` as MessageKey),
    route: (r: GrievanceRoute): GrievanceRoute => ({
      ...r,
      section: tr(ROUTE, r.section),
      note: tr(ROUTE, r.note),
      authorityLabel: tr(WHO, r.authorityLabel),
    }),
    fields: (fields: GrievanceField[]): LocalisedField[] =>
      fields.map((f) => ({
        ...f,
        label: tr(FIELD, f.label),
        hint: f.hint ? tr(FIELD, f.hint) : undefined,
        options: f.options?.map((o) => ({ value: o, label: tr(OPTION, o) })),
      })),
  };
}
