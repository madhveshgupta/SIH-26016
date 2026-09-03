/**
 * The permission matrix — one config surface, so an auditor can see exactly what
 * each of the 8 roles may do without reading any code.
 */
import type { RoleType } from "@prisma/client";

/** Every protected thing in the system. */
export type Resource =
  | "masterData"
  | "project"
  | "proposal"
  | "scrutiny"
  | "parcel"
  | "notification"
  | "objection"
  | "grievance"
  | "award"
  | "compensation"
  | "payment"
  | "rnr"
  | "possession"
  | "document"
  | "dashboard"
  | "report"
  | "alert"
  | "auditLog"
  | "user"
  | "integration"
  | "mlPrediction";

/**
 * `approve` is separate from `update` on purpose: an officer may edit a draft
 * without having the authority to approve it, and conflating the two is how
 * real systems end up letting people sign off their own work.
 */
export type Action = "create" | "read" | "update" | "delete" | "approve" | "export";

export type PermissionMatrix = Record<RoleType, Partial<Record<Resource, Action[]>>>;

const ALL: Action[] = ["create", "read", "update", "delete", "approve", "export"];
const RW: Action[] = ["create", "read", "update"];
const RO: Action[] = ["read"];
const RO_EXPORT: Action[] = ["read", "export"];

export const PERMISSIONS: PermissionMatrix = {
  SUPER_ADMIN: {
    masterData: ALL, project: ALL, proposal: ALL, scrutiny: ALL, parcel: ALL,
    notification: ALL, objection: ALL, grievance: ALL, award: ALL, compensation: ALL, payment: ALL,
    rnr: ALL, possession: ALL, document: ALL, dashboard: RO_EXPORT, report: ALL,
    alert: ALL, auditLog: RO_EXPORT, user: ALL, integration: ALL, mlPrediction: RO,
  },

  /**
   * NHAI, Railways, state PWDs — they ask for the land, and their project
   * implementation units build on it once possession is handed over.
   */
  LAND_REQUIRING_BODY: {
    project: RW, proposal: RW, parcel: RW, possession: RO, document: RW,
    dashboard: RO, report: RO_EXPORT, alert: RO, mlPrediction: RO,
  },

  /** Does the acquisition legwork on the ground. */
  LAND_ACQUIRING_AUTHORITY: {
    project: RO,
    proposal: ["read", "update"], scrutiny: RW, parcel: RW, notification: RW,
    // approve: the CALA is the competent authority that decides objections
    // under the NH Act s.3C — which Act applies is checked per case.
    objection: ["create", "read", "update", "approve"],
    grievance: ["read", "update", "approve"], award: RW, compensation: RW, document: RW,
    dashboard: RO, report: RO_EXPORT, alert: RO, mlPrediction: RO,
  },

  /** The pivotal role. */
  DISTRICT_COLLECTOR: {
    project: RO,
    proposal: ["read", "update", "approve"], scrutiny: ["create", "read", "update", "approve"],
    parcel: RW, notification: ["create", "read", "update", "approve"],
    // create: objections under LARR s.15 are filed AT the Collector's office,
    // so a walk-in objection is recorded by that office on the citizen's behalf.
    objection: ["create", "read", "update", "approve"],
    grievance: ["read", "update", "approve"], award: ["create", "read", "update", "approve"],
    compensation: ["create", "read", "update", "approve"], payment: ["create", "read", "update", "approve"],
    rnr: RW, possession: ["create", "read", "update", "approve"], document: RW,
    dashboard: RO_EXPORT, report: RO_EXPORT, alert: RO, auditLog: RO,
    // The officer who has to act on a risk score is the one who should see it.
    mlPrediction: RO,
  },

  STATE_GOVERNMENT: {
    masterData: ["read", "update"], project: RO, proposal: ["read", "approve"],
    scrutiny: RO, parcel: RO, notification: ["read", "approve"], objection: RO, grievance: RO,
    award: RO, compensation: RO, payment: RO, rnr: RO, possession: RO, document: RO,
    dashboard: RO_EXPORT, report: RO_EXPORT, alert: RO, auditLog: RO, mlPrediction: RO,
  },

  /** Line ministries and national policy advisers (NITI Aayog). */
  CENTRAL_MINISTRY: {
    masterData: RO, project: RO, proposal: ["read", "approve"], parcel: RO,
    notification: RO, objection: RO, grievance: RO, award: RO, compensation: RO, payment: RO, rnr: RO,
    possession: RO, document: RO, dashboard: RO_EXPORT, report: RO_EXPORT,
    alert: RO, auditLog: RO, integration: RO, mlPrediction: RO,
  },

  REHABILITATION_AUTHORITY: {
    proposal: RO, parcel: RO, rnr: ["create", "read", "update", "approve"],
    grievance: ["read", "update", "approve"],
    document: RW, dashboard: RO, report: RO_EXPORT, alert: RO,
  },

  /**
   * The citizen. Sees only their OWN land — enforced by ownership scoping in
   * scope.ts, not by this matrix alone.
   */
  LANDOWNER: {
    parcel: RO, notification: RO, objection: ["create", "read"], grievance: ["create", "read"],
    award: RO, compensation: RO, rnr: RO, document: RO,
  },
};

/** Does this role have this permission at all? Jurisdiction is checked separately. */
export function can(role: RoleType, resource: Resource, action: Action): boolean {
  return PERMISSIONS[role]?.[resource]?.includes(action) ?? false;
}

/** Everything a role may do — used to render the permission-matrix screen. */
export function permissionsFor(role: RoleType): Partial<Record<Resource, Action[]>> {
  return PERMISSIONS[role] ?? {};
}

export const ALL_RESOURCES: Resource[] = [
  "masterData", "project", "proposal", "scrutiny", "parcel", "notification",
  "objection", "grievance", "award", "compensation", "payment", "rnr", "possession",
  "document", "dashboard", "report", "alert", "auditLog", "user",
  "integration", "mlPrediction",
];
