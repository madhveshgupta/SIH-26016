/** The state cadastre behind each village the system has mapped. */
import type { CorridorPortal } from "./cadastral-corridor";

const UP = (gisCode: string): CorridorPortal => ({
  kind: "angular",
  apiBase: "https://upbhunaksha.gov.in/bhunakshaserver",
  wmsUrl: "https://upbhunaksha.gov.in/bhunakshaserver/WMS",
  referer: "https://upbhunaksha.gov.in/",
  wmsVersion: "1.3.0",
  stateCode: "",
  gisCode,
  srid: 32644,
  // UP draws a 1-pixel stroke over the fill, centred on the true line
  // (calibrated in scripts/calibrate-boundaries.sql).
  insetPx: 0.5,
});

export const UP_AKBARPUR = UP("14600766124649");

export const GOA_ALDONA: CorridorPortal = {
  kind: "classic",
  apiBase: "https://bhunaksha.goa.gov.in/bhunaksha",
  wmsUrl: "https://bhunaksha.goa.gov.in/bhunaksha/WMS",
  referer: "https://bhunaksha.goa.gov.in/bhunaksha/",
  wmsVersion: "1.1.1",
  stateCode: "30",
  levels: "01,30010002,40113000,000VILLAGE,",
  gisCode: "013001000240113000000VILLAGE",
  srid: 32643,
  // Goa renders fill only, no stroke.
  insetPx: 0,
};

export const VILLAGE_PORTALS: Record<string, CorridorPortal> = Object.fromEntries(
  [
    UP_AKBARPUR,
    UP("18000922172239"), // Akhnapur, Bahraich
    GOA_ALDONA,
    {
      kind: "angular", apiBase: "https://bhunakshahp.nic.in/bhunakshaserver", wmsUrl: "https://bhunakshahp.nic.in/bhunakshaserver/WMS",
      referer: "https://bhunakshahp.nic.in/", wmsVersion: "1.3.0", stateCode: "", gisCode: "0401005801", srid: 32643, wmsCrs: "epsg", insetPx: 0.5,
    },
    {
      kind: "angular", apiBase: "https://maps.revenueharyana.gov.in/bhunakshaserver", wmsUrl: "https://maps.revenueharyana.gov.in/bhunakshaserver/WMS",
      referer: "https://maps.revenueharyana.gov.in/", wmsVersion: "1.3.0", stateCode: "", gisCode: "0100100001R", srid: 32643, wmsCrs: "epsg", insetPx: 0.5,
    },
    {
      kind: "classic", apiBase: "https://gisbhunaksha.punjab.gov.in", wmsUrl: "https://gisbhunaksha.punjab.gov.in/WMS",
      referer: "https://gisbhunaksha.punjab.gov.in/", wmsVersion: "1.1.1", stateCode: "03", levels: "01,001,010,090,30352,",
      gisCode: "0100101009030352", srid: 32643, wmsCrs: "epsg", insetPx: 0,
    },
    {
      kind: "classic", apiBase: "https://bhunaksha.rajasthan.gov.in/Viewmap", wmsUrl: "https://bhunaksha.rajasthan.gov.in/Viewmap/WMS",
      referer: "https://bhunaksha.rajasthan.gov.in/Viewmap/", wmsVersion: "1.1.1", stateCode: "08", levels: "09,295,1316,05240,19686,001,",
      gisCode: "0929513160524019686001", srid: 32643, wmsCrs: "blank", insetPx: 0,
    },
    {
      kind: "classic", apiBase: "https://bhunaksha.tripura.gov.in/bhunaksha", wmsUrl: "https://bhunaksha.tripura.gov.in/bhunaksha/WMS",
      referer: "https://bhunaksha.tripura.gov.in/bhunaksha/", wmsVersion: "1.1.1", stateCode: "16", levels: "269,6697,000155,0008896,922862,06_01,",
      gisCode: "2696697000155000889692286206_01", srid: 32646, wmsCrs: "epsg", insetPx: 0,
    },
  ].map((p) => [p.gisCode, p as CorridorPortal]),
);
