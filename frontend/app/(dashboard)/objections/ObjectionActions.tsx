"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Gavel } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@frontend/components/ui";
import { Dialog } from "@frontend/components/ui/Dialog";
import { useToast } from "@frontend/components/ui/Toast";
import { useT } from "@frontend/components/I18nProvider";

const OUTCOMES = [
  { value: "REJECTED", label: "screens.objPage.out_REJECTED" },
  { value: "PARTIALLY_ACCEPTED", label: "screens.objPage.out_PARTIALLY_ACCEPTED" },
  { value: "ACCEPTED", label: "screens.objPage.out_ACCEPTED" },
] as const;

async function post(url: string, body: unknown, failed: string): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.error ?? failed;
}

/** Hearing and decision, for the authority the Act names. */
export default function ObjectionActions({ id, hearingDate }: { id: string; hearingDate: string | null }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<"hearing" | "decision" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(hearingDate?.slice(0, 10) ?? today);
  const [status, setStatus] = useState("REJECTED");
  const [decision, setDecision] = useState("");
  const [reasons, setReasons] = useState("");

  const heard = hearingDate !== null && new Date(hearingDate) <= new Date();

  const submit = async (kind: "hearing" | "decision") => {
    setBusy(true);
    setError(null);
    const err =
      kind === "hearing"
        ? await post(`/api/objections/${id}/hearing`, { hearingDate: date }, t("screens.objPage.saveFailed"))
        : await post(`/api/objections/${id}/decision`, { status, decision, decisionReasons: reasons }, t("screens.objPage.saveFailed"));
    setBusy(false);
    if (err) return setError(err);
    setOpen(null);
    toast({
      tone: "success",
      title: kind === "hearing" ? t("screens.objPage.hearingListedToast") : t("screens.objPage.decisionRecorded"),
      message: kind === "hearing" ? t("screens.objPage.heardOnToast", { date }) : t("screens.objPage.decisionToast"),
    });
    router.refresh();
  };

  const close = () => {
    setOpen(null);
    setError(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" icon={<CalendarClock className="h-4 w-4" />} onClick={() => setOpen("hearing")}>
        {hearingDate ? t("screens.objPage.relist") : t("screens.objPage.list")}
      </Button>
      <Button
        size="sm"
        icon={<Gavel className="h-4 w-4" />}
        disabled={!heard}
        title={heard ? undefined : t("screens.objPage.mustHear")}
        onClick={() => setOpen("decision")}
      >
        {t("screens.objPage.recordDecision")}
      </Button>

      <Dialog
        open={open === "hearing"}
        onClose={close}
        title={t("screens.objPage.listTitle")}
        description={t("screens.objPage.listDesc")}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close}>{t("common.cancel")}</Button>
            <Button size="sm" loading={busy} onClick={() => submit("hearing")}>{t("screens.objPage.list")}</Button>
          </>
        }
      >
        <Field label={t("screens.objPage.hearingDate")} required hint={t("screens.objPage.hearingDateHint")}>
          <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
      </Dialog>

      <Dialog
        open={open === "decision"}
        onClose={close}
        wide
        title={t("screens.objPage.decisionTitle")}
        description={t("screens.objPage.decisionDesc")}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close}>{t("common.cancel")}</Button>
            <Button size="sm" loading={busy} disabled={reasons.trim().length < 20 || !decision.trim()} onClick={() => submit("decision")}>
              {t("screens.objPage.recordDecision")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("screens.objPage.outcome")} required>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>{t(o.label)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("screens.objPage.decision")} required hint={t("screens.objPage.decisionHint")}>
            <Input value={decision} onChange={(e) => setDecision(e.target.value)} placeholder={t("screens.objPage.decisionPh")} />
          </Field>
          <Field
            label={t("screens.objPage.reasonsLabel")}
            required
            hint={t("screens.objPage.reasonsHint", { n: reasons.trim().length })}
          >
            <Textarea rows={6} value={reasons} onChange={(e) => setReasons(e.target.value)} />
          </Field>
          {status === "ACCEPTED" && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
              {t("screens.objPage.willWithdraw")}
            </p>
          )}
          {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
        </div>
      </Dialog>
    </div>
  );
}
