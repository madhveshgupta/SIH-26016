/** The login flow. */
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import {
  verifyPassword,
  isLocked,
  lockoutUntil,
  MAX_FAILED_ATTEMPTS,
} from "@backend/auth/password";
import type { Actor } from "@backend/rbac/scope";

export type LoginFailure =
  | "invalid_credentials"
  | "account_locked"
  | "account_inactive";

export interface LoginContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface LoginSuccess {
  ok: true;
  actor: Actor;
  fullName: string;
  email: string;
  /** e.g. "District Collector, Agra" — shown in the header so an officer's
   *  authority is visible alongside their jurisdiction. */
  designation: string | null;
  mustChangePassword: boolean;
}

export interface LoginRejected {
  ok: false;
  reason: LoginFailure;
  /** Populated when the reason is account_locked. */
  lockedUntil?: Date | null;
  attemptsRemaining?: number;
}

export type LoginResult = LoginSuccess | LoginRejected;

/** Verify credentials. */
export async function attemptLogin(
  email: string,
  password: string,
  ctx: LoginContext = {},
): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { role: true, ownerProfile: { select: { id: true } } },
  });

  if (!user) {
    // Still audit it: repeated attempts against non-existent accounts are a
    // signal in their own right.
    await appendAudit({
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: "unknown",
      afterJson: { email, reason: "no_such_user" },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return { ok: false, reason: "invalid_credentials" };
  }

  if (isLocked(user.lockedUntil)) {
    await appendAudit({
      actorId: user.id,
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      afterJson: { reason: "account_locked", lockedUntil: user.lockedUntil },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return { ok: false, reason: "account_locked", lockedUntil: user.lockedUntil };
  }

  if (!user.isActive) {
    await appendAudit({
      actorId: user.id,
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      afterJson: { reason: "account_inactive" },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return { ok: false, reason: "account_inactive" };
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);

  if (!passwordOk) {
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: shouldLock ? lockoutUntil() : null,
      },
    });
    await appendAudit({
      actorId: user.id,
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      afterJson: { reason: "bad_password", attempts, locked: shouldLock },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return shouldLock
      ? { ok: false, reason: "account_locked", lockedUntil: lockoutUntil() }
      : { ok: false, reason: "invalid_credentials", attemptsRemaining: MAX_FAILED_ATTEMPTS - attempts };
  }

  // Success — clear the failure counter.
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await appendAudit({
    actorId: user.id,
    action: "LOGIN",
    entityType: "User",
    entityId: user.id,
    afterJson: { role: user.role.type, jurisdiction: user.jurisdictionLevel },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return {
    ok: true,
    fullName: user.fullName,
    email: user.email,
    designation: user.designation,
    mustChangePassword: user.mustChangePassword,
    actor: {
      id: user.id,
      role: user.role.type,
      jurisdictionLevel: user.jurisdictionLevel,
      stateId: user.stateId,
      districtId: user.districtId,
      tehsilId: user.tehsilId,
      agencyId: user.agencyId,
      ownerId: user.ownerProfile?.id ?? null,
    },
  };
}

/** Session claims for a user, re-read from the database. */
export async function sessionClaimsFor(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true, ownerProfile: { select: { id: true } } },
  });
  if (!user || !user.isActive || isLocked(user.lockedUntil)) return null;
  return {
    id: user.id,
    role: user.role.type,
    jurisdictionLevel: user.jurisdictionLevel,
    stateId: user.stateId,
    districtId: user.districtId,
    tehsilId: user.tehsilId,
    agencyId: user.agencyId,
    ownerId: user.ownerProfile?.id ?? null,
    email: user.email,
    fullName: user.fullName,
    designation: user.designation,
    mustChangePassword: user.mustChangePassword,
  };
}

/** "+919812345678" → "+91 ••••• ••678"; an email → "c••••••@bhoominayan.gov.in". */
export function maskDestination(user: { phone: string | null; email: string }): string {
  if (user.phone) return `${user.phone.slice(0, 3)} ••••• ••${user.phone.slice(-3)}`;
  const [local, domain] = user.email.split("@");
  return `${local[0]}${"•".repeat(Math.max(3, local.length - 1))}@${domain}`;
}
