/** The pending second factor between "password correct" and "signed in". */
import { SignJWT, jwtVerify } from "jose";
import { createOtpChallenge, verifyOtp, OTP_TTL_SECONDS, type OtpResult } from "@backend/auth/otp";

export const CHALLENGE_COOKIE = "bhoomi_otp";

function secret(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s || s.length < 16) throw new Error("NEXTAUTH_SECRET is missing or too short.");
  return new TextEncoder().encode(s);
}

interface ChallengeClaims {
  userId: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

async function sign(c: ChallengeClaims): Promise<string> {
  return new SignJWT({ ...c })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("bhoomi-nayan/otp")
    .setExpirationTime(`${OTP_TTL_SECONDS}s`)
    .sign(secret());
}

/** Start a challenge for a user whose password has just been verified. */
export async function issueChallenge(userId: string): Promise<{ token: string; code: string }> {
  const { challenge, code } = createOtpChallenge();
  const token = await sign({
    userId,
    codeHash: challenge.codeHash,
    expiresAt: challenge.expiresAt.getTime(),
    attempts: 0,
  });
  return { token, code };
}

export type ChallengeOutcome =
  | { result: "valid"; userId: string }
  | { result: Exclude<OtpResult, "valid"> | "no_challenge"; userId: string | null; retryToken: string | null };

/** Check a submitted code. On a wrong code, returns a new token with the attempt counted. */
export async function checkChallenge(token: string | undefined, code: string): Promise<ChallengeOutcome> {
  if (!token) return { result: "no_challenge", userId: null, retryToken: null };
  let claims: ChallengeClaims;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: "bhoomi-nayan/otp" });
    claims = payload as unknown as ChallengeClaims;
  } catch {
    return { result: "expired", userId: null, retryToken: null };
  }
  const result = verifyOtp(
    { codeHash: claims.codeHash, expiresAt: new Date(claims.expiresAt), attempts: claims.attempts },
    code.trim(),
  );
  if (result === "valid") return { result, userId: claims.userId };
  const retryToken = result === "invalid" ? await sign({ ...claims, attempts: claims.attempts + 1 }) : null;
  return { result, userId: claims.userId, retryToken };
}

export function challengeCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: OTP_TTL_SECONDS,
  };
}
