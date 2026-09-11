/** Re-link the audit chain after a record was removed. */
import { GENESIS_HASH, appendAudit, hashPayload, verifyChain } from "@backend/audit/chain";
import { prisma } from "@backend/db/client";

async function main() {
  const confirmed = process.argv.includes("--confirm");
  const reason = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "";

  const before = await verifyChain();
  if (before.intact) {
    console.log(`The chain is intact — ${before.recordsChecked} records. Nothing to do.`);
    return;
  }

  console.log("The audit chain is broken.");
  console.log(`  records checked : ${before.recordsChecked}`);
  console.log(`  breaks at       : sequence ${before.brokenAtSequence}`);
  console.log(`  reason          : ${before.reason}`);

  if (!confirmed || reason.length < 10) {
    console.log("\nRefusing to rebuild without --confirm and a written reason.");
    console.log('  npx tsx scripts/repair-audit-chain.ts --confirm "a smoke test deleted its own rows"');
    console.log("\nOn a production system, do not rebuild: investigate. A broken chain is the alarm working.");
    process.exitCode = 1;
    return;
  }

  // Close the gaps first.
  const ordered = await prisma.auditLog.findMany({ orderBy: { sequence: "asc" }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    // Move everything out of the way first: `sequence` is unique, so
    // renumbering in place would collide with the rows not yet moved.
    await tx.$executeRawUnsafe(`UPDATE "AuditLog" SET sequence = sequence + 100000000;`);
    for (const [index, row] of ordered.entries()) {
      await tx.$executeRaw`UPDATE "AuditLog" SET sequence = ${BigInt(index + 1)} WHERE id = ${row.id};`;
    }
    // The counter must continue after the last record, not from where it was.
    await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"AuditLog"', 'sequence'), ${ordered.length});`);
  });
  console.log(`  renumbered      : ${ordered.length} records, 1 to ${ordered.length}`);

  // Re-link every record to the one before it, keeping the contents untouched.
  const rows = await prisma.auditLog.findMany({ orderBy: { sequence: "asc" } });
  let prevHash = GENESIS_HASH;
  let rewritten = 0;
  for (const row of rows) {
    const hash = hashPayload({
      prevHash,
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      beforeJson: row.beforeJson ?? null,
      afterJson: row.afterJson ?? null,
      createdAt: row.createdAt,
    });
    if (row.prevHash !== prevHash || row.hash !== hash) {
      await prisma.auditLog.update({ where: { id: row.id }, data: { prevHash, hash } });
      rewritten++;
    }
    prevHash = hash;
  }

  // The rebuild is itself an auditable act, and says so in the chain.
  await appendAudit({
    action: "UPDATE",
    entityType: "AuditLog",
    entityId: "chain-rebuild",
    afterJson: {
      reason,
      recordsRelinked: rewritten,
      recordsRenumbered: ordered.length,
      brokenAtSequence: before.brokenAtSequence ? Number(before.brokenAtSequence) : null,
      originalReason: before.reason,
      rebuiltAt: new Date().toISOString(),
    },
  });

  const after = await verifyChain();
  console.log(`\nRe-linked ${rewritten} records. Chain ${after.intact ? "verifies" : "STILL BROKEN"} over ${after.recordsChecked} records.`);
  console.log("The rebuild is recorded in the chain itself, with the reason given.");
  if (!after.intact) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
