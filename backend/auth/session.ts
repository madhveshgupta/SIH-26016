/** Session handling — signed JWT in an httpOnly cookie. */
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { JurisdictionLevel, RoleType } from "@prisma/client";
import type { Actor } from "@backend/rbac/scope";

export const SESSION_COOKIE = "bhoomi_session";
const SESSION_HOURS = 8; // one working day

function secret(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "NEXTAUTH_SECRET is missing or too short. Set it in .env (openssl rand -base64 32).",
    );
  }
  return new TextEncoder().encode(s);
}

export interface SessionClaims extends Actor {
  email: string;
  fullName: string;
  designation: string | null;
  mustChangePassword: boolean;
}

export async function createSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("bhoomi-nayan")
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export async function readSessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: "bhoomi-nayan" });
    // Narrow rather than trust: a token missing these is unusable downstream.
    if (!payload.id || !payload.role || !payload.jurisdictionLevel) return null;
    return {
      id: String(payload.id),
      email: String(payload.email ?? ""),
      fullName: String(payload.fullName ?? ""),
      designation: (payload.designation as string | null) ?? null,
      role: payload.role as RoleType,
      jurisdictionLevel: payload.jurisdictionLevel as JurisdictionLevel,
      stateId: (payload.stateId as string | null) ?? null,
      districtId: (payload.districtId as string | null) ?? null,
      tehsilId: (payload.tehsilId as string | null) ?? null,
      agencyId: (payload.agencyId as string | null) ?? null,
      ownerId: (payload.ownerId as string | null) ?? null,
      mustChangePassword: Boolean(payload.mustChangePassword),
    };
  } catch {
    // Expired, tampered, or signed with a different secret — all mean "no session".
    return null;
  }
}

/** The session for the current request, or null. Server components and route handlers. */
export async function getSession(): Promise<SessionClaims | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return token ? readSessionToken(token) : null;
}

/** The session, or throw. */
export async function requireSession(): Promise<SessionClaims> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHENTICATED");
  return s;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  };
}
