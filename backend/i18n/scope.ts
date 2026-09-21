/** The translated counterpart of rbac/scope.ts's scopeTitle(). */
import type { MessageKey } from "./types";

type ScopedNoun = "dashboard" | "landMap" | "projects";

type ScopeActor = {
  role: string;
  jurisdictionLevel?: string | null;
};

const LEVELS: Record<string, string> = {
  NATIONAL: "national",
  STATE: "state",
  DISTRICT: "district",
  TEHSIL: "tehsil",
  VILLAGE: "village",
};

/** The key for this actor's scoped title, e.g. "scope.dashboard.district". */
export function scopeTitleKey(actor: ScopeActor, noun: ScopedNoun = "dashboard"): MessageKey {
  const level = actor.role === "LANDOWNER" ? "mine" : (LEVELS[actor.jurisdictionLevel ?? ""] ?? "national");
  return `scope.${noun}.${level}` as MessageKey;
}

/** "All States and Union Territories", "One District"… — rbac's describeScope(), translated. */
export function scopeDescKey(actor: ScopeActor): MessageKey {
  if (actor.role === "LANDOWNER") return "screens.scopeDesc.LANDOWNER";
  const level = actor.jurisdictionLevel ?? "";
  return (LEVELS[level] ? `screens.scopeDesc.${level}` : "screens.scopeDesc.NONE") as MessageKey;
}

const PARCEL_STATUS: Record<string, string> = {
  PROPOSED: "proposed",
  NOTIFIED: "notified",
  OBJECTED: "underObjection",
  AWARD_DECLARED: "awardDeclared",
  COMPENSATED: "compensated",
  POSSESSED: "possessed",
  DISPUTED: "disputed",
  WITHDRAWN: "withdrawn",
};

/** A plot's status (PROPOSED, AWARD_DECLARED…) as its dictionary key, e.g. "stages.awardDeclared". */
export function parcelStatusKey(status: string): MessageKey {
  return `stages.${PARCEL_STATUS[status] ?? "proposed"}` as MessageKey;
}
