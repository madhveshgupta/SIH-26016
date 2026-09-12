/** A stored document title in the reader's language. */
import type { MessageKey } from "@backend/i18n";
import { dictionaryText } from "@backend/i18n/api-text";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const GENERATED: { re: RegExp; key: MessageKey; vars: (m: RegExpExecArray) => Record<string, string> }[] = [
  {
    re: /^PRELIMINARY NOTIFICATION UNDER SECTION (\S+) — (.+)$/,
    key: "screens.docs.tPrelim",
    vars: (m) => ({ sec: m[1], ref: m[2] }),
  },
  {
    re: /^DECLARATION UNDER SECTION (\S+) — (.+)$/,
    key: "screens.docs.tDecl",
    vars: (m) => ({ sec: m[1], ref: m[2] }),
  },
  { re: /^Award (\S+)$/, key: "screens.docs.tAward", vars: (m) => ({ no: m[1] }) },
];

export function documentTitle(t: Translate, title: string): string {
  for (const g of GENERATED) {
    const m = g.re.exec(title);
    if (m) return t(g.key, g.vars(m));
  }
  return dictionaryText(t, title) ?? title;
}
