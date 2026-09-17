"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@frontend/components/ui";
import { useToast } from "@frontend/components/ui/Toast";
import { useT } from "@frontend/components/I18nProvider";

export default function RunChecksButton() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      loading={busy}
      icon={<RefreshCw className="h-4 w-4" />}
      onClick={async () => {
        setBusy(true);
        const res = await fetch("/api/integrations/check", { method: "POST" });
        setBusy(false);
        if (!res.ok) {
          toast({ tone: "error", title: t("screens.integ.checksFailed") });
          return;
        }
        const { results } = (await res.json()) as { results: { ok: boolean }[] };
        const up = results.filter((r) => r.ok).length;
        toast({ tone: up === results.length ? "success" : "warning", title: t("screens.integ.reachableOf", { up, total: results.length }), message: t("screens.integ.logged") });
        router.refresh();
      }}
    >
      {t("screens.integ.runNow")}
    </Button>
  );
}
