/**
 * Re-trace every plot in the corridor snapshots from the cached plot renderings — no portal
 * traffic unless an image is missing from the cache.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fetchPlotBoundary } from "@backend/integrations/adapters/plot-boundary";
import type { HarvestedPlot } from "@backend/integrations/adapters/cadastral-corridor";
import { loadCadastralSnapshots } from "./lib/cadastral-snapshots";

async function main() {
  const insetOverride = process.env.INSET_PX != null ? Number(process.env.INSET_PX) : null;
  const only = process.argv.slice(2);
  for (const c of loadCadastralSnapshots().map((x) => ({ id: x.corridorId, portal: x.portal, file: x.file })).filter((x) => !only.length || only.includes(x.id))) {
    const file = c.file;
    const snap = JSON.parse(readFileSync(file, "utf8")) as { plots: HarvestedPlot[]; portal?: { insetPx?: number } };
    const portal = insetOverride == null ? c.portal : { ...c.portal, insetPx: insetOverride };
    let failed = 0;
    for (const p of snap.plots) {
      const b = await fetchPlotBoundary(portal, p.plotId, p.reportedExtent);
      if (!b) { failed++; continue; }
      p.ringUtm = b.ringUtm.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))]);
      p.tracedAreaSqm = Math.round(b.tracedAreaSqm);
      p.vertices = b.vertices;
      p.metresPerPixel = b.metresPerPixel;
      p.extentErrorM = Number(b.extentErrorM.toFixed(3));
    }
    if (insetOverride != null && snap.portal) snap.portal.insetPx = insetOverride;
    writeFileSync(file, JSON.stringify(snap, null, 1));
    console.log(`${c.id}: ${snap.plots.length - failed} re-traced, ${failed} failed (inset ${portal.insetPx ?? 0} px)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
