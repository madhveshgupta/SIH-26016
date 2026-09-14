/** Filing a citizen's representation, and getting it to the officer who must answer it. */
import { Prisma, type AcquisitionAct, type GrievanceCategory, type RoleType } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import { fileObjection, objectionWindow } from "@backend/statutory/notifications";
import { createWithReference } from "@backend/proposals/reference";
import { STATE_CODE } from "@backend/geo/state-codes";
import { AUTHORITY_ROLE, categoryFor, type GrievanceCategoryDef, type GrievanceField } from "./catalogue";

export interface FileGrievanceInput {
  category: GrievanceCategory;
  /** The citizen's own plot. Everything else is derived from it. */
  parcelId: string;
  /** Raw answers from the template, keyed by field. */
  answers: Record<string, unknown>;
  filedByUserId: string;
  objectorName: string;
  ownerId?: string | null;
}

export interface FileGrievanceResult {
  id: string;
  referenceNo: string;
  statuteSection: string;
  authorityLabel: string;
  /** Set when a statutory objection was filed alongside it. */
  objectionId: string | null;
  /** Said back to the citizen: why an objection was, or was not, also filed. */
  objectionNote: string | null;
  assignedTo: string | null;
}

const token = (s: string, len: number) =>
  (s.toUpperCase().replace(/[^A-Z0-9]/g, "") || "XX").slice(0, len).padEnd(2, "X");

/** Check the answers against the template that asked for them. */
export function validateAnswers(
  def: GrievanceCategoryDef,
  raw: Record<string, unknown>,
): { key: string; label: string; value: string }[] {
  const out: { key: string; label: string; value: string }[] = [];
  for (const field of def.fields) {
    const value = normalise(field, raw[field.key]);
    if (value === null) {
      if (field.required) throw new Error(`${field.label} is required`);
      continue;
    }
    out.push({ key: field.key, label: field.label, value });
  }
  // Every required field answered, and nothing of substance said at all, is
  // not a grievance anyone can act on.
  const words = out.map((o) => o.value).join(" ").trim();
  if (words.length < 10) throw new Error("Describe the problem before submitting");
  return out;
}

function normalise(field: GrievanceField, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;

  switch (field.kind) {
    case "number":
    case "money": {
      const n = Number(s.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) throw new Error(`${field.label} must be a number`);
      if (field.max != null && n > field.max) throw new Error(`${field.label} looks too large`);
      // Money is shown in Indian grouping; a plain number keeps its own form.
      return field.kind === "money" ? `₹${n.toLocaleString("en-IN")}` : String(n);
    }
    case "date": {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) throw new Error(`${field.label} is not a valid date`);
      if (d.getTime() > Date.now() + 86_400_000) throw new Error(`${field.label} cannot be in the future`);
      return d.toISOString().slice(0, 10);
    }
    case "select":
      if (field.options && !field.options.includes(s)) throw new Error(`Choose one of the options for ${field.label}`);
      return s;
    default: {
      const max = field.max ?? 2000;
      if (s.length > max) throw new Error(`${field.label} is too long`);
      return s;
    }
  }
}

/** The formal representation the officer reads. */
export function composeRepresentation(
  def: GrievanceCategoryDef,
  answers: { label: string; value: string }[],
  context: {
    objectorName: string;
    khasraNo: string;
    village: string;
    district: string;
    state: string;
    projectName: string;
    proposalRef: string | null;
    section: string;
    authorityLabel: string;
  },
): string {
  const lines = [
    `REPRESENTATION UNDER ${context.section.toUpperCase()}`,
    "",
    `To: ${context.authorityLabel}`,
    `From: ${context.objectorName}`,
    `Subject: ${def.title.en}`,
    "",
    `Land: khasra ${context.khasraNo}, village ${context.village}, district ${context.district}, ${context.state}`,
    `Acquisition: ${context.projectName}${context.proposalRef ? ` (case ${context.proposalRef})` : ""}`,
    "",
    "PARTICULARS",
  ];
  for (const a of answers) {
    // A long answer reads better under its heading than beside it.
    lines.push(a.value.includes("\n") || a.value.length > 80 ? `${a.label}:\n  ${a.value.replace(/\n/g, "\n  ")}` : `${a.label}: ${a.value}`);
  }
  lines.push("", `Filed through the Bhoomi Nayan citizen portal by ${context.objectorName}.`);
  return lines.join("\n");
}

async function nextGrievanceReference(stateName: string, districtName: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `GRV/${STATE_CODE[stateName] ?? token(stateName, 2)}/${token(districtName, 3)}/${year}/`;
  const last = await prisma.grievance.findFirst({
    where: { referenceNo: { startsWith: prefix } },
    orderBy: { referenceNo: "desc" },
    select: { referenceNo: true },
  });
  const lastSeq = last ? Number(last.referenceNo.slice(prefix.length)) : 0;
  return `${prefix}${String(Number.isFinite(lastSeq) ? lastSeq + 1 : 1).padStart(4, "0")}`;
}

/** The officer who must answer, by role and jurisdiction. */
export async function resolveAuthority(
  role: RoleType,
  districtId: string,
  stateId: string,
): Promise<{ id: string; fullName: string } | null> {
  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { is: { type: role } },
      OR: [{ districtId }, { stateId, districtId: null }, { jurisdictionLevel: "NATIONAL" }],
    },
    select: { id: true, fullName: true, districtId: true, stateId: true, jurisdictionLevel: true },
  });
  if (candidates.length === 0) return null;
  const rank = (c: (typeof candidates)[number]) =>
    c.districtId === districtId ? 0 : c.stateId === stateId ? 1 : 2;
  return candidates.sort((a, b) => rank(a) - rank(b)).map(({ id, fullName }) => ({ id, fullName }))[0];
}

export async function fileGrievance(input: FileGrievanceInput): Promise<FileGrievanceResult> {
  const def = categoryFor(input.category);

  const parcel = await prisma.landParcel.findUnique({
    where: { id: input.parcelId },
    include: {
      village: { select: { name: true } },
      district: { select: { id: true, name: true, stateId: true, state: { select: { name: true } } } },
      project: { select: { name: true, governingAct: true } },
      proposal: { select: { id: true, referenceNo: true } },
      owners: { select: { ownerId: true } },
    },
  });
  if (!parcel) throw new Error("Plot not found");
  if (input.ownerId && !parcel.owners.some((o) => o.ownerId === input.ownerId)) {
    throw new Error("That plot is not recorded in your name");
  }

  const act: AcquisitionAct = parcel.project.governingAct;
  const route = def.route(act);
  const authorityRole = AUTHORITY_ROLE[route.authority](act);

  const answers = validateAnswers(def, input.answers);
  const representation = composeRepresentation(def, answers, {
    objectorName: input.objectorName,
    khasraNo: parcel.khasraNo,
    village: parcel.village.name,
    district: parcel.district.name,
    state: parcel.district.state.name,
    projectName: parcel.project.name,
    proposalRef: parcel.proposal?.referenceNo ?? null,
    section: route.section,
    authorityLabel: route.authorityLabel,
  });

  // An identical complaint filed twice helps nobody and buries the first one.
  const duplicate = await prisma.grievance.count({
    where: {
      filedByUserId: input.filedByUserId,
      parcelId: parcel.id,
      category: input.category,
      decidedAt: null,
      status: { notIn: ["WITHDRAWN", "RESOLVED", "REJECTED"] },
    },
  });
  if (duplicate > 0) {
    throw new Error("You already have an open grievance of this kind on this plot. Its progress is on this page.");
  }

  // Track 1 — the statutory objection, where this category is one and the window is open.
  let objectionId: string | null = null;
  let objectionNote: string | null = null;
  if (def.statutoryObjection && parcel.proposalId) {
    const window = await objectionWindow(parcel.proposalId);
    if (window.open) {
      try {
        const objection = await fileObjection({
          proposalId: parcel.proposalId,
          parcelId: parcel.id,
          objectorName: input.objectorName,
          grounds: representation,
          filedByUserId: input.filedByUserId,
          objectorOwnerId: input.ownerId ?? null,
          actorId: input.filedByUserId,
        });
        objectionId = objection.id;
        objectionNote = `Also filed as a formal objection under ${route.section}. You will be given a hearing date before it is decided.`;
      } catch (e) {
        // An objection already pending on this plot is not a reason to lose
        // the representation; record it and say so.
        objectionNote = `Recorded as a representation. ${e instanceof Error ? e.message : "The statutory objection could not be filed."}`;
      }
    } else {
      objectionNote = `Recorded as a representation rather than a formal objection. ${window.reason ?? ""}`.trim();
    }
  }

  const authority = await resolveAuthority(authorityRole, parcel.district.id, parcel.district.stateId);

  // Track 2 — the grievance record itself.
  const grievance = await createWithReference(
    () => nextGrievanceReference(parcel.district.state.name, parcel.district.name),
    (referenceNo) =>
      prisma.grievance.create({
        data: {
          referenceNo,
          category: input.category,
          proposalId: parcel.proposalId,
          parcelId: parcel.id,
          filedByUserId: input.filedByUserId,
          ownerId: input.ownerId ?? null,
          detailsJson: answers as unknown as Prisma.InputJsonValue,
          representation,
          statuteSection: route.section,
          authorityLabel: route.authorityLabel,
          authorityRole,
          assignedToId: authority?.id ?? null,
          objectionId,
        },
      }),
  );

  // Track 3 — tell the authority.
  if (authority) {
    const urgent = input.category === "POSSESSION_BEFORE_PAYMENT";
    await prisma.alert.create({
      data: {
        type: urgent ? "GRIEVANCE_URGENT" : "GRIEVANCE_FILED",
        severity: urgent ? "CRITICAL" : "WARNING",
        title: `${urgent ? "Urgent: " : ""}${def.title.en}`,
        message:
          `${input.objectorName} has filed ${grievance.referenceNo} about khasra ${parcel.khasraNo}, ${parcel.village.name}` +
          ` — ${parcel.project.name}. Route: ${route.section}.`,
        proposalId: parcel.proposalId,
        recipientId: authority.id,
        channels: ["IN_APP"],
      },
    });
  }

  await appendAudit({
    actorId: input.filedByUserId,
    action: "CREATE",
    entityType: "Grievance",
    entityId: grievance.id,
    afterJson: {
      referenceNo: grievance.referenceNo,
      category: input.category,
      parcelId: parcel.id,
      statuteSection: route.section,
      authorityRole,
      assignedToId: authority?.id ?? null,
      objectionId,
    },
  });

  return {
    id: grievance.id,
    referenceNo: grievance.referenceNo,
    statuteSection: route.section,
    authorityLabel: route.authorityLabel,
    objectionId,
    objectionNote,
    assignedTo: authority?.fullName ?? null,
  };
}
