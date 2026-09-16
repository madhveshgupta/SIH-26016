/** Field surveys — what a patwari records standing on the plot. */
import { Prisma, type FieldSurveyKind } from "@prisma/client";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import { scopeForParcel, type Actor } from "@backend/rbac/scope";
import { lngLat } from "@backend/validation/request";

export interface SurveyPhoto {
  /** Data URL captured on the device. */
  dataUrl?: string;
  documentId?: string;
  lat: number;
  lng: number;
  takenAt: string;
  caption?: string;
}

export interface SurveyInput {
  clientId: string;
  parcelId: string;
  kind: FieldSurveyKind;
  capturedAt: string;
  boundary?: [number, number][];
  accuracyM?: number;
  findings?: Record<string, unknown>;
  notes?: string;
  photos?: SurveyPhoto[];
  signatureDataUrl?: string;
  signedBy?: string;
}

const KINDS: FieldSurveyKind[] = [
  "JOINT_MEASUREMENT", "STRUCTURE_ENUMERATION", "CROP_AND_TREE",
  "FAMILY_SURVEY", "POSSESSION_PROOF", "ANOMALY_VERIFICATION",
];

export const SURVEY_LABEL: Record<FieldSurveyKind, string> = {
  JOINT_MEASUREMENT: "Joint measurement",
  STRUCTURE_ENUMERATION: "Structures",
  CROP_AND_TREE: "Crops and trees",
  FAMILY_SURVEY: "Family survey (R&R)",
  POSSESSION_PROOF: "Possession proof",
  ANOMALY_VERIFICATION: "Verification of a flagged plot",
};

/** Area of a walked boundary, in hectares, computed by PostGIS on the spheroid. */
async function walkedArea(boundary: [number, number][]): Promise<number | null> {
  if (boundary.length < 3) return null;
  const ring = [...boundary, boundary[0]];
  const geojson = JSON.stringify({ type: "Polygon", coordinates: [ring] });
  const rows = await prisma.$queryRaw<{ ha: number }[]>`
    SELECT (ST_Area(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326))::geography) / 10000)::float8 AS ha;
  `;
  return rows[0]?.ha ?? null;
}

/** Accept one survey from a device. */
export async function receiveSurvey(input: SurveyInput, actor: Actor) {
  if (!input.clientId || input.clientId.length > 80) throw new Error("The survey is missing its device reference");
  const kind = KINDS.find((k) => k === input.kind) ?? "JOINT_MEASUREMENT";

  // Scoped: a surveyor can only record against land in their own jurisdiction.
  const parcel = await prisma.landParcel.findFirst({
    where: { AND: [scopeForParcel(actor), { id: input.parcelId }] },
    select: { id: true, khasraNo: true, declaredAreaHectares: true },
  });
  if (!parcel) throw new Error("That plot is not in your jurisdiction");

  const capturedAt = new Date(input.capturedAt);
  if (Number.isNaN(capturedAt.getTime())) throw new Error("The survey has no valid capture time");
  // A phone clock can be wrong, but not by years.
  const now = Date.now();
  if (capturedAt.getTime() > now + 86_400_000 || capturedAt.getTime() < now - 365 * 86_400_000) {
    throw new Error("The device clock looks wrong — check the date on the phone");
  }

  const boundary = (input.boundary ?? []).map((p) => lngLat(p)).filter(Boolean) as [number, number][];
  if ((input.boundary?.length ?? 0) > 0 && boundary.length !== input.boundary!.length) {
    throw new Error("Some boundary points are outside India — check the GPS fix");
  }
  const area = boundary.length >= 3 ? await walkedArea(boundary) : null;

  const data = {
    kind,
    capturedAt,
    boundary: boundary.length ? (boundary as never) : Prisma.JsonNull,
    accuracyM: input.accuracyM != null ? new Prisma.Decimal(Math.min(999, Math.max(0, input.accuracyM)).toFixed(2)) : null,
    walkedAreaHectares: area != null ? new Prisma.Decimal(area.toFixed(4)) : null,
    findings: (input.findings ?? Prisma.JsonNull) as never,
    notes: input.notes?.slice(0, 4000) ?? null,
    photos: (input.photos ?? Prisma.JsonNull) as never,
    signedBy: input.signedBy?.slice(0, 200) ?? null,
  };

  const survey = await prisma.fieldSurvey.upsert({
    where: { clientId: input.clientId },
    // A resend updates the same row; the surveyor and plot never change.
    update: { ...data, syncedAt: new Date() },
    create: { ...data, clientId: input.clientId, parcelId: parcel.id, surveyorId: actor.id },
  });

  await appendAudit({
    actorId: actor.id,
    action: "CREATE",
    entityType: "FieldSurvey",
    entityId: survey.id,
    afterJson: {
      clientId: input.clientId, parcelId: parcel.id, khasra: parcel.khasraNo, kind,
      capturedAt, boundaryPoints: boundary.length, photos: input.photos?.length ?? 0,
      // How long the device was out of contact.
      offlineMinutes: Math.round((Date.now() - capturedAt.getTime()) / 60000),
    },
  });

  const recorded = Number(parcel.declaredAreaHectares);
  return {
    id: survey.id,
    clientId: survey.clientId,
    syncedAt: survey.syncedAt,
    walkedAreaHectares: area,
    // The number the surveyor came to check: does the walk match the record?
    differenceFromRecordPct: area && recorded ? Number((((area - recorded) / recorded) * 100).toFixed(1)) : null,
  };
}

/** Surveys for the plots an officer may see. */
export async function recentSurveys(actor: Actor, limit = 50) {
  return prisma.fieldSurvey.findMany({
    where: { parcel: scopeForParcel(actor) },
    orderBy: { capturedAt: "desc" },
    take: limit,
    select: {
      id: true, kind: true, capturedAt: true, syncedAt: true, notes: true, signedBy: true,
      walkedAreaHectares: true, accuracyM: true, boundary: true, photos: true,
      surveyor: { select: { fullName: true } },
      parcel: {
        select: {
          id: true, khasraNo: true, declaredAreaHectares: true,
          village: { select: { name: true } }, district: { select: { name: true } },
        },
      },
    },
  });
}

/** The plots a surveyor is expected to visit — cached on the device for offline use. */
export async function assignedParcels(actor: Actor, limit = 200, projectId?: string) {
  return prisma.landParcel.findMany({
    where: {
      AND: [
        scopeForParcel(actor),
        { status: { in: ["PROPOSED", "NOTIFIED", "OBJECTED", "AWARD_DECLARED"] } },
        projectId ? { projectId } : {},
      ],
    },
    orderBy: [{ hasConflict: "desc" }, { chainageM: "asc" }],
    take: limit,
    select: {
      id: true, khasraNo: true, status: true, hasConflict: true,
      declaredAreaHectares: true, computedAreaHectares: true,
      centroidLat: true, centroidLng: true,
      village: { select: { name: true } },
      district: { select: { name: true } },
      project: { select: { name: true } },
      owners: { select: { owner: { select: { fullName: true } } } },
      fieldSurveys: { select: { id: true, capturedAt: true }, orderBy: { capturedAt: "desc" }, take: 1 },
    },
  });
}
