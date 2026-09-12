/** Document repository — upload, versioning and access history. */
import { randomBytes } from "node:crypto";
import { prisma } from "@backend/db/client";
import { appendAudit } from "@backend/audit/chain";
import { storage, objectKey } from "@backend/storage";

/** Categories tied to the workflow stages that produce them. */
export const DOCUMENT_CATEGORIES = [
  "SIA_REPORT", "EXPERT_GROUP_REPORT", "PRELIMINARY_NOTIFICATION", "OBJECTION",
  "DECLARATION", "AWARD_STATEMENT", "CADASTRAL_MAP", "PAYMENT_PROOF",
  "POSSESSION_CERTIFICATE", "RNR_AWARD", "CONSENT_FORM", "OTHER",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<string, string> = {
  SIA_REPORT: "Social Impact Assessment report",
  EXPERT_GROUP_REPORT: "Expert Group report",
  PRELIMINARY_NOTIFICATION: "Preliminary notification",
  OBJECTION: "Objection",
  DECLARATION: "Declaration",
  AWARD_STATEMENT: "Award statement",
  CADASTRAL_MAP: "Cadastral map",
  PAYMENT_PROOF: "Payment proof",
  POSSESSION_CERTIFICATE: "Possession certificate",
  RNR_AWARD: "R&R award",
  CONSENT_FORM: "Consent form",
  OTHER: "Other",
};

/** Accepted types. A portal taking uploads from thousands of field users is an
 *  obvious malware entry point, so the list is explicit rather than permissive. */
const ALLOWED_MIME = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/tiff",
  "application/vnd.google-earth.kml+xml", "application/geo+json", "text/csv",
]);
const MAX_BYTES = 25 * 1024 * 1024;

export interface UploadInput {
  title: string;
  category: DocumentCategory;
  proposalId?: string | null;
  uploadedById: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
  /** Supply to add a version to an existing document rather than create one. */
  documentId?: string;
}

export interface UploadResult {
  documentId: string;
  version: number;
  verificationCode: string | null;
  checksum: string;
}

/** Short human-quotable code printed with a QR on generated documents. */
function verificationCode(): string {
  return randomBytes(5).toString("hex").toUpperCase();
}

export async function uploadDocument(input: UploadInput): Promise<UploadResult> {
  if (input.data.byteLength === 0) throw new Error("File is empty");
  if (input.data.byteLength > MAX_BYTES) {
    throw new Error(`File exceeds the ${MAX_BYTES / 1024 / 1024} MB limit`);
  }
  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw new Error(`File type not accepted: ${input.mimeType}`);
  }

  const doc = input.documentId
    ? await prisma.document.findUnique({ where: { id: input.documentId } })
    : null;

  const document =
    doc ??
    (await prisma.document.create({
      data: {
        title: input.title,
        category: input.category,
        proposalId: input.proposalId ?? null,
        uploadedById: input.uploadedById,
        currentVersion: 0,
        verificationCode: verificationCode(),
      },
    }));

  const version = document.currentVersion + 1;
  const key = objectKey(document.id, version, input.fileName);
  const stored = await storage().put(key, input.data, input.mimeType);

  await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      version,
      storageKey: key,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      uploadedById: input.uploadedById,
    },
  });

  await prisma.document.update({
    where: { id: document.id },
    data: { currentVersion: version },
  });

  await appendAudit({
    actorId: input.uploadedById,
    action: doc ? "UPDATE" : "CREATE",
    entityType: "Document",
    entityId: document.id,
    afterJson: { version, fileName: input.fileName, checksum: stored.checksum },
  });

  return {
    documentId: document.id,
    version,
    verificationCode: document.verificationCode,
    checksum: stored.checksum,
  };
}

/** Fetch a version's bytes and record who looked. */
export async function readDocument(
  documentId: string,
  version: number | null,
  actorId: string,
  ipAddress?: string | null,
): Promise<{ data: Buffer; fileName: string; mimeType: string; version: number }> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      versions: { orderBy: { version: "desc" } },
    },
  });
  if (!doc) throw new Error("Document not found");

  const v = version
    ? doc.versions.find((x) => x.version === version)
    : doc.versions[0];
  if (!v) throw new Error(`Version ${version} not found`);

  const data = await storage().get(v.storageKey);

  await appendAudit({
    actorId,
    action: "DOWNLOAD",
    entityType: "DocumentVersion",
    entityId: v.id,
    afterJson: { documentId, version: v.version, fileName: v.fileName },
    ipAddress,
  });

  return { data, fileName: v.fileName, mimeType: v.mimeType, version: v.version };
}

/** Who has opened this document, most recent first. */
export async function accessHistory(documentId: string, limit = 50) {
  const versions = await prisma.documentVersion.findMany({
    where: { documentId },
    select: { id: true, version: true },
  });
  const ids = versions.map((v) => v.id);
  if (ids.length === 0) return [];

  const rows = await prisma.auditLog.findMany({
    where: { entityType: "DocumentVersion", entityId: { in: ids } },
    orderBy: { sequence: "desc" },
    take: limit,
    include: { actor: { select: { fullName: true, email: true } } },
  });

  return rows.map((r) => ({
    at: r.createdAt,
    actor: r.actor?.fullName ?? "Unknown",
    email: r.actor?.email ?? null,
    action: r.action,
    ipAddress: r.ipAddress,
    version: versions.find((v) => v.id === r.entityId)?.version ?? null,
  }));
}
