"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ArrowRight, Split, X } from "lucide-react";
import { Badge } from "@frontend/components/ui";
import { STATUS_COLOUR, STATUS_TONE } from "./legend";
import { useT } from "@frontend/components/I18nProvider";
import { parcelStatusKey } from "@backend/i18n/scope";
import type { MessageKey } from "@backend/i18n/types";
import type { PlotSummary } from "./PlotRecord";

/** What a plot on the map layer carries — the popup reads nothing else. */
export type MapPlot = PlotSummary & { landUse?: string | null };

const sentence = (v: string) => v.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

/**
 * The compact card for the plot picked on the map: just enough to confirm it is the right plot,
 * and the way into its full record.
 */
export default function PlotPopup({ plot, onClose }: { plot: MapPlot; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The revenue record is the legal area; the map measure stands in only when
  // the state publishes none.
  const area = plot.recordHa ?? plot.mapHa;
  const areaNote = plot.recordHa == null && plot.mapHa != null ? t("screens.mapPanel.onMap") : null;
  const landUseKey = `screens.landUse.${plot.landUse}`;
  const landUse = !plot.landUse ? "—" : t(landUseKey as MessageKey) === landUseKey ? sentence(plot.landUse) : t(landUseKey as MessageKey);

  return (
    <div role="dialog" aria-label={t("screens.parcelPage.khasraTitle", { no: plot.khasraNo })} className="text-foreground">
      <div className="flex items-start justify-between gap-2 px-3.5 pt-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight tracking-tight">
            {t("common.khasra")} <span className="font-mono">{plot.khasraNo}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">
            {[plot.village, plot.district].filter(Boolean).join(", ")}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          title={t("screens.mapPanel.closeEsc")}
          className="-mr-1.5 -mt-1 shrink-0 rounded-md p-1 text-muted transition hover:bg-surface-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <dl className="mt-2.5 grid grid-cols-[76px_1fr] items-center gap-x-3 gap-y-1.5 px-3.5 text-xs">
        <dt className="text-muted">{t("common.status")}</dt>
        <dd>
          <Badge
            tone={STATUS_TONE[plot.status] ?? "neutral"}
            icon={<span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOUR[plot.status] ?? "#94a3b8" }} />}
          >
            {t(parcelStatusKey(plot.status))}
          </Badge>
        </dd>
        <dt className="text-muted">{t("common.area")}</dt>
        <dd className="font-medium tabular-nums">
          {area == null ? "—" : t("screens.units.ha", { value: area.toFixed(4) })}
          {areaNote && <span className="ml-1 font-normal text-muted">({areaNote})</span>}
        </dd>
        <dt className="text-muted">{t("screens.plotRecord.landUse")}</dt>
        <dd>{landUse}</dd>
        <dt className="text-muted">{t("common.project")}</dt>
        <dd className="truncate font-medium" title={plot.project}>{plot.project}</dd>
      </dl>

      {plot.hasConflict && (
        <div className="mx-3.5 mt-2.5 flex items-start gap-1.5 rounded-md bg-danger-soft px-2 py-1.5 text-[11px] font-medium text-danger">
          <Split className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{t("screens.mapPanel.alsoClaimedBy", { projects: plot.otherProjects ?? t("screens.globe.anotherProject") })}</span>
        </div>
      )}

      <div className="mt-3 border-t border-border px-3.5 py-2">
        <Link
          href={`/parcels/${encodeURIComponent(plot.id)}`}
          className="group inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
        >
          {t("screens.mapPanel.viewFull")}
          <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
