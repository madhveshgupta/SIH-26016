/**
 * Harvest Tier 2 land — real OpenStreetMap field boundaries along an alignment — for every state
 * without georeferenced cadastral plots.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { denseFieldSpots, fieldsAlongCorridor, nearestVillage, reverseAdmin } from "@backend/integrations/adapters/osm-fields";

/** States/UTs by LGD code with their ISO 3166-2 code (what OSM tags the boundary with). */
/** `box` is a rough WGS84 extent (minLat, minLng, maxLat, maxLng) used only to sample where fields are mapped. */
export const FIELD_STATES: { lgd: string; name: string; iso: string; box: [number, number, number, number] }[] = [
  { lgd: "01", name: "Jammu and Kashmir", iso: "IN-JK" , box: [32.3,73.8,34.7,76.0] },
  { lgd: "04", name: "Chandigarh", iso: "IN-CH" , box: [30.66,76.69,30.80,76.85] },
  { lgd: "05", name: "Uttarakhand", iso: "IN-UT" , box: [28.9,77.6,31.4,81.0] },
  { lgd: "07", name: "Delhi", iso: "IN-DL" , box: [28.42,76.84,28.88,77.35] },
  { lgd: "08", name: "Rajasthan", iso: "IN-RJ" , box: [23.0,69.5,30.2,78.2] },
  { lgd: "10", name: "Bihar", iso: "IN-BR" , box: [24.3,83.4,27.5,88.2] },
  { lgd: "11", name: "Sikkim", iso: "IN-SK" , box: [27.1,88.0,28.1,88.9] },
  { lgd: "12", name: "Arunachal Pradesh", iso: "IN-AR" , box: [26.7,91.6,29.4,97.4] },
  { lgd: "13", name: "Nagaland", iso: "IN-NL" , box: [25.2,93.3,27.0,95.2] },
  { lgd: "14", name: "Manipur", iso: "IN-MN" , box: [23.8,93.0,25.7,94.7] },
  { lgd: "15", name: "Mizoram", iso: "IN-MZ" , box: [21.9,92.3,24.5,93.4] },
  { lgd: "17", name: "Meghalaya", iso: "IN-ML" , box: [25.0,89.8,26.1,92.8] },
  { lgd: "18", name: "Assam", iso: "IN-AS" , box: [24.1,89.7,27.9,96.0] },
  { lgd: "19", name: "West Bengal", iso: "IN-WB" , box: [21.5,85.8,27.2,89.9] },
  { lgd: "20", name: "Jharkhand", iso: "IN-JH" , box: [21.9,83.3,25.3,87.9] },
  { lgd: "21", name: "Odisha", iso: "IN-OR" , box: [17.8,81.4,22.6,87.5] },
  { lgd: "22", name: "Chhattisgarh", iso: "IN-CT" , box: [17.8,80.3,24.1,84.4] },
  { lgd: "23", name: "Madhya Pradesh", iso: "IN-MP" , box: [21.1,74.0,26.9,82.8] },
  { lgd: "24", name: "Gujarat", iso: "IN-GJ" , box: [20.1,68.2,24.7,74.5] },
  { lgd: "26", name: "Dadra and Nagar Haveli and Daman and Diu", iso: "IN-DH" , box: [20.1,72.8,20.8,73.2] },
  { lgd: "27", name: "Maharashtra", iso: "IN-MH" , box: [15.6,72.6,22.0,80.9] },
  { lgd: "28", name: "Andhra Pradesh", iso: "IN-AP" , box: [12.6,76.8,19.9,84.8] },
  { lgd: "29", name: "Karnataka", iso: "IN-KA" , box: [11.6,74.1,18.4,78.6] },
  { lgd: "31", name: "Lakshadweep", iso: "IN-LD" , box: [8.2,71.9,11.6,73.8] },
  { lgd: "32", name: "Kerala", iso: "IN-KL" , box: [8.2,74.9,12.8,77.4] },
  { lgd: "33", name: "Tamil Nadu", iso: "IN-TN" , box: [8.1,76.3,13.5,80.3] },
  { lgd: "34", name: "Puducherry", iso: "IN-PY" , box: [11.8,79.7,12.1,79.9] },
  { lgd: "35", name: "Andaman and Nicobar Islands", iso: "IN-AN" , box: [6.7,92.2,13.7,94.0] },
  { lgd: "36", name: "Telangana", iso: "IN-TG" , box: [15.8,77.2,19.9,81.3] },
  { lgd: "37", name: "Ladakh", iso: "IN-LA" , box: [32.3,75.3,35.5,79.9] },
];

async function harvestState(s: (typeof FIELD_STATES)[number]) {
  const spots = await denseFieldSpots(s.box);
  const words = s.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  let tried = 0;
  for (const spot of spots) {
    if (spot.count < 15 || tried >= 5) break;
    tried++;
    // The box grid covers neighbouring states and the sea too — confirm the state.
    const admin = await reverseAdmin(spot.lat, spot.lng);
    await delay(1100); // Nominatim usage policy: at most one request per second
    if (!admin.state || !words.some((w) => admin.state!.toLowerCase().includes(w))) continue;
    const village = await nearestVillage(spot.lat, spot.lng);
    if (!village) continue;
    const { fields, centreline } = await fieldsAlongCorridor(
      { ...village, lat: spot.lat, lng: spot.lng },
      { rightOfWayM: 60, maxFields: 45 },
    );
    await delay(2000);
    if (fields.length < 10) continue;
    return {
      lgd: s.lgd,
      state: s.name,
      source: "OpenStreetMap (Overpass API)",
      licence: "© OpenStreetMap contributors, ODbL 1.0",
      village,
      district: admin.district,
      subdistrict: admin.subdistrict,
      fieldsInCell: spot.count,
      rightOfWayM: 60,
      centreline,
      fields,
      harvestedAt: new Date().toISOString(),
    };
  }
  throw new Error(`no part of the state has enough mapped fields (densest 3 km cell: ${spots[0]?.count ?? 0})`);
}

async function main() {
  const only = process.argv.slice(2);
  await mkdir("prisma/data/fields", { recursive: true });
  for (const s of FIELD_STATES) {
    if (only.length ? !only.includes(s.lgd) : existsSync(`prisma/data/fields/${s.lgd}.json`)) continue;
    const t0 = Date.now();
    try {
      const snap = await harvestState(s);
      await writeFile(`prisma/data/fields/${s.lgd}.json`, JSON.stringify(snap, null, 1));
      console.log(`✓ ${s.name.padEnd(22)} ${snap.fields.length} fields · ${snap.village.name}, ${snap.district ?? "?"} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    } catch (e) {
      console.log(`✗ ${s.name.padEnd(22)} ${e instanceof Error ? e.message : e}`);
    }
    await delay(3000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
