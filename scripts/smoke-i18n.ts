/** Smoke test for the translations. */
import en from "../backend/i18n/locales/en";
import {
  COVERAGE, LOCALES, LOCALE_INFO, formatDate, formatNumber, stageKey, translate, type Locale, type MessageKey,
} from "../backend/i18n";
import { CATEGORIES } from "../backend/grievances/catalogue";
import { untranslatable } from "../backend/grievances/localise";
import { definitionFor } from "../backend/workflow/engine";
import { apiText } from "../backend/i18n/api-text";
import { alertText } from "../backend/alerts/words";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${l}${d ? "  " + d : ""}`);
  if (ok) pass++;
  else fail++;
};

/** Unicode ranges of each language's script. */
const DEVANAGARI = /[ऀ-ॿ]/g;
const BENGALI = /[ঀ-৿]/g;
const SCRIPT: Record<Exclude<Locale, "en">, RegExp> = {
  hi: DEVANAGARI, mr: DEVANAGARI, bn: BENGALI,
  ta: /[\u0B80-\u0BFF]/g, te: /[\u0C00-\u0C7F]/g,
};

/** Things that stay in Latin script in every language: citations, acronyms, codes. */
const LATIN_OK = /\{\w+\}|\b(?:LARR|CALA|LAO|NHAI|RVNL|SIA|SMS|ULPIN|GIS|MIS|PFMS|SIH|PS|NH|SC|ST|R&R|OTP|UP|AGR|LA|CC|BY|GZT|UTR|WebGL|AUC|Bhu-Naksha|ss?\.\s?\d+[A-Z]?(?:\(\w+\))*|\d+[A-Z]?)\b/g;

function leaves(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

const EN = leaves(en);
console.log(`\nTRANSLATIONS — ${LOCALES.length} languages, ${EN.length} strings each\n======================================================`);

console.log("\nThe registry:");
check("every listed language has a dictionary", LOCALES.length >= 2, LOCALES.join(" "));
check("every language has a name, direction and Intl tag",
  LOCALES.every((l) => LOCALE_INFO[l]?.label && LOCALE_INFO[l].dir && LOCALE_INFO[l].intl));
check("exactly the plan's six languages (Phase 15)",
  [...LOCALES].sort().join() === ["bn", "en", "hi", "mr", "ta", "te"].join(), LOCALES.join(" "));
check("dates and numbers format in every language without throwing",
  LOCALES.every((l) => formatDate(l, new Date("2026-09-22")).includes("2026") && /\d/.test(formatNumber(l, 1234567))));
check("digits stay international (Article 343)",
  LOCALES.every((l) => formatNumber(l, 1234567).replace(/[^\d]/g, "") === "1234567"));

console.log("\nEach dictionary:");
for (const locale of LOCALES) {
  if (locale === "en") continue;
  const script = SCRIPT[locale];
  const missing: string[] = [];
  const brokenVars: string[] = [];
  const wrongScript: string[] = [];
  const sameAsEnglish: string[] = [];
  for (const [key, english] of EN) {
    const text = translate(locale, key as MessageKey);
    const own = text !== english || text === key;
    if (text === key) { missing.push(key); continue; }
    if (placeholders(text) !== placeholders(english)) brokenVars.push(key);
    const englishWords = english.replace(LATIN_OK, "").match(/[A-Za-z]{3,}/g) ?? [];
    if (englishWords.length === 0) continue; // a citation, an acronym, a number
    const native = text.match(script)?.length ?? 0;
    if (!own) sameAsEnglish.push(key);
    else if (native === 0) wrongScript.push(key);
  }
  const name = `${locale.padEnd(3)} ${LOCALE_INFO[locale].english}`;
  check(`${name}: every key present`, missing.length === 0 && COVERAGE[locale] >= 0.999,
    missing.length ? `${missing.length} missing, e.g. ${missing.slice(0, 3).join(", ")}` : `${Math.round(COVERAGE[locale] * 100)}%`);
  check(`${name}: placeholders intact`, brokenVars.length === 0, brokenVars.slice(0, 4).join(", "));
  check(`${name}: written in its own script`, wrongScript.length === 0, wrongScript.slice(0, 4).join(", "));
  check(`${name}: nothing left in English`, sameAsEnglish.length === 0, sameAsEnglish.slice(0, 4).join(", "));
}

console.log("\nWhat the screens look up by code:");
const routes = CATEGORIES.flatMap((c) => [c.route("LARR_2013"), c.route("NH_ACT_1956")]);
const orphans = untranslatable(CATEGORIES, routes);
check("every grievance field, option and route has a dictionary entry", orphans.length === 0, orphans.slice(0, 3).join(" | "));
check("every grievance category has a title and a blurb",
  CATEGORIES.every((c) => translate("en", `grievance.cat.${c.key}` as MessageKey) === c.title.en
    && translate("en", `grievance.cat.${c.key}_BLURB` as MessageKey) === c.blurb.en));
const stagesOk = (["LARR_2013", "NH_ACT_1956"] as const).every((act) =>
  definitionFor(act).stages.every((s) => translate("en", stageKey(act, s.status)) === s.label));
check("every workflow stage of both Acts has a name, matching the Act definition", stagesOk);

console.log("\nLegal vocabulary the review flagged:");
check("Hindi uses the statutory तोषण for solatium", translate("hi", "compensation.solatium").includes("तोषण"));
check("Hindi uses the statutory अधिनिर्णय for award", translate("hi", "stages.awardDeclared").includes("अधिनिर्णय"));
check("Marathi uses निवाडा for award", translate("mr", "stages.awardDeclared").includes("निवाडा"));
// One word per term on every screen, the one the Act's own translation uses.
const all = (locale: Locale) => EN.map(([key]) => translate(locale, key as MessageKey));
const hiOld = all("hi").filter((s) => /अधिग्रह|मुआवज़[ाे]/.test(s.replace(/\(मुआवज़ा\)/g, "")));
check("Hindi says अर्जन and प्रतिकर throughout (मुआवज़ा only as a bracketed gloss)", hiOld.length === 0, hiOld.slice(0, 2).join(" | "));
const mrOld = all("mr").filter((s) => /मोबदल/.test(s));
check("Marathi says भरपाई for compensation throughout", mrOld.length === 0, mrOld.slice(0, 2).join(" | "));

console.log("\nServer messages and alerts:");
// Every message the API can send has a translation its pattern actually reaches.
const API = Object.entries((en as unknown as { screens: { api: Record<string, string> } }).screens.api);
const hiT = (key: MessageKey, vars?: Record<string, string | number>) => translate("hi", key, vars);
const unreached = API.filter(([, english]) => {
  const sample = english.replace(/\{(\w+)\}/g, "7");
  return apiText(hiT, sample) === sample;
}).map(([k]) => k);
check(`every server message (${API.length}) reaches its Hindi translation`, unreached.length === 0, unreached.slice(0, 4).join(", "));
check("a message the dictionary does not know comes back as written", apiText(hiT, "Some new error.") === "Some new error.");
const alert = "Escalated — Breached: Section 3C objections — LA/UP/AGR/2026/0007";
check("a stored English alert is shown in Hindi", alertText(hiT, alert) !== alert, alertText(hiT, alert));
check("fallback: an unknown key comes back as the key, not a crash",
  translate("hi", "no.such.key" as MessageKey) === "no.such.key");

console.log(`\n======================================================\nPASSED ${pass}   FAILED ${fail}`);
process.exit(fail ? 1 : 0);
