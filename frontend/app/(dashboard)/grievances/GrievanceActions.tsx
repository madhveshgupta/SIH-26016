"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gavel } from "lucide-react";
import { Button, Field, Select, Textarea } from "@frontend/components/ui";
import { Dialog } from "@frontend/components/ui/Dialog";
import { useToast } from "@frontend/components/ui/Toast";
import { useT } from "@frontend/components/I18nProvider";

/** Where the officer can take it; each is worded as screens.grvPage.o_<value>. */
const OUTCOMES = [
  { value: "ACKNOWLEDGED", closes: false },
  { value: "UNDER_EXAMINATION", closes: false },
  { value: "REFERRED", closes: true },
  { value: "RESOLVED", closes: true },
  { value: "REJECTED", closes: true },
] as const;

/** The officer's reply. */
export default function GrievanceActions({ id, reference }: { id: string; reference: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("UNDER_EXAMINATION");
  const [decision, setDecision] = useState("");
  const [reasons, setReasons] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closes = OUTCOMES.find((o) => o.value === status)?.closes ?? false;
  const ready = !closes || (decision.trim().length > 0 && reasons.trim().length >= 20);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/grievances/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, decision, decisionReasons: reasons }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? t("screens.grvPage.saveFailed"));
    setOpen(false);
    toast({
      tone: "success",
      title: closes ? t("screens.grvPage.disposedToast") : t("screens.grvPage.updated"),
      message: t("screens.grvPage.toldMsg", { ref: reference }),
    });
    router.refresh();
  };

  return (
    <>
      <Button size="sm" variant="secondary" icon={<Gavel className="h-4 w-4" />} onClick={() => setOpen(true)}>
        {t("screens.grvPage.respond")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("screens.grvPage.respondTo", { ref: reference })}
        description={t("screens.grvPage.notified")}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button size="sm" loading={busy} disabled={!ready} onClick={submit}>{t("common.save")}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("screens.grvPage.whatHappening")} required>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>{t(`screens.grvPage.o_${o.value}`)}</option>
              ))}
            </Select>
          </Field>

          {closes && (
            <>
              <Field label={t("screens.grvPage.decisionLine")} required>
                <Textarea rows={2} value={decision} onChange={(e) => setDecision(e.target.value)} maxLength={1000} />
              </Field>
              <Field
                label={t("screens.grvPage.writtenReasons")}
                required
                hint={t("screens.grvPage.reasonsHint")}
              >
                <Textarea rows={5} value={reasons} onChange={(e) => setReasons(e.target.value)} maxLength={8000} />
              </Field>
            </>
          )}

          {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
        </div>
      </Dialog>
    </>
  );
}
