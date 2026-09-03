/**
 * The demo account directory — how the login page turns Role → State → District into exactly one
 * account.
 */
import type { RoleType } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { STATE_CODE } from "@backend/geo/state-codes";

export function stateAbbreviation(stateName: string): string {
  return STATE_CODE[stateName] ?? stateName.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
}

/** "North Goa" → "north-goa". */
export function slug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

/** How far down the Role → State → District picker a role goes. */
export type PickerDepth = "national" | "state" | "district";

export interface RoleCard {
  role: RoleType;
  label: string;
  description: string;
  depth: PickerDepth;
}

export const ROLE_CARDS: RoleCard[] = [
  { role: "DISTRICT_COLLECTOR", label: "District Collector", description: "Scrutiny, notifications, awards and possession for one district", depth: "district" },
  { role: "LAND_ACQUIRING_AUTHORITY", label: "Land Acquisition Authority", description: "Surveys, enquiries and compensation on the ground (CALA / LAO)", depth: "district" },
  { role: "STATE_GOVERNMENT", label: "State Government", description: "Approvals and oversight across the state", depth: "state" },
  { role: "REHABILITATION_AUTHORITY", label: "R&R Commissioner", description: "Affected families, entitlements and resettlement", depth: "state" },
  { role: "LAND_REQUIRING_BODY", label: "Land Requiring Body", description: "Projects, proposals and land handed over for construction — NHAI, RVNL and other agencies", depth: "national" },
  { role: "CENTRAL_MINISTRY", label: "Central Ministry", description: "National monitoring, approvals, analytics and the policy simulator", depth: "national" },
  { role: "LANDOWNER", label: "Landowner (Citizen)", description: "Your land, your compensation, your objections", depth: "district" },
  { role: "SUPER_ADMIN", label: "Administrator", description: "Master data, users and integrations", depth: "national" },
];

export interface DirectoryAccount {
  email: string;
  fullName: string;
  designation: string | null;
  role: RoleType;
  stateId: string | null;
  districtId: string | null;
}

export interface Directory {
  roles: RoleCard[];
  states: { id: string; name: string; code: string; districts: { id: string; name: string }[] }[];
  accounts: DirectoryAccount[];
}

/** Every active demo account, with the jurisdictions they resolve against. */
export async function demoDirectory(): Promise<Directory> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { email: true, fullName: true, designation: true, stateId: true, districtId: true, role: { select: { type: true } } },
    orderBy: { email: "asc" },
  });
  const districts = await prisma.district.findMany({
    where: { id: { in: users.map((u) => u.districtId).filter((x): x is string => Boolean(x)) } },
    select: { id: true, name: true, stateId: true },
    orderBy: { name: "asc" },
  });
  const stateIds = new Set([
    ...users.map((u) => u.stateId).filter((x): x is string => Boolean(x)),
    ...districts.map((d) => d.stateId),
  ]);
  const states = await prisma.state.findMany({ where: { id: { in: [...stateIds] } }, orderBy: { name: "asc" } });

  return {
    roles: ROLE_CARDS,
    states: states.map((s) => ({
      id: s.id,
      name: s.name,
      code: stateAbbreviation(s.name),
      districts: districts.filter((d) => d.stateId === s.id).map((d) => ({ id: d.id, name: d.name })),
    })),
    accounts: users.map((u) => ({
      email: u.email,
      fullName: u.fullName,
      designation: u.designation,
      role: u.role.type,
      stateId: u.stateId,
      districtId: u.districtId,
    })),
  };
}
