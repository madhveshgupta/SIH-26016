/**
 * Looking a key up and filling its {placeholders} — the whole mechanism, with
 * no dictionary attached, so the browser can use it on the one dictionary it is
 * sent (see frontend/components/I18nProvider.tsx) without pulling in the rest.
 */
import type { Dictionary, MessageKey } from "./types";

/** The string at a dot path, or undefined. */
export function lookupIn(dictionary: Partial<Dictionary> | Record<string, unknown>, key: string): string | undefined {
  const value = key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], dictionary);
  return typeof value === "string" ? value : undefined;
}

/** Fill {name} placeholders; an unknown one is left visible rather than blanked. */
export function fill(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

/** `base` with every string `over` provides laid on top — a translation over the English. */
export function overlay<T>(base: T, over: unknown): T {
  if (typeof base === "string") return (typeof over === "string" ? over : base) as T;
  if (!base || typeof base !== "object") return base;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base as Record<string, unknown>)) {
    out[k] = overlay(v, (over as Record<string, unknown> | undefined)?.[k]);
  }
  return out as T;
}

/** The dictionary key for a workflow stage's name under the case's Act. */
export function stageKey(act: string, stage: string): MessageKey {
  return `workflow.${act === "NH_ACT_1956" ? "nh" : "larr"}.${stage}` as MessageKey;
}
