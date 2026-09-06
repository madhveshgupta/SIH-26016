/** Demo accounts — generated, not hand-picked, so every jurisdiction is equal. */
import { PrismaClient, type JurisdictionLevel, type RoleType } from "@prisma/client";
import { hashPassword } from "../backend/auth/password";
import { stateAbbreviation, slug } from "../backend/auth/accounts";

const prisma = new PrismaClient();

/** Demo password. Verified against checkPasswordPolicy() in backend/auth/password.ts. */
const DEMO_PASSWORD = "Suraksha@Bhoomi2026";

interface AccountSeed {
  email: string;
  fullName: string;
  designation: string;
  role: RoleType;
  jurisdictionLevel: JurisdictionLevel;
  stateId?: string | null;
  districtId?: string | null;
  agencyCode?: string;
  phone?: string;
}

const NATIONAL: AccountSeed[] = [
  { email: "admin@bhoominayan.gov.in", fullName: "Rajiv Malhotra", designation: "Super Administrator, NIC", role: "SUPER_ADMIN", jurisdictionLevel: "NATIONAL" },
  { email: "morth@bhoominayan.gov.in", fullName: "Deepak Nair", designation: "Under Secretary, Ministry of Road Transport and Highways", role: "CENTRAL_MINISTRY", jurisdictionLevel: "NATIONAL" },
  { email: "mor@bhoominayan.gov.in", fullName: "Sunita Rao", designation: "Director (Land), Ministry of Railways", role: "CENTRAL_MINISTRY", jurisdictionLevel: "NATIONAL" },
  { email: "mojs@bhoominayan.gov.in", fullName: "Harish Kulkarni", designation: "Joint Secretary, Ministry of Jal Shakti", role: "CENTRAL_MINISTRY", jurisdictionLevel: "NATIONAL" },
  { email: "nhai.officer@bhoominayan.gov.in", fullName: "Vikram Singh Rathore", designation: "Project Director, NHAI", role: "LAND_REQUIRING_BODY", jurisdictionLevel: "NATIONAL", agencyCode: "NHAI" },
  { email: "rvnl.officer@bhoominayan.gov.in", fullName: "Kavita Menon", designation: "Chief Project Manager, RVNL", role: "LAND_REQUIRING_BODY", jurisdictionLevel: "NATIONAL", agencyCode: "RVNL" },
  { email: "pia.nhai@bhoominayan.gov.in", fullName: "Arun Prakash", designation: "Site Engineer, Project Implementation Unit (NHAI)", role: "LAND_REQUIRING_BODY", jurisdictionLevel: "NATIONAL", agencyCode: "NHAI" },
  { email: "policy@bhoominayan.gov.in", fullName: "Dr. Lakshmi Narayanan", designation: "Adviser, NITI Aayog", role: "CENTRAL_MINISTRY", jurisdictionLevel: "NATIONAL" },
];

/** Deterministic synthetic names, so a re-seed yields the same people. */
const FIRST = ["Anil", "Priya", "Suresh", "Meera", "Rakesh", "Kavita", "Sanjay", "Neha", "Manoj", "Anjali", "Ravi", "Pooja", "Ajay", "Sunita", "Vijay", "Rekha"];
const LAST = ["Verma", "Chaudhary", "Sharma", "Joshi", "Naik", "Patil", "Yadav", "Mishra", "Gupta", "Desai", "Rawat", "Kumar", "Singh", "Reddy", "Das", "Pillai"];
function nameFor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${FIRST[h % FIRST.length]} ${LAST[(h >>> 5) % LAST.length]}`;
}

/** A stable, obviously-fake mobile number for the citizen OTP flow. */
function phoneFor(seed: string): string {
  let h = 7;
  for (const c of seed) h = (h * 131 + c.charCodeAt(0)) % 1_000_000_000;
  return `+919${String(h).padStart(9, "0")}`;
}

async function main() {
  console.log("Generating demo accounts from the data…\n");

  const roles = await prisma.role.findMany();
  const roleIdByType = new Map(roles.map((r) => [r.type, r.id]));
  if (roleIdByType.size === 0) throw new Error("No roles found — run `npm run db:seed` first.");
  const agencies = await prisma.agency.findMany({ select: { id: true, code: true } });
  const agencyIdByCode = new Map(agencies.map((a) => [a.code, a.id]));

  // Jurisdictions that actually have a project — the data decides who exists.
  const states = await prisma.state.findMany({
    where: { projects: { some: {} } },
    orderBy: { name: "asc" },
  });
  const districts = await prisma.district.findMany({
    where: { projects: { some: {} } },
    include: { state: true },
    orderBy: [{ state: { name: "asc" } }, { name: "asc" }],
  });

  const accounts: AccountSeed[] = [...NATIONAL];
  for (const s of states) {
    const code = stateAbbreviation(s.name).toLowerCase();
    accounts.push(
      { email: `state.${code}@bhoominayan.gov.in`, fullName: nameFor(`state-${s.id}`), designation: `Principal Secretary, Revenue, ${s.name}`, role: "STATE_GOVERNMENT", jurisdictionLevel: "STATE", stateId: s.id },
      { email: `rnr.${code}@bhoominayan.gov.in`, fullName: nameFor(`rnr-${s.id}`), designation: `Commissioner, Rehabilitation and Resettlement, ${s.name}`, role: "REHABILITATION_AUTHORITY", jurisdictionLevel: "STATE", stateId: s.id },
    );
  }
  for (const d of districts) {
    const ds = slug(d.name);
    accounts.push(
      { email: `collector.${ds}@bhoominayan.gov.in`, fullName: nameFor(`collector-${d.id}`), designation: `District Collector, ${d.name}`, role: "DISTRICT_COLLECTOR", jurisdictionLevel: "DISTRICT", stateId: d.stateId, districtId: d.id },
      { email: `cala.${ds}@bhoominayan.gov.in`, fullName: nameFor(`cala-${d.id}`), designation: `Competent Authority for Land Acquisition, ${d.name}`, role: "LAND_ACQUIRING_AUTHORITY", jurisdictionLevel: "DISTRICT", stateId: d.stateId, districtId: d.id },
      { email: `landowner.${ds}@example.in`, fullName: nameFor(`owner-${d.id}`), designation: `Landowner, ${d.name}`, role: "LANDOWNER", jurisdictionLevel: "VILLAGE", stateId: d.stateId, districtId: d.id, phone: phoneFor(`owner-${d.id}`) },
    );
  }

  // Accounts the data no longer supports are deactivated, not left dangling.
  const keep = new Set(accounts.map((a) => a.email));
  const stale = await prisma.user.updateMany({ where: { email: { notIn: [...keep] } }, data: { isActive: false } });

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const a of accounts) {
    const roleId = roleIdByType.get(a.role);
    if (!roleId) throw new Error(`Role ${a.role} not seeded`);
    const data = {
      fullName: a.fullName,
      designation: a.designation,
      passwordHash,
      roleId,
      jurisdictionLevel: a.jurisdictionLevel,
      stateId: a.stateId ?? null,
      districtId: a.districtId ?? null,
      agencyId: a.agencyCode ? (agencyIdByCode.get(a.agencyCode) ?? null) : null,
      phone: a.phone ?? null,
      isActive: true,
      // Demo accounts skip the forced password change: the shared password is printed on the login
      // screen anyway, so the prompt guards nothing and interrupts every sign-in.
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    };
    const user = await prisma.user.upsert({ where: { email: a.email }, update: data, create: { email: a.email, ...data } });

    // A citizen needs an Owner record for ownership scoping to work.
    if (a.role === "LANDOWNER") {
      const district = districts.find((d) => d.id === a.districtId)!;
      await prisma.owner.upsert({
        where: { userId: user.id },
        update: { fullName: a.fullName },
        create: {
          fullName: a.fullName,
          fatherName: `Shri ${nameFor(`father-${user.id}`)}`,
          userId: user.id,
          address: `${district.name}, ${district.state.name}`,
          phone: a.phone,
        },
      });
    }
  }

  const byRole = new Map<string, number>();
  for (const a of accounts) byRole.set(a.role, (byRole.get(a.role) ?? 0) + 1);
  console.log(`  ${states.length} states and ${districts.length} districts with projects`);
  for (const [role, n] of byRole) console.log(`  ${role.padEnd(28)} ${n}`);
  if (stale.count) console.log(`  deactivated ${stale.count} account(s) no longer backed by data`);
  console.log(`\n${accounts.length} accounts. Demo password for every account: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
