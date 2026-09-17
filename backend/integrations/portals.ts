/** The Bhu-Naksha state cadastral portals this system integrates with. */
export interface PortalDef {
  state: string;
  lgd: string;
  kind: "angular" | "classic" | "georef" | "assam";
  base: string;
  /** Rough WGS84 box for the state — used only to sanity-check the CRS. */
  box: [number, number, number, number]; // minLat, minLng, maxLat, maxLng
  /** UTM zones to try, most likely first. */
  zones: number[];
}

export const PORTALS: PortalDef[] = [
  { state: "Uttar Pradesh", lgd: "09", kind: "angular", base: "https://upbhunaksha.gov.in", box: [23.8, 77.0, 30.5, 84.7], zones: [44, 43, 45] },
  { state: "Haryana", lgd: "06", kind: "angular", base: "https://maps.revenueharyana.gov.in", box: [27.6, 74.4, 31.0, 77.6], zones: [43, 44] },
  { state: "Himachal Pradesh", lgd: "02", kind: "angular", base: "https://bhunakshahp.nic.in", box: [30.3, 75.5, 33.3, 79.0], zones: [43, 44] },
  { state: "Jammu and Kashmir", lgd: "01", kind: "angular", base: "https://bhunaksha.jk.gov.in", box: [32.2, 73.2, 35.2, 76.9], zones: [43, 44] },
  { state: "Rajasthan", lgd: "08", kind: "classic", base: "https://bhunaksha.rajasthan.gov.in/Viewmap", box: [23.0, 69.4, 30.3, 78.3], zones: [43, 42, 44] },
  { state: "Punjab", lgd: "03", kind: "classic", base: "https://gisbhunaksha.punjab.gov.in", box: [29.5, 73.8, 32.6, 77.0], zones: [43, 44] },
  { state: "Chhattisgarh", lgd: "22", kind: "classic", base: "https://bhunaksha.cg.nic.in", box: [17.7, 80.2, 24.2, 84.5], zones: [44, 45] },
  { state: "Goa", lgd: "30", kind: "classic", base: "https://bhunaksha.goa.gov.in/bhunaksha", box: [14.8, 73.6, 15.9, 74.4], zones: [43] },
  { state: "Odisha", lgd: "21", kind: "classic", base: "https://bhunakshaodisha.nic.in/bhunaksha", box: [17.7, 81.3, 22.7, 87.6], zones: [45, 44] },
  { state: "Bihar", lgd: "10", kind: "classic", base: "https://bhunaksha.bihar.gov.in", box: [24.2, 83.3, 27.6, 88.3], zones: [45, 44] },
  { state: "Tripura", lgd: "16", kind: "classic", base: "https://bhunaksha.tripura.gov.in/bhunaksha", box: [22.9, 91.1, 24.6, 92.4], zones: [46, 45] },
  { state: "Andhra Pradesh", lgd: "28", kind: "classic", base: "https://bhunaksha.ap.gov.in/bhunakshalpm", box: [12.6, 76.7, 19.9, 84.8], zones: [44, 45] },
  { state: "Tamil Nadu", lgd: "33", kind: "classic", base: "https://collabland-tn.gov.in", box: [8.0, 76.2, 13.6, 80.4], zones: [44, 43] },
  // Maharashtra's georeferenced viewer (/27/index.html → /rest). It needs a session cookie.
  { state: "Maharashtra", lgd: "27", kind: "georef", base: "https://mahabhunakasha.mahabhumi.gov.in", box: [15.6, 72.6, 22.1, 80.9], zones: [43, 44] },
  // Assam's Bhu-Naksha (2025 rebuild), joined to Dharitree records. Vector plots with ULPIN.
  { state: "Assam", lgd: "18", kind: "assam", base: "https://bhunaksha.assam.gov.in", box: [24.1, 89.7, 28.0, 96.1], zones: [46] },
  { state: "Lakshadweep", lgd: "31", kind: "classic", base: "https://bhunaksha.utl.gov.in/bhunaksha", box: [8.2, 71.6, 12.4, 74.0], zones: [43] },
];
