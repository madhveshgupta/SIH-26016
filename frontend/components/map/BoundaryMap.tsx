"use client";

import { useEffect } from "react";
import { CircleMarker, LayersControl, MapContainer, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  seq: number;
  lat: number;
  lng: number;
}

function Fit({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 3) return;
    import("leaflet").then((L) => {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 19 });
    });
  }, [map, points]);
  return null;
}

/** One parcel, its boundary and its numbered survey points. */
export default function BoundaryMap({ points, colour = "#0b3d91", highlight }: { points: MapPoint[]; colour?: string; highlight?: number | null }) {
  const centre: [number, number] = points.length ? [points[0].lat, points[0].lng] : [22.5, 79];
  return (
    <div className="h-[420px] overflow-hidden rounded-xl border border-border">
      <style>{`.vertex-label{background:#0b3d91;color:#fff;border:none;border-radius:9999px;padding:1px 6px;font:600 10px/1.4 system-ui;box-shadow:0 1px 3px rgba(0,0,0,.3)}.vertex-label::before{display:none}`}</style>
      <MapContainer center={centre} zoom={17} maxZoom={20} zoomSnap={0.25} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satellite">
            <TileLayer attribution="Imagery &copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={18} maxZoom={20} />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Street map">
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={20} />
          </LayersControl.BaseLayer>
        </LayersControl>
        {points.length >= 3 && (
          <Polygon positions={points.map((p) => [p.lat, p.lng])} pathOptions={{ color: "#fde047", weight: 2.5, fillColor: colour, fillOpacity: 0.35 }} />
        )}
        {points.map((p) => (
          <CircleMarker
            key={p.seq}
            center={[p.lat, p.lng]}
            radius={highlight === p.seq ? 8 : 5}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: highlight === p.seq ? "#f59e0b" : "#0b3d91", fillOpacity: 1 }}
          >
            <Tooltip permanent direction="top" offset={[0, -6]} className="vertex-label">
              {p.seq}
            </Tooltip>
          </CircleMarker>
        ))}
        <Fit points={points} />
      </MapContainer>
    </div>
  );
}
