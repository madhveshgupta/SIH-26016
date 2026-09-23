"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@frontend/components/ui";
import { useToast } from "@frontend/components/ui/Toast";
import { useT } from "@frontend/components/I18nProvider";

/** Run the alert rules now, rather than waiting for the hourly cron. */
export default function RunSweepButton() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      icon={<RefreshCw className="h-4 w-4" />}
      onClick={async () => {
        setBusy(true);
        const res = await fetch("/api/alerts/sweep", { method: "POST" });
        setBusy(false);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({ tone: "error", title: t("screens.alertsPage.sweepFailed"), message: data.error });
          return;
        }
        toast({
          tone: "success",
          title: data.created ? t("screens.alertsPage.sweepRaised", { count: data.created }) : t("screens.alertsPage.sweepNothing"),
          message: t("screens.alertsPage.sweepSummary", { findings: data.findings, escalations: data.escalations, sent: data.alreadySent }),
        });
        router.refresh();
      }}
    >
      {t("screens.alertsPage.runNow")}
    </Button>
  );
}
