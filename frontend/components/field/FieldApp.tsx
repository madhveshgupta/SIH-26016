"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Camera, PenLine, X, Crosshair } from "lucide-react";
import {
  allSurveys, getCache, isSupported, markSurvey, newClientId, putCache, removeSurvey, saveSurvey,
  type QueuedSurvey,
} from "@frontend/lib/offline/queue";
import FieldDashboard from "./FieldDashboard";
import { useT } from "@frontend/components/I18nProvider";
import type { MessageKey } from "@backend/i18n/types";

export interface FieldParcel {
  id: string;
  khasraNo: string;
  status: string;
  hasConflict: boolean;
  recordedHa: number;
  mappedHa: number | null;
  lat: number | null;
  lng: number | null;
  village: string;
  district: string;
  project: string;
  owners: string[];
  lastSurveyedAt: string | null;
}

/** The online/offline flag, straight from the browser. */
function subscribeToConnection(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** What a survey can record — FieldSurveyKind; the names are screens.surveyKind.<KIND>. */
const KINDS = [
  "JOINT_MEASUREMENT", "STRUCTURE_ENUMERATION", "CROP_AND_TREE", "FAMILY_SURVEY", "POSSESSION_PROOF", "ANOMALY_VERIFICATION",
] as const;

/** The field app. */
export default function FieldApp({ parcels: initialParcels, surveyorName }: { parcels: FieldParcel[]; surveyorName: string }) {
  const t = useT();
  const [parcels, setParcels] = useState<FieldParcel[]>(initialParcels);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const [queue, setQueue] = useState<QueuedSurvey[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [active, setActive] = useState<FieldParcel | null>(null);

  const refreshQueue = useCallback(async () => {
    if (!isSupported()) return;
    setQueue(await allSurveys());
  }, []);

  // The browser owns this, so read it from the browser rather than mirroring
  // it into state and keeping the two in step.
  const online = useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true);

  // Offline first: show whatever the device already has, then update it.
  useEffect(() => {
    void (async () => {
      if (!isSupported()) return;
      const cached = await getCache<FieldParcel[]>("parcels");
      if (cached && initialParcels.length === 0) setParcels(cached.value);
      if (cached) setCachedAt(cached.at);
      if (initialParcels.length > 0) {
        await putCache("parcels", initialParcels);
        setCachedAt(new Date().toISOString());
      }
      await refreshQueue();
    })();
  }, [initialParcels, refreshQueue]);

  /** Hand everything on the device to the server, one survey at a time. */
  const sync = useCallback(async () => {
    if (!navigator.onLine) {
      setNote(t("screens.field.stillOffline"));
      return;
    }
    const pending = (await allSurveys()).filter((s) => s.status !== "syncing");
    if (pending.length === 0) {
      setNote(t("screens.field.nothingToSync"));
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch("/api/field/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surveys: pending.map((s) => ({
            clientId: s.clientId, parcelId: s.parcelId, kind: s.kind, capturedAt: s.capturedAt,
            boundary: s.boundary, accuracyM: s.accuracyM, findings: s.findings, notes: s.notes,
            photos: s.photos, signatureDataUrl: s.signatureDataUrl, signedBy: s.signedBy,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(data.error ?? t("screens.field.serverRefused"));
        return;
      }
      // Clear exactly what the server confirmed, and keep the rest with its reason.
      for (const stored of data.stored ?? []) await removeSurvey(stored.clientId);
      for (const bad of data.rejected ?? []) {
        await markSurvey(bad.clientId, { status: "failed", lastError: bad.error });
      }
      const kept = (data.rejected ?? []).length;
      const stored = (data.stored ?? []).length;
      const handed = t(stored === 1 ? "screens.field.handedOverOne" : "screens.field.handedOverMany", { count: stored });
      setNote(kept ? `${handed} · ${t("screens.field.keptRefused", { count: kept })}` : handed);
    } catch {
      setNote(t("screens.field.dropped"));
    } finally {
      setSyncing(false);
      await refreshQueue();
    }
  }, [refreshQueue, t]);

  // Hand everything over as soon as the signal returns.
  useEffect(() => {
    if (!online) return;
    const timer = setTimeout(() => void sync(), 0);
    return () => clearTimeout(timer);
  }, [online, sync]);

  if (active) {
    return (
      <SurveyForm
        parcel={active}
        surveyorName={surveyorName}
        onCancel={() => setActive(null)}
        onSaved={async () => {
          setActive(null);
          await refreshQueue();
          setNote(t("screens.field.savedOnPhone"));
          if (navigator.onLine) void sync();
        }}
      />
    );
  }

  return (
    <FieldDashboard 
      parcels={parcels}
      queue={queue}
      online={online}
      syncing={syncing}
      cachedAt={cachedAt}
      onSync={sync}
      onSelectPlot={(p) => setActive(p)}
      note={note}
      onClearNote={() => setNote(null)}
    />
  );
}

/** One survey: walk the boundary, photograph it, note what is on it, get it signed. */
function SurveyForm({
  parcel,
  surveyorName,
  onCancel,
  onSaved,
}: {
  parcel: FieldParcel;
  surveyorName: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<string>(KINDS[0]);
  const [boundary, setBoundary] = useState<[number, number][]>([]);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [photos, setPhotos] = useState<{ dataUrl: string; lat: number; lng: number; takenAt: string }[]>([]);
  const [notes, setNotes] = useState("");
  const [structures, setStructures] = useState("");
  const [trees, setTrees] = useState("");
  const [crop, setCrop] = useState("");
  const [signedBy, setSignedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const signed = useRef(false);

  /** One GPS reading, at the accuracy the phone can manage. */
  const readPosition = () =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (!("geolocation" in navigator)) return reject(new Error(t("screens.field.noGps")));
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });

  const addPoint = async () => {
    setLocating(true);
    setGpsError(null);
    try {
      const pos = await readPosition();
      setBoundary((b) => [...b, [Number(pos.coords.longitude.toFixed(7)), Number(pos.coords.latitude.toFixed(7))]]);
      setAccuracy(Math.round(pos.coords.accuracy));
    } catch (e) {
      // A position error carries the browser's own English wording; ours is translated.
      setGpsError(e instanceof Error ? e.message : t("screens.field.noFix"));
    } finally {
      setLocating(false);
    }
  };

  /** A photograph is evidence only if it says where and when it was taken. */
  const addPhoto = async (file: File) => {
    const dataUrl = await downscale(file);
    let lat = 0, lng = 0;
    try {
      const pos = await readPosition();
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch {
      /* a photo with no fix is still worth keeping; it is marked as such */
    }
    setPhotos((p) => [...p, { dataUrl, lat, lng, takenAt: new Date().toISOString() }]);
  };

  const save = async () => {
    setSaving(true);
    const canvas = canvasRef.current;
    const survey: QueuedSurvey = {
      clientId: newClientId(),
      parcelId: parcel.id,
      parcelLabel: `${parcel.khasraNo}, ${parcel.village}`,
      kind,
      capturedAt: new Date().toISOString(),
      boundary,
      accuracyM: accuracy,
      findings: {
        structures: structures.trim() || null,
        trees: trees.trim() || null,
        standingCrop: crop.trim() || null,
        surveyor: surveyorName,
      },
      notes: notes.trim(),
      photos,
      signatureDataUrl: signed.current && canvas ? canvas.toDataURL("image/png") : undefined,
      signedBy: signedBy.trim() || undefined,
      status: "pending",
      attempts: 0,
    };
    await saveSurvey(survey);
    setSaving(false);
    onSaved();
  };

  // --- signature pad --------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";

    const pos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      };
    };
    const down = (e: PointerEvent) => {
      drawing.current = true;
      signed.current = true;
      const { x, y } = pos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drawing.current) return;
      const { x, y } = pos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    };
    const up = () => { drawing.current = false; };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", up);
    };
  }, []);

  const walked = boundary.length >= 3 ? approximateArea(boundary) : null;
  const difference = walked && parcel.recordedHa ? ((walked - parcel.recordedHa) / parcel.recordedHa) * 100 : null;

  return (
    <div className="mx-auto max-w-xl px-4 pb-28 pt-4">
      <button onClick={onCancel} className="text-xs text-muted hover:text-foreground">{t("screens.field.allPlots")}</button>
      <h1 className="mt-1 font-mono text-lg font-semibold text-foreground">{parcel.khasraNo}</h1>
      <p className="text-xs text-muted">
        {t("screens.field.plotLine", { village: parcel.village, district: parcel.district, ha: parcel.recordedHa.toFixed(4), project: parcel.project })}
      </p>

      <label className="mt-4 block text-xs font-medium text-foreground">
        {t("screens.field.whatRecording")}
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm"
        >
          {KINDS.map((value) => <option key={value} value={value}>{t(`screens.surveyKind.${value}` as MessageKey)}</option>)}
        </select>
      </label>

      {/* --- boundary walk --- */}
      <section className="mt-4 rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t("screens.field.walkBoundary")}</h2>
          <span className="text-[11px] text-muted">
            {t(boundary.length === 1 ? "screens.field.pointsOne" : "screens.field.pointsMany", { count: boundary.length })}
            {accuracy ? ` · ±${t("screens.plotRecord.metres", { m: accuracy })}` : ""}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted">{t("screens.field.standAtCorner")}</p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => void addPoint()}
            disabled={locating}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-3 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            <Crosshair className={`h-4 w-4 ${locating ? "animate-pulse" : ""}`} />
            {locating ? t("screens.field.gettingFix") : t("screens.field.dropPoint")}
          </button>
          <button
            onClick={() => setBoundary((b) => b.slice(0, -1))}
            disabled={boundary.length === 0}
            className="rounded-lg border border-border px-3 text-sm disabled:opacity-40"
          >
            {t("screens.field.undo")}
          </button>
        </div>
        {gpsError && <p className="mt-2 rounded-lg bg-danger-soft px-2 py-1.5 text-[11px] text-danger">{gpsError}</p>}
        {walked !== null && (
          <p className={`mt-2 rounded-lg px-2 py-1.5 text-[11px] ${Math.abs(difference ?? 0) > 10 ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`}>
            {t("screens.field.walkedArea", { ha: walked.toFixed(4) })}
            {difference !== null && ` · ${t("screens.parcelPage.againstRecord", { pct: `${difference > 0 ? "+" : ""}${difference.toFixed(1)}` })}`}
            {Math.abs(difference ?? 0) > 10 && ` — ${t("screens.field.recheck")}`}
          </p>
        )}
      </section>

      {/* --- photographs --- */}
      <section className="mt-3 rounded-xl border border-border bg-surface p-3">
        <h2 className="text-sm font-semibold text-foreground">{t("screens.field.photographs")}</h2>
        <p className="mt-0.5 text-[11px] text-muted">{t("screens.field.photoDesc")}</p>
        <label className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-sm text-brand">
          <Camera className="h-4 w-4" />
          {t("screens.field.takePhoto")}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void addPhoto(file);
              e.target.value = "";
            }}
          />
        </label>
        {photos.length > 0 && (
          <ul className="mt-2 grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <li key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl} alt={t("screens.field.photoAlt", { n: i + 1 })} className="h-24 w-full rounded-lg object-cover" />
                <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/60 px-1 py-0.5 text-[9px] text-white">
                  {p.lat ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : t("screens.field.noGpsFix")}
                </span>
                <button
                  onClick={() => setPhotos((all) => all.filter((_, j) => j !== i))}
                  aria-label={t("screens.field.removePhoto")}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- what is on the land --- */}
      <section className="mt-3 space-y-2 rounded-xl border border-border bg-surface p-3">
        <h2 className="text-sm font-semibold text-foreground">{t("screens.field.onLand")}</h2>
        <p className="text-[11px] text-muted">{t("screens.field.onLandDesc")}</p>
        {[
          [t("screens.field.structures"), structures, setStructures, t("screens.field.structuresPh")],
          [t("screens.field.trees"), trees, setTrees, t("screens.field.treesPh")],
          [t("screens.field.crop"), crop, setCrop, t("screens.field.cropPh")],
        ].map(([label, value, set, placeholder]) => (
          <label key={label as string} className="block text-xs text-muted">
            {label as string}
            <input
              value={value as string}
              onChange={(e) => (set as (v: string) => void)(e.target.value)}
              placeholder={placeholder as string}
              className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
            />
          </label>
        ))}
        <label className="block text-xs text-muted">
          {t("screens.field.notes")}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
          />
        </label>
      </section>

      {/* --- signature --- */}
      <section className="mt-3 rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <PenLine className="h-4 w-4" /> {t("screens.field.signature")}
          </h2>
          <button
            onClick={() => {
              const ctx = canvasRef.current?.getContext("2d");
              if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
              signed.current = false;
            }}
            className="text-[11px] text-muted"
          >
            {t("screens.field.clear")}
          </button>
        </div>
        <canvas ref={canvasRef} width={560} height={160} className="mt-2 h-32 w-full touch-none rounded-lg border border-dashed border-border bg-surface" />
        <input
          value={signedBy}
          onChange={(e) => setSignedBy(e.target.value)}
          placeholder={t("screens.field.signerPh")}
          className="mt-2 h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
        />
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface p-3">
        <div className="mx-auto flex max-w-xl gap-2">
          <button onClick={onCancel} className="rounded-lg border border-border px-4 py-3 text-sm">{t("common.cancel")}</button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex-1 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? t("screens.field.savingPhone") : t("screens.field.saveSurvey")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shrink a photo before it goes into IndexedDB: a phone camera file is megabytes. */
function downscale(file: File, maxEdge = 1280, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(String(reader.result));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(String(reader.result));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Area of the walked ring, in hectares — the shoelace formula on a local equirectangular
 * projection.
 */
function approximateArea(ring: [number, number][]): number {
  const latMean = (ring.reduce((a, p) => a + p[1], 0) / ring.length) * (Math.PI / 180);
  const mPerDegLat = 111_132.92 - 559.82 * Math.cos(2 * latMean) + 1.175 * Math.cos(4 * latMean);
  const mPerDegLng = 111_412.84 * Math.cos(latMean) - 93.5 * Math.cos(3 * latMean);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = [ring[j][0] * mPerDegLng, ring[j][1] * mPerDegLat];
    const [x2, y2] = [ring[i][0] * mPerDegLng, ring[i][1] * mPerDegLat];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2) / 10_000;
}
