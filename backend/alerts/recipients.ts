/** Who an alert goes to. */
import type { RoleType } from "@prisma/client";
import { prisma } from "@backend/db/client";

export interface Geography {
  stateIds: string[];
  districtIds: string[];
  /** The agency that owns the project — requiring bodies see only their own. */
  agencyId?: string | null;
}

export interface Recipient {
  id: string;
  email: string;
  phone: string | null;
}

/** Roles that see cases by agency rather than by geography (scope.ts agrees). */
const BY_AGENCY: RoleType[] = ["LAND_REQUIRING_BODY"];

/** One rung up. */
export const SUPERIOR: Partial<Record<RoleType, RoleType>> = {
  LAND_ACQUIRING_AUTHORITY: "DISTRICT_COLLECTOR",
  REHABILITATION_AUTHORITY: "DISTRICT_COLLECTOR",
  DISTRICT_COLLECTOR: "STATE_GOVERNMENT",
  STATE_GOVERNMENT: "CENTRAL_MINISTRY",
};

/** Active officers of `role` whose jurisdiction covers `geo`. */
export async function officersFor(role: RoleType, geo: Geography): Promise<Recipient[]> {
  if (role === "SUPER_ADMIN" || role === "LANDOWNER") return [];

  let where: Record<string, unknown>;
  if (BY_AGENCY.includes(role)) {
    if (!geo.agencyId) return [];
    where = { agencyId: geo.agencyId };
  } else {
    where = {
      OR: [
        { jurisdictionLevel: "NATIONAL" },
        ...(geo.stateIds.length ? [{ jurisdictionLevel: "STATE", stateId: { in: geo.stateIds } }] : []),
        ...(geo.districtIds.length
          ? [{ jurisdictionLevel: { in: ["DISTRICT", "TEHSIL", "VILLAGE"] }, districtId: { in: geo.districtIds } }]
          : []),
      ],
    };
  }

  return prisma.user.findMany({
    where: { isActive: true, role: { type: role }, ...where },
    select: { id: true, email: true, phone: true },
  });
}

/** Memoised within one sweep, so fifty cases in a district cost one query. */
export function recipientCache() {
  const memo = new Map<string, Promise<Recipient[]>>();
  return (role: RoleType, geo: Geography) => {
    const key = `${role}|${[...geo.stateIds].sort()}|${[...geo.districtIds].sort()}|${geo.agencyId ?? ""}`;
    let hit = memo.get(key);
    if (!hit) {
      hit = officersFor(role, geo);
      memo.set(key, hit);
    }
    return hit;
  };
}
