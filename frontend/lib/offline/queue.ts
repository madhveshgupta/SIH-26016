"use client";

/** The offline queue. */

const DB_NAME = "bhoomi-field";
const DB_VERSION = 1;
const SURVEYS = "surveys";
const CACHE = "cache";

export type QueueStatus = "pending" | "syncing" | "failed";

export interface QueuedSurvey {
  clientId: string;
  parcelId: string;
  parcelLabel: string;
  kind: string;
  capturedAt: string;
  boundary: [number, number][];
  accuracyM: number | null;
  findings: Record<string, unknown>;
  notes: string;
  photos: { dataUrl: string; lat: number; lng: number; takenAt: string; caption?: string }[];
  signatureDataUrl?: string;
  signedBy?: string;
  status: QueueStatus;
  attempts: number;
  lastError?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SURVEYS)) db.createObjectStore(SURVEYS, { keyPath: "clientId" });
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = fn(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

/** Is there a usable IndexedDB here at all? (Private windows sometimes say no.) */
export function isSupported(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export function saveSurvey(survey: QueuedSurvey): Promise<void> {
  return run<void>(SURVEYS, "readwrite", (s) => s.put(survey));
}

export function allSurveys(): Promise<QueuedSurvey[]> {
  return run<QueuedSurvey[]>(SURVEYS, "readonly", (s) => s.getAll()).then((rows) =>
    rows.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)),
  );
}

export function removeSurvey(clientId: string): Promise<void> {
  return run<void>(SURVEYS, "readwrite", (s) => s.delete(clientId));
}

export async function markSurvey(clientId: string, changes: Partial<QueuedSurvey>): Promise<void> {
  const existing = await run<QueuedSurvey | undefined>(SURVEYS, "readonly", (s) => s.get(clientId));
  if (!existing) return;
  await saveSurvey({ ...existing, ...changes });
}

export function putCache<T>(key: string, value: T): Promise<void> {
  return run<void>(CACHE, "readwrite", (s) => s.put({ value, at: new Date().toISOString() }, key));
}

export function getCache<T>(key: string): Promise<{ value: T; at: string } | undefined> {
  return run<{ value: T; at: string } | undefined>(CACHE, "readonly", (s) => s.get(key));
}

/** A device-unique id for a survey. */
export function newClientId(): string {
  let device = localStorage.getItem("bhoomi-device-id");
  if (!device) {
    device = Math.random().toString(36).slice(2, 10);
    localStorage.setItem("bhoomi-device-id", device);
  }
  return `${device}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
