/**
 * Statutory notifications and objections — LARR ss.11, 15, 19, 21 and the National Highways Act
 * ss.3A, 3C, 3D.
 */
import { Prisma, type AcquisitionAct, type NotificationType, type ObjectionStatus, type ProposalStatus, type RoleType } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import { definitionFor, stageFor, transition } from "@backend/workflow/engine";
import { generateNotificationPdf } from "@backend/documents/generate";
import { uploadDocument } from "@backend/documents/service";
import { publishToGazette } from "@backend/integrations/adapters/egazette";
import { sendMessage } from "@backend/integrations/adapters/notify";

/** The channels the Act requires. All of them, not a selection. */
export const PUBLICATION_CHANNELS = [
  { key: "publishedGazette", label: "Official Gazette", required: true },
  { key: "publishedNewspaper1", label: "Newspaper (1st)", required: true },
  { key: "publishedNewspaper2", label: "Newspaper (2nd)", required: true },
  { key: "publishedLocalLang", label: "Regional language paper", required: true },
  { key: "publishedPanchayat", label: "Panchayat notice board", required: true },
  { key: "publishedWebsite", label: "Official website", required: true },
] as const;

export const NOTIFICATION_LABEL: Record<NotificationType, string> = {
  SEC_4_2_SIA: "Social Impact Assessment notification (s.4(2))",
  SEC_11_PRELIMINARY: "Preliminary notification (s.11)",
  SEC_19_DECLARATION: "Declaration of intended acquisition (s.19)",
  SEC_21_NOTICE: "Notice to persons interested (s.21)",
  NH_3A_PRELIMINARY: "Preliminary notification (s.3A, NH Act)",
  NH_3D_DECLARATION: "Declaration (s.3D, NH Act)",
  NH_3G_COMPENSATION: "Compensation determination (s.3G, NH Act)",
  CORRIGENDUM: "Corrigendum",
  WITHDRAWAL: "Withdrawal of notification",
};

export interface PublicationStatus {
  done: number;
  total: number;
  complete: boolean;
  missing: string[];
}

export function publicationStatus(n: Record<string, unknown>): PublicationStatus {
  const missing = PUBLICATION_CHANNELS.filter((c) => !n[c.key]).map((c) => c.label);
  return {
    done: PUBLICATION_CHANNELS.length - missing.length,
    total: PUBLICATION_CHANNELS.length,
    complete: missing.length === 0,
    missing,
  };
}

export interface IssueNotificationInput {
  proposalId: string;
  type: NotificationType;
  gazetteRef?: string;
  issuedOn?: Date;
  actorId: string;
  channels?: Partial<Record<(typeof PUBLICATION_CHANNELS)[number]["key"], boolean>>;
  /** Send it to the e-Gazette. */
  publish?: boolean;
}

/** Issue a notification and start the clock it governs. */
export async function issueNotification(input: IssueNotificationInput) {
  const proposal = await prisma.proposal.findUnique({
    where: { id: input.proposalId },
    include: { project: { select: { governingAct: true } } },
  });
  if (!proposal) throw new Error("Proposal not found");

  const issuedOn = input.issuedOn ?? new Date();

  // Which downstream stage does this notification start the clock for?
  const startsFor: Partial<Record<NotificationType, string>> = {
    SEC_11_PRELIMINARY: "SEC_19_DECLARATION",
    NH_3A_PRELIMINARY: "SEC_19_DECLARATION",
    SEC_19_DECLARATION: "AWARD_DECLARED",
    NH_3D_DECLARATION: "AWARD_DECLARED",
  };
  const nextStatus = startsFor[input.type];
  const nextStage = nextStatus
    ? stageFor(proposal.project.governingAct, nextStatus as never)
    : undefined;
  const startsDeadlineAt = nextStage?.statutoryDays
    ? new Date(issuedOn.getTime() + nextStage.statutoryDays * 86_400_000)
    : null;

  // Publication through the e-Gazette, where asked for.
  let gazetteRef = input.gazetteRef ?? null;
  let gazetteUrl: string | null = null;
  if (input.publish) {
    const state = await prisma.proposal.findUnique({
      where: { id: input.proposalId },
      select: { project: { select: { states: { select: { state: { select: { lgdCode: true } } }, take: 1 } } } },
    });
    const receipt = await publishToGazette({
      reference: `${input.proposalId}:${input.type}`,
      title: NOTIFICATION_LABEL[input.type],
      notificationType: input.type,
      stateCode: state?.project.states[0]?.state.lgdCode ?? "",
      issuedOn,
    });
    if (receipt.ok && receipt.data) {
      gazetteRef = receipt.data.gazetteRef;
      gazetteUrl = receipt.data.url;
    }
  }

  const created = await prisma.notification.create({
    data: {
      proposalId: input.proposalId,
      type: input.type,
      gazetteRef,
      issuedOn,
      startsDeadlineAt,
      publishedGazette: input.channels?.publishedGazette ?? Boolean(gazetteRef && input.publish),
      publishedNewspaper1: input.channels?.publishedNewspaper1 ?? false,
      publishedNewspaper2: input.channels?.publishedNewspaper2 ?? false,
      publishedLocalLang: input.channels?.publishedLocalLang ?? false,
      publishedPanchayat: input.channels?.publishedPanchayat ?? false,
      publishedWebsite: input.channels?.publishedWebsite ?? false,
    },
  });

  // Parcels covered by a preliminary notification become NOTIFIED — from this
  // date they cannot lawfully be sold or transferred.
  if (input.type === "SEC_11_PRELIMINARY" || input.type === "NH_3A_PRELIMINARY") {
    await prisma.landParcel.updateMany({
      where: { proposalId: input.proposalId, status: "PROPOSED" },
      data: { status: "NOTIFIED" },
    });
  }

  await appendAudit({
    actorId: input.actorId,
    action: "CREATE",
    entityType: "Notification",
    entityId: created.id,
    afterJson: { type: input.type, issuedOn, startsDeadlineAt, gazetteRef, gazetteUrl },
  });

  return created;
}

/**
 * Which notification each stage publishes, by Act, and whether publishing it completes the
 * stage.
 */
const DUE_AT: Record<"LARR_2013" | "NH_ACT_1956", Partial<Record<ProposalStatus, { type: NotificationType; completesStage: boolean }>>> = {
  LARR_2013: {
    SIA_ORDERED: { type: "SEC_4_2_SIA", completesStage: false },
    SIA_STUDY: { type: "SEC_4_2_SIA", completesStage: false },
    SEC_11_PRELIM_NOTIFICATION: { type: "SEC_11_PRELIMINARY", completesStage: true },
    SEC_19_DECLARATION: { type: "SEC_19_DECLARATION", completesStage: true },
    SEC_21_NOTICE: { type: "SEC_21_NOTICE", completesStage: true },
  },
  NH_ACT_1956: {
    SEC_11_PRELIM_NOTIFICATION: { type: "NH_3A_PRELIMINARY", completesStage: true },
    SEC_19_DECLARATION: { type: "NH_3D_DECLARATION", completesStage: true },
    AWARD_ENQUIRY: { type: "NH_3G_COMPENSATION", completesStage: false },
  },
};

export interface NotificationDue {
  type: NotificationType;
  label: string;
  /** Where the case goes once it is published, when publishing completes the stage. */
  advancesTo: ProposalStatus | null;
  advancesToLabel: string | null;
}

/** The notification this case should publish at its current stage, if any. */
export function notificationDue(act: AcquisitionAct, status: ProposalStatus): NotificationDue | null {
  const def = definitionFor(act);
  const due = DUE_AT[def.act as keyof typeof DUE_AT]?.[status];
  if (!due) return null;
  const stage = def.stages.find((s) => s.status === status);
  // The last entry of `next` is the stage's default forward path.
  const advancesTo = due.completesStage ? (stage?.next.at(-1) ?? null) : null;
  return {
    type: due.type,
    label: NOTIFICATION_LABEL[due.type],
    advancesTo,
    advancesToLabel: advancesTo ? (def.stages.find((s) => s.status === advancesTo)?.label ?? advancesTo) : null,
  };
}

/** Every status at which some Act publishes a notification — for list queries. */
export const STATUSES_WITH_NOTIFICATION: ProposalStatus[] = [
  ...new Set(Object.values(DUE_AT).flatMap((m) => Object.keys(m) as ProposalStatus[])),
];

export type ChannelKey = (typeof PUBLICATION_CHANNELS)[number]["key"];

export interface IssueFromDeskInput {
  proposalId: string;
  type: NotificationType;
  /** The date printed on the notification. Not in the future. */
  issuedOn: Date;
  gazetteRef?: string | null;
  /** Send to the e-Gazette; its number becomes the gazette reference. */
  publish: boolean;
  /** Channels already published in, as of issue. The rest are recorded later. */
  channels: ChannelKey[];
  /** Move the case on when publishing completes the stage. */
  advance: boolean;
  actorId: string;
  actorRole: RoleType;
}

export interface IssueFromDeskResult {
  notificationId: string;
  gazetteRef: string | null;
  documentId: string | null;
  advancedTo: ProposalStatus | null;
  /** Things that did not happen, in words the officer can act on. Issue still stands. */
  warnings: string[];
}

/** Issue a notification from an officer's desk. */
export async function issueFromDesk(input: IssueFromDeskInput): Promise<IssueFromDeskResult> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: input.proposalId },
    select: {
      id: true,
      referenceNo: true,
      status: true,
      project: { select: { governingAct: true } },
      stages: { where: { exitedAt: null }, orderBy: { enteredAt: "desc" }, take: 1, select: { enteredAt: true } },
    },
  });
  if (!proposal) throw new Error("Case not found");

  const act = proposal.project.governingAct;
  const due = notificationDue(act, proposal.status);
  const stageLabel = stageFor(act, proposal.status)?.label ?? proposal.status;
  if (!due) throw new Error(`No notification is published at “${stageLabel}”.`);
  if (due.type !== input.type) {
    throw new Error(`At “${stageLabel}” this case publishes the ${due.label}, not the ${NOTIFICATION_LABEL[input.type]}.`);
  }

  const already = await prisma.notification.findFirst({
    where: { proposalId: proposal.id, type: input.type },
    select: { issuedOn: true },
  });
  if (already) {
    throw new Error(`The ${due.label} for this case was already issued on ${already.issuedOn.toISOString().slice(0, 10)}.`);
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (Number.isNaN(input.issuedOn.getTime()) || input.issuedOn > today) {
    throw new Error("A notification cannot be dated in the future.");
  }
  const entered = proposal.stages[0]?.enteredAt;
  if (entered && input.issuedOn.toISOString().slice(0, 10) < entered.toISOString().slice(0, 10)) {
    throw new Error(`The case reached “${stageLabel}” on ${entered.toISOString().slice(0, 10)}; the notification cannot be dated before that.`);
  }

  const channels = Object.fromEntries(input.channels.map((k) => [k, true])) as IssueNotificationInput["channels"];
  const created = await issueNotification({
    proposalId: proposal.id,
    type: input.type,
    issuedOn: input.issuedOn,
    gazetteRef: input.gazetteRef ?? undefined,
    publish: input.publish,
    channels,
    actorId: input.actorId,
  });

  const warnings: string[] = [];
  if (input.publish && !created.gazetteRef) {
    warnings.push("The e-Gazette did not confirm publication. Record the gazette number when it is published.");
  }

  // The notification itself, as a filed and versioned document.
  let documentId: string | null = null;
  const pdfKind =
    input.type === "SEC_11_PRELIMINARY" || input.type === "NH_3A_PRELIMINARY" ? "PRELIMINARY"
    : input.type === "SEC_19_DECLARATION" || input.type === "NH_3D_DECLARATION" ? "DECLARATION"
    : null;
  if (pdfKind) {
    try {
      const gen = await generateNotificationPdf(proposal.id, pdfKind);
      const doc = await uploadDocument({
        title: gen.title,
        category: pdfKind === "PRELIMINARY" ? "PRELIMINARY_NOTIFICATION" : "DECLARATION",
        proposalId: proposal.id,
        uploadedById: input.actorId,
        fileName: `${proposal.referenceNo.replaceAll("/", "-")}-${input.type.toLowerCase()}.pdf`,
        mimeType: "application/pdf",
        data: gen.pdf,
      });
      documentId = doc.documentId;
      await prisma.notification.update({ where: { id: created.id }, data: { documentId } });
    } catch (e) {
      warnings.push(`The PDF could not be generated (${(e as Error).message}). Upload the signed copy under Documents.`);
    }
  }

  let advancedTo: ProposalStatus | null = null;
  if (input.advance && due.advancesTo) {
    const moved = await transition({
      proposalId: proposal.id,
      to: due.advancesTo,
      action: "FORWARD",
      actorId: input.actorId,
      actorRole: input.actorRole,
      remarks: `${due.label} issued on ${input.issuedOn.toISOString().slice(0, 10)}${created.gazetteRef ? `, gazette ${created.gazetteRef}` : ""}.`,
    });
    if (moved.ok) advancedTo = due.advancesTo;
    else warnings.push(`The case stays at “${stageLabel}”: ${moved.message ?? moved.error}. The officer holding it can move it on.`);
  }

  return { notificationId: created.id, gazetteRef: created.gazetteRef, documentId, advancedTo, warnings };
}

/** Cases waiting for their notification: at a stage that publishes one, and not yet published. */
export async function awaitingNotification(where: Prisma.ProposalWhereInput) {
  const cases = await prisma.proposal.findMany({
    where: { AND: [where, { status: { in: STATUSES_WITH_NOTIFICATION } }] },
    select: {
      id: true,
      referenceNo: true,
      status: true,
      project: { select: { name: true, governingAct: true } },
      stages: { where: { exitedAt: null }, orderBy: { enteredAt: "desc" }, take: 1, select: { enteredAt: true } },
      notifications: { select: { type: true } },
    },
    orderBy: { referenceNo: "asc" },
  });
  return cases.flatMap((c) => {
    const due = notificationDue(c.project.governingAct, c.status);
    if (!due || c.notifications.some((n) => n.type === due.type)) return [];
    return [{
      proposalId: c.id,
      referenceNo: c.referenceNo,
      projectName: c.project.name,
      type: due.type,
      label: due.label,
      stageLabel: stageFor(c.project.governingAct, c.status)?.label ?? c.status,
      act: c.project.governingAct,
      status: c.status,
      enteredOn: (c.stages[0]?.enteredAt ?? new Date(0)).toISOString().slice(0, 10),
      advancesTo: due.advancesTo,
      advancesToLabel: due.advancesToLabel,
    }];
  });
}

/**
 * Record publication in channels that came after issue — the newspapers and the Panchayat board
 * are rarely on the same day as the Gazette.
 */
export async function recordPublication(notificationId: string, channels: ChannelKey[], actorId: string) {
  const before = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!before) throw new Error("Notification not found");
  const fresh = channels.filter((k) => !before[k]);
  if (fresh.length === 0) throw new Error("Those channels are already recorded as published.");

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: Object.fromEntries(fresh.map((k) => [k, true])),
  });
  await appendAudit({
    actorId,
    action: "UPDATE",
    entityType: "Notification",
    entityId: notificationId,
    beforeJson: Object.fromEntries(fresh.map((k) => [k, false])),
    afterJson: Object.fromEntries(fresh.map((k) => [k, true])),
  });
  return { notification: updated, status: publicationStatus(updated as never) };
}

/** Who hears and decides objections, by statute. */
export const OBJECTION_AUTHORITY: Record<AcquisitionAct, RoleType[]> = {
  LARR_2013: ["DISTRICT_COLLECTOR", "SUPER_ADMIN"],
  STATE_ACT: ["DISTRICT_COLLECTOR", "SUPER_ADMIN"],
  NH_ACT_1956: ["LAND_ACQUIRING_AUTHORITY", "SUPER_ADMIN"],
  RAILWAYS_ACT_1989: ["LAND_ACQUIRING_AUTHORITY", "SUPER_ADMIN"],
};

export function mayHearObjections(act: AcquisitionAct, role: RoleType): boolean {
  return OBJECTION_AUTHORITY[act]?.includes(role) ?? false;
}

/** An objection still waiting for a decision. */
export const OPEN_OBJECTION = { decidedAt: null, status: { not: "WITHDRAWN" as ObjectionStatus } };

export interface ObjectionWindow {
  open: boolean;
  closesAt: Date | null;
  /** Why it is not open, in words a landowner can act on. */
  reason: string | null;
  /** The same reason as a code, so a page can say it in the reader's language. */
  code: "NOT_FOUND" | "NOT_YET" | "OVER" | "CLOSED" | null;
}

/** Is the case taking objections today? */
export async function objectionWindow(proposalId: string, now = new Date()): Promise<ObjectionWindow> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: {
      project: { select: { governingAct: true } },
      stages: { where: { exitedAt: null }, orderBy: { enteredAt: "desc" }, take: 1 },
    },
  });
  if (!proposal) return { open: false, closesAt: null, reason: "Case not found", code: "NOT_FOUND" };

  const chain = definitionFor(proposal.project.governingAct).stages.map((s) => s.status);
  if (proposal.status !== "OBJECTIONS") {
    const before = chain.indexOf(proposal.status) < chain.indexOf("OBJECTIONS") && chain.includes(proposal.status);
    return {
      open: false,
      closesAt: null,
      reason: before
        ? "Objections open once the preliminary notification is published."
        : "The objection period for this case is over.",
      code: before ? "NOT_YET" : "OVER",
    };
  }

  const stage = proposal.stages[0];
  const days = stageFor(proposal.project.governingAct, "OBJECTIONS")?.statutoryDays ?? null;
  const closesAt =
    stage?.statutoryDeadline ??
    (stage && days ? new Date(stage.enteredAt.getTime() + days * 86_400_000) : null);
  if (closesAt && now > closesAt) {
    return { open: false, closesAt, reason: `The objection period closed on ${closesAt.toISOString().slice(0, 10)}.`, code: "CLOSED" };
  }
  return { open: true, closesAt, reason: null, code: null };
}

export interface FileObjectionInput {
  proposalId: string;
  parcelId?: string | null;
  objectorName: string;
  objectorPhone?: string;
  grounds: string;
  /** Set when a landowner files it themselves through the citizen portal. */
  filedByUserId?: string | null;
  /** The objector's Owner record. */
  objectorOwnerId?: string | null;
  actorId?: string | null;
}

export async function fileObjection(input: FileObjectionInput) {
  if (input.grounds.trim().length < 10) {
    throw new Error("State the grounds of the objection");
  }
  if (!input.objectorName.trim()) throw new Error("The objector's name is required");

  const window = await objectionWindow(input.proposalId);
  if (!window.open) throw new Error(window.reason ?? "Objections are not being received for this case");

  if (input.parcelId) {
    const parcel = await prisma.landParcel.findUnique({
      where: { id: input.parcelId },
      select: { proposalId: true, status: true, owners: { select: { ownerId: true } } },
    });
    if (!parcel || parcel.proposalId !== input.proposalId) {
      throw new Error("That plot is not part of this acquisition case");
    }
    if (input.objectorOwnerId && !parcel.owners.some((o) => o.ownerId === input.objectorOwnerId)) {
      throw new Error("That plot is not recorded in your name");
    }
    if (parcel.status === "WITHDRAWN") throw new Error("That plot has already been left out of the acquisition");
  }

  if (input.filedByUserId) {
    const pending = await prisma.objection.count({
      where: { ...OPEN_OBJECTION, filedByUserId: input.filedByUserId, proposalId: input.proposalId, parcelId: input.parcelId ?? null },
    });
    if (pending > 0) throw new Error("You already have an objection pending on this plot");
  }

  let objection;
  try {
    objection = await prisma.objection.create({
      data: {
        proposalId: input.proposalId,
        parcelId: input.parcelId ?? null,
        objectorName: input.objectorName.trim(),
        objectorPhone: input.objectorPhone ?? null,
        grounds: input.grounds.trim(),
        filedByUserId: input.filedByUserId ?? null,
        status: "FILED",
      },
    });
  } catch (e) {
    // A partial unique index backs the duplicate check above, so a double
    // click that races past it is still refused (prisma/sql/postgis-setup.sql).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error("You already have an objection pending on this plot");
    }
    throw e;
  }

  // Only a notified plot moves to "under objection" — never one already
  // awarded, paid for or possessed.
  if (input.parcelId) {
    await prisma.landParcel.updateMany({
      where: { id: input.parcelId, status: { in: ["PROPOSED", "NOTIFIED"] } },
      data: { status: "OBJECTED" },
    });
  }

  await appendAudit({
    actorId: input.filedByUserId ?? input.actorId ?? null,
    action: "CREATE",
    entityType: "Objection",
    entityId: objection.id,
    afterJson: { proposalId: input.proposalId, parcelId: input.parcelId ?? null, objectorName: objection.objectorName },
  });

  return objection;
}

/** The number to tell, where the objection was filed through the portal. */
async function objectorPhoneFor(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
  return user?.phone ?? null;
}

async function objectionForAuthority(objectionId: string, actorRole: RoleType) {
  const objection = await prisma.objection.findUnique({
    where: { id: objectionId },
    include: { proposal: { select: { project: { select: { governingAct: true } } } } },
  });
  if (!objection) throw new Error("Objection not found");
  const act = objection.proposal.project.governingAct;
  if (!mayHearObjections(act, actorRole)) {
    throw new Error(
      act === "LARR_2013" || act === "STATE_ACT"
        ? "Under LARR s.15 objections are heard and decided by the Collector."
        : "Under this Act objections are heard and decided by the competent authority (CALA).",
    );
  }
  if (objection.decidedAt || objection.status === "WITHDRAWN") {
    throw new Error("This objection has already been disposed of");
  }
  return objection;
}

export interface ScheduleHearingInput {
  objectionId: string;
  hearingDate: Date;
  actorId: string;
  actorRole: RoleType;
}

/** List (or re-list) the hearing the objector is entitled to. */
export async function scheduleHearing(input: ScheduleHearingInput) {
  const before = await objectionForAuthority(input.objectionId, input.actorRole);
  if (Number.isNaN(input.hearingDate.getTime())) throw new Error("Give a valid hearing date");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (input.hearingDate < today) throw new Error("A hearing cannot be listed in the past");

  const updated = await prisma.objection.update({
    where: { id: input.objectionId },
    data: { status: "HEARING_SCHEDULED", hearingDate: input.hearingDate },
  });

  await appendAudit({
    actorId: input.actorId,
    action: "UPDATE",
    entityType: "Objection",
    entityId: updated.id,
    beforeJson: { status: before.status, hearingDate: before.hearingDate },
    afterJson: { status: updated.status, hearingDate: updated.hearingDate },
  });

  // A hearing nobody was told about is not a hearing.
  const phone = updated.objectorPhone ?? (await objectorPhoneFor(updated.filedByUserId));
  if (phone) {
    await sendMessage({
      channel: "SMS",
      to: phone,
      about: "objection hearing listed",
      body: `Bhoomi Nayan: your objection will be heard on ${input.hearingDate.toISOString().slice(0, 10)}. You may attend in person or send a representative.`,
    });
  }
  return updated;
}

export interface DisposeObjectionInput {
  objectionId: string;
  status: Extract<ObjectionStatus, "ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED">;
  decision: string;
  decisionReasons: string;
  actorId: string;
  actorRole: RoleType;
}

/** Dispose of an objection. */
export async function disposeObjection(input: DisposeObjectionInput) {
  if (input.decisionReasons.trim().length < 20) {
    throw new Error(
      "Written reasons are required. An objection disposed without reasons is liable to be set aside on review.",
    );
  }
  if (!input.decision.trim()) throw new Error("Record the decision");

  const before = await objectionForAuthority(input.objectionId, input.actorRole);
  if (!before.hearingDate || before.hearingDate > new Date()) {
    throw new Error("The objector must be heard before the objection is decided. List a hearing first.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Conditional on still being undecided, inside the transaction: two
    // officers pressing the button at the same moment would otherwise both
    // pass the check above and both write a decision, leaving two disposals
    // and two audit entries for one objection.
    const claimed = await tx.objection.updateMany({
      where: { id: input.objectionId, decidedAt: null, status: { not: "WITHDRAWN" } },
      data: {
        status: input.status,
        decision: input.decision.trim(),
        decisionReasons: input.decisionReasons.trim(),
        decidedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw new Error("This objection has already been disposed of");
    const o = await tx.objection.findUniqueOrThrow({ where: { id: input.objectionId } });
    if (o.parcelId) {
      if (input.status === "ACCEPTED") {
        await tx.landParcel.update({ where: { id: o.parcelId }, data: { status: "WITHDRAWN" } });
      } else {
        const stillOpen = await tx.objection.count({ where: { ...OPEN_OBJECTION, parcelId: o.parcelId } });
        if (stillOpen === 0) {
          await tx.landParcel.updateMany({ where: { id: o.parcelId, status: "OBJECTED" }, data: { status: "NOTIFIED" } });
        }
      }
    }
    return o;
  });

  const decidedPhone = updated.objectorPhone ?? (await objectorPhoneFor(updated.filedByUserId));
  if (decidedPhone) {
    await sendMessage({
      channel: "SMS",
      to: decidedPhone,
      about: "objection decided",
      body:
        input.status === "ACCEPTED"
          ? "Bhoomi Nayan: your objection has been accepted and your plot is left out of the acquisition. Written reasons are on your My Land page."
          : `Bhoomi Nayan: your objection has been ${input.status === "REJECTED" ? "rejected" : "partly accepted"}. The written reasons are on your My Land page.`,
    });
  }

  await appendAudit({
    actorId: input.actorId,
    action: "UPDATE",
    entityType: "Objection",
    entityId: updated.id,
    beforeJson: { status: before.status },
    afterJson: {
      status: input.status,
      reasons: input.decisionReasons,
      parcelOutcome: updated.parcelId ? (input.status === "ACCEPTED" ? "WITHDRAWN" : "NOTIFIED") : null,
    },
  });

  return updated;
}

export const OBJECTION_LABEL: Record<ObjectionStatus, string> = {
  FILED: "Filed",
  UNDER_REVIEW: "Under review",
  HEARING_SCHEDULED: "Hearing scheduled",
  HEARD: "Heard",
  ACCEPTED: "Accepted",
  PARTIALLY_ACCEPTED: "Partially accepted",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

/** Consent percentage against the statutory threshold. */
export async function consentStatus(proposalId: string) {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: { project: { select: { isPPP: true, isPrivateCompany: true } }, consents: true },
  });
  if (!proposal) return null;

  const required = proposal.project.isPrivateCompany ? 80 : proposal.project.isPPP ? 70 : 0;
  if (required === 0) return null;

  const total = proposal.consents.length;
  const granted = proposal.consents.filter((c) => c.status === "GRANTED").length;
  const pct = total === 0 ? 0 : Math.round((granted / total) * 100);

  return { required, granted, total, pct, met: pct >= required };
}
