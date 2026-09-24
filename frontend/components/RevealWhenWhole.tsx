"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@frontend/lib/cn";

interface RevealWhenWholeProps {
  children: ReactNode;
  /** Stagger, in ms, before the entrance runs once the element is in view. */
  delay?: number;
  className?: string;
}

/**
 * Keeps its children hidden until the whole element is inside the viewport, then plays a
 * rise-in; it hides again whenever the fold cuts it, so scrolling back up never leaves half a
 * card showing.
 */
export default function RevealWhenWhole({ children, delay = 0, className }: RevealWhenWholeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    // 0.98, not 1: fractional layout heights can keep the ratio a hair
    // under 1 even when the card is visibly whole.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.98) {
          setShown(true);
          return;
        }
        // Hide again only when the fold is what cuts it (scrolling back up).
        const viewportBottom = entry.rootBounds?.bottom ?? window.innerHeight;
        if (entry.boundingClientRect.bottom > viewportBottom) setShown(false);
      },
      { threshold: [0, 0.98, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("whole-reveal", shown && "is-shown", className)}
      style={shown && delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      <noscript>
        <style>{".whole-reveal{opacity:1}"}</style>
      </noscript>
      {children}
    </div>
  );
}
