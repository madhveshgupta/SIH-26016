/** THE ALERT SWEEP — run hourly from cron (`npm run alerts:run`). */
import { Prisma, type AlertChannel, type AlertSeverity } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import { sendMessage } from "@backend/integrations/adapters/notify";
import { recipientCache, type Recipient } from "./recipients";
import { pendingBeyondSla, statutoryDeadlines } from "./rules/cases";
import { compensationUnpaid, paymentFailed, possessionBeforePayment } from "./rules/money";
import { milestonesOverdue } from "./rules/milestones";
import type { Finding, Rule } from "./rules/types";

export const RULES: Record<string, Rule> = {
  statutoryDeadlines,
  pendingBeyondSla,
  compensationUnpaid,
  paymentFailed,
  possessionBeforePayment,
  milestonesOverdue,
};

/** Louder alerts go by louder channels. SMS is kept for what cannot wait. */
function channelsFor(severity: AlertSeverity): AlertChannel[] {
  if (severity === "CRITICAL" || severity === "STATUTORY_LAPSE_RISK") return ["IN_APP", "EMAIL", "SMS"];
  if (severity === "WARNING") return ["IN_APP", "EMAIL"];
  return ["IN_APP"];
}

export interface SweepResult {
  findings: number;
  created: number;
  escalations: number;
  alreadySent: number;
  delivered: number;
  deliveryFailures: number;
  byType: Record<string, number>;
  ms: number;
}

interface Created {
  id: string;
  recipient: Recipient;
  finding: Finding;
  channels: AlertChannel[];
}

/** Create unless this person already has this key. */
async function raise(
  sent: Set<string>,
  finding: Finding,
  recipient: Recipient,
  key: string,
  escalation: { fromId: string | null } | null,
): Promise<Created | null> {
  if (sent.has(`${recipient.id}|${key}`)) return null;
  const channels = channelsFor(finding.severity);
  try {
    const a = await prisma.alert.create({
      data: {
        type: escalation ? `${finding.type}_ESCALATED` : finding.type,
        severity: finding.severity,
        title: escalation ? `Escalated — ${finding.title}` : finding.title,
        message: finding.message,
        proposalId: finding.proposalId,
        recipientId: recipient.id,
        channels,
        dedupeKey: key,
        escalatedFromId: escalation?.fromId ?? null,
      },
      select: { id: true },
    });
    return { id: a.id, recipient, finding, channels };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

/** Email and SMS for the new alerts, a few at a time. */
async function deliver(items: Created[]): Promise<{ delivered: number; failures: number }> {
  let delivered = 0;
  let failures = 0;
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const sends: Promise<{ ok: boolean }>[] = [];
      const { recipient, finding, channels } = item;
      if (channels.includes("EMAIL") && recipient.email) {
        sends.push(sendMessage({ channel: "EMAIL", to: recipient.email, subject: finding.title, body: finding.message, about: `alert ${finding.type}` }));
      }
      if (channels.includes("SMS") && recipient.phone) {
        const sms = `Bhoomi Nayan: ${finding.title}`;
        sends.push(sendMessage({ channel: "SMS", to: recipient.phone, body: sms.length > 160 ? `${sms.slice(0, 157)}...` : sms, about: `alert ${finding.type}` }));
      }
      const results = await Promise.all(sends);
      const ok = results.filter((r) => r.ok).length;
      delivered += ok;
      failures += results.length - ok;
      // Delivered means every outside channel we tried accepted it.
      if (results.length > 0 && ok === results.length) {
        await prisma.alert.update({ where: { id: item.id }, data: { deliveredAt: new Date() } });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { delivered, failures };
}

export async function runAlertSweep(opts: { now?: Date; actorId?: string | null; deliver?: boolean } = {}): Promise<SweepResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const officers = recipientCache();

  const findings = (await Promise.all(Object.values(RULES).map((rule) => rule(now)))).flat();
  const keys = findings.flatMap((f) => [f.key, `${f.key}:ESC`]);
  const sent = new Set(
    (await prisma.alert.findMany({ where: { dedupeKey: { in: keys } }, select: { recipientId: true, dedupeKey: true } })).map(
      (a) => `${a.recipientId}|${a.dedupeKey}`,
    ),
  );

  const created: Created[] = [];
  let escalations = 0;
  let alreadySent = 0;
  const byType: Record<string, number> = {};

  for (const f of findings) {
    const holders = new Map<string, Recipient>();
    for (const role of f.to) for (const r of await officers(role, f.geo)) holders.set(r.id, r);

    let firstId: string | null = null;
    for (const r of holders.values()) {
      const a = await raise(sent, f, r, f.key, null);
      if (!a) { alreadySent++; continue; }
      created.push(a);
      firstId ??= a.id;
      byType[f.type] = (byType[f.type] ?? 0) + 1;
    }

    if (f.escalateTo) {
      // Point the escalation at the alert it escalates, when this run raised
      // one; on a later run the original is already on the officer's desk.
      firstId ??=
        (await prisma.alert.findFirst({ where: { dedupeKey: f.key, recipientId: { in: [...holders.keys()] } }, select: { id: true } }))?.id ??
        null;
      for (const r of await officers(f.escalateTo, f.geo)) {
        if (holders.has(r.id)) continue;
        // No original when nobody holds that desk — which is itself the
        // reason the superior needs to know.
        const a = await raise(sent, f, r, `${f.key}:ESC`, { fromId: firstId });
        if (!a) { alreadySent++; continue; }
        created.push(a);
        escalations++;
      }
    }
  }

  const delivery = opts.deliver === false ? { delivered: 0, failures: 0 } : await deliver(created);

  const result: SweepResult = {
    findings: findings.length,
    created: created.length,
    escalations,
    alreadySent,
    delivered: delivery.delivered,
    deliveryFailures: delivery.failures,
    byType,
    ms: Date.now() - started,
  };

  if (created.length > 0 || opts.actorId) {
    await appendAudit({
      actorId: opts.actorId ?? null,
      action: "CREATE",
      entityType: "AlertSweep",
      entityId: now.toISOString(),
      afterJson: { ...result },
    });
  }
  return result;
}
