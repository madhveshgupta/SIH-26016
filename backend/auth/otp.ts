/** OTP second factor. */
import { createHash, randomInt } from "node:crypto";

export const OTP_TTL_SECONDS = 300; // 5 minutes
export const OTP_LENGTH = 6;
export const MAX_OTP_ATTEMPTS = 3;

export interface OtpChallenge {
  /** SHA-256 of the code. The plaintext code is never stored. */
  codeHash: string;
  expiresAt: Date;
  attempts: number;
}

export function isDemoMode(): boolean {
  return (process.env.SMS_MODE ?? "mock") === "mock";
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Generate a challenge.
 * @returns the challenge to store, plus the plaintext code — which the caller
 *          may only surface to the user in demo mode.
 */
export function createOtpChallenge(): { challenge: OtpChallenge; code: string } {
  // randomInt is CSPRNG-backed; Math.random would be predictable.
  const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
  return {
    code,
    challenge: {
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      attempts: 0,
    },
  };
}

export type OtpResult = "valid" | "invalid" | "expired" | "too_many_attempts";

export function verifyOtp(challenge: OtpChallenge, submitted: string): OtpResult {
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) return "too_many_attempts";
  if (challenge.expiresAt.getTime() < Date.now()) return "expired";
  // Compare hashes, not plaintext — the stored value is a hash by design.
  return hashCode(submitted) === challenge.codeHash ? "valid" : "invalid";
}
