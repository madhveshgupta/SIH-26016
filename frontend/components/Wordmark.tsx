"use client";

import Emblem from "@frontend/components/Emblem";
import { useT } from "@frontend/components/I18nProvider";

/** The Bhoomi Nayan lockup: emblem + two-tone serif wordmark + tagline. */
export default function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  const t = useT();
  const lg = size === "lg";
  return (
    <span className="flex items-center gap-3">
      <Emblem className={lg ? "h-14 w-14 shrink-0" : "h-11 w-11 shrink-0"} />

      <span className="leading-none">
        <span
          className={
            lg
              ? "block font-display text-4xl tracking-tight"
              : "block font-display text-[26px] tracking-tight"
          }
        >
          <span className="text-brand">Bhoomi</span>{" "}
          <span className="text-accent">Nayan</span>
        </span>
        <span
          className={
            lg
              ? "mt-2 block text-[12px] uppercase tracking-[0.22em] text-muted"
              : "mt-1.5 block text-[10px] uppercase tracking-[0.18em] text-muted"
          }
        >
          {t("screens.brand.tagline")}
        </span>
      </span>
    </span>
  );
}
