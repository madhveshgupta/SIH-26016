/** Jurisdiction scoping. */
import type { JurisdictionLevel, RoleType } from "@prisma/client";

/** The minimum an authenticated caller must carry for scoping to work. */
export interface Actor {
  id: string;
  role: RoleType;
  jurisdictionLevel: JurisdictionLevel;
  stateId: string | null;
  districtId: string | null;
  tehsilId: string | null;
  agencyId: string | null;
  /** Set only for LANDOWNER — links the user to their Owner record. */
  ownerId?: string | null;
}

/** A where-fragment that matches nothing. Used when a scope is inconsistent. */
const MATCH_NONE = { id: "__no_access__" } as const;

/** Is this actor unrestricted? */
export function isNational(actor: Actor): boolean {
  return actor.jurisdictionLevel === "NATIONAL";
}

/** Scope for models that hang off a district (LandParcel). */
export function scopeForParcel(actor: Actor): Record<string, unknown> {
  if (actor.role === "LANDOWNER") {
    // Ownership, not geography. A landowner sees their own land wherever it is.
    if (!actor.ownerId) return MATCH_NONE;
    return { owners: { some: { ownerId: actor.ownerId } } };
  }
  switch (actor.jurisdictionLevel) {
    case "NATIONAL":
      return {};
    case "STATE":
      return actor.stateId ? { district: { stateId: actor.stateId } } : MATCH_NONE;
    case "DISTRICT":
      return actor.districtId ? { districtId: actor.districtId } : MATCH_NONE;
    case "TEHSIL":
      return actor.tehsilId ? { village: { tehsilId: actor.tehsilId } } : MATCH_NONE;
    case "VILLAGE":
      // No village field on the actor yet; fall back to tehsil rather than
      // silently widening to the whole district.
      return actor.tehsilId ? { village: { tehsilId: actor.tehsilId } } : MATCH_NONE;
    default:
      return MATCH_NONE;
  }
}

/** Scope for Proposal. */
export function scopeForProposal(actor: Actor): Record<string, unknown> {
  if (actor.role === "LAND_REQUIRING_BODY") {
    if (!actor.agencyId) return MATCH_NONE;
    return { project: { agencyId: actor.agencyId } };
  }
  if (actor.role === "LANDOWNER") {
    if (!actor.ownerId) return MATCH_NONE;
    return { parcels: { some: { owners: { some: { ownerId: actor.ownerId } } } } };
  }
  switch (actor.jurisdictionLevel) {
    case "NATIONAL":
      return {};
    case "STATE":
      return actor.stateId
        ? { project: { states: { some: { stateId: actor.stateId } } } }
        : MATCH_NONE;
    case "DISTRICT":
    case "TEHSIL":
    case "VILLAGE":
      return actor.districtId
        ? { project: { districts: { some: { districtId: actor.districtId } } } }
        : MATCH_NONE;
    default:
      return MATCH_NONE;
  }
}

/** Scope for Project. */
export function scopeForProject(actor: Actor): Record<string, unknown> {
  if (actor.role === "LAND_REQUIRING_BODY") {
    return actor.agencyId ? { agencyId: actor.agencyId } : MATCH_NONE;
  }
  switch (actor.jurisdictionLevel) {
    case "NATIONAL":
      return {};
    case "STATE":
      return actor.stateId ? { states: { some: { stateId: actor.stateId } } } : MATCH_NONE;
    case "DISTRICT":
    case "TEHSIL":
    case "VILLAGE":
      return actor.districtId
        ? { districts: { some: { districtId: actor.districtId } } }
        : MATCH_NONE;
    default:
      return MATCH_NONE;
  }
}

/**
 * Scope for rows that MAY hang off a parcel — an objection can be about a specific plot, or
 * about the acquisition as a whole.
 */
export function scopeForOptionalParcel(actor: Actor): Record<string, unknown> {
  const parcel = scopeForParcel(actor);
  if (Object.keys(parcel).length === 0) return {};
  return { OR: [{ parcelId: null }, { parcel }] };
}

/** Scope for District rows themselves (master-data screens, dashboards). */
export function scopeForDistrict(actor: Actor): Record<string, unknown> {
  switch (actor.jurisdictionLevel) {
    case "NATIONAL":
      return {};
    case "STATE":
      return actor.stateId ? { stateId: actor.stateId } : MATCH_NONE;
    case "DISTRICT":
    case "TEHSIL":
    case "VILLAGE":
      return actor.districtId ? { id: actor.districtId } : MATCH_NONE;
    default:
      return MATCH_NONE;
  }
}

/** Scope for AffectedFamily, which hangs off a village rather than a parcel. */
export function scopeForFamily(actor: Actor): Record<string, unknown> {
  if (actor.role === "LANDOWNER") {
    return actor.ownerId ? { ownerId: actor.ownerId } : MATCH_NONE;
  }
  switch (actor.jurisdictionLevel) {
    case "NATIONAL":
      return {};
    case "STATE":
      return actor.stateId ? { village: { tehsil: { district: { stateId: actor.stateId } } } } : MATCH_NONE;
    case "DISTRICT":
      return actor.districtId ? { village: { tehsil: { districtId: actor.districtId } } } : MATCH_NONE;
    case "TEHSIL":
    case "VILLAGE":
      return actor.tehsilId ? { village: { tehsilId: actor.tehsilId } } : MATCH_NONE;
    default:
      return MATCH_NONE;
  }
}

/** May this actor look across every state, or only their own? */
export function canSeeAllStates(actor: Actor): boolean {
  return isNational(actor);
}

/** May this actor choose between districts, or are they inside one? */
export function canChooseDistrict(actor: Actor): boolean {
  return isNational(actor) || actor.jurisdictionLevel === "STATE";
}

/** The state an actor is fixed to, or null where they span the country. */
export function fixedStateFor(actor: Actor): string | null {
  return isNational(actor) ? null : actor.stateId;
}

/** The level one below the actor's own, for "progress by …" tables. */
export function rollupLevel(actor: Actor): "state" | "district" | "project" {
  switch (actor.jurisdictionLevel) {
    case "NATIONAL":
      return "state";
    case "STATE":
      return "district";
    default:
      return "project";
  }
}

/**
 * The title for a scoped screen — "District dashboard", not "National dashboard", for someone
 * who can see one district.
 */
export function scopeTitle(actor: Actor, noun = "dashboard"): string {
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  if (actor.role === "LANDOWNER") return `My ${noun}`;
  switch (actor.jurisdictionLevel) {
    case "NATIONAL":
      return `National ${noun}`;
    case "STATE":
      return `State ${noun}`;
    case "DISTRICT":
      return `District ${noun}`;
    case "TEHSIL":
      return `Tehsil ${noun}`;
    case "VILLAGE":
      return `Village ${noun}`;
    default:
      return cap(noun);
  }
}

/** Human-readable description of what this actor can see. */
export function describeScope(actor: Actor): string {
  if (actor.role === "LANDOWNER") return "Own land holdings only";
  switch (actor.jurisdictionLevel) {
    case "NATIONAL":
      return "All States and Union Territories";
    case "STATE":
      return "One State";
    case "DISTRICT":
      return "One District";
    case "TEHSIL":
      return "One Tehsil";
    case "VILLAGE":
      return "One Village";
    default:
      return "No access";
  }
}
