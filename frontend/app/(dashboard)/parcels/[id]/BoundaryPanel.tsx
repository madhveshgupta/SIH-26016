"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Download } from "lucide-react";
import { buttonClass } from "@frontend/components/ui/Button";
import type { BoundaryPoint } from "@backend/gis/vertices";
import { useLocale, useT } from "@frontend/components/I18nProvider";

function MapLoading() {
  const t = useT();
  return <div className="flex h-[420px] items-center justify-center rounded-xl border border-border text-xs text-muted">{t("screens.parcelPage.loadingMap")}</div>;
}

const BoundaryMap = dynamic(() => import("@frontend/components/map/BoundaryMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

/** Map and point table side by side; hovering a row highlights its point. */
export default function BoundaryPanel({ parcelId, points, colour }: { parcelId: string; points: BoundaryPoint[]; colour: string }) {
  const t = useT();
  const { intl } = useLocale();
  const [hover, setHover] = useState<number | null>(null);
  const perimeter = points.reduce((a, p) => a + p.sideM, 0);
  return (
    <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
      <BoundaryMap points={points} colour={colour} highlight={hover} />
      <div className="flex flex-col">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted">
            {t("screens.parcelPage.pointsPerimeter", { count: points.length, m: perimeter.toLocaleString(intl, { maximumFractionDigits: 1 }) })}
          </div>
          <div className="flex gap-1.5">
            {(["csv", "geojson", "kml"] as const).map((f) => (
              <a key={f} href={`/api/gis/parcels/${parcelId}/export?format=${f}`} className={buttonClass("secondary", "sm")}>
                <Download className="h-3.5 w-3.5" /> {f.toUpperCase()}
              </a>
            ))}
          </div>
        </div>
        <div className="max-h-[380px] overflow-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-muted text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{t("screens.parcelPage.point")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("screens.plotRecord.latitude")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("screens.plotRecord.longitude")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("screens.plotRecord.elevation")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("screens.plotRecord.sideToNext")}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.seq} onMouseEnter={() => setHover(p.seq)} onMouseLeave={() => setHover(null)} className="border-t border-border hover:bg-brand-soft/50">
                  <td className="px-3 py-1.5"><span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">{p.seq}</span></td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{p.lat.toFixed(7)}° N</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{p.lng.toFixed(7)}° E</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted">{p.elevationM == null ? "—" : t("screens.plotRecord.metres", { m: p.elevationM.toFixed(1) })}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums">{t("screens.plotRecord.metres", { m: p.sideM.toFixed(2) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
