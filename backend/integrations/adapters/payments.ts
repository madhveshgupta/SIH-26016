/** Payments — a PFMS-style disbursement adapter. */
import { createHash } from "node:crypto";
import { callIntegration, modeFor, type CallResult } from "@backend/integrations/call";

export interface PaymentInstruction {
  /** Our own reference for this disbursement. */
  reference: string;
  amount: number;
  beneficiaryName: string;
  /** Masked before it reaches us; never log the full number. */
  accountMasked: string;
  ifsc: string;
  purpose: string;
}

export interface PaymentAck {
  utrNumber: string;
  status: "INSTRUCTED" | "PAID" | "FAILED";
  bank: string;
  failureReason: string | null;
  valueDate: string;
}

/** A stable pseudo-random number in [0,1) for a reference — same input, same outcome. */
function deterministicRandom(seed: string): number {
  const h = createHash("sha256").update(seed).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

/** UTRs are 16 characters: bank code, date and a sequence. */
function utrFor(reference: string): string {
  const h = createHash("sha256").update(`utr:${reference}`).digest("hex").toUpperCase();
  return `SBIN${new Date().toISOString().slice(2, 10).replaceAll("-", "")}${h.slice(0, 4)}`;
}

const FAILURES = [
  { reason: "Beneficiary account frozen at the bank", share: 0.04 },
  { reason: "Name in the land record does not match the bank account", share: 0.03 },
  { reason: "IFSC no longer valid — branch merged", share: 0.02 },
];

/** Send a payment instruction. */
export async function instructPayment(input: PaymentInstruction): Promise<CallResult<PaymentAck>> {
  return callIntegration<PaymentAck>({
    system: "PAYMENTS",
    endpoint: modeFor("PAYMENTS") === "live" ? `${process.env.PFMS_URL ?? ""}/v1/payments` : "mock://pfms/v1/payments",
    method: "POST",
    // Redacted: an integration log is not a place for bank details.
    request: { reference: input.reference, amount: input.amount, ifsc: input.ifsc, purpose: input.purpose },
    attempts: 3,
    run: async () => {
      if (modeFor("PAYMENTS") === "live") {
        throw new Error("PAYMENTS_MODE=live, but no PFMS credentials are configured");
      }
      // The mock behaves like a real gateway: latency, and a small share of
      // instructions that fail for reasons a clerk must then act on.
      await new Promise((r) => setTimeout(r, 60 + deterministicRandom(input.reference) * 140));
      if (input.amount <= 0) {
        throw Object.assign(new Error("Amount must be greater than zero"), { statusCode: 400 });
      }
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(input.ifsc)) {
        throw Object.assign(new Error(`IFSC ${input.ifsc} is not a valid code`), { statusCode: 400 });
      }

      const roll = deterministicRandom(`fail:${input.reference}`);
      let cumulative = 0;
      for (const f of FAILURES) {
        cumulative += f.share;
        if (roll < cumulative) {
          return {
            data: { utrNumber: utrFor(input.reference), status: "FAILED" as const, bank: input.ifsc.slice(0, 4), failureReason: f.reason, valueDate: new Date().toISOString().slice(0, 10) },
            statusCode: 200,
          };
        }
      }
      return {
        data: {
          utrNumber: utrFor(input.reference),
          status: "INSTRUCTED" as const,
          bank: input.ifsc.slice(0, 4),
          failureReason: null,
          valueDate: new Date().toISOString().slice(0, 10),
        },
        statusCode: 200,
      };
    },
    // A validation error will fail the same way every time; only transport is retried.
    retryable: (e) => !(e as { statusCode?: number })?.statusCode,
  });
}

/** Ask the gateway what happened to an instruction. */
export async function paymentStatus(reference: string, utrNumber: string): Promise<CallResult<PaymentAck>> {
  return callIntegration<PaymentAck>({
    system: "PAYMENTS",
    endpoint: modeFor("PAYMENTS") === "live" ? `${process.env.PFMS_URL ?? ""}/v1/payments/${utrNumber}` : `mock://pfms/v1/payments/${utrNumber}`,
    method: "GET",
    request: { reference, utrNumber },
    run: async () => {
      if (modeFor("PAYMENTS") === "live") throw new Error("PAYMENTS_MODE=live, but no PFMS credentials are configured");
      await new Promise((r) => setTimeout(r, 40));
      return {
        data: {
          utrNumber,
          status: "PAID" as const,
          bank: utrNumber.slice(0, 4),
          failureReason: null,
          valueDate: new Date().toISOString().slice(0, 10),
        },
        statusCode: 200,
      };
    },
  });
}
