"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Newspaper } from "lucide-react";
import { Button, Field, Input, Select } from "@frontend/components/ui";
import { Dialog } from "@frontend/components/ui/Dialog";
import { useToast } from "@frontend/components/ui/Toast";
import { useT } from "@frontend/components/I18nProvider";
import { rich } from "@frontend/lib/rich";
import { stageKey } from "@backend/i18n/core";
import type { MessageKey } from "@backend/i18n/types";

/** A case that is at a stage which publishes a notification it has not yet published. */
export interface IssueOption {
  proposalId: string;
  referenceNo: string;
  projectName: string;
  type: string;
  label: string;
  stageLabel: string;
  /** The day the case reached this stage; the notice cannot be dated earlier. */
  enteredOn: string;
  advancesToLabel: string | null;
  /** For wording the stage names in the viewer's language. */
  act?: string;
  status?: string;
  advancesTo?: string | null;
}

export interface ChannelOption {
  key: string;
  label: string;
}

async function post(url: string, body: unknown, failed: string): Promise<{ error?: string } & Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : { error: data.error ?? failed };
}

/** A dictionary entry, or the given English when the dictionary has none. */
function useWords() {
  const t = useT();
  const or = (key: string, fallback: string) => {
    const text = t(key as MessageKey);
    return text === key ? fallback : text;
  };
  return {
    t,
    notice: (o: IssueOption) => or(`notices.type.${o.type}`, o.label),
    stage: (o: IssueOption, status: string | null | undefined, fallback: string) =>
      o.act && status ? or(stageKey(o.act, status), fallback) : fallback,
    channel: (c: ChannelOption) => or(`notices.channel.${c.key}`, c.label),
  };
}

function Checks({ options, value, onChange }: { options: ChannelOption[]; value: string[]; onChange: (v: string[]) => void }) {
  const w = useWords();
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {options.map((c) => (
        <label key={c.key} className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--brand)]"
            checked={value.includes(c.key)}
            onChange={(e) => onChange(e.target.checked ? [...value, c.key] : value.filter((k) => k !== c.key))}
          />
          {w.channel(c)}
        </label>
      ))}
    </div>
  );
}

/** Issue the notification a case's stage calls for. */
export function IssueNotificationButton({
  options,
  channels,
  initialProposalId,
}: {
  options: IssueOption[];
  channels: ChannelOption[];
  initialProposalId?: string;
}) {
  const w = useWords();
  const t = w.t;
  const router = useRouter();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const preselected = options.find((o) => o.proposalId === initialProposalId);

  const [open, setOpen] = useState(Boolean(preselected));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState((preselected ?? options[0])?.proposalId ?? "");
  const [issuedOn, setIssuedOn] = useState(today);
  const [mode, setMode] = useState<"egazette" | "manual">("egazette");
  const [gazetteRef, setGazetteRef] = useState("");
  const [published, setPublished] = useState<string[]>(["publishedWebsite"]);
  const [advance, setAdvance] = useState(true);

  const chosen = options.find((o) => o.proposalId === proposalId);
  const disabled = options.length === 0;

  const submit = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const r = await post("/api/notifications", {
      proposalId,
      type: chosen.type,
      issuedOn,
      publish: mode === "egazette",
      gazetteRef: mode === "manual" ? gazetteRef : null,
      channels: mode === "egazette" ? published.filter((k) => k !== "publishedGazette") : published,
      advance,
    }, t("screens.issue.saveFailed"));
    setBusy(false);
    if (r.error) return setError(r.error);
    setOpen(false);
    const warnings = (r.warnings as string[] | undefined) ?? [];
    toast({
      tone: warnings.length ? "warning" : "success",
      title: t("screens.issue.issued", { notice: w.notice(chosen) }),
      message: [
        r.gazetteRef ? t("screens.issue.gazette", { ref: String(r.gazetteRef) }) : null,
        r.advancedTo && chosen.advancesToLabel
          ? t("screens.issue.nowAt", { stage: w.stage(chosen, chosen.advancesTo, chosen.advancesToLabel) })
          : null,
        ...warnings,
      ]
        .filter(Boolean)
        .join(" "),
    });
    router.refresh();
  };

  return (
    <>
      <Button
        size="sm"
        icon={<Megaphone className="h-4 w-4" />}
        disabled={disabled}
        title={disabled ? t("screens.issue.noneWaiting") : undefined}
        onClick={() => setOpen(true)}
      >
        {t("screens.issue.issueBtn")}
      </Button>

      <Dialog
        open={open}
        onClose={() => { setOpen(false); setError(null); }}
        wide
        title={t("screens.issue.title")}
        description={t("screens.issue.desc")}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button size="sm" loading={busy} disabled={!chosen || (mode === "manual" && !gazetteRef.trim())} onClick={submit}>
              {t("screens.issue.issue")}
            </Button>
          </>
        }
      >
        {chosen && (
          <div className="space-y-3">
            <Field label={t("screens.issue.case")} required>
              {options.length > 1 ? (
                <Select value={proposalId} onChange={(e) => setProposalId(e.target.value)}>
                  {options.map((o) => (
                    <option key={o.proposalId} value={o.proposalId}>
                      {o.referenceNo} — {o.projectName}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="text-sm">
                  <span className="font-mono">{chosen.referenceNo}</span> — {chosen.projectName}
                </div>
              )}
            </Field>

            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs">
              <div className="font-medium">{w.notice(chosen)}</div>
              <div className="mt-0.5 text-muted">{t("screens.issue.dueBecause", { stage: w.stage(chosen, chosen.status, chosen.stageLabel) })}</div>
            </div>

            <Field label={t("screens.issue.dateLabel")} required hint={t("screens.issue.dateHint", { from: chosen.enteredOn })}>
              <Input type="date" min={chosen.enteredOn} max={today} value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
            </Field>

            <Field label={t("screens.issue.gazetteLabel")} required>
              <Select value={mode} onChange={(e) => setMode(e.target.value as "egazette" | "manual")}>
                <option value="egazette">{t("screens.issue.egazetteNow")}</option>
                <option value="manual">{t("screens.issue.alreadyPublished")}</option>
              </Select>
            </Field>
            {mode === "manual" && (
              <Field label={t("screens.issue.gazetteNo")} required>
                <Input value={gazetteRef} maxLength={80} onChange={(e) => setGazetteRef(e.target.value)} placeholder={t("screens.issue.gazettePh")} />
              </Field>
            )}

            {/* Not a Field: that is a <label>, and these are labels already. */}
            <fieldset>
              <legend className="text-xs font-medium text-foreground">{t("screens.issue.alsoIn")}</legend>
              <div className="mt-1.5">
                <Checks
                  options={mode === "egazette" ? channels.filter((c) => c.key !== "publishedGazette") : channels}
                  value={published}
                  onChange={setPublished}
                />
              </div>
              <span className="mt-1 block text-[11px] text-muted">{t("screens.issue.leaveRest")}</span>
            </fieldset>

            {chosen.advancesToLabel && (
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand)]" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
                <span>
                  {rich(t("screens.issue.moveOn"), { stage: <strong>{w.stage(chosen, chosen.advancesTo, chosen.advancesToLabel)}</strong> })}
                  {(chosen.advancesTo ?? chosen.advancesToLabel.toUpperCase()).includes("OBJECTION") ? ` — ${t("screens.issue.opensObjections")}` : ""}
                </span>
              </label>
            )}
            {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
          </div>
        )}
      </Dialog>
    </>
  );
}

/** Record channels a notification has appeared in since it was issued. */
export function RecordPublicationButton({ id, missing }: { id: string; missing: ChannelOption[] }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await post(`/api/notifications/${id}/publication`, { channels: picked }, t("screens.issue.saveFailed"));
    setBusy(false);
    if (r.error) return setError(r.error);
    setOpen(false);
    setPicked([]);
    const status = r.status as { complete: boolean; done: number; total: number } | undefined;
    toast({
      tone: "success",
      title: t("screens.issue.recorded"),
      message: status?.complete ? t("screens.issue.everyChannel") : t("screens.issue.channelsNow", { done: status?.done ?? 0, total: status?.total ?? 0 }),
    });
    router.refresh();
  };

  return (
    <>
      <Button size="sm" variant="ghost" icon={<Newspaper className="h-4 w-4" />} onClick={() => setOpen(true)}>
        {t("screens.issue.recordBtn")}
      </Button>
      <Dialog
        open={open}
        onClose={() => { setOpen(false); setError(null); }}
        title={t("screens.issue.recordBtn")}
        description={t("screens.issue.recordDesc")}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button size="sm" loading={busy} disabled={picked.length === 0} onClick={submit}>{t("screens.issue.record")}</Button>
          </>
        }
      >
        <Checks options={missing} value={picked} onChange={setPicked} />
        {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
      </Dialog>
    </>
  );
}
