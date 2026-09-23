"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button, Field, Input, Select } from "@frontend/components/ui";
import { Dialog } from "@frontend/components/ui/Dialog";
import { useToast } from "@frontend/components/ui/Toast";
import { useT } from "@frontend/components/I18nProvider";

async function save(body: Record<string, unknown>, failed: string): Promise<string | null> {
  const res = await fetch("/api/masters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.error ?? failed;
}

/** Dialog shell shared by the three forms: open button, save, error, refresh. */
function useSaver(done: string) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const err = await save(body, t("screens.masters.saveFailed"));
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    toast({ tone: "success", title: done, message: t("screens.masters.recorded") });
    router.refresh();
  };
  const close = () => { setOpen(false); setError(null); };
  return { open, setOpen, busy, error, submit, close };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p> : null;
}

export interface DistrictRow {
  id: string;
  name: string;
  nameLocal: string | null;
  circleRatePerHectare: string | null;
  multiplierFactor: string;
  isUrban: boolean;
}

export function EditDistrictButton({ d }: { d: DistrictRow }) {
  const t = useT();
  const s = useSaver(t("screens.masters.districtUpdated", { name: d.name }));
  const [rate, setRate] = useState(d.circleRatePerHectare ?? "");
  const [multiplier, setMultiplier] = useState(d.multiplierFactor);
  const [urban, setUrban] = useState(d.isUrban);
  const [nameLocal, setNameLocal] = useState(d.nameLocal ?? "");

  return (
    <>
      <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => s.setOpen(true)}>
        {t("common.edit")}
      </Button>
      <Dialog
        open={s.open}
        onClose={s.close}
        title={t("screens.masters.districtTitle", { name: d.name })}
        description={t("screens.masters.districtDesc")}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={s.close}>{t("common.cancel")}</Button>
            <Button
              size="sm"
              loading={s.busy}
              onClick={() => s.submit({ kind: "district", id: d.id, circleRatePerHectare: rate.trim(), multiplierFactor: multiplier, isUrban: urban, nameLocal: nameLocal.trim() })}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("screens.masters.nameLocal")} hint={t("screens.masters.nameLocalHint")}>
            <Input value={nameLocal} maxLength={120} onChange={(e) => setNameLocal(e.target.value)} />
          </Field>
          <Field label={t("screens.masters.rateLabel")} hint={t("screens.masters.rateHint")}>
            <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} placeholder={t("screens.masters.ratePh")} />
          </Field>
          <Field label={t("common.area")} hint={t("screens.masters.areaHint")}>
            <Select
              value={urban ? "urban" : "rural"}
              onChange={(e) => {
                const u = e.target.value === "urban";
                setUrban(u);
                if (u) setMultiplier("1.00");
              }}
            >
              <option value="rural">{t("screens.masters.rural")}</option>
              <option value="urban">{t("screens.masters.urban")}</option>
            </Select>
          </Field>
          <Field label={t("screens.masters.multLabel")} hint={t("screens.masters.multHint")}>
            <Input type="number" min={1} max={2} step={0.05} disabled={urban} value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
          </Field>
          <ErrorLine error={s.error} />
        </div>
      </Dialog>
    </>
  );
}

export interface MinistryRow {
  id: string;
  code: string;
  name: string;
}

export function MinistryButton({ m }: { m?: MinistryRow }) {
  const t = useT();
  const s = useSaver(m ? t("screens.masters.ministryUpdated") : t("screens.masters.ministryAdded"));
  const [code, setCode] = useState(m?.code ?? "");
  const [name, setName] = useState(m?.name ?? "");
  return (
    <>
      {m ? (
        <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => s.setOpen(true)}>{t("common.edit")}</Button>
      ) : (
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => s.setOpen(true)}>{t("screens.masters.addMinistry")}</Button>
      )}
      <Dialog
        open={s.open}
        onClose={s.close}
        title={m ? t("screens.masters.editCode", { code: m.code }) : t("screens.masters.addMinistryTitle")}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={s.close}>{t("common.cancel")}</Button>
            <Button size="sm" loading={s.busy} onClick={() => s.submit({ kind: "ministry", id: m?.id, code, name })}>{t("common.save")}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("screens.masters.code")} required hint={t("screens.masters.codeHintMinistry")}>
            <Input value={code} maxLength={20} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
          <Field label={t("screens.masters.fullName")} required>
            <Input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ErrorLine error={s.error} />
        </div>
      </Dialog>
    </>
  );
}

export interface AgencyRow {
  id: string;
  code: string;
  name: string;
  isRequiringBody: boolean;
  ministryId: string | null;
}

export function AgencyButton({ a, ministries }: { a?: AgencyRow; ministries: MinistryRow[] }) {
  const t = useT();
  const s = useSaver(a ? t("screens.masters.agencyUpdated") : t("screens.masters.agencyAdded"));
  const [code, setCode] = useState(a?.code ?? "");
  const [name, setName] = useState(a?.name ?? "");
  const [requiring, setRequiring] = useState(a?.isRequiringBody ?? true);
  const [ministryId, setMinistryId] = useState(a?.ministryId ?? "");
  return (
    <>
      {a ? (
        <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => s.setOpen(true)}>{t("common.edit")}</Button>
      ) : (
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => s.setOpen(true)}>{t("screens.masters.addAgency")}</Button>
      )}
      <Dialog
        open={s.open}
        onClose={s.close}
        title={a ? t("screens.masters.editCode", { code: a.code }) : t("screens.masters.addAgencyTitle")}
        description={t("screens.masters.agencyDesc")}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={s.close}>{t("common.cancel")}</Button>
            <Button
              size="sm"
              loading={s.busy}
              onClick={() => s.submit({ kind: "agency", id: a?.id, code, name, isRequiringBody: requiring, ministryId: ministryId || null })}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("screens.masters.code")} required hint={t("screens.masters.codeHintAgency")}>
            <Input value={code} maxLength={20} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
          <Field label={t("screens.masters.fullName")} required>
            <Input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("screens.masters.adminMinistry")}>
            <Select value={ministryId} onChange={(e) => setMinistryId(e.target.value)}>
              <option value="">{t("screens.masters.noneStateBody")}</option>
              {ministries.map((m) => (
                <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("screens.masters.mayFile")}>
            <Select value={requiring ? "yes" : "no"} onChange={(e) => setRequiring(e.target.value === "yes")}>
              <option value="yes">{t("screens.masters.yesRequiring")}</option>
              <option value="no">{t("screens.masters.noImplementing")}</option>
            </Select>
          </Field>
          <ErrorLine error={s.error} />
        </div>
      </Dialog>
    </>
  );
}
