import { clientAddress, LIMITS, rateLimit } from "@backend/security/rate-limit";
import { cookies } from "next/headers";
import { checkChallenge, CHALLENGE_COOKIE, challengeCookieOptions } from "@backend/auth/challenge";
import { sessionClaimsFor } from "@backend/auth/login";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@backend/auth/session";
import { appendAudit } from "@backend/audit/chain";
import { apiJson } from "@backend/http/respond";

/** Step 2 of 2: the one-time code. Only now is a session issued. */
export async function POST(req: Request) {
  // A six-digit code is only strong if it cannot be guessed a thousand times.
  const address = clientAddress(req);
  const limit = rateLimit(`otp:${address ?? "unattributed"}`, address ? LIMITS.otp : { max: 60, windowSeconds: 60 });
  if (!limit.ok) {
    return await apiJson(
      { error: "Too many attempts. Wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let code = "";
  try {
    code = String((await req.json()).code ?? "");
  } catch {
    return await apiJson({ error: "Malformed request" }, { status: 400 });
  }
  const jar = await cookies();
  const outcome = await checkChallenge(jar.get(CHALLENGE_COOKIE)?.value, code);

  if (outcome.result !== "valid") {
    if (outcome.userId) {
      await appendAudit({
        actorId: outcome.userId,
        action: "OTP_FAILED",
        entityType: "User",
        entityId: outcome.userId,
        afterJson: { reason: outcome.result },
      });
    }
    const message = {
      invalid: "That code is not correct.",
      expired: "The code has expired. Sign in again to get a new one.",
      too_many_attempts: "Too many wrong codes. Sign in again to get a new one.",
      no_challenge: "Sign in with your password first.",
    }[outcome.result];
    const res = await apiJson({ error: message, restart: outcome.result !== "invalid" }, { status: 401 });
    if (outcome.retryToken) res.cookies.set(CHALLENGE_COOKIE, outcome.retryToken, challengeCookieOptions());
    else res.cookies.set(CHALLENGE_COOKIE, "", { path: "/api/auth", maxAge: 0 });
    return res;
  }

  const claims = await sessionClaimsFor(outcome.userId);
  if (!claims) {
    return await apiJson({ error: "This account can no longer sign in.", restart: true }, { status: 403 });
  }

  const res = await apiJson({
    ok: true,
    role: claims.role,
    mustChangePassword: claims.mustChangePassword,
    home: claims.role === "LANDOWNER" ? "/my-land" : "/dashboard",
  });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(claims), sessionCookieOptions());
  res.cookies.set(CHALLENGE_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  return res;
}
