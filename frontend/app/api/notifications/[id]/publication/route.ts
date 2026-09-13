import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForProposal } from "@backend/rbac/scope";
import { PUBLICATION_CHANNELS, recordPublication, type ChannelKey } from "@backend/statutory/notifications";
import { apiError, id as cleanId } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

const CHANNEL_KEYS = new Set<string>(PUBLICATION_CHANNELS.map((c) => c.key));

/** Record that a notification has now appeared in more of the required channels. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "notification", "update")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const id = cleanId((await params).id);
  const inScope = id ? await prisma.notification.count({ where: { id, proposal: { AND: [scopeForProposal(s)] } } }) : 0;
  if (!id || !inScope) return await apiJson({ error: "Notification not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const channels = Array.isArray(body?.channels) ? body.channels.filter((c: unknown) => typeof c === "string" && CHANNEL_KEYS.has(c)) : [];
  if (channels.length === 0) return await apiJson({ error: "Tick at least one channel" }, { status: 400 });

  try {
    const { status } = await recordPublication(id, channels as ChannelKey[], s.id);
    return await apiJson({ ok: true, status });
  } catch (e) {
    const { status, error } = apiError(e, "record publication");
    return await apiJson({ error }, { status });
  }
}
