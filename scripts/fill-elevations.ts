/**
 * Elevation for every boundary point, from Open-Meteo's elevation API (Copernicus DEM GLO-90,
 * ~90 m grid).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { portalFetch } from "@backend/integrations/http";

const prisma = new PrismaClient();
const CACHE = "prisma/data/elevation-cache.json";
const key = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

async function main() {
  const cache: Record<string, number> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  const missing = await prisma.parcelVertex.findMany({ where: { elevationM: null }, select: { id: true, lat: true, lng: true } });
  console.log(`${missing.length} boundary points without elevation`);

  const need = missing.filter((v) => cache[key(Number(v.lat), Number(v.lng))] == null);
  const unique = [...new Map(need.map((v) => [key(Number(v.lat), Number(v.lng)), v])).values()];
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const qs = new URLSearchParams({
      latitude: batch.map((v) => Number(v.lat).toFixed(5)).join(","),
      longitude: batch.map((v) => Number(v.lng).toFixed(5)).join(","),
    });
    const res = await portalFetch(`https://api.open-meteo.com/v1/elevation?${qs}`, { timeoutMs: 30_000 });
    if (!res.ok) {
      console.log(`  batch ${i / 100 + 1}: HTTP ${res.status}, retrying later`);
      await delay(10_000);
      continue;
    }
    const { elevation } = await res.json<{ elevation: number[] }>();
    batch.forEach((v, k) => {
      if (Number.isFinite(elevation[k])) cache[key(Number(v.lat), Number(v.lng))] = elevation[k];
    });
    process.stdout.write(`\r  fetched ${Math.min(i + 100, unique.length)}/${unique.length}`);
    await delay(700); // be gentle with a free public API
  }
  writeFileSync(CACHE, JSON.stringify(cache));

  let written = 0;
  for (const v of missing) {
    const e = cache[key(Number(v.lat), Number(v.lng))];
    if (e == null) continue;
    await prisma.parcelVertex.update({ where: { id: v.id }, data: { elevationM: new Prisma.Decimal(e), elevationSource: "Open-Meteo (Copernicus DEM GLO-90)" } });
    written++;
  }
  console.log(`\n${written} boundary points now carry elevation · cache has ${Object.keys(cache).length} points`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
