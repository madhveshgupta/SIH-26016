"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@frontend/components/ui";
import { useToast } from "@frontend/components/ui/Toast";
import { useT } from "@frontend/components/I18nProvider";
import { describeFactor } from "./explain";

/** Re-run the model against the case as it stands now. */
export default function RescoreButton({ proposalId, label }: { proposalId: string; label?: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      icon={<Sparkles className="h-3.5 w-3.5" />}
      onClick={async () => {
        setBusy(true);
        const res = await fetch("/api/ml/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposalId }),
        });
        const data = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return toast({ tone: "error", title: t("screens.rescore.notScored"), message: data.error });
        toast({
          tone: data.delayRiskBand === "HIGH" ? "warning" : "success",
          title: t("screens.rescore.riskTitle", { pct: Math.round(data.delayRisk * 100) }),
          message: data.factors?.[0] ? t("screens.rescore.largestFactor", { factor: describeFactor(t, data.factors[0]) }) : undefined,
        });
        router.refresh();
      }}
    >
      {label ?? t("screens.rescore.rescore")}
    </Button>
  );
}
