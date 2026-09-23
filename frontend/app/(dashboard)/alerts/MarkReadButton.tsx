"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck } from "lucide-react";
import { Button } from "@frontend/components/ui";
import { useT } from "@frontend/components/I18nProvider";

export default function MarkReadButton({ id, all }: { id?: string; all?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={all ? "secondary" : "ghost"}
      size="sm"
      loading={busy}
      icon={all ? <CheckCheck className="h-4 w-4" /> : <Check className="h-4 w-4" />}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/alerts/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(all ? { all: true } : { id }) });
        setBusy(false);
        router.refresh();
      }}
    >
      {all ? t("screens.alertsPage.markAll") : t("screens.alertsPage.markRead")}
    </Button>
  );
}
