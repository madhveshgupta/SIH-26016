"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@frontend/components/I18nProvider";
import { stageKey } from "@backend/i18n/core";

function actionFor(target: string): "APPROVE" | "REJECT" | "RETURN" {
  if (target === "REJECTED") return "REJECT";
  if (target === "RETURNED_FOR_CLARIFICATION") return "RETURN";
  return "APPROVE";
}

export default function TransitionForm({
  proposalId,
  targets,
  act,
}: {
  proposalId: string;
  targets: string[];
  act: string;
}) {
  const t = useT();
  const router = useRouter();
  const optionLabel = (target: string) =>
    target === "RETURNED_FOR_CLARIFICATION"
      ? t("screens.transition.returnOpt")
      : target === "REJECTED"
        ? t("screens.transition.rejectOpt")
        : t("screens.transition.approveTo", { stage: t(stageKey(act, target)) });
  const [to, setTo] = useState(targets[0]);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const action = actionFor(to);
  // Rejections and returns must carry reasons — "rejected" with no reasoning is
  // what gets an acquisition quashed on review.
  const remarksRequired = action !== "APPROVE";

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("screens.transition.title")}</h2>

      <label className="mt-2 block text-[11px] text-muted">
        {t("screens.transition.decision")}
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
        >
          {targets.map((target) => (
            <option key={target} value={target}>
              {optionLabel(target)}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-2 block text-[11px] text-muted">
        {t("screens.transition.remarks")} {remarksRequired && <span className="text-red-600">{t("screens.transition.required")}</span>}
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          placeholder={remarksRequired ? t("screens.transition.reasonsRequired") : t("screens.transition.optional")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
        />
      </label>

      {error && (
        <p className="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        disabled={busy || (remarksRequired && remarks.trim().length === 0)}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/proposals/transition", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ proposalId, to, action, remarks }),
            });
            const data = await res.json();
            if (!res.ok) setError(data.error ?? t("screens.transition.failed"));
            else router.refresh();
          } finally {
            setBusy(false);
          }
        }}
        className="mt-3 w-full rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {busy ? t("screens.transition.recording") : t("screens.transition.record")}
      </button>

      <p className="mt-2 text-[10px] leading-snug text-muted">
        {t("screens.transition.note")}
      </p>
    </div>
  );
}
