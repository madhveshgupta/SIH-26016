"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@frontend/components/ui";
import { useToast } from "@frontend/components/ui/Toast";
import { useT } from "@frontend/components/I18nProvider";

export default function ChangePasswordForm({ next }: { next: string | null }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const checks = [
    [password.length >= 12, t("screens.account.c12")],
    [/[a-z]/.test(password) && /[A-Z]/.test(password), t("screens.account.cCase")],
    [/[0-9]/.test(password), t("screens.account.cDigit")],
    [/[^A-Za-z0-9]/.test(password), t("screens.account.cSymbol")],
  ] as const;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setErrors({ confirm: t("screens.account.mismatch") });
      return;
    }
    setBusy(true);
    setErrors({});
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: password }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setErrors({ [data.field ?? "newPassword"]: data.error });
      return;
    }
    toast({ tone: "success", title: t("screens.account.changed"), message: t("screens.account.changedMsg") });
    setCurrent("");
    setPassword("");
    setConfirm("");
    router.push(next ?? "/account");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label={t("screens.account.current")} error={errors.currentPassword} required>
        <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </Field>
      <Field label={t("screens.account.new")} error={errors.newPassword} required>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {checks.map(([ok, label]) => (
          <li key={label} className={ok ? "text-success" : "text-muted"}>
            {ok ? "✓" : "○"} {label}
          </li>
        ))}
      </ul>
      <Field label={t("screens.account.confirm")} error={errors.confirm} required>
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </Field>
      <Button type="submit" loading={busy} disabled={!current || !password || !confirm}>
        {t("screens.account.update")}
      </Button>
    </form>
  );
}
