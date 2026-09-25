/**
 * End-to-end smoke test: auth, RBAC, jurisdiction scoping and the tamper-evident
 * audit chain.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { attemptLogin } from "../backend/auth/login";
import { appendAudit, verifyChain } from "../backend/audit/chain";
import { can, permissionsFor } from "../backend/rbac/permissions";
import {
  scopeForParcel,
  scopeForProposal,
  scopeForDistrict,
  describeScope,
  type Actor,
} from "../backend/rbac/scope";
import { checkPasswordPolicy } from "../backend/auth/password";
import { createOtpChallenge, verifyOtp } from "../backend/auth/otp";

const prisma = new PrismaClient();
const PASSWORD = "Suraksha@Bhoomi2026";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(
    `  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? "  " + detail : ""}`,
  );
  if (ok) pass++;
  else fail++;
}

async function login(email: string) {
  const r = await attemptLogin(email, PASSWORD, { ipAddress: "127.0.0.1", userAgent: "smoke" });
  if (!r.ok) throw new Error(`login failed for ${email}: ${r.reason}`);
  return r;
}

async function main() {
  console.log("\nAUTH / RBAC / AUDIT SMOKE TEST\n======================================================");

  // ---- 1. authentication --------------------------------------------------
  console.log("\nAuthentication:");
  const collectorAgra = await login("collector.agra@bhoominayan.gov.in");
  check("valid credentials are accepted", true, collectorAgra.fullName);

  const bad = await attemptLogin("collector.agra@bhoominayan.gov.in", "wrong-password", {});
  check("wrong password is rejected", !bad.ok && bad.reason === "invalid_credentials");

  const ghost = await attemptLogin("nobody@bhoominayan.gov.in", "whatever", {});
  check(
    "unknown account gives the SAME error as a wrong password",
    !ghost.ok && ghost.reason === "invalid_credentials",
    "(does not leak which accounts exist)",
  );

  // Reset the counter that the deliberate failure above incremented.
  await prisma.user.update({
    where: { email: "collector.agra@bhoominayan.gov.in" },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

  // Demo accounts deliberately skip the forced change (see prisma/seed-users.ts);
  // the schema default still forces it for genuinely new accounts.
  check("seeded demo accounts sign in without a forced password change", !collectorAgra.mustChangePassword);

  // ---- 2. password policy -------------------------------------------------
  console.log("\nPassword policy:");
  check("strong password accepted", checkPasswordPolicy(PASSWORD).ok);
  check("short password rejected", !checkPasswordPolicy("Abc1!").ok);
  check("no-symbol password rejected", !checkPasswordPolicy("Abcdefgh1234").ok);
  check("common-word prefix rejected", !checkPasswordPolicy("Password123!xy").ok);

  // ---- 3. OTP -------------------------------------------------------------
  console.log("\nOTP second factor:");
  const { challenge, code } = createOtpChallenge();
  check("6-digit code generated", /^\d{6}$/.test(code), code);
  check("correct code verifies", verifyOtp(challenge, code) === "valid");
  check("wrong code rejected", verifyOtp(challenge, "000000") === "invalid" || code === "000000");
  check(
    "expired challenge rejected",
    verifyOtp({ ...challenge, expiresAt: new Date(Date.now() - 1000) }, code) === "expired",
  );
  check(
    "too many attempts rejected",
    verifyOtp({ ...challenge, attempts: 3 }, code) === "too_many_attempts",
  );

  // ---- 4. permission matrix ----------------------------------------------
  console.log("\nPermission matrix:");
  check("collector may approve an award", can("DISTRICT_COLLECTOR", "award", "approve"));
  check("ministry may NOT approve an award", !can("CENTRAL_MINISTRY", "award", "approve"));
  check("ministry may read dashboards and predictions",
    can("CENTRAL_MINISTRY", "dashboard", "read") && can("CENTRAL_MINISTRY", "mlPrediction", "read"));
  check("requiring body may read possession (its implementation unit builds after handover)",
    can("LAND_REQUIRING_BODY", "possession", "read") && !can("LAND_REQUIRING_BODY", "possession", "approve"));
  check("landowner may file an objection", can("LANDOWNER", "objection", "create"));
  check("landowner may NOT declare an award", !can("LANDOWNER", "award", "create"));
  check("landowner may NOT read the audit log", !can("LANDOWNER", "auditLog", "read"));
  check(
    "requiring body may NOT approve its own proposal",
    !can("LAND_REQUIRING_BODY", "proposal", "approve"),
    "(cannot sign off its own work)",
  );
  check("every role has at least one permission", Object.values(
    ["SUPER_ADMIN","LAND_REQUIRING_BODY","LAND_ACQUIRING_AUTHORITY","DISTRICT_COLLECTOR",
     "STATE_GOVERNMENT","CENTRAL_MINISTRY","REHABILITATION_AUTHORITY","LANDOWNER"] as const,
  ).every((r) => Object.keys(permissionsFor(r)).length > 0));

  // ---- 5. jurisdiction scoping -------------------------------------------
  console.log("\nJurisdiction scoping (the important one):");
  const agra = collectorAgra.actor;
  const jaipur = (await login("collector.jaipur@bhoominayan.gov.in")).actor;
  const ministry = (await login("morth@bhoominayan.gov.in")).actor;
  const stateUp = (await login("state.up@bhoominayan.gov.in")).actor;

  check("Agra collector is district-scoped", describeScope(agra) === "One District");
  check("Ministry is national", describeScope(ministry) === "All States and Union Territories");

  const agraDistricts = await prisma.district.count({ where: scopeForDistrict(agra) });
  const jaipurDistricts = await prisma.district.count({ where: scopeForDistrict(jaipur) });
  const upDistricts = await prisma.district.count({ where: scopeForDistrict(stateUp) });
  const allDistricts = await prisma.district.count({ where: scopeForDistrict(ministry) });

  check("Agra collector sees exactly 1 district", agraDistricts === 1, `${agraDistricts}`);
  check("Jaipur collector sees exactly 1 district", jaipurDistricts === 1, `${jaipurDistricts}`);
  check("UP state officer sees several, not all", upDistricts > 1 && upDistricts < allDistricts,
    `${upDistricts} of ${allDistricts}`);
  check("Ministry sees every district", allDistricts > upDistricts, `${allDistricts}`);

  // The two collectors must not overlap at all.
  const agraIds = (await prisma.district.findMany({ where: scopeForDistrict(agra), select: { id: true } })).map((d) => d.id);
  const jaipurIds = (await prisma.district.findMany({ where: scopeForDistrict(jaipur), select: { id: true } })).map((d) => d.id);
  check(
    "two collectors' scopes do not overlap",
    agraIds.every((id) => !jaipurIds.includes(id)),
    "(different districts, different worlds)",
  );

  // A landowner is scoped by ownership, not geography.
  const owner = await login("landowner.agra@example.in");
  const ownerScope = scopeForParcel(owner.actor);
  check("landowner scope is ownership-based", JSON.stringify(ownerScope).includes("owners"),
    JSON.stringify(ownerScope).slice(0, 60));

  // A requiring body is scoped to its own agency, which is narrower than geography.
  const nhai = (await login("nhai.officer@bhoominayan.gov.in")).actor;
  check("requiring body is agency-scoped", JSON.stringify(scopeForProposal(nhai)).includes("agencyId"));

  // An actor with a missing jurisdiction must fail closed, not open.
  const broken: Actor = { ...agra, districtId: null };
  const brokenCount = await prisma.district.count({ where: scopeForDistrict(broken) });
  check("misconfigured scope fails CLOSED, not open", brokenCount === 0, `${brokenCount} rows`);

  // ---- 6. audit chain -----------------------------------------------------
  console.log("\nTamper-evident audit chain:");
  const before = await verifyChain();
  check("chain is intact after logins", before.intact, `${before.recordsChecked} records`);

  const written = await appendAudit({
    actorId: agra.id,
    action: "UPDATE",
    entityType: "SmokeTest",
    entityId: "smoke-1",
    beforeJson: { compensation: 1_000_000 },
    afterJson: { compensation: 1_500_000 },
    ipAddress: "127.0.0.1",
  });
  check("record appended with a hash", written.hash.length === 64, written.hash.slice(0, 16) + "…");

  const afterAppend = await verifyChain();
  check("chain still intact after append", afterAppend.intact, `${afterAppend.recordsChecked} records`);

  // The real test: edit a historical row directly in the database, exactly as a
  // clerk with DB access would, and confirm verification catches it.
  await prisma.$executeRaw`
    UPDATE "AuditLog"
       SET "afterJson" = ${Prisma.sql`'{"compensation": 9999999}'::jsonb`}
     WHERE id = ${written.id};
  `;
  const tampered = await verifyChain();
  check(
    "🔴 TAMPERING IS DETECTED",
    !tampered.intact,
    tampered.reason ?? "",
  );
  check(
    "tampering is pinpointed to the exact record",
    tampered.brokenAtId === written.id,
    `sequence ${tampered.brokenAtSequence}`,
  );

  // Repair the record we tampered with, so the chain is valid again and the
  // next assertion tests deletion rather than the leftover edit.
  await prisma.auditLog.delete({ where: { id: written.id } });

  // Deleting the TAIL is NOT detectable by a hash chain alone — see the "known limitation" note in
  // backend/audit/chain.ts.
  const afterTailDelete = await verifyChain();
  check(
    "tail truncation is NOT detected (known limitation, documented)",
    afterTailDelete.intact,
    "needs an external anchor — see chain.ts",
  );

  // This test used to clear the whole table here, to get a clean chain for the next assertion.

  // Deleting a MIDDLE record IS detectable, because every later record's
  // prevHash and sequence stop lining up.
  const a1 = await appendAudit({ action: "VIEW", entityType: "SmokeTest", entityId: "m1" });
  const a2 = await appendAudit({ action: "VIEW", entityType: "SmokeTest", entityId: "m2" });
  await appendAudit({ action: "VIEW", entityType: "SmokeTest", entityId: "m3" });
  check("chain intact before mid-chain deletion", (await verifyChain()).intact);

  // Keep the row verbatim so it can be put back: a test must not leave the system's own evidence
  // chain broken.
  const middle = await prisma.auditLog.findUniqueOrThrow({ where: { id: a2.id } });
  await prisma.auditLog.delete({ where: { id: a2.id } });
  const gapped = await verifyChain();
  check(
    "🔴 MID-CHAIN DELETION IS DETECTED",
    !gapped.intact,
    gapped.reason ?? "",
  );

  await prisma.auditLog.create({
    data: {
      ...middle,
      // JSON columns come back as JsonValue and need re-asserting on the way in.
      beforeJson: (middle.beforeJson ?? undefined) as never,
      afterJson: (middle.afterJson ?? undefined) as never,
    },
  });
  const restored = await verifyChain();
  check("the chain verifies again once the record is restored", restored.intact, restored.reason ?? `${restored.recordsChecked} records`);
  void a1;

  console.log("\n======================================================");
  console.log(`PASSED ${pass}   FAILED ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("\n\x1b[31mSmoke test error:\x1b[0m", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
