/** Reference number generation. */
import { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { STATE_CODE } from "@backend/geo/state-codes";

/** Strip to A-Z0-9 and cap, so odd master-data names cannot produce broken refs. */
function token(s: string, len: number): string {
  const t = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (t || "XX").slice(0, len).padEnd(2, "X");
}

/** Official abbreviation where we know it; first two letters otherwise. */
function stateToken(name: string): string {
  return STATE_CODE[name] ?? token(name, 2);
}

/** Next reference for a proposal in a district. */
export async function nextProposalReference(districtId: string): Promise<string> {
  const district = await prisma.district.findUnique({
    where: { id: districtId },
    include: { state: { select: { name: true, lgdCode: true } } },
  });
  if (!district) throw new Error(`Unknown district: ${districtId}`);

  const year = new Date().getFullYear();
  const st = stateToken(district.state.name);
  const dt = token(district.name, 3);
  const prefix = `LA/${st}/${dt}/${year}/`;

  const last = await prisma.proposal.findFirst({
    where: { referenceNo: { startsWith: prefix } },
    orderBy: { referenceNo: "desc" },
    select: { referenceNo: true },
  });

  const lastSeq = last ? Number(last.referenceNo.slice(prefix.length)) : 0;
  const seq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/** Project reference: `PRJ/<MINISTRY>/<YYYY>/<SEQ>`. */
export async function nextProjectReference(ministryCode = "GOI"): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PRJ/${token(ministryCode, 6)}/${year}/`;
  const last = await prisma.project.findFirst({
    where: { referenceNo: { startsWith: prefix } },
    orderBy: { referenceNo: "desc" },
    select: { referenceNo: true },
  });
  const lastSeq = last ? Number(last.referenceNo.slice(prefix.length)) : 0;
  const seq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/** Allocate a reference number and use it, retrying if someone else took it first. */
export async function createWithReference<T>(
  nextReference: () => Promise<string>,
  create: (reference: string) => Promise<T>,
  attempts = 8,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await create(await nextReference());
    } catch (e) {
      const taken = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!taken || attempt >= attempts) throw e;
      // Stagger the retries so racers do not collide again in lockstep.
      await new Promise((r) => setTimeout(r, 15 * attempt + Math.random() * 25));
    }
  }
}
