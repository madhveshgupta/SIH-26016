/** Notification services — SMS, email and push. */
import { createHash } from "node:crypto";
import type { IntegrationSystem } from "@prisma/client";
import { callIntegration, modeFor, type CallResult } from "@backend/integrations/call";

export type Channel = "SMS" | "EMAIL" | "PUSH";

export interface Message {
  channel: Channel;
  /** Mobile number, email address or device token. */
  to: string;
  /** Kept short: an SMS is 160 characters, and rural handsets are not smartphones. */
  body: string;
  /** Subject, email only. */
  subject?: string;
  /** What this is about, for the log. */
  about: string;
}

export interface Receipt {
  messageId: string;
  channel: Channel;
  acceptedAt: string;
  /** SMS is billed per 160-character segment. */
  segments: number;
}

const SYSTEM: Record<Channel, IntegrationSystem> = { SMS: "SMS_GATEWAY", EMAIL: "EMAIL", PUSH: "SMS_GATEWAY" };

/** Never put a citizen's contact details in a log; show enough to trace it. */
function maskDestination(to: string): string {
  if (to.includes("@")) {
    const [user, domain] = to.split("@");
    return `${user.slice(0, 1)}${"•".repeat(Math.max(2, user.length - 1))}@${domain}`;
  }
  return `${to.slice(0, 3)}•••••${to.slice(-2)}`;
}

export async function sendMessage(msg: Message): Promise<CallResult<Receipt>> {
  const system = SYSTEM[msg.channel];
  return callIntegration<Receipt>({
    system,
    endpoint: modeFor(system) === "live" ? `${process.env.SMS_URL ?? ""}/v1/send` : `mock://${msg.channel.toLowerCase()}/v1/send`,
    method: "POST",
    request: { to: maskDestination(msg.to), about: msg.about, characters: msg.body.length },
    attempts: 2,
    run: async () => {
      if (modeFor(system) === "live") throw new Error(`${msg.channel} is set to live, but no gateway credentials are configured`);
      await new Promise((r) => setTimeout(r, 30));
      const valid =
        msg.channel === "EMAIL" ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(msg.to) : /^(\+91)?[6-9]\d{9}$/.test(msg.to.replace(/\s/g, ""));
      if (!valid) throw Object.assign(new Error(`${msg.channel} destination ${maskDestination(msg.to)} is not valid`), { statusCode: 400 });
      if (!msg.body.trim()) throw Object.assign(new Error("Refusing to send an empty message"), { statusCode: 400 });
      return {
        data: {
          messageId: createHash("sha256").update(`${msg.to}:${msg.body}:${Date.now()}`).digest("hex").slice(0, 16),
          channel: msg.channel,
          acceptedAt: new Date().toISOString(),
          segments: Math.ceil(msg.body.length / 160),
        },
        statusCode: 202,
      };
    },
    retryable: (e) => !(e as { statusCode?: number })?.statusCode,
  });
}
