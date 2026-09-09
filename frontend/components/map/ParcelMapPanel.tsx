"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Feature, Geometry } from "geojson";
import { STATUS_COLOUR, STATUS_ORDER, projectColour } from "./legend";
import { useT } from "@frontend/components/I18nProvider";
import { parcelStatusKey } from "@backend/i18n/scope";
import type { GlobeProject } from "./ProjectGlobe";
import PlotPopup, { type MapPlot } from "./PlotPopup";
import GlobeLoading from "./GlobeLoading";

/** OpenLayers touches `window` on import, so the globe must not be server-rendered. */
const ProjectGlobe = dynamic(() => import("./ProjectGlobe"), {
  ssr: false,
  loading: () => <GlobeLoading height={560} />,
});

export interface MapProjectOption {
  id: string;
  referenceNo: string;
  name: string;
  /** States this project needs land in. */
  states: string[];
  parcels: number;
}

interface Props {
  projects: MapProjectOption[];
  /** Preselected project. When `lockProject` is set the picker is hidden. */
  initialProjectId?: string | null;
  initialStatus?: string | null;
  lockProject?: boolean;
  /** The map's height: pixels, or a CSS length such as a calc() that fits the window. */
  mapHeight?: number | string;
}

const chip = (active: boolean) =>
  `rounded-md px-2 py-1 text-[11px] transition ${
    active
      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
      : "border border-border text-foreground hover:bg-surface-muted"
  }`;

export default function ParcelMapPanel({
  projects,
  initialProjectId = null,
  initialStatus = null,
  lockProject = false,
  mapHeight = 560,
}: Props) {
  const t = useT();
  const plots = (n: number) => t(n === 1 ? "screens.globe.plotsOne" : "screens.globe.plotsMany", { count: n });
  const [projectId, setProjectIdState] = useState<string | null>(initialProjectId);
  const [status, setStatus] = useState<string | null>(initialStatus);
  const [colourBy, setColourBy] = useState<"status" | "project">("status");

  /** The plot picked on the map — exactly the properties its map feature carries. */
  const [selectedPlot, setSelectedPlot] = useState<MapPlot | null>(null);

  /** Another project’s land: whatever was selected belongs to the old one. */
  const setProjectId = useCallback((id: string | null) => {
    setSelectedPlot(null);
    setProjectIdState(id);
  }, []);

  /** Clicking another plot simply replaces the selection, and with it the card. */
  const selectFromMap = useCallback((feature: Feature<Geometry, Record<string, unknown>>) => {
    setSelectedPlot((feature.properties ?? null) as unknown as MapPlot | null);
  }, []);

  const clearSelection = useCallback(() => setSelectedPlot(null), []);

  /** Project points for the globe overview. */
  const [globeProjects, setGlobeProjects] = useState<GlobeProject[] | null>(null);

  useEffect(() => {
    if (globeProjects) return;
    let cancelled = false;
    fetch("/api/gis/overview")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!cancelled) setGlobeProjects(d.projects ?? []);
      })
      .catch(() => {
        if (!cancelled) setGlobeProjects([]);
      });
    return () => { cancelled = true; };
  }, [globeProjects]);

  /** Projects grouped under each state they need land in. */
  const byState = useMemo(() => {
    const m = new Map<string, MapProjectOption[]>();
    for (const p of projects) {
      for (const s of p.states.length ? p.states : ["—"]) {
        m.set(s, [...(m.get(s) ?? []), p]);
      }
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [projects]);

  const refsInView = useMemo(
    () =>
      projects
        .filter((p) => p.parcels > 0 && (projectId === null || p.id === projectId))
        .map((p) => p.referenceNo)
        .sort(),
    [projects, projectId],
  );

  const chosen = projects.find((p) => p.id === projectId) ?? null;
  const inDetail = projectId !== null;

  return (
    <div className="space-y-3">
      {/* Project header — shows when viewing a project's parcels */}
      {!lockProject && inDetail && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{chosen?.name ?? t("common.project")}</div>
            <div className="text-xs text-muted">
              {chosen?.referenceNo}{chosen ? ` · ${plots(chosen.parcels)}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={projectId ?? ""}
              onChange={(e) => setProjectId(e.target.value || null)}
              aria-label={t("screens.mapPanel.chooseProject")}
              className="h-9 min-w-[220px] rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              {byState.map(([state, list]) => (
                <optgroup key={state} label={state}>
                  {list.map((p) => (
                    <option key={`${state}-${p.id}`} value={p.id} disabled={p.parcels === 0}>
                      {t("screens.mapPanel.projectOption", { name: p.name, plots: plots(p.parcels) })}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button onClick={() => setProjectId(null)} className={chip(false)} title={t("screens.mapPanel.backToGlobe")}>
              {t("screens.mapPanel.globe")}
            </button>
          </div>
        </div>
      )}

      {/* Globe overview header — shows when no project is selected */}
      {!lockProject && !inDetail && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t("screens.mapPanel.chooseOnGlobe")}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {t("screens.mapPanel.turnEarth")}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="whitespace-nowrap">{t("screens.mapPanel.orJump")}</span>
            <select
              value=""
              onChange={(e) => e.target.value && setProjectId(e.target.value)}
              aria-label={t("screens.mapPanel.chooseProject")}
              className="h-9 min-w-[240px] rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              <option value="">{t("screens.mapPanel.selectProject")}</option>
              {byState.map(([state, list]) => (
                <optgroup key={state} label={state}>
                  {list.map((p) => (
                    <option key={`${state}-${p.id}`} value={p.id} disabled={p.parcels === 0}>
                      {t("screens.mapPanel.projectOption", { name: p.name, plots: plots(p.parcels) })}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* Status filter + colour-by controls — only when viewing parcels */}
      {inDetail && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-muted">{t("common.status")}</span>
          <button onClick={() => setStatus(null)} className={chip(status === null)}>
            {t("common.all")}
          </button>
          {STATUS_ORDER.map((s) => (
            <button key={s} onClick={() => setStatus(status === s ? null : s)} className={`${chip(status === s)} flex items-center gap-1.5`}>
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLOUR[s] }} />
              {t(parcelStatusKey(s))}
            </button>
          ))}
          {!lockProject && (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-[11px] text-muted">{t("screens.mapPanel.colourBy")}</span>
              <button onClick={() => setColourBy("status")} className={chip(colourBy === "status")}>
                {t("common.status")}
              </button>
              <button onClick={() => setColourBy("project")} className={chip(colourBy === "project")}>
                {t("common.project")}
              </button>
            </span>
          )}
        </div>
      )}

      {/* The globe — single component for both overview and detail */}
      {!globeProjects ? (
        <GlobeLoading height={mapHeight} />
      ) : (
        <ProjectGlobe
          projects={globeProjects}
          projectId={projectId}
          statusFilter={status}
          colourBy={colourBy}
          lockProject={lockProject}
          height={mapHeight}
          onProjectChange={setProjectId}
          onSelectParcel={selectFromMap}
          onClearSelection={clearSelection}
          selectedId={selectedPlot?.id ?? null}
          popup={selectedPlot && <PlotPopup key={selectedPlot.id} plot={selectedPlot} onClose={clearSelection} />}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        {inDetail ? (
          <>
            {colourBy === "project" &&
              refsInView.map((ref, i) => (
                <span key={ref} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: projectColour(i) }} />
                  {projects.find((p) => p.referenceNo === ref)?.name}
                </span>
              ))}
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm border-2 border-yellow-400" />
              {t("screens.mapPanel.legendCadastral")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm border-2 border-cyan-400" />
              {t("screens.mapPanel.legendOsm")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm border-2 border-dashed border-slate-400" />
              {t("screens.mapPanel.legendGenerated")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm border-2 border-dashed border-red-600" />
              {t("screens.mapPanel.legendClaimedTwice")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-dashed border-neutral-400" />
              {t("screens.globe.rightOfWay")}
            </span>
            <span className="text-muted">
              {t("screens.mapPanel.legendHint")}
            </span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#60a5fa]" /> {t("screens.mapPanel.legendNotPossessed")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#facc15]" /> {t("screens.mapPanel.legendUnderWay")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#10b981]" /> {t("screens.mapPanel.legend40")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" /> {t("screens.mapPanel.legendConflict")}
            </span>
            <span className="text-muted">{t("screens.mapPanel.legendDotSize")}</span>
          </>
        )}
      </div>
    </div>
  );
}
