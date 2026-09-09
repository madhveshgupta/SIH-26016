"use client";

import { useEffect } from "react";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import type { Feature, Geometry } from "geojson";
import "leaflet/dist/leaflet.css";

/**
 * The selected plot on its own, on satellite imagery — the "where is this actually" answer the
 * drawer owes the reader before any table.
 */
function Fit({ data }: { data: Feature<Geometry> }) {
  const map = useMap();
  useEffect(() => {
    import("leaflet").then((L) => {
      const bounds = L.geoJSON(data as never).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 19 });
    });
  }, [data, map]);
  return null;
}

export default function PlotMiniMap({ feature, colour }: { feature: Feature<Geometry>; colour: string }) {
  return (
    <MapContainer
      center={[27.113, 78.08]}
      zoom={17}
      maxZoom={20}
      zoomControl={false}
      scrollWheelZoom={false}
      dragging={false}
      doubleClickZoom={false}
      attributionControl={false}
      style={{ height: "100%", width: "100%", background: "#0b1120" }}
    >
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={18}
        maxZoom={20}
      />
      <GeoJSON
        key={String(feature.properties?.id ?? "plot")}
        data={feature as never}
        // A preview, not a control: it must not take the pointer, and it must
        // not look like another clickable plot layer.
        interactive={false}
        style={{ color: "#ffffff", weight: 2.5, fillColor: colour, fillOpacity: 0.45 } as never}
      />
      <Fit data={feature} />
    </MapContainer>
  );
}
