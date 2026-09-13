/** e-Gazette — publishing a statutory notification. */
import { createHash } from "node:crypto";
import { callIntegration, modeFor, type CallResult } from "@backend/integrations/call";

export interface GazetteRequest {
  /** Our notification reference, used as the idempotency key. */
  reference: string;
  title: string;
  /** e.g. "SEC_11_PRELIMINARY". */
  notificationType: string;
  stateCode: string;
  issuedOn: Date;
}

export interface GazetteReceipt {
  gazetteRef: string;
  partAndSection: string;
  publishedOn: string;
  url: string;
}

export async function publishToGazette(input: GazetteRequest): Promise<CallResult<GazetteReceipt>> {
  return callIntegration<GazetteReceipt>({
    system: "E_GAZETTE",
    endpoint: modeFor("E_GAZETTE") === "live" ? `${process.env.EGAZETTE_URL ?? ""}/v1/publish` : "mock://egazette/v1/publish",
    method: "POST",
    stateCode: input.stateCode,
    request: { reference: input.reference, notificationType: input.notificationType, issuedOn: input.issuedOn },
    attempts: 3,
    run: async () => {
      if (modeFor("E_GAZETTE") === "live") throw new Error("EGAZETTE_MODE=live, but no e-Gazette credentials are configured");
      await new Promise((r) => setTimeout(r, 70));
      const serial = createHash("sha256").update(input.reference).digest("hex").slice(0, 6).toUpperCase();
      const year = input.issuedOn.getFullYear();
      // Land acquisition notifications run in Part II, Section 3, sub-section (ii).
      return {
        data: {
          gazetteRef: `CG-DL-E-${serial}-${year}`,
          partAndSection: "Part II — Section 3 — Sub-section (ii)",
          publishedOn: input.issuedOn.toISOString().slice(0, 10),
          url: `https://egazette.gov.in/WriteReadData/${year}/${serial}.pdf`,
        },
        statusCode: 201,
      };
    },
  });
}
