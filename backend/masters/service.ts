/** Master data — the reference tables every case is built on. */
import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import { can } from "@backend/rbac/permissions";
import { scopeForDistrict, type Actor } from "@backend/rbac/scope";
import { MAX_MULTIPLIER, MIN_MULTIPLIER } from "@backend/compensation/calculator";
import { num, text } from "@backend/validation/request";

type Role = Actor["role"];

/** Circle rates above ₹500 crore a hectare are a misplaced decimal, not a rate. */
const MAX_RATE_PER_HA = 5_000_000_000;

export function mayEditDistricts(role: Role) {
  return can(role, "masterData", "update");
}

/** Agencies and ministries are national; only a national administrator adds them. */
export function mayEditBodies(role: Role) {
  return can(role, "masterData", "create");
}

export interface DistrictInput {
  nameLocal?: unknown;
  circleRatePerHectare?: unknown;
  multiplierFactor?: unknown;
  isUrban?: unknown;
}

export async function updateDistrict(actor: Actor, id: string, input: DistrictInput) {
  if (!mayEditDistricts(actor.role)) throw new Error("Your role cannot change master data.");
  // A State edits its own districts only — the same scope that governs reading.
  const before = await prisma.district.findFirst({ where: { AND: [{ id }, scopeForDistrict(actor)] } });
  if (!before) throw new Error("District not found");

  const data: Prisma.DistrictUpdateInput = {};

  if (input.nameLocal !== undefined) {
    const v = input.nameLocal === "" || input.nameLocal === null ? null : text(input.nameLocal, { max: 120 });
    if (v === null && input.nameLocal) throw new Error("The local-language name is not valid.");
    data.nameLocal = v;
  }

  if (input.circleRatePerHectare !== undefined) {
    if (input.circleRatePerHectare === null || input.circleRatePerHectare === "") {
      data.circleRatePerHectare = null;
    } else {
      const rate = num(input.circleRatePerHectare, { min: 1, max: MAX_RATE_PER_HA });
      if (rate === null) throw new Error("The circle rate must be a positive amount in rupees per hectare.");
      data.circleRatePerHectare = new Prisma.Decimal(rate.toFixed(2));
    }
  }

  const isUrban = input.isUrban === undefined ? before.isUrban : input.isUrban === true;
  if (input.isUrban !== undefined) data.isUrban = isUrban;

  let multiplier = Number(before.multiplierFactor);
  if (input.multiplierFactor !== undefined) {
    const m = num(input.multiplierFactor, { min: MIN_MULTIPLIER, max: MAX_MULTIPLIER });
    if (m === null) throw new Error(`The multiplier must be between ${MIN_MULTIPLIER.toFixed(2)} and ${MAX_MULTIPLIER.toFixed(2)} (LARR First Schedule).`);
    multiplier = Math.round(m * 100) / 100;
  }
  // First Schedule: urban land is multiplied by 1.
  if (isUrban && multiplier !== 1) {
    throw new Error("Urban land takes a multiplier of 1.00 under the First Schedule. Set it to 1.00, or mark the district rural.");
  }
  if (input.multiplierFactor !== undefined || input.isUrban !== undefined) {
    data.multiplierFactor = new Prisma.Decimal(multiplier.toFixed(2));
  }

  if (Object.keys(data).length === 0) throw new Error("Nothing to change.");

  const after = await prisma.district.update({ where: { id }, data });
  await appendAudit({
    actorId: actor.id,
    action: "UPDATE",
    entityType: "District",
    entityId: id,
    beforeJson: {
      nameLocal: before.nameLocal,
      circleRatePerHectare: before.circleRatePerHectare?.toString() ?? null,
      multiplierFactor: before.multiplierFactor.toString(),
      isUrban: before.isUrban,
    },
    afterJson: {
      nameLocal: after.nameLocal,
      circleRatePerHectare: after.circleRatePerHectare?.toString() ?? null,
      multiplierFactor: after.multiplierFactor.toString(),
      isUrban: after.isUrban,
    },
  });
  return after;
}

/** Codes are what other systems (PFMS, e-Gazette) quote, so they are strict. */
function code(v: unknown): string {
  const c = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(c)) {
    throw new Error("The code must be 2–20 letters, digits, hyphens or underscores, e.g. NHAI or MORTH.");
  }
  return c;
}

function name(v: unknown): string {
  const n = text(v, { min: 3, max: 160 });
  if (!n) throw new Error("Give the full name (3–160 characters).");
  return n;
}

/** Write, refusing a code another row already uses. */
async function uniqueCode<T>(
  clash: () => Promise<{ id: string } | null>,
  id: string | null,
  write: () => Promise<T>,
  what: string,
  c: string,
): Promise<T> {
  const other = await clash();
  if (other && other.id !== id) throw new Error(`Another ${what} already uses the code ${c}.`);
  try {
    return await write();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error(`Another ${what} already uses the code ${c}.`);
    }
    throw e;
  }
}

export interface BodyInput {
  code?: unknown;
  name?: unknown;
  /** Agencies only. */
  isRequiringBody?: unknown;
  ministryId?: unknown;
}

async function ministryRef(v: unknown): Promise<string | null> {
  if (v === undefined || v === null || v === "") return null;
  const m = typeof v === "string" ? await prisma.ministry.findUnique({ where: { id: v }, select: { id: true } }) : null;
  if (!m) throw new Error("That ministry does not exist.");
  return m.id;
}

export async function saveMinistry(actor: Actor, id: string | null, input: BodyInput) {
  if (!mayEditBodies(actor.role)) throw new Error("Only a national administrator can add or change ministries.");
  const data = { code: code(input.code), name: name(input.name) };
  const before = id ? await prisma.ministry.findUnique({ where: { id } }) : null;
  if (id && !before) throw new Error("Ministry not found");

  const saved = await uniqueCode(
    () => prisma.ministry.findUnique({ where: { code: data.code }, select: { id: true } }),
    id,
    () => (id ? prisma.ministry.update({ where: { id }, data }) : prisma.ministry.create({ data })),
    "ministry",
    data.code,
  );
  await appendAudit({
    actorId: actor.id,
    action: id ? "UPDATE" : "CREATE",
    entityType: "Ministry",
    entityId: saved.id,
    beforeJson: before ? { code: before.code, name: before.name } : undefined,
    afterJson: data,
  });
  return saved;
}

export async function saveAgency(actor: Actor, id: string | null, input: BodyInput) {
  if (!mayEditBodies(actor.role)) throw new Error("Only a national administrator can add or change agencies.");
  const data = {
    code: code(input.code),
    name: name(input.name),
    isRequiringBody: input.isRequiringBody !== false,
    ministryId: await ministryRef(input.ministryId),
  };
  const before = id ? await prisma.agency.findUnique({ where: { id } }) : null;
  if (id && !before) throw new Error("Agency not found");

  // An agency with projects on file stays a requiring body: its proposals
  // were filed on that footing.
  if (before?.isRequiringBody && !data.isRequiringBody && (await prisma.project.count({ where: { agencyId: before.id } })) > 0) {
    throw new Error("This agency has projects on file, so it must remain a land requiring body.");
  }

  const saved = await uniqueCode(
    () => prisma.agency.findUnique({ where: { code: data.code }, select: { id: true } }),
    id,
    () => (id ? prisma.agency.update({ where: { id }, data }) : prisma.agency.create({ data })),
    "agency",
    data.code,
  );
  await appendAudit({
    actorId: actor.id,
    action: id ? "UPDATE" : "CREATE",
    entityType: "Agency",
    entityId: saved.id,
    beforeJson: before ? { code: before.code, name: before.name, isRequiringBody: before.isRequiringBody, ministryId: before.ministryId } : undefined,
    afterJson: data,
  });
  return saved;
}
