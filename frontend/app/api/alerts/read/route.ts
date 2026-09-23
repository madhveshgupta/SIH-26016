import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { apiJson } from "@backend/http/respond";

/** Mark one alert (or all of the caller's alerts) as read. Only your own. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const where = body.all ? { recipientId: s.id, isRead: false } : { id: String(body.id ?? ""), recipientId: s.id };
  const { count } = await prisma.alert.updateMany({ where, data: { isRead: true, readAt: new Date() } });
  return await apiJson({ ok: true, count });
}
