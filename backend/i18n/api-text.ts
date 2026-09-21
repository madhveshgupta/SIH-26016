/** Server messages in the reader's language. */
import en from "./locales/en";
import type { MessageKey } from "./types";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const API = (en as unknown as { screens: { api: Record<string, string> } }).screens.api;

const EXACT = new Map<string, MessageKey>();
const PATTERNS: { re: RegExp; names: string[]; key: MessageKey }[] = [];
for (const [k, text] of Object.entries(API)) {
  const key = `screens.api.${k}` as MessageKey;
  if (!text.includes("{")) {
    EXACT.set(text, key);
    continue;
  }
  const names: string[] = [];
  const source = text
    .split(/(\{\w+\})/)
    .map((piece) => {
      const m = /^\{(\w+)\}$/.exec(piece);
      if (m) {
        names.push(m[1]);
        return "(.+?)";
      }
      return piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  PATTERNS.push({ re: new RegExp(`^${source}$`, "s"), names, key });
}

/** Every English string in the dictionary, lower-cased, to its key — for translating the captured parts. */
const LEAVES = new Map<string, MessageKey>();
(function walk(node: unknown, path: string) {
  if (typeof node === "string") {
    const lower = node.toLowerCase();
    if (!LEAVES.has(lower) && !node.includes("{")) LEAVES.set(lower, path as MessageKey);
    return;
  }
  if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
})(en, "");

/** A phrase the dictionary knows in English ("Critical", a stage name), in the reader's language; null if it does not. */
export function dictionaryText(t: Translate, english: string): string | null {
  const leaf = LEAVES.get(english.toLowerCase());
  return leaf ? t(leaf) : null;
}

function translatePart(t: Translate, value: string): string {
  const leaf = LEAVES.get(value.toLowerCase());
  if (leaf) return t(leaf);
  // Codes: a role (DISTRICT_COLLECTOR) or a stage (SEC_19_DECLARATION).
  if (/^[A-Z][A-Z0-9_]+$/.test(value)) {
    for (const key of [`roles.${value}`, `workflow.larr.${value}`, `workflow.nh.${value}`]) {
      const text = t(key as MessageKey);
      if (text !== key) return text;
    }
  }
  return value;
}

/** One server message in the reader's language; as written if the dictionary has no entry for it. */
export function apiText(t: Translate, english: string): string {
  const exact = EXACT.get(english);
  if (exact) return t(exact);
  for (const p of PATTERNS) {
    const m = p.re.exec(english);
    if (!m) continue;
    const vars: Record<string, string> = {};
    p.names.forEach((name, i) => (vars[name] = translatePart(t, m[i + 1])));
    return t(p.key, vars);
  }
  return english;
}

/** The text fields of a response body — error, message, note, detail and warnings — translated. */
export function translateBody<T>(body: T, t: Translate): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const field of ["error", "message", "note", "detail"]) {
    if (typeof out[field] === "string") out[field] = apiText(t, out[field] as string);
  }
  if (Array.isArray(out.warnings)) out.warnings = out.warnings.map((w) => (typeof w === "string" ? apiText(t, w) : w));
  return out as T;
}
