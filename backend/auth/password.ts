/** Password hashing and the account-lockout policy. */
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

/** Failed attempts before the account locks. */
export const MAX_FAILED_ATTEMPTS = 5;
/** How long a locked account stays locked. */
export const LOCKOUT_MINUTES = 15;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface PasswordPolicyResult {
  ok: boolean;
  problems: string[];
}

/** Government password policy. */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const problems: string[] = [];
  if (password.length < 12) problems.push("must be at least 12 characters");
  if (!/[a-z]/.test(password)) problems.push("must contain a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("must contain an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("must contain a digit");
  if (!/[^A-Za-z0-9]/.test(password)) problems.push("must contain a symbol");
  if (/^(?:password|admin|welcome|bhoomi|bhumi|nayan)/i.test(password)) {
    problems.push("must not start with a common word");
  }
  return { ok: problems.length === 0, problems };
}

export function lockoutUntil(): Date {
  return new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
}

export function isLocked(lockedUntil: Date | null): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > Date.now();
}
