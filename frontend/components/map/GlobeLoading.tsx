"use client";

import { useT } from "@frontend/components/I18nProvider";

/** What stands in for a globe while its script downloads — the same night sky it opens on. */
export default function GlobeLoading({ height, rounded = "rounded-lg" }: { height: number | string; rounded?: string }) {
  const t = useT();
  return (
    <div
      className={`flex items-center justify-center border border-border text-xs text-slate-300 ${rounded}`}
      style={{ height, background: "radial-gradient(circle at 50% 45%, #14213d 0%, #080d1a 70%)" }}
    >
      {t("screens.misc.loadingGlobe")}
    </div>
  );
}
