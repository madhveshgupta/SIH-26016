"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Download, FileSpreadsheet, FileText, Play, Plus, Save, Table2, Trash2, X } from "lucide-react";
import type { ReportResult } from "@backend/reports/registry";
import { Badge, Button, Field, Input, Select } from "@frontend/components/ui";
import { useToast } from "@frontend/components/ui/Toast";
import { cn } from "@frontend/lib/cn";
import { useLocale, useT } from "@frontend/components/I18nProvider";
import type { MessageKey } from "@backend/i18n/types";

export interface ReportInfo {
  key: string;
  title: string;
  description: string;
  section: string;
}

export interface EntityInfo {
  key: string;
  label: string;
  description: string;
  fields: { key: string; label: string; numeric?: boolean }[];
}

export interface SavedReport {
  id: string;
  name: string;
  description: string | null;
  isShared: boolean;
  owned: boolean;
  definition: { entity: string; columns: string[]; groupBy?: string[]; aggregate?: { field: string; as: string }[] };
}

export interface ScheduleInfo {
  id: string;
  label: string;
  frequency: string;
  recipients: string[];
  format: string;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunNote: string | null;
  owned: boolean;
}

type Tab = "pack" | "builder" | "saved" | "schedules";

const AGGREGATES = ["count", "sum", "avg", "min", "max"] as const;

export default function ReportWorkbench({
  reports,
  entities,
  saved,
  schedules,
  mayExport,
}: {
  reports: ReportInfo[];
  entities: EntityInfo[];
  saved: SavedReport[];
  schedules: ScheduleInfo[];
  mayExport: boolean;
}) {
  const t = useT();
  const { intl } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("pack");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What produced the result on screen, so exports match it exactly. */
  const [source, setSource] = useState<{ key?: string; templateId?: string; definition?: unknown; name?: string } | null>(null);

  // --- builder state --------------------------------------------------------
  const [entityKey, setEntityKey] = useState(entities[0]?.key ?? "parcel");
  const entity = entities.find((e) => e.key === entityKey) ?? entities[0];
  const [columns, setColumns] = useState<string[]>(entity?.fields.slice(0, 5).map((f) => f.key) ?? []);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [aggregate, setAggregate] = useState<{ field: string; as: string }[]>([]);
  const [name, setName] = useState("");

  /** Switching entity resets the selection: its columns do not exist on the new one. */
  const chooseEntity = (key: string) => {
    const e = entities.find((x) => x.key === key);
    setEntityKey(key);
    setColumns(e?.fields.slice(0, 5).map((f) => f.key) ?? []);
    setGroupBy([]);
    setAggregate([]);
  };

  const run = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      setRunning(true);
      setError(null);
      const res = await fetch("/api/reports/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      setRunning(false);
      if (!res.ok) {
        setError(data.error ?? t("screens.reportPack.runFailed"));
        return;
      }
      setResult(data.report as ReportResult);
      setSource({ key: body.key as string, templateId: body.templateId as string, definition: body.definition, name: label });
    },
    [t],
  );

  const exportHref = (format: string) => {
    const params = new URLSearchParams({ format });
    if (source?.key) params.set("key", source.key);
    if (source?.templateId) params.set("template", source.templateId);
    return `/api/reports/export?${params}`;
  };

  const saveTemplate = async () => {
    if (!name.trim()) return toast({ tone: "warning", title: t("screens.reportPack.nameFirst") });
    const res = await fetch("/api/reports/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, definition: { entity: entityKey, columns, groupBy, aggregate } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast({ tone: "error", title: t("screens.reportPack.saveFailed"), message: data.error });
    toast({ tone: "success", title: t("screens.reportPack.saved"), message: t("screens.reportPack.savedMsg") });
    router.refresh();
  };

  const toggle = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  const grouped = useMemo(() => {
    const m = new Map<string, ReportInfo[]>();
    for (const r of reports) m.set(r.section, [...(m.get(r.section) ?? []), r]);
    return [...m.entries()];
  }, [reports]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "pack", label: t("screens.reportPack.tabPack"), count: reports.length },
    { key: "builder", label: t("screens.reportPack.tabBuilder") },
    { key: "saved", label: t("screens.reportPack.tabSaved"), count: saved.length },
    { key: "schedules", label: t("screens.reportPack.tabScheduled"), count: schedules.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            role="tab"
            aria-selected={tab === tb.key}
            onClick={() => setTab(tb.key)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              tab === tb.key ? "border-brand bg-brand text-white" : "border-border bg-surface hover:bg-surface-muted",
            )}
          >
            {tb.label}
            {tb.count !== undefined && <span className="ml-1.5 tabular-nums opacity-70">{tb.count}</span>}
          </button>
        ))}
      </div>

      {tab === "pack" && (
        <div className="space-y-4">
          {grouped.map(([section, list]) => (
            <div key={section}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{section}</h2>
              <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {list.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => run({ key: r.key }, r.title)}
                    className="rounded-xl border border-border bg-surface p-3 text-left transition hover:border-brand hover:shadow"
                  >
                    <div className="flex items-start gap-2">
                      <Table2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{r.title}</div>
                        <div className="mt-0.5 text-xs text-muted">{r.description}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "builder" && entity && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
            <Field label={t("screens.reportPack.reportOn")}>
              <Select value={entityKey} onChange={(e) => chooseEntity(e.target.value)}>
                {entities.map((e) => (
                  <option key={e.key} value={e.key}>{e.label}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("screens.reportPack.nameToSave")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("screens.reportPack.namePh")} />
            </Field>
          </div>

          <div className="mt-3">
            <div className="text-xs font-medium text-foreground">{t("screens.reportPack.columns")}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {entity.fields.map((f) => (
                <button
                  key={f.key}
                  onClick={() => toggle(columns, setColumns, f.key)}
                  className={cn(
                    "rounded-lg border px-2 py-1 text-xs",
                    columns.includes(f.key) ? "border-brand bg-brand-soft text-brand" : "border-border text-muted hover:bg-surface-muted",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-foreground">{t("screens.reportPack.groupBy")} <span className="font-normal text-muted">{t("screens.reportPack.optional")}</span></div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {entity.fields.filter((f) => !f.numeric).map((f) => (
                  <button
                    key={f.key}
                    onClick={() => toggle(groupBy, setGroupBy, f.key)}
                    className={cn(
                      "rounded-lg border px-2 py-1 text-xs",
                      groupBy.includes(f.key) ? "border-accent bg-accent-soft text-warning" : "border-border text-muted hover:bg-surface-muted",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-foreground">
                {t("screens.reportPack.summarise")} <span className="font-normal text-muted">{t("screens.reportPack.neededGrouping")}</span>
              </div>
              <div className="mt-1.5 space-y-1.5">
                {aggregate.map((a, i) => (
                  <div key={`${a.field}-${i}`} className="flex items-center gap-1.5">
                    <Select
                      className="h-8 text-xs"
                      value={a.as}
                      onChange={(e) => setAggregate(aggregate.map((x, j) => (i === j ? { ...x, as: e.target.value } : x)))}
                    >
                      {AGGREGATES.map((g) => <option key={g} value={g}>{t(`screens.reportPack.aggName_${g}`)}</option>)}
                    </Select>
                    <Select
                      className="h-8 text-xs"
                      value={a.field}
                      onChange={(e) => setAggregate(aggregate.map((x, j) => (i === j ? { ...x, field: e.target.value } : x)))}
                    >
                      {entity.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </Select>
                    <button aria-label={t("screens.reportPack.remove")} onClick={() => setAggregate(aggregate.filter((_, j) => j !== i))} className="text-muted hover:text-danger">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setAggregate([...aggregate, { as: "count", field: entity.fields[0].key }])}
                >
                  {t("screens.reportPack.addSummary")}
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              loading={running}
              icon={<Play className="h-4 w-4" />}
              disabled={columns.length === 0}
              onClick={() =>
                run({ definition: { entity: entityKey, columns, groupBy, aggregate }, name: name || undefined }, name || t("screens.reportPack.custom"))
              }
            >
              {t("screens.reportPack.run")}
            </Button>
            <Button variant="secondary" icon={<Save className="h-4 w-4" />} disabled={columns.length === 0} onClick={saveTemplate}>
              {t("screens.reportPack.save")}
            </Button>
          </div>
        </div>
      )}

      {tab === "saved" && (
        <div className="space-y-2">
          {saved.length === 0 && <p className="text-sm text-muted">{t("screens.reportPack.nothingSaved")}</p>}
          {saved.map((tpl) => {
            const ent = entities.find((e) => e.key === tpl.definition.entity);
            const fieldName = (k: string) => ent?.fields.find((f) => f.key === k)?.label ?? k;
            return (
            <div key={tpl.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {tpl.name}
                  {tpl.isShared && <Badge tone="info">{t("screens.reportPack.shared")}</Badge>}
                  {!tpl.owned && <Badge tone="neutral">{t("screens.reportPack.someoneElse")}</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {ent?.label ?? tpl.definition.entity} · {t("screens.reportPack.columnsN", { count: tpl.definition.columns.length })}
                  {tpl.definition.groupBy?.length
                    ? ` · ${t("screens.reportPack.groupedBy", { fields: tpl.definition.groupBy.map(fieldName).join(", ") })}`
                    : ""}
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" icon={<Play className="h-3.5 w-3.5" />} onClick={() => run({ definition: tpl.definition, name: tpl.name, templateId: tpl.id }, tpl.name)}>
                  {t("screens.reportPack.run")}
                </Button>
                {tpl.owned && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={async () => {
                      await fetch("/api/reports/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: tpl.id }) });
                      toast({ tone: "success", title: t("screens.reportPack.deleted") });
                      router.refresh();
                    }}
                  >
                    {t("screens.reportPack.delete")}
                  </Button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {tab === "schedules" && (
        <ScheduleTab reports={reports} saved={saved} schedules={schedules} />
      )}

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}

      {result && (
        <div className="rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">{result.title}</h2>
              <p className="text-xs text-muted">
                {t("screens.reportPack.resultMeta", {
                  rows: t("screens.reportPack.count_rows", { count: result.rows.length }),
                  filter: result.filterNote,
                  when: new Date(result.generatedAt).toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" }),
                })}
              </p>
            </div>
            {mayExport && (
              <div className="flex gap-1.5">
                <a href={exportHref("CSV")} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-surface-muted">
                  <Download className="h-3 w-3" /> CSV
                </a>
                <a href={exportHref("EXCEL")} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-surface-muted">
                  <FileSpreadsheet className="h-3 w-3" /> Excel
                </a>
                <a href={exportHref("PDF")} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-surface-muted">
                  <FileText className="h-3 w-3" /> PDF
                </a>
              </div>
            )}
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-muted text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  {result.columns.map((c) => (
                    <th key={c.key} className={cn("whitespace-nowrap px-3 py-2 font-semibold", c.numeric ? "text-right" : "text-left")}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    {result.columns.map((c) => (
                      <td key={c.key} className={cn("px-3 py-1.5", c.numeric && "text-right tabular-nums")}>
                        {formatCell(row[c.key], intl, c.format)}
                      </td>
                    ))}
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr><td colSpan={result.columns.length} className="px-3 py-8 text-center text-muted">{t("screens.reportPack.nothingMatched")}</td></tr>
                )}
              </tbody>
              {result.totals && (
                <tfoot className="sticky bottom-0 bg-surface-muted font-medium">
                  <tr>
                    {result.columns.map((c) => (
                      <td key={c.key} className={cn("px-3 py-2", c.numeric && "text-right tabular-nums")}>
                        {formatCell(result.totals![c.key], intl, c.format)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function formatCell(value: unknown, intl: string, format?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (format === "money") return `₹${value.toLocaleString(intl, { maximumFractionDigits: 0 })}`;
    if (format === "pct") return `${value}%`;
    return value.toLocaleString(intl, { maximumFractionDigits: 4 });
  }
  return String(value);
}

/** Scheduling a report: what, how often, and to whom. */
function ScheduleTab({ reports, saved, schedules }: { reports: ReportInfo[]; saved: SavedReport[]; schedules: ScheduleInfo[] }) {
  const t = useT();
  const { intl } = useLocale();
  /** "2/3 delivered · <mail errors>" as the scheduler wrote it; the count is worded, the errors are the mail server's. */
  const runNote = (note: string) => {
    const m = /^(\d+)\/(\d+) delivered(.*)$/.exec(note);
    return m ? `${t("screens.reportPack.delivered", { done: m[1], total: m[2] })}${m[3]}` : note;
  };
  const router = useRouter();
  const toast = useToast();
  const [what, setWhat] = useState(reports[0]?.key ?? "");
  const [frequency, setFrequency] = useState("WEEKLY");
  const [format, setFormat] = useState("PDF");
  const [recipients, setRecipients] = useState("");
  const [busy, setBusy] = useState(false);

  const post = async (body: unknown, success: string) => {
    setBusy(true);
    const res = await fetch("/api/reports/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast({ tone: "error", title: t("screens.reportPack.failedGeneric"), message: data.error });
    toast({ tone: "success", title: success, message: data.note ?? undefined });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold">{t("screens.reportPack.scheduleTitle")}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <Field label={t("screens.reportPack.report")}>
            <Select value={what} onChange={(e) => setWhat(e.target.value)}>
              <optgroup label={t("screens.reportPack.tabPack")}>
                {reports.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
              </optgroup>
              {saved.length > 0 && (
                <optgroup label={t("screens.reportPack.tabSaved")}>
                  {saved.map((tpl) => <option key={tpl.id} value={`template:${tpl.id}`}>{tpl.name}</option>)}
                </optgroup>
              )}
            </Select>
          </Field>
          <Field label={t("screens.reportPack.howOften")}>
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              <option value="DAILY">{t("screens.reportPack.freq_DAILY")}</option>
              <option value="WEEKLY">{t("screens.reportPack.freq_WEEKLY")}</option>
              <option value="MONTHLY">{t("screens.reportPack.freq_MONTHLY")}</option>
            </Select>
          </Field>
          <Field label={t("screens.reportPack.format")}>
            <Select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="PDF">PDF</option>
              <option value="EXCEL">Excel</option>
              <option value="CSV">CSV</option>
            </Select>
          </Field>
          <Field label={t("screens.reportPack.to")} hint={t("screens.reportPack.toHint")}>
            <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="secretary@nic.in, collector@nic.in" />
          </Field>
        </div>
        <Button
          className="mt-3"
          size="sm"
          loading={busy}
          icon={<CalendarClock className="h-4 w-4" />}
          disabled={!recipients.trim()}
          onClick={() =>
            post(
              {
                ...(what.startsWith("template:") ? { templateId: what.slice(9) } : { reportKey: what }),
                frequency,
                format,
                recipients: recipients.split(/[,\s]+/).filter(Boolean),
              },
              t("screens.reportPack.scheduled"),
            )
          }
        >
          {t("screens.reportPack.scheduleIt")}
        </Button>
      </div>

      <div className="space-y-2">
        {schedules.length === 0 && <p className="text-sm text-muted">{t("screens.reportPack.noSchedules")}</p>}
        {schedules.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{s.label}</div>
              <div className="mt-0.5 text-xs text-muted">
                {t("screens.reportPack.scheduleLine", {
                  frequency: t(`screens.reportPack.freq_${s.frequency}` as MessageKey),
                  format: s.format,
                  to: s.recipients.join(", "),
                  when: new Date(s.nextRunAt).toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" }),
                })}
              </div>
              {s.lastRunNote && <div className="mt-0.5 text-[11px] text-muted">{t("screens.reportPack.lastRun", { note: runNote(s.lastRunNote) })}</div>}
            </div>
            {s.owned && (
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" loading={busy} icon={<Play className="h-3.5 w-3.5" />} onClick={() => post({ runNow: s.id }, t("screens.reportPack.sent"))}>
                  {t("screens.reportPack.runNow")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => post({ stop: s.id }, t("screens.reportPack.stopped"))}>{t("screens.reportPack.stop")}</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
