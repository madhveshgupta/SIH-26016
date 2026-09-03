import { prisma } from "@backend/db/client";
import { attemptLogin, maskDestination } from "@backend/auth/login";
import { issueChallenge, CHALLENGE_COOKIE, challengeCookieOptions } from "@backend/auth/challenge";
import { isDemoMode } from "@backend/auth/otp";
import { appendAudit } from "@backend/audit/chain";
import { clientAddress, LIMITS, rateLimit } from "@backend/security/rate-limit";
import { apiJson } from "@backend/http/respond";

/** Step 1 of 2: password. */
export async function POST(req: Request) {
  let email = "";
  let password = "";
  try {
    const body = await req.json();
    email = String(body.email ?? "");
    password = String(body.password ?? "");
  } catch {
    return await apiJson({ error: "Malformed request" }, { status: 400 });
  }
  if (!email || !password) {
    return await apiJson({ error: "Email and password are required" }, { status: 400 });
  }

  // Credential stuffing is the attack here: limit the address AND the account,
  // so neither one machine trying many accounts nor many machines trying one
  // account gets an unlimited number of guesses.
  const address = clientAddress(req);
  const keys = [`login:account:${email.toLowerCase()}`];
  // Only limit by address when the deployment actually tells us one.
  if (address) keys.unshift(`login:ip:${address}`);
  for (const key of keys) {
    const limit = rateLimit(key, LIMITS.login);
    if (!limit.ok) {
      return await apiJson(
        { error: "Too many sign-in attempts. Wait a minute and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }
  }

  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent");
  const result = await attemptLogin(email, password, { ipAddress, userAgent });

  if (!result.ok) {
    const message =
      result.reason === "account_locked"
        ? "Account locked after repeated failed attempts. Try again in 15 minutes."
        : result.reason === "account_inactive"
          ? "This account is inactive. Contact your administrator."
          : "Incorrect email or password.";
    return await apiJson(
      { error: message, attemptsRemaining: result.attemptsRemaining },
      { status: result.reason === "account_locked" ? 423 : 401 },
    );
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: result.actor.id }, select: { phone: true, email: true } });
  const { token, code } = await issueChallenge(result.actor.id);
  const destination = maskDestination(user);
  await appendAudit({
    actorId: result.actor.id,
    action: "OTP_SENT",
    entityType: "User",
    entityId: result.actor.id,
    afterJson: { destination },
    ipAddress,
    userAgent,
  });

  const res = await apiJson({
    ok: true,
    otpRequired: true,
    destination,
    fullName: result.fullName,
    ...(isDemoMode() ? { demoCode: code } : {}),
  });
  res.cookies.set(CHALLENGE_COOKIE, token, challengeCookieOptions());
  return res;
}
