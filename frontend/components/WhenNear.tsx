"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Render `children` only once this spot is about to scroll into view. */
export default function WhenNear({
  children,
  height,
  label,
  // Zero on purpose: on a 1000 px screen the front-page map starts ~90 px below the fold (before
  // the hero settles), so any look-ahead loaded the globe with the page anyway.
  rootMargin = "0px",
}: {
  children: ReactNode;
  /** Height of the placeholder, in px — match the component it stands in for. */
  height: number;
  label?: string;
  rootMargin?: string;
}) {
  const [near, setNear] = useState(false);
  const spot = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = spot.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer support: load it anyway, on a later tick so this stays a
      // subscription rather than a render-time state change.
      const t = setTimeout(() => setNear(true), 0);
      return () => clearTimeout(t);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  if (near) return <>{children}</>;
  return (
    <div
      ref={spot}
      style={{ height, background: "radial-gradient(circle at 50% 45%, #14213d 0%, #080d1a 70%)" }}
      className="flex items-center justify-center rounded-xl border border-border text-xs text-slate-300"
    >
      {label}
    </div>
  );
}
