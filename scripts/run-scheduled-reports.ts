/** Run every scheduled report that is due, and email it. */
import { prisma } from "@backend/db/client";
import { dueSchedules, runSchedule } from "@backend/reports/schedule";
import type { Actor } from "@backend/rbac/scope";

async function main() {
  const due = await dueSchedules();
  if (due.length === 0) {
    console.log("Nothing due.");
    return;
  }
  console.log(`${due.length} scheduled report(s) due\n`);
  for (const schedule of due) {
    const u = schedule.createdBy;
    const actor: Actor & { email: string; fullName: string } = {
      id: u.id, role: u.role.type, jurisdictionLevel: u.jurisdictionLevel,
      stateId: u.stateId, districtId: u.districtId, tehsilId: u.tehsilId, agencyId: u.agencyId,
      ownerId: u.ownerProfile?.id ?? null, email: u.email, fullName: u.fullName,
    };
    try {
      const result = await runSchedule(schedule.id, actor);
      console.log(`  ✓ ${schedule.reportKey ?? schedule.templateId} → ${result.note}`);
    } catch (e) {
      console.error(`  ✗ ${schedule.reportKey ?? schedule.templateId}: ${(e as Error).message}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
