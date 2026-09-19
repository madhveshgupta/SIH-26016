"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Landmark, Scale } from "lucide-react";
import { Button, Field, Textarea } from "@frontend/components/ui";
import { Dialog } from "@frontend/components/ui/Dialog";
import { useToast } from "@frontend/components/ui/Toast";
import { useT } from "@frontend/components/I18nProvider";

/** Labels come from the server so the dialog speaks the reader's language. */
export interface ObjectionLabels {
  dialogTitle: string;
  filedUnder: string;
  grounds: string;
  groundsHint: string;
  commonGrounds: string;
  file: string;
  cancel: string;
  filed: string;
  filedMessage: string;
  examples: string[];
  /** The formal representation, already composed and translated server-side. */
  template?: string;
  useTemplate?: string;
  writeOwn?: string;
  routedTo?: string;
}


export default function FileObjectionButton({
  parcelId,
  khasraNo,
  village,
  closesOn,
  section,
  labels,
}: {
  parcelId: string;
  khasraNo: string;
  village: string;
  closesOn: string | null;
  section: string;
  labels?: ObjectionLabels;
}) {
  const t = useT();
  const l: ObjectionLabels = labels ?? {
    dialogTitle: t("objection.dialogTitle", { khasra: khasraNo, village }),
    filedUnder: t("objection.filedUnder", { section }),
    grounds: t("objection.grounds"),
    groundsHint: t("objection.groundsHint"),
    commonGrounds: t("objection.commonGrounds"),
    file: t("objection.file"),
    cancel: t("common.cancel"),
    filed: t("objection.filed"),
    filedMessage: t("objection.filedMessage"),
    examples: [t("plot.groundPurpose"), t("plot.groundArea"), t("plot.groundAssets"), t("plot.groundPersons")],
  };
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [grounds, setGrounds] = useState("");
  const [usingTemplate, setUsingTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/objections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parcelId, grounds }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? t("screens.objPage.fileFailed"));
    setOpen(false);
    setGrounds("");
    setUsingTemplate(false);
    toast({ tone: "success", title: l.filed, message: l.filedMessage });
    router.refresh();
  };

  return (
    <>
      <Button size="sm" variant="secondary" icon={<Scale className="h-4 w-4" />} onClick={() => setOpen(true)}>
        {l.file}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={l.dialogTitle}
        description={`${l.filedUnder}${closesOn ? ` · ${closesOn}` : ""}`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>{l.cancel}</Button>
            <Button size="sm" loading={busy} disabled={grounds.trim().length < 10} onClick={submit}>{l.file}</Button>
          </>
        }
      >
        {l.template && (
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={usingTemplate ? "primary" : "secondary"}
              icon={<FileText className="h-4 w-4" />}
              onClick={() => {
                setGrounds(l.template ?? "");
                setUsingTemplate(true);
              }}
            >
              {l.useTemplate}
            </Button>
            {usingTemplate && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setGrounds("");
                  setUsingTemplate(false);
                }}
              >
                {l.writeOwn}
              </Button>
            )}
          </div>
        )}

        <Field label={l.grounds} required hint={l.groundsHint}>
          <Textarea
            rows={usingTemplate ? 14 : 7}
            value={grounds}
            onChange={(e) => setGrounds(e.target.value)}
            className={usingTemplate ? "font-mono text-xs leading-relaxed" : undefined}
          />
        </Field>

        {!usingTemplate && (
          <div className="mt-3 text-xs text-muted">
            {l.commonGrounds}
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {l.examples.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        )}

        {l.routedTo && (
          <p className="mt-3 flex gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs leading-relaxed text-brand">
            <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{l.routedTo}</span>
          </p>
        )}

        {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
      </Dialog>
    </>
  );
}
