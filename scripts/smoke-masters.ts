/** Smoke test — master data administration (PS 26016, Data Standardization). */
import type { RoleType } from "@prisma/client";
import { prisma } from "@backend/db/client";
import type { Actor } from "@backend/rbac/scope";
import { saveAgency, saveMinistry, updateDistrict } from "@backend/masters/service";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? `  — ${d}` : ""}`);
};
const refused = async (l: string, f: () => Promise<unknown>, match: RegExp) => {
  try {
    await f();
    check(l, false, "was accepted");
  } catch (e) {
    const m = (e as Error).message;
    check(l, match.test(m), m);
  }
};

async function actor(role: RoleType, where: Record<string, unknown> = {}): Promise<Actor> {
  const u = await prisma.user.findFirstOrThrow({
    where: { role: { type: role }, isActive: true, ...where },
    select: { id: true, jurisdictionLevel: true, stateId: true, districtId: true, tehsilId: true, agencyId: true },
  });
  return { ...u, role };
}

async function main() {
  console.log("\nMASTER DATA\n======================================================");

  const admin = await actor("SUPER_ADMIN", { jurisdictionLevel: "NATIONAL" });
  // A district with awards already on file, so we can prove they are not rewritten.
  const district = await prisma.district.findFirstOrThrow({
    where: { isUrban: false, parcels: { some: { compensations: { some: {} } } } },
  });
  const state = await actor("STATE_GOVERNMENT", { stateId: district.stateId });
  const otherState = await actor("STATE_GOVERNMENT", { stateId: { not: district.stateId } });
  const collector = await actor("DISTRICT_COLLECTOR", { districtId: district.id }).catch(() => actor("DISTRICT_COLLECTOR"));
  const original = { circleRatePerHectare: district.circleRatePerHectare, multiplierFactor: district.multiplierFactor, isUrban: district.isUrban, nameLocal: district.nameLocal };

  const award = await prisma.compensationRecord.findFirstOrThrow({
    where: { parcel: { districtId: district.id } },
    select: { id: true, marketValuePerHectare: true, multiplierFactor: true, totalCompensation: true },
  });

  const smokeCodes = ["SMOKE-AG", "SMOKE-AG2", "SMOKE-MIN"];
  try {
    // --- districts --------------------------------------------------------------
    await refused("a Collector cannot change master data", () => updateDistrict(collector, district.id, { circleRatePerHectare: 1 }), /cannot change master data/);
    await refused("a State cannot touch another State's district", () => updateDistrict(otherState, district.id, { circleRatePerHectare: 1 }), /not found/);

    const newRate = Number(original.circleRatePerHectare ?? 1_000_000) + 12_345;
    const d = await updateDistrict(state, district.id, { circleRatePerHectare: String(newRate), multiplierFactor: "1.6" });
    check("a State revises its own district's circle rate and multiplier", Number(d.circleRatePerHectare) === newRate && Number(d.multiplierFactor) === 1.6);

    await refused("a multiplier above 2.00 is refused", () => updateDistrict(admin, district.id, { multiplierFactor: 2.5 }), /between 1\.00 and 2\.00/);
    await refused("a multiplier below 1.00 is refused", () => updateDistrict(admin, district.id, { multiplierFactor: 0.8 }), /between 1\.00 and 2\.00/);
    await refused("urban land with a multiplier other than 1.00 is refused", () => updateDistrict(admin, district.id, { isUrban: true }), /Urban land takes a multiplier of 1\.00/);
    await refused("a negative circle rate is refused", () => updateDistrict(admin, district.id, { circleRatePerHectare: -5 }), /positive amount/);
    await refused("a number smuggled in an array is refused", () => updateDistrict(admin, district.id, { circleRatePerHectare: [30] }), /positive amount/);
    await refused("a rate with a misplaced decimal (₹900 crore/ha) is refused", () => updateDistrict(admin, district.id, { circleRatePerHectare: 9_000_000_000 }), /positive amount/);
    await refused("an empty change is refused", () => updateDistrict(admin, district.id, {}), /Nothing to change/);

    const urban = await updateDistrict(admin, district.id, { isUrban: true, multiplierFactor: 1 });
    check("marking a district urban with multiplier 1.00 is accepted", urban.isUrban && Number(urban.multiplierFactor) === 1);

    const after = await prisma.compensationRecord.findUniqueOrThrow({
      where: { id: award.id },
      select: { marketValuePerHectare: true, multiplierFactor: true, totalCompensation: true },
    });
    check(
      "awards already assessed keep the rate they were computed with",
      after.marketValuePerHectare.equals(award.marketValuePerHectare) && after.multiplierFactor.equals(award.multiplierFactor) && after.totalCompensation.equals(award.totalCompensation),
    );

    const trail = await prisma.auditLog.findFirst({
      where: { entityType: "District", entityId: district.id, actorId: state.id },
      orderBy: { sequence: "desc" },
      select: { beforeJson: true, afterJson: true },
    });
    check("the change is on the audit chain with before and after", Boolean(trail && (trail.afterJson as { circleRatePerHectare?: string })?.circleRatePerHectare));

    // --- ministries and agencies -------------------------------------------------
    await refused("a State cannot add a ministry", () => saveMinistry(state, null, { code: "SMOKE-MIN", name: "Smoke ministry" }), /national administrator/);
    const min = await saveMinistry(admin, null, { code: "smoke-min", name: "Ministry of Smoke Testing" });
    check("the administrator adds a ministry; the code is upper-cased", min.code === "SMOKE-MIN");
    await refused("a duplicate ministry code is refused in words", () => saveMinistry(admin, null, { code: "SMOKE-MIN", name: "Another" }), /already uses the code SMOKE-MIN/);
    await refused("a code with spaces is refused", () => saveMinistry(admin, null, { code: "NO SPACES", name: "Ministry" }), /2–20 letters/);

    const ag = await saveAgency(admin, null, { code: "SMOKE-AG", name: "Smoke Test Authority", ministryId: min.id, isRequiringBody: true });
    check("an agency is added under that ministry", ag.ministryId === min.id && ag.isRequiringBody);
    const renamed = await saveAgency(admin, ag.id, { code: "SMOKE-AG2", name: "Smoke Test Authority (renamed)", ministryId: min.id, isRequiringBody: false });
    check("an agency without projects can be edited and made implementing-only", renamed.code === "SMOKE-AG2" && !renamed.isRequiringBody);
    await refused("an unknown ministry is refused", () => saveAgency(admin, ag.id, { code: "SMOKE-AG2", name: "Smoke Test Authority", ministryId: "nope" }), /does not exist/);

    const busy = await prisma.agency.findFirstOrThrow({ where: { isRequiringBody: true, projects: { some: {} } } });
    await refused(
      "an agency with projects on file must remain a requiring body",
      () => saveAgency(admin, busy.id, { code: busy.code, name: busy.name, ministryId: busy.ministryId, isRequiringBody: false }),
      /must remain a land requiring body/,
    );
  } finally {
    await prisma.district.update({ where: { id: district.id }, data: original });
    await prisma.agency.deleteMany({ where: { code: { in: smokeCodes } } });
    await prisma.ministry.deleteMany({ where: { code: { in: smokeCodes } } });
  }
  const restored = await prisma.district.findUniqueOrThrow({ where: { id: district.id } });
  check("the district is put back as it was", String(restored.circleRatePerHectare) === String(original.circleRatePerHectare) && restored.multiplierFactor.equals(original.multiplierFactor));

  console.log(`\n  ${pass} passed · ${fail} failed\n`);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
