"use client";

import { STATUS_COLOUR, STATUS_ORDER } from "@frontend/components/map/legend";
import { useT } from "@frontend/components/I18nProvider";
import { parcelStatusKey } from "@backend/i18n/scope";

/** A parcel-status bar: how far acquisition has got, at a glance. */
export default function ProgressBar({ byStatus, total }: { byStatus: Partial<Record<string, number>>; total: number }) {
  const t = useT();
  if (!total) return <div className="h-2 rounded-full bg-surface-muted" />;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-surface-muted">
      {[...STATUS_ORDER].reverse().map((s) => {
        const n = byStatus[s] ?? 0;
        if (!n) return null;
        return (
          <div
            key={s}
            title={`${t(parcelStatusKey(s))}: ${n}`}
            style={{ width: `${(n / total) * 100}%`, background: STATUS_COLOUR[s] }}
          />
        );
      })}
    </div>
  );
}
