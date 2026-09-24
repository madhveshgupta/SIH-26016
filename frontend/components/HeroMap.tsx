"use client";

import { useT } from "@frontend/components/I18nProvider";
import type { MessageKey } from "@backend/i18n/types";
import {
  INDIA_PATH,
  INDIA_STATES_PATH,
  INDIA_VIEWBOX,
  projectToIndia,
} from "@frontend/lib/india-outline";

/** India, surveyed into existence. */
/** Names are screens.heroMap.<name> — each in the viewer's own script. */
const SITES: { id: string; state: string; lon: number; lat: number; primary?: boolean }[] = [
  { id: "Agra", state: "UttarPradesh", lon: 78.02, lat: 27.18, primary: true },
  { id: "Jalandhar", state: "Punjab", lon: 75.58, lat: 31.33 },
  { id: "Sehore", state: "MadhyaPradesh", lon: 77.08, lat: 23.2 },
  { id: "Guntur", state: "AndhraPradesh", lon: 80.45, lat: 16.3 },
  { id: "Aldona", state: "Goa", lon: 73.87, lat: 15.61 },
];

export default function HeroMap({ className = "" }: { className?: string }) {
  const t = useT();
  const place = (name: string) => t(`screens.heroMap.${name}` as MessageKey);
  return (
    <svg
      viewBox={INDIA_VIEWBOX}
      className={className}
      role="img"
      aria-label={t("screens.heroMap.aria")}
    >
      <defs>
        <clipPath id="indiaClip" clipRule="evenodd">
          <path d={INDIA_PATH} clipRule="evenodd" />
        </clipPath>

        <linearGradient id="indiaTint" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="#5a9b72" stopOpacity="0.55" />
          <stop offset="52%" stopColor="#2c6247" stopOpacity="0.68" />
          <stop offset="100%" stopColor="#0f3022" stopOpacity="0.9" />
        </linearGradient>

        {/* light from the upper right, matching the page's warm side */}
        <linearGradient id="indiaLight" x1="1" y1="0" x2="0.1" y2="1">
          <stop offset="0%" stopColor="#ffdcae" stopOpacity="0.55" />
          <stop offset="34%" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#04180f" stopOpacity="0.4" />
        </linearGradient>

        <filter id="indiaLift" x="-22%" y="-14%" width="144%" height="134%">
          <feDropShadow dx="0" dy="20" stdDeviation="22" floodColor="#0a1f15" floodOpacity="0.45" />
        </filter>

        <filter id="pinGlow" x="-150%" y="-150%" width="400%" height="400%">
          <feDropShadow dx="0" dy="2" stdDeviation="3.5" floodColor="#07150e" floodOpacity="0.6" />
        </filter>

        {/* the light sweep, once across the terrain */}
        <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g filter="url(#indiaLift)">
        <g className="map-land">
          <g clipPath="url(#indiaClip)">
            <image
              href="/hero/expressway.jpg"
              x="-45"
              y="-35"
              width="500"
              height="615"
              preserveAspectRatio="xMidYMid slice"
            />
            <rect x="0" y="0" width="400" height="520" fill="url(#indiaTint)" />
            <rect x="0" y="0" width="400" height="520" fill="url(#indiaLight)" />
          </g>

          {/* the light sweep — a second clip group, so it can never spill
              past the coastline no matter how wide the gradient bar is */}
          <g clipPath="url(#indiaClip)">
            <rect
              x="0"
              y="-40"
              width="140"
              height="600"
              fill="url(#sweepGrad)"
              className="map-sweep mix-blend-overlay"
            />
          </g>
        </g>

        {/* district boundaries */}
        <g className="map-district" clipPath="url(#indiaClip)">
          <path
            d={INDIA_STATES_PATH}
            fill="none"
            className="stroke-white"
            strokeOpacity="0.3"
            strokeWidth="0.7"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>

        {/* The coastline, drawn as a survey line. pathLength="1" makes the dash
            maths independent of the path's real length. */}
        <path
          d={INDIA_PATH}
          pathLength="1"
          fill="none"
          fillRule="evenodd"
          className="map-draw stroke-white/70"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </g>

      {SITES.map((s, i) => {
        const { x, y } = projectToIndia(s.lon, s.lat);
        const r = s.primary ? 6 : 4.2;
        return (
          <g key={s.id}>
            <title>{`${place(s.id)}, ${place(s.state)}`}</title>

            {s.primary && (
              <circle cx={x} cy={y} r={r * 1.8} className="map-ping fill-accent" />
            )}

            <g className={`map-pin map-pin-${i + 1}`} filter="url(#pinGlow)">
              <circle
                cx={x}
                cy={y}
                r={r * 2}
                className={s.primary ? "fill-accent" : "fill-white"}
                opacity="0.2"
              />
              <circle
                cx={x}
                cy={y}
                r={r}
                className={s.primary ? "fill-accent" : "fill-white"}
              />
              <circle
                cx={x}
                cy={y}
                r={r}
                fill="none"
                className="stroke-white"
                strokeWidth="1.4"
                opacity={s.primary ? 0.95 : 0.65}
              />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
