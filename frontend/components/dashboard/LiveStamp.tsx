"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useLocale, useT } from "@frontend/components/I18nProvider";

/**
 * "Real-time" made visible: when the figures on screen were read, refreshed on a
 * fixed interval.
 */
export default function LiveStamp({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const t = useT();
  const { intl } = useLocale();
  // Read on the client at mount; the server's clock is not this user's clock.
  const [readAt, setReadAt] = useState<Date>(() => new Date());
  const [auto, setAuto] = useState(true);
  const [refreshing, startRefresh] = useTransition();
  const asked = useRef(false);

  const refresh = () => {
    asked.current = true;
    startRefresh(() => router.refresh());
  };

  // The transition ends when the refreshed page has rendered: that is the read time.
  useEffect(() => {
    if (!refreshing && asked.current) {
      asked.current = false;
      setReadAt(new Date());
    }
  }, [refreshing]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, seconds]);

  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5" suppressHydrationWarning>
        {auto && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" aria-hidden />}
        {t("screens.liveStamp.updated", { time: readAt.toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })}
      </span>
      <button
        onClick={refresh}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 hover:bg-surface-muted"
        aria-label={t("screens.liveStamp.refreshNow")}
      >
        <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
        {t("screens.liveStamp.refresh")}
      </button>
      <label className="inline-flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-3 w-3 accent-[var(--brand)]" />
        {t("screens.liveStamp.every", { seconds })}
      </label>
    </span>
  );
}
