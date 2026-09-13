import type { NotificationType } from "@prisma/client";
import { getSession } from "@backend/auth/session";
import { prisma } from "@backend/db/client";
import { can } from "@backend/rbac/permissions";
import { scopeForProposal } from "@backend/rbac/scope";
import { issueFromDesk, NOTIFICATION_LABEL, PUBLICATION_CHANNELS, type ChannelKey } from "@backend/statutory/notifications";
import { apiError, id as cleanId, text } from "@backend/validation/request";
import { apiJson } from "@backend/http/respond";

const CHANNEL_KEYS = new Set<string>(PUBLICATION_CHANNELS.map((c) => c.key));

/** Issue a statutory notification for a case in the caller's jurisdiction. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return await apiJson({ error: "Unauthenticated" }, { status: 401 });
  if (!can(s.role, "notification", "create")) return await apiJson({ error: "Not permitted" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const proposalId = cleanId(body?.proposalId);
  if (!proposalId) return await apiJson({ error: "Choose a case" }, { status: 400 });
  const inScope = await prisma.proposal.count({ where: { AND: [{ id: proposalId }, scopeForProposal(s)] } });
  if (!inScope) return await apiJson({ error: "Case not found" }, { status: 404 });

  const type = typeof body?.type === "string" && body.type in NOTIFICATION_LABEL ? (body.type as NotificationType) : null;
  if (!type) return await apiJson({ error: "Choose the notification to issue" }, { status: 400 });

  // A calendar day, as printed on the notification.
  const day = typeof body?.issuedOn === "string" ? body.issuedOn.trim() : "";
  const issuedOn = new Date(`${day}T10:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(issuedOn.getTime()) || issuedOn.getUTCFullYear() < 2000) {
    return await apiJson({ error: "Give the date of issue as YYYY-MM-DD" }, { status: 400 });
  }

  const gazetteRef = body?.gazetteRef == null || body.gazetteRef === "" ? null : text(body.gazetteRef, { max: 80 });
  if (body?.gazetteRef && !gazetteRef) return await apiJson({ error: "The gazette number is not valid" }, { status: 400 });

  const channels = Array.isArray(body?.channels) ? body.channels.filter((c: unknown) => typeof c === "string" && CHANNEL_KEYS.has(c)) : [];

  try {
    const result = await issueFromDesk({
      proposalId,
      type,
      issuedOn,
      gazetteRef,
      publish: body?.publish === true,
      channels: channels as ChannelKey[],
      advance: body?.advance !== false,
      actorId: s.id,
      actorRole: s.role,
    });
    return await apiJson({ ok: true, ...result });
  } catch (e) {
    const { status, error } = apiError(e, "issue notification");
    return await apiJson({ error }, { status });
  }
}
