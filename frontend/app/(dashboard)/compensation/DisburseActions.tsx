"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Landmark, RefreshCw } from "lucide-react";
import { Button, Field, Textarea } from "@frontend/components/ui";
import { Dialog } from "@frontend/components/ui/Dialog";
import { useToast } from "@frontend/components/ui/Toast";
import { useT } from "@frontend/components/I18nProvider";

/** Pay one record, or deposit it with the LARR Authority under s.77. */
export function DisburseButton({
  compensationId,
  amount,
  owner,
  payable = true,
}: {
  compensationId: string;
  amount: string;
  owner: string;
  /** False when no bank account is on record — then s.77 is the only route. */
  payable?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const post = async (body: unknown) => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/compensation/disburse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? t("screens.comp.payFailed"));
      if (!depositOpen) toast({ tone: "error", title: t("screens.comp.payRefused"), message: data.error });
      return false;
    }
    toast({
      tone: data.status === "FAILED" ? "warning" : "success",
      title:
        data.status === "DEPOSITED_WITH_AUTHORITY"
          ? t("screens.comp.deposited")
          : data.status === "FAILED"
            ? t("screens.comp.bankRejected")
            : t("screens.comp.instructed"),
      message: data.message,
    });
    setDepositOpen(false);
    router.refresh();
    return true;
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button
        size="sm"
        loading={busy}
        disabled={!payable}
        title={payable ? undefined : t("screens.comp.noAccount")}
        icon={<Banknote className="h-3.5 w-3.5" />}
        onClick={() => post({ compensationId })}
      >
        {t("screens.comp.pay", { amount })}
      </Button>
      <Button size="sm" variant="secondary" icon={<Landmark className="h-3.5 w-3.5" />} onClick={() => setDepositOpen(true)}>
        s.77
      </Button>

      <Dialog
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        title={t("screens.comp.depositTitle")}
        description={t("screens.comp.depositDesc", { amount, owner })}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDepositOpen(false)}>{t("common.cancel")}</Button>
            <Button size="sm" loading={busy} disabled={reason.trim().length < 10} onClick={() => post({ compensationId, depositWithAuthority: true, depositReason: reason })}>
              {t("screens.comp.depositBtn")}
            </Button>
          </>
        }
      >
        <Field label={t("screens.comp.whyNot")} required hint={t("screens.comp.whyNotHint")}>
          <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("screens.comp.whyNotPh")} />
        </Field>
        {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
      </Dialog>
    </div>
  );
}

/** Ask the gateway to confirm instructions that are still in flight. */
export function SettleButton({ count, projectId }: { count: number; projectId?: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      icon={<RefreshCw className="h-4 w-4" />}
      onClick={async () => {
        setBusy(true);
        const res = await fetch("/api/compensation/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(projectId ? { projectId } : {}),
        });
        const data = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return toast({ tone: "error", title: t("screens.comp.gatewayDown"), message: data.error });
        toast({
          tone: "success",
          title: t(data.settled === 1 ? "screens.comp.confirmedOne" : "screens.comp.confirmedMany", { count: data.settled }),
          message: data.settled ? t("screens.comp.canPossess") : t("screens.comp.nothingSettled"),
        });
        router.refresh();
      }}
    >
      {t("screens.comp.checkWithBank", { count })}
    </Button>
  );
}
