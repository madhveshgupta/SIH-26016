"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { GlobeLabels, GlobeProject } from "./ProjectGlobe";

/** The citizen's own land, on the map. */
const ProjectGlobe = dynamic(() => import("./ProjectGlobe"), {
  ssr: false,
  loading: () => (
    <div
      className="h-[420px] rounded-lg border border-border"
      style={{ background: "radial-gradient(circle at 50% 45%, #14213d 0%, #080d1a 70%)" }}
    />
  ),
});

export default function MyLandMap({
  title,
  intro,
  empty,
  selected = null,
  labels,
}: {
  title: string;
  intro: string;
  empty: string;
  /** The map's own words, in the reader's language. */
  labels: GlobeLabels & { loading: string; acquisition: string; plots: string };
  /** The plot picked in a card (`?plot=`), outlined and flown to on the globe. */
  selected?: { id: string; projectId: string } | null;
}) {
  const [projects, setProjects] = useState<GlobeProject[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(selected?.projectId ?? null);
  const [inView, setInView] = useState(false);
  const frame = useRef<HTMLDivElement | null>(null);

  // A newly picked plot switches to its acquisition and asks the globe to fly there once.
  const [shownPlot, setShownPlot] = useState(selected?.id ?? null);
  const [focusNonce, setFocusNonce] = useState(selected ? 1 : 0);
  if ((selected?.id ?? null) !== shownPlot) {
    setShownPlot(selected?.id ?? null);
    if (selected) {
      setProjectId(selected.projectId);
      setFocusNonce((n) => n + 1);
    }
  }
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer support: load it anyway, but on a later tick so this stays
      // a subscription rather than a render-time state change.
      const t = setTimeout(() => setInView(true), 0);
      return () => clearTimeout(t);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      // Start loading just before it reaches the viewport, so the map is
      // usually ready by the time it is on screen.
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    fetch("/api/gis/overview")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { projects?: GlobeProject[] }) => {
        if (cancelled) return;
        const mine = (d.projects ?? []).filter((p) => p.parcels > 0);
        setProjects(mine);
        // Open on the picked plot's acquisition if there is one, otherwise on
        // whichever acquisition takes the most of their land.
        const largest = [...mine].sort((a, b) => b.hectares - a.hectares)[0]?.id ?? null;
        setProjectId((cur) => (cur && mine.some((p) => p.id === cur) ? cur : largest));
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [inView]);

  if (projects !== null && projects.length === 0) return null;

  return (
    <section id="plot-map" className="mt-5 scroll-mt-20">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 max-w-3xl text-xs text-muted">{intro}</p>

      {projects && projects.length > 1 && (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          <span>{labels.acquisition}</span>
          <select
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value || null)}
            className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-foreground focus:border-brand focus:outline-none"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {labels.plots.replace("{count}", String(p.parcels))}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="mt-2" ref={frame}>
        {projects === null ? (
          <div
            className="flex h-[420px] items-center justify-center rounded-lg border border-border text-xs text-slate-300"
            style={{ background: "radial-gradient(circle at 50% 45%, #14213d 0%, #080d1a 70%)" }}
          >
            {labels.loading}
          </div>
        ) : projectId ? (
          <ProjectGlobe
            projects={projects}
            projectId={projectId}
            lockProject
            selectedId={selected?.id ?? null}
            focusNonce={focusNonce}
            height={420}
            labels={labels}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted">{empty}</div>
        )}
      </div>
    </section>
  );
}
