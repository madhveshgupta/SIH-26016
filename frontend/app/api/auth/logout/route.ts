import { getSession, SESSION_COOKIE } from "@backend/auth/session";
import { appendAudit } from "@backend/audit/chain";
import { apiJson } from "@backend/http/respond";

export async function POST() {
  const session = await getSession();
  if (session) {
    await appendAudit({
      actorId: session.id,
      action: "LOGOUT",
      entityType: "User",
      entityId: session.id,
    });
  }
  const res = await apiJson({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
