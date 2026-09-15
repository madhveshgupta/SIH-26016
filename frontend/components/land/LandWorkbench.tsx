"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Crosshair, MousePointer2, Route, Trash2, X } from "lucide-react";
import type { CandidatePlot, LookupCode } from "@backend/projects/land-selection";
import { Badge, Button, Field, Input, Select, Textarea } from "@frontend/components/ui";
import { useToast } from "@frontend/components/ui/Toast";
import { cn } from "@frontend/lib/cn";
import type { PickerTool } from "./LandPickerMap";
import { useT } from "@frontend/components/I18nProvider";
import type { MessageKey } from "@backend/i18n/types";
import { rich } from "@frontend/lib/rich";

function MapLoading() {
  const t = useT();
  return <div className="flex h-[max(420px,calc(100dvh-320px))] items-center justify-center rounded-xl border border-border text-xs text-muted">{t("screens.parcelPage.loadingMap")}</div>;
}

const LandPickerMap = dynamic(() => import("./LandPickerMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

export interface DistrictOption {
  id: string;
  name: string;
  state: string;
  plots: number;
  liveCadastre: boolean;
}

type Mode =
  | { kind: "create"; agencies: { id: string; name: string }[] | null }
  | { kind: "edit"; projectId: string; rightOfWayM: number | null };

/** ProjectType and AcquisitionAct; the names are screens.projectType.* and screens.act.*. */
const TYPES = [
  "HIGHWAY", "RAILWAY", "IRRIGATION", "INDUSTRIAL_CORRIDOR", "URBAN_DEVELOPMENT", "RENEWABLE_ENERGY", "MINING", "DEFENCE", "OTHER",
] as const;

const ACTS = ["LARR_2013", "NH_ACT_1956", "RAILWAYS_ACT_1989", "STATE_ACT"] as const;

/** The Act that ordinarily governs each kind of project. */
const DEFAULT_ACT: Record<string, string> = { HIGHWAY: "NH_ACT_1956", RAILWAY: "RAILWAYS_ACT_1989" };

const TOOLS: { key: PickerTool; label: MessageKey; hint: MessageKey; icon: typeof MousePointer2 }[] = [
  { key: "select", label: "screens.landWb.toolSelect", hint: "screens.landWb.toolSelectHint", icon: MousePointer2 },
  { key: "line", label: "screens.landWb.toolLine", hint: "screens.landWb.toolLineHint", icon: Route },
  { key: "lookup", label: "screens.landWb.toolLookup", hint: "screens.landWb.toolLookupHint", icon: Crosshair },
];

const ha = (p: CandidatePlot) => p.recordHa ?? p.mapHa ?? 0;

export default function LandWorkbench({ districts, initialDistrictId, mode }: { districts: DistrictOption[]; initialDistrictId: string | null; mode: Mode }) {
  const t = useT();
  const plotsN = (n: number) => t(n === 1 ? "screens.globe.plotsOne" : "screens.globe.plotsMany", { count: n });
  const router = useRouter();
  const toast = useToast();
  const [districtId, setDistrictId] = useState<string>(initialDistrictId ?? districts[0]?.id ?? "");
  const [known, setKnown] = useState<Map<string, CandidatePlot>>(new Map());
  const [shownKeys, setShownKeys] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [tool, setTool] = useState<PickerTool>("select");
  const [line, setLine] = useState<[number, number][]>([]);
  const [row, setRow] = useState<number>(mode.kind === "edit" ? mode.rightOfWayM ?? 30 : 30);
  const [note, setNote] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Project details (create only).
  const [name, setName] = useState("");
  const [type, setType] = useState("HIGHWAY");
  const [act, setAct] = useState("NH_ACT_1956");
  const [agencyId, setAgencyId] = useState(mode.kind === "create" ? mode.agencies?.[0]?.id ?? "" : "");
  const [cost, setCost] = useState("");
  const [description, setDescription] = useState("");

  const projectId = mode.kind === "edit" ? mode.projectId : undefined;
  const district = districts.find((d) => d.id === districtId);
  const loading = loadedFor !== districtId;

  // Load the district's mapped plots. Selections elsewhere are kept.
  useEffect(() => {
    if (!districtId) return;
    let cancelled = false;
    const q = new URLSearchParams({ districtId, ...(projectId ? { projectId } : {}) });
    fetch(`/api/land/candidates?${q}`)
      .then((r) => r.json())
      .then((d: { plots?: CandidatePlot[] }) => {
        if (cancelled) return;
        const plots = d.plots ?? [];
        setKnown((prev) => {
          const next = new Map(prev);
          for (const p of plots) next.set(p.key, p);
          return next;
        });
        // A project's own plots start selected.
        setSelected((prev) => {
          const next = new Set(prev);
          for (const p of plots) if (p.inProject) next.add(p.key);
          return next;
        });
        setShownKeys((prev) => [...plots.map((p) => p.key), ...prev.filter((k) => k.startsWith("live:"))]);
      })
      .finally(() => !cancelled && setLoadedFor(districtId));
    return () => {
      cancelled = true;
    };
  }, [districtId, projectId]);

  const shown = useMemo(() => shownKeys.flatMap((k) => (known.get(k) ? [known.get(k)!] : [])).filter((p) => p.district === district?.name || p.source === "LIVE"), [shownKeys, known, district]);
  const chosen = useMemo(() => [...selected].flatMap((k) => (known.get(k) ? [known.get(k)!] : [])), [selected, known]);

  const toggle = useCallback(
    (key: string) => {
      const p = known.get(key);
      if (p?.inProject && !p.inProject.editable) {
        setNote({ tone: "warn", text: t("screens.landWb.lockedNote", { no: p.khasraNo }) });
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [known, t],
  );

  const lookup = useCallback(
    async (lat: number, lng: number) => {
      setNote({ tone: "info", text: t("screens.landWb.asking") });
      const res = await fetch("/api/land/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ districtId, lat, lng, projectId }),
      });
      const d = (await res.json().catch(() => ({}))) as { plot?: CandidatePlot | null; code?: LookupCode; khasraNo?: string; error?: string };
      const found = d.code ? t(`screens.landWb.lk_${d.code}` as MessageKey, { no: d.khasraNo ?? "" }) : null;
      if (!res.ok || !d.plot) return setNote({ tone: "warn", text: d.error ?? found ?? t("screens.landWb.lk_none") });
      const plot = d.plot;
      setKnown((prev) => new Map(prev).set(plot.key, plot));
      setShownKeys((prev) => (prev.includes(plot.key) ? prev : [...prev, plot.key]));
      setSelected((prev) => new Set(prev).add(plot.key));
      setNote({
        tone: plot.claimedBy.length ? "warn" : "info",
        text: [
          found,
          t("screens.landWb.added"),
          plot.claimedBy.length ? t("screens.landWb.alreadyClaimed", { projects: plot.claimedBy.map((c) => c.name).join(", ") }) : "",
        ].filter(Boolean).join(" "),
      });
    },
    [districtId, projectId, t],
  );

  const onMapClick = useCallback(
    (lat: number, lng: number) => {
      if (tool === "line") setLine((l) => [...l, [lat, lng]]);
      else if (tool === "lookup") void lookup(lat, lng);
    },
    [tool, lookup],
  );

  const takeCorridor = async () => {
    setBusy(true);
    const res = await fetch("/api/land/corridor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ districtId, line: line.map(([lat, lng]) => [lng, lat]), rightOfWayM: row }),
    });
    const d = (await res.json().catch(() => ({}))) as { keys?: string[]; error?: string };
    setBusy(false);
    if (!res.ok) return setNote({ tone: "warn", text: d.error ?? t("screens.landWb.corridorFailed") });
    const keys = (d.keys ?? []).filter((k) => !(known.get(k)?.inProject && !known.get(k)!.inProject!.editable));
    setSelected((prev) => new Set([...prev, ...keys]));
    setNote({
      tone: "info",
      text: keys.length
        ? t(keys.length === 1 ? "screens.landWb.corridorOne" : "screens.landWb.corridorMany", { count: keys.length, m: row })
        : t("screens.landWb.corridorNone"),
    });
  };

  const picks = () => ({
    record: [...selected].filter((k) => k.startsWith("rec:") && !known.get(k)?.inProject),
    live: [...selected].flatMap((k) => {
      const p = known.get(k);
      return k.startsWith("live:") && p?.live && p.signature ? [{ live: p.live, signature: p.signature }] : [];
    }),
  });

  const removals = [...known.values()].filter((p) => p.inProject?.editable && !selected.has(p.key)).map((p) => p.inProject!.parcelId);
  const additions = picks();
  const changes = additions.record.length + additions.live.length + removals.length;

  const submit = async () => {
    setBusy(true);
    try {
      if (mode.kind === "create") {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name, type, governingAct: act, agencyId, description, estimatedCostCrore: cost,
            alignment: line.length >= 2 ? line.map(([lat, lng]) => [lng, lat]) : null,
            rightOfWayM: row,
            picks: additions,
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) return setNote({ tone: "warn", text: d.error ?? t("screens.landWb.createFailed") });
        toast({
          tone: d.conflicts ? "warning" : "success",
          title: t("screens.landWb.created", { ref: d.referenceNo }),
          message: [
            t("screens.landWb.createdMsg", { plots: plotsN(d.parcels) }),
            d.conflicts ? t("screens.landWb.createdConflicts", { count: d.conflicts }) : "",
          ].filter(Boolean).join(" "),
        });
        router.push(`/projects/${d.id}`);
      } else {
        const res = await fetch(`/api/projects/${mode.projectId}/land`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ add: additions, remove: removals }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) return setNote({ tone: "warn", text: d.error ?? t("screens.landWb.saveFailed") });
        toast({ tone: "success", title: t("screens.landWb.landUpdated"), message: t("screens.landWb.addedRemoved", { added: d.added, removed: d.removed }) });
        router.push(`/projects/${mode.projectId}`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const conflicts = chosen.filter((p) => p.claimedBy.length > 0);
  const byVillage = useMemo(() => {
    const m = new Map<string, CandidatePlot[]>();
    for (const p of chosen) m.set(`${p.village}, ${p.district}`, [...(m.get(`${p.village}, ${p.district}`) ?? []), p]);
    return [...m.entries()];
  }, [chosen]);
  const states = useMemo(() => [...new Set(districts.map((d) => d.state))], [districts]);
  const canSubmit = mode.kind === "create" ? name.trim().length >= 5 && selected.size > 0 && (!mode.agencies || agencyId) : changes > 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("screens.landWb.district")} className="min-w-[260px] flex-1">
            <Select value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
              {states.map((s) => (
                <optgroup key={s} label={s}>
                  {districts.filter((d) => d.state === s).map((d) => (
                    <option key={d.id} value={d.id}>
                      {t(d.liveCadastre ? "screens.landWb.districtOptionLive" : "screens.landWb.districtOption", { name: d.name, plots: plotsN(d.plots) })}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("screens.landWb.mapTool")}>
            {TOOLS.map((tl) => {
              const disabled = tl.key === "lookup" && !district?.liveCadastre;
              return (
                <button
                  key={tl.key}
                  role="tab"
                  aria-selected={tool === tl.key}
                  disabled={disabled}
                  title={disabled ? t("screens.landWb.noCadastre") : t(tl.hint)}
                  onClick={() => setTool(tl.key)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                    tool === tl.key ? "border-brand bg-brand text-white" : "border-border bg-surface hover:bg-surface-muted",
                  )}
                >
                  <tl.icon className="h-4 w-4" aria-hidden />
                  {t(tl.label)}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-muted">{t(TOOLS.find((tl) => tl.key === tool)!.hint)}</p>

        {tool === "line" && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
            <Field label={t("screens.landWb.rowLabel")} className="w-36">
              <Input type="number" min={5} max={500} value={row} onChange={(e) => setRow(Number(e.target.value))} />
            </Field>
            <span className="pb-2 text-xs text-muted">{t(line.length === 1 ? "screens.field.pointsOne" : "screens.field.pointsMany", { count: line.length })}</span>
            <Button size="sm" variant="secondary" disabled={line.length === 0} onClick={() => setLine((l) => l.slice(0, -1))}>{t("screens.landWb.undoPoint")}</Button>
            <Button size="sm" variant="ghost" disabled={line.length === 0} onClick={() => setLine([])}>{t("screens.field.clear")}</Button>
            <Button size="sm" loading={busy} disabled={line.length < 2 || !(row >= 5 && row <= 500)} onClick={takeCorridor}>
              {t("screens.landWb.selectInRow")}
            </Button>
          </div>
        )}

        {note && (
          <div className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-xs", note.tone === "warn" ? "bg-warning-soft text-warning" : "bg-info-soft text-info")}>
            <span className="flex-1">{note.text}</span>
            <button aria-label={t("screens.field.dismiss")} onClick={() => setNote(null)}><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        <div className="relative">
          <LandPickerMap
            plots={shown}
            selected={selected}
            tool={tool}
            line={line}
            rightOfWayM={row}
            fitKey={districtId}
            onTogglePlot={toggle}
            onMapClick={onMapClick}
            // The rest of the window below the page header and the tools, so the
            // whole map is on screen when the page opens.
            height="max(420px, calc(100dvh - 320px))"
          />
          {loading && (
            <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
              <span className="rounded bg-black/60 px-2 py-1 text-xs text-white">{t("screens.landWb.loadingPlots")}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          <Legend swatch="border-2 border-yellow-300" label={t("screens.mapPanel.legendCadastral")} />
          <Legend swatch="border-2 border-dashed border-white bg-slate-400" label={t("screens.landWb.legendGenerated")} />
          <Legend swatch="border-2 border-cyan-400" label={t("screens.landWb.legendLive")} />
          <Legend swatch="border-2 border-dashed border-red-400 bg-red-400/30" label={t("screens.landWb.legendClaimed")} />
          <Legend swatch="bg-blue-600" label={t("screens.field.selected")} />
          {mode.kind === "edit" && <Legend swatch="bg-slate-500" label={t("screens.landWb.legendLocked")} />}
        </div>
      </div>

      <aside className="space-y-4">
        {mode.kind === "create" && (
          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">{t("common.project")}</h2>
            <Field label={t("screens.plotRecord.name")} required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("screens.landWb.namePh")} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("screens.plotRecord.type")} required>
                <Select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value);
                    setAct(DEFAULT_ACT[e.target.value] ?? "LARR_2013");
                  }}
                >
                  {TYPES.map((v) => <option key={v} value={v}>{t(`screens.projectType.${v}`)}</option>)}
                </Select>
              </Field>
              <Field label={t("screens.landWb.actLabel")} required>
                <Select value={act} onChange={(e) => setAct(e.target.value)}>
                  {ACTS.map((v) => <option key={v} value={v}>{t(`screens.act.${v}`)}</option>)}
                </Select>
              </Field>
            </div>
            {mode.agencies && (
              <Field label={t("screens.landWb.agency")} required>
                <Select value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                  {mode.agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label={t("screens.landWb.cost")} hint={t("screens.landWb.costHint")}>
              <Input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
            <Field label={t("screens.proposalDetail.publicPurpose")}>
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("screens.landWb.landChosen")}</h2>
            <span className="text-xs tabular-nums text-muted">
              {plotsN(chosen.length)} · {t("screens.units.ha", { value: chosen.reduce((s, p) => s + ha(p), 0).toFixed(4) })}
            </span>
          </div>

          {conflicts.length > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {t(conflicts.length === 1 ? "screens.landWb.conflictsOne" : "screens.landWb.conflictsMany", { count: conflicts.length })}
              </span>
            </div>
          )}

          {chosen.length === 0 ? (
            <p className="mt-3 text-xs text-muted">{t("screens.landWb.noneChosen")}</p>
          ) : (
            <div className="mt-3 max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {byVillage.map(([village, list]) => (
                <div key={village}>
                  <div className="text-[11px] font-medium text-muted">{village}</div>
                  <ul className="mt-1 divide-y divide-border">
                    {list.map((p) => (
                      <li key={p.key} className="flex items-center gap-2 py-1.5 text-xs">
                        <span className="w-20 shrink-0 truncate font-mono">{p.khasraNo}</span>
                        <span className="flex-1 tabular-nums text-muted">{t("screens.units.ha", { value: ha(p).toFixed(4) })}</span>
                        {p.source === "LIVE" && <Badge tone="info">{t("screens.landWb.tagLive")}</Badge>}
                        {p.claimedBy.length > 0 && <Badge tone="danger">{t("screens.landWb.tagClaimed")}</Badge>}
                        {p.inProject && !p.inProject.editable ? (
                          <Badge tone="neutral">{t("screens.landWb.tagLocked")}</Badge>
                        ) : (
                          <button aria-label={t("screens.landWb.removeKhasra", { no: p.khasraNo })} onClick={() => toggle(p.key)} className="text-muted hover:text-danger">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {mode.kind === "edit" && (
            <p className="mt-3 text-xs text-muted">
              {t("screens.landWb.toAddRemove", { add: additions.record.length + additions.live.length, remove: removals.length })}
            </p>
          )}

          <Button className="mt-4 w-full" loading={busy} disabled={!canSubmit} onClick={submit}>
            {mode.kind === "create" ? t("screens.landWb.createBtn") : t("screens.landWb.saveBtn")}
          </Button>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            {rich(t("screens.landWb.footNote"), { proposed: <em>{t("stages.proposed")}</em> })}
          </p>
        </div>
      </aside>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2.5 w-4 rounded-sm", swatch)} />
      {label}
    </span>
  );
}
