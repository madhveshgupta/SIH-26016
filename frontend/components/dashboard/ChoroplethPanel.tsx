"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import WhenNear from "@frontend/components/WhenNear";
import GlobeLoading from "@frontend/components/map/GlobeLoading";

/** The globe needs WebGL and `window`, so it cannot be server-rendered. */
const IndiaChoropleth = dynamic(() => import("./IndiaChoropleth"), {
  ssr: false,
  loading: () => <GlobeLoading height={460} rounded="rounded-xl" />,
});

/**
 * The globe is the heaviest thing on any page (several MB of script plus imagery), and on the
 * front page and the dashboard it sits below the fold.
 */
export default function ChoroplethPanel(props: ComponentProps<typeof IndiaChoropleth>) {
  // The controls row and legend add ~90 px to the map itself.
  return (
    <WhenNear height={(props.height ?? 460) + 90}>
      <IndiaChoropleth {...props} />
    </WhenNear>
  );
}
