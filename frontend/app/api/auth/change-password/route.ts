import { prisma } from "@backend/db/client";
import { getSession, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@backend/auth/session";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@backend/auth/password";
import { appendAudit } from "@backend/audit/chain";
import { apiJson } from "@backend/http/respond";

/** Change the signed-in user's password; clears the forced-change flag. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return await apiJson({ error: "Unauthenticated" }, { status: 401 });

  let current = "", next = "";
  try {
    const body = await req.json();
    current = String(body.currentPassword ?? "");
    next = String(body.newPassword ?? "");
  } catch {
    return await apiJson({ error: "Malformed request" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user || !(await verifyPassword(current, user.passwordHash))) {
    return await apiJson({ error: "Your current password is not correct.", field: "currentPassword" }, { status: 400 });
  }
  const policy = checkPasswordPolicy(next);
  if (!policy.ok) {
    return await apiJson({ error: "The new password does not meet the password rules.", field: "newPassword", problems: policy.problems }, { status: 400 });
  }
  if (await verifyPassword(next, user.passwordHash)) {
    return await apiJson({ error: "Choose a password different from the current one.", field: "newPassword" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), mustChangePassword: false },
  });
  await appendAudit({ actorId: user.id, action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id });

  const res = await apiJson({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken({ ...session, mustChangePassword: false }), sessionCookieOptions());
  return res;
}
