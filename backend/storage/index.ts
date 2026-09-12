/** Object storage behind one interface. */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredObject {
  key: string;
  sizeBytes: number;
  /** SHA-256 of the PLAINTEXT, so integrity can be checked after decryption. */
  checksum: string;
}

export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  readonly name: string;
}

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Derive the data key from the app secret. In production this is a KMS key. */
function dataKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  if (secret.length < 16) {
    throw new Error("NEXTAUTH_SECRET must be set before documents can be stored");
  }
  // Changing the salt derives a different key: every stored document must be
  // re-encrypted in the same step, or it stops decrypting.
  return scryptSync(secret, "bhoomi-nayan-documents", 32);
}

export function encrypt(plain: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dataKey(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  // iv || authTag || ciphertext — self-describing, so no sidecar metadata.
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(blob: Buffer): Buffer {
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, dataKey(), iv);
  decipher.setAuthTag(tag);
  // Throws if the ciphertext was tampered with — GCM authenticates as well as
  // encrypts, so a modified document fails loudly rather than decoding to junk.
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function checksum(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Local filesystem driver. Same interface as the S3 one would have. */
class LocalDriver implements StorageDriver {
  readonly name = "local-filesystem";
  constructor(private root: string) {}

  private path(key: string) {
    // Keys are app-generated, but refuse traversal anyway.
    if (key.includes("..")) throw new Error("Invalid storage key");
    return join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<StoredObject> {
    const plainChecksum = checksum(data);
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, encrypt(data));
    return { key, sizeBytes: data.byteLength, checksum: plainChecksum };
  }

  async get(key: string): Promise<Buffer> {
    return decrypt(await readFile(this.path(key)));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}

let driver: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (driver) return driver;
  // When MinIO/S3 is configured, an S3Driver would be returned here instead.
  driver = new LocalDriver(process.env.STORAGE_ROOT ?? ".storage");
  return driver;
}

/** Deterministic key: documents/<documentId>/v<version>/<filename>. */
export function objectKey(documentId: string, version: number, fileName: string): string {
  const safe = fileName.replace(/[^\w.\-]/g, "_").slice(0, 120);
  return `documents/${documentId}/v${version}/${safe}`;
}
