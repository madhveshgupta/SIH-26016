/** Stored alerts, in the reader's language. */
import en from "@backend/i18n/locales/en";
import type { MessageKey } from "@backend/i18n/types";
import { dictionaryText } from "@backend/i18n/api-text";
import { storedRouteText } from "@backend/grievances/localise";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const screens = (en as unknown as { screens: Record<string, Record<string, string>> }).screens;

/** Parts that may be empty, and parts that are always a number. */
const OPTIONAL = new Set(["sec", "esc", "reason"]);
const NUMERIC = new Set(["days", "pct", "due"]);

interface Template {
  re: RegExp;
  names: string[];
  key: MessageKey;
  /** Clock sentences are stored with the project name after them. */
  withProject?: boolean;
  literal: number;
}

function compile(text: string, key: MessageKey, withProject = false): Template {
  const names: string[] = [];
  let literal = 0;
  const source = (withProject ? `${text} {project}.` : text)
    .split(/(\{\w+\})/)
    .map((piece) => {
      const m = /^\{(\w+)\}$/.exec(piece);
      if (!m) {
        literal += piece.length;
        return piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      names.push(m[1]);
      return OPTIONAL.has(m[1]) ? "(.*?)" : NUMERIC.has(m[1]) ? "(\\d+)" : "(.+?)";
    })
    .join("");
  return { re: new RegExp(`^${source}$`, "s"), names, key, withProject, literal };
}

const CLOCK_KEYS = Object.keys(screens.clock).filter((k) => /^(lapsed|rescinded|overdue|toLapse|toRescind|remaining)(One|Many)$/.test(k));
const TEMPLATES: Template[] = [
  ...Object.entries(screens.alertMsg)
    .filter(([k]) => !k.startsWith("u_") && !k.startsWith("x_"))
    .map(([k, text]) => compile(text, `screens.alertMsg.${k}` as MessageKey)),
  ...CLOCK_KEYS.flatMap((k) => [
    compile(screens.clock[k], `screens.clock.${k}` as MessageKey, true),
    compile(screens.clock[k], `screens.clock.${k}` as MessageKey),
  ]),
  // The more fixed wording a template has, the less it can match by accident.
].sort((a, b) => b.literal - a.literal);

function count(t: Translate, value: string, unit: "day" | "owner"): string | null {
  const m = new RegExp(`^(\\d+) ${unit}s?$`).exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return t(`screens.alertMsg.u_${unit}${n === 1 ? "One" : "Many"}` as MessageKey, { n });
}

function part(t: Translate, name: string, value: string): string {
  switch (name) {
    case "sec": {
      const m = /^ under (.+)$/.exec(value);
      return m ? t("screens.clock.underSection", { section: m[1] }) : value;
    }
    case "esc":
      return value ? t("screens.alertMsg.x_esc") : "";
    case "waited":
    case "sla":
    case "late":
    case "ago":
    case "left":
      return count(t, value, "day") ?? value;
    case "owners":
      return count(t, value, "owner") ?? value;
    case "authority":
    case "section":
      return storedRouteText(t, value);
    case "title":
      return alertText(t, value);
    case "sev":
    case "stage":
    case "cat":
    case "status":
      return dictionaryText(t, value) ?? value;
    default:
      return value;
  }
}

/** A stored alert title or message in the reader's language. */
export function alertText(t: Translate, text: string): string {
  for (const tpl of TEMPLATES) {
    const m = tpl.re.exec(text);
    if (!m) continue;
    const vars: Record<string, string> = {};
    tpl.names.forEach((name, i) => (vars[name] = part(t, name, m[i + 1])));
    if (tpl.withProject) {
      const { project, ...rest } = vars;
      return `${t(tpl.key, rest)} ${project}.`;
    }
    return t(tpl.key, vars);
  }
  return text;
}
