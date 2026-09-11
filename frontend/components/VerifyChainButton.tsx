"use client";

import { useState } from "react";
import { useT } from "@frontend/components/I18nProvider";

type Result = {
  intact: boolean;
  recordsChecked: number;
  brokenAtSequence: string | null;
  reason: string | null;
  reasonCode: "outOfOrder" | "prevHash" | "altered" | null;
};

export default function VerifyChainButton() {
  const t = useT();
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="text-right">
      <button
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            const res = await fetch("/api/audit/verify");
            setResult(await res.json());
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {busy ? t("screens.verifyChain.verifying") : t("screens.verifyChain.verify")}
      </button>

      {result && (
        <div
          className={`mt-2 max-w-xs rounded-md px-3 py-2 text-left text-[11px] leading-relaxed ${
            result.intact
              ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300"
              : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"
          }`}
        >
          {result.intact ? (
            <>
              <strong>{t("screens.verifyChain.intact")}</strong>{" "}
              {t("screens.verifyChain.intactDetail", { count: result.recordsChecked })}
            </>
          ) : (
            <>
              <strong>{t("screens.verifyChain.broken", { seq: result.brokenAtSequence ?? "" })}</strong>{" "}
              {result.reasonCode ? t(`screens.verifyChain.reason_${result.reasonCode}`) : result.reason}
            </>
          )}
        </div>
      )}
    </div>
  );
}
