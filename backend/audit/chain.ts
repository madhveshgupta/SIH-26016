/** Tamper-evident audit chain. */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/client";

export interface AuditEntry {
  actorId?: string | null;
  action:
    | "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT" | "VIEW" | "DOWNLOAD" | "LOGIN_FAILED"
    | "OTP_SENT" | "OTP_FAILED" | "PASSWORD_CHANGED";
  entityType: string;
  entityId: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The genesis value for the first record in an empty chain. */
export const GENESIS_HASH = "0".repeat(64);

/** Canonical JSON: keys sorted at every level. */
export function canonicalize(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Date) return v.toISOString();
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = walk((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  };
  return JSON.stringify(walk(value));
}

/** The exact fields that go into a record's hash. Changing this breaks all existing chains. */
export function hashPayload(input: {
  prevHash: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: Date;
}): string {
  const canonical = canonicalize({
    prevHash: input.prevHash,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
    createdAt: input.createdAt.toISOString(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Append one record to the chain. */
/** Postgres codes for "you lost a race, try again": a serialization failure and a deadlock. */
function isRetryableConflict(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return e.code === "P2034" || /write conflict|deadlock|could not serialize/i.test(e.message);
}

/** Append one record, retrying when a concurrent write wins the race. */
export async function appendAudit(entry: AuditEntry, attempts = 8): Promise<{ id: string; hash: string }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await appendOnce(entry);
    } catch (e) {
      if (!isRetryableConflict(e) || attempt >= attempts) throw e;
      // Backoff with jitter, so the losers do not collide again together.
      await new Promise((r) => setTimeout(r, 10 * attempt + Math.random() * 40));
    }
  }
}

function appendOnce(entry: AuditEntry): Promise<{ id: string; hash: string }> {
  return prisma.$transaction(
    async (tx) => {
      const prev = await tx.auditLog.findFirst({
        orderBy: { sequence: "desc" },
        select: { hash: true },
      });
      const prevHash = prev?.hash ?? GENESIS_HASH;
      const createdAt = new Date();

      const hash = hashPayload({
        prevHash,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        beforeJson: entry.beforeJson ?? null,
        afterJson: entry.afterJson ?? null,
        createdAt,
      });

      const row = await tx.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          beforeJson: (entry.beforeJson ?? undefined) as never,
          afterJson: (entry.afterJson ?? undefined) as never,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
          prevHash,
          hash,
          createdAt,
        },
        select: { id: true, hash: true },
      });
      return row;
    },
    { isolationLevel: "Serializable" },
  );
}

export interface VerificationResult {
  intact: boolean;
  recordsChecked: number;
  /** Position of the first bad record, 1-based. Null when the chain is intact. */
  brokenAtSequence: bigint | null;
  brokenAtId: string | null;
  reason: string | null;
  /** The same failure as a code, for screens that word it in the viewer's language. */
  reasonCode: "outOfOrder" | "prevHash" | "altered" | null;
}

/** Walk the whole chain and re-derive every hash. */
export async function verifyChain(limit?: number): Promise<VerificationResult> {
  const rows = await prisma.auditLog.findMany({
    orderBy: { sequence: "asc" },
    ...(limit ? { take: limit } : {}),
  });

  let expectedPrev = GENESIS_HASH;
  let previousSequence: bigint | null = null;

  for (const r of rows) {
    // Sequence must ADVANCE, but need not be contiguous.
    if (previousSequence !== null && r.sequence <= previousSequence) {
      return {
        intact: false,
        recordsChecked: rows.length,
        brokenAtSequence: r.sequence,
        brokenAtId: r.id,
        reason: `records are out of order — ${r.sequence} follows ${previousSequence}`,
        reasonCode: "outOfOrder",
      };
    }
    if (r.prevHash !== expectedPrev) {
      return {
        intact: false,
        recordsChecked: rows.length,
        brokenAtSequence: r.sequence,
        brokenAtId: r.id,
        reason: "prevHash does not match the previous record (a record was inserted or removed)",
        reasonCode: "prevHash",
      };
    }
    const recomputed = hashPayload({
      prevHash: r.prevHash ?? GENESIS_HASH,
      actorId: r.actorId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      beforeJson: r.beforeJson ?? null,
      afterJson: r.afterJson ?? null,
      createdAt: r.createdAt,
    });
    if (recomputed !== r.hash) {
      return {
        intact: false,
        recordsChecked: rows.length,
        brokenAtSequence: r.sequence,
        brokenAtId: r.id,
        reason: "record contents were altered after it was written",
        reasonCode: "altered",
      };
    }
    expectedPrev = r.hash;
    previousSequence = r.sequence;
  }

  return {
    intact: true,
    recordsChecked: rows.length,
    brokenAtSequence: null,
    brokenAtId: null,
    reason: null,
    reasonCode: null,
  };
}
