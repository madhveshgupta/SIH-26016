/** Raise alerts for everything overdue, due soon or done out of order. */
import { prisma } from "@backend/db/client";
import { RULES, runAlertSweep } from "@backend/alerts/sweep";

async function main() {
  if (process.argv.includes("--dry")) {
    const now = new Date();
    for (const [name, rule] of Object.entries(RULES)) {
      const found = await rule(now);
      const bySeverity = found.reduce<Record<string, number>>((m, f) => ((m[f.severity] = (m[f.severity] ?? 0) + 1), m), {});
      console.log(`  ${name.padEnd(24)} ${String(found.length).padStart(4)}  ${JSON.stringify(bySeverity)}`);
      for (const f of found.slice(0, 2)) console.log(`      e.g. ${f.title}`);
    }
    return;
  }

  const r = await runAlertSweep();
  console.log(
    `alerts: ${r.findings} findings → ${r.created} raised (${r.escalations} escalations), ${r.alreadySent} already sent · ` +
      `${r.delivered} email/SMS delivered, ${r.deliveryFailures} failed · ${r.ms} ms`,
  );
  for (const [type, n] of Object.entries(r.byType)) console.log(`  ${type.padEnd(28)} ${n}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
