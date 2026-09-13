"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Landmark, Scale, Send } from "lucide-react";
import type { GrievanceCategory } from "@prisma/client";
import type { LocalisedField } from "@backend/grievances/localise";
import { Button, Field, Input, Select, Textarea } from "@frontend/components/ui";

export interface PlotOption {
  id: string;
  label: string;
  project: string;
  section: string;
  authorityLabel: string;
  note: string;
  /** Only set for categories that can become a statutory objection. */
  objectionWindow: { open: boolean; message: string } | null;
}

interface Filed {
  referenceNo: string;
  statuteSection: string;
  authorityLabel: string;
  assignedTo: string | null;
  objectionId: string | null;
  objectionNote: string | null;
}

/** The form's own words, translated on the server. Templates carry {placeholders}. */
export interface GrievanceFormLabels {
  whichPlot: string;
  chooseOne: string;
  submitTo: string;
  stillNeeded: string;
  cancel: string;
  whereItGoes: string;
  authority: string;
  filedUnder: string;
  acquisition: string;
  submittedTo: string;
  yourReference: string;
  reached: string;
  alsoObjection: string;
  representation: string;
  seeProgress: string;
  raiseAnother: string;
  couldNotSubmit: string;
}

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

/** The template for one kind of problem. */
export default function GrievanceForm({
  category,
  fields,
  plots,
  initialPlotId,
  labels: L,
}: {
  category: GrievanceCategory;
  fields: LocalisedField[];
  labels: GrievanceFormLabels;
  plots: PlotOption[];
  initialPlotId: string;
}) {
  const router = useRouter();
  const [plotId, setPlotId] = useState(initialPlotId);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<Filed | null>(null);

  const plot = useMemo(() => plots.find((p) => p.id === plotId) ?? plots[0], [plots, plotId]);
  const set = (key: string, value: string) => setAnswers((a) => ({ ...a, [key]: value }));

  const missing = fields.filter((f) => f.required && !(answers[f.key] ?? "").trim());
  const ready = missing.length === 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/grievances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, parcelId: plotId, answers }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? L.couldNotSubmit);
    setFiled(data as Filed);
    router.refresh();
  };

  if (filed) {
    return (
      <div className="rounded-xl border border-success/30 bg-success-soft p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
          <div className="min-w-0">
            {/* The plot's own route, already translated, rather than the
                server's English echo of the same thing. */}
            <h2 className="text-sm font-semibold text-foreground">{fill(L.submittedTo, { authority: plot.authorityLabel })}</h2>
            <p className="mt-1 text-sm text-foreground">
              {L.yourReference.split("{reference}")[0]}
              <span className="font-mono font-semibold">{filed.referenceNo}</span>
              {L.yourReference.split("{reference}")[1] ?? ""}
            </p>
            <dl className="mt-3 space-y-1 text-xs text-muted">
              <div>
                <dt className="inline font-medium text-foreground">{L.filedUnder}: </dt>
                <dd className="inline">{plot.section}</dd>
              </div>
              {filed.assignedTo && (
                <div>
                  <dt className="inline font-medium text-foreground">{L.reached}: </dt>
                  <dd className="inline">{filed.assignedTo}</dd>
                </div>
              )}
            </dl>
            {filed.objectionNote && (
              <p className="mt-3 flex gap-2 rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed">
                <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                <span>{filed.objectionId ? fill(L.alsoObjection, { section: plot.section }) : L.representation}</span>
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/objections" className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand-strong">
                {L.seeProgress}
              </Link>
              <Link href="/objections/raise" className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium hover:bg-surface-muted">
                {L.raiseAnother}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <Field label={L.whichPlot} required>
          <Select value={plotId} onChange={(e) => setPlotId(e.target.value)}>
            {plots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        {fields.map((f) => {
          const value = answers[f.key] ?? "";
          return (
            <Field key={f.key} label={f.label} hint={f.hint} required={f.required}>
              {f.kind === "textarea" ? (
                <Textarea rows={f.max && f.max > 2000 ? 7 : 4} value={value} onChange={(e) => set(f.key, e.target.value)} maxLength={f.max} />
              ) : f.kind === "select" ? (
                <Select value={value} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">{L.chooseOne}</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  type={f.kind === "date" ? "date" : f.kind === "number" || f.kind === "money" ? "number" : "text"}
                  inputMode={f.kind === "money" || f.kind === "number" ? "decimal" : undefined}
                  min={f.kind === "money" || f.kind === "number" ? 0 : undefined}
                  max={f.kind === "date" ? new Date().toISOString().slice(0, 10) : undefined}
                  value={value}
                  onChange={(e) => set(f.key, e.target.value)}
                  maxLength={f.kind === "text" ? f.max : undefined}
                />
              )}
            </Field>
          );
        })}

        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button icon={<Send className="h-4 w-4" />} loading={busy} disabled={!ready} onClick={submit}>
            {fill(L.submitTo, { authority: plot.authorityLabel })}
          </Button>
          <Link href="/objections" className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
            {L.cancel}
          </Link>
          {!ready && (
            <span className="text-xs text-muted">
              {fill(L.stillNeeded, { fields: missing.map((m) => m.label).join(", ") })}
            </span>
          )}
        </div>
      </div>

      {/* Where this goes, said before they commit rather than after. */}
      <aside className="h-fit space-y-3 rounded-xl border border-border bg-surface-muted p-4 text-xs leading-relaxed">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Landmark className="h-4 w-4 text-brand" aria-hidden />
          {L.whereItGoes}
        </div>
        <dl className="space-y-2">
          <div>
            <dt className="font-medium text-foreground">{L.authority}</dt>
            <dd className="text-muted">{plot.authorityLabel}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{L.filedUnder}</dt>
            <dd className="text-muted">{plot.section}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{L.acquisition}</dt>
            <dd className="text-muted">{plot.project}</dd>
          </div>
        </dl>
        <p className="border-t border-border pt-3 text-muted">{plot.note}</p>
        {plot.objectionWindow && (
          <p className={`flex gap-2 rounded-lg px-3 py-2 ${plot.objectionWindow.open ? "bg-brand-soft text-brand" : "bg-warning-soft text-warning"}`}>
            <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{plot.objectionWindow.message}</span>
          </p>
        )}
      </aside>
    </div>
  );
}
