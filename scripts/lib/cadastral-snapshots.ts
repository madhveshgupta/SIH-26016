/**
 * Every harvested cadastral corridor, with the portal configuration needed to re-query or
 * re-trace it.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { CorridorPortal, HarvestedPlot } from "@backend/integrations/adapters/cadastral-corridor";
import { CORRIDORS } from "../harvest-corridors";

export interface CadastralSnapshot {
  file: string;
  corridorId: string;
  projectRef: string;
  srid: number;
  gisCode: string;
  portal: CorridorPortal;
  plots: HarvestedPlot[];
}

export function loadCadastralSnapshots(): CadastralSnapshot[] {
  return readdirSync("prisma/data/cadastral")
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const file = `prisma/data/cadastral/${f}`;
      const snap = JSON.parse(readFileSync(file, "utf8"));
      const portal: CorridorPortal | undefined = snap.portal ?? CORRIDORS.find((c) => c.id === snap.corridorId)?.portal;
      if (!portal) throw new Error(`${file} has no portal configuration`);
      return { file, corridorId: snap.corridorId, projectRef: snap.projectRef, srid: snap.srid, gisCode: snap.gisCode, portal, plots: snap.plots };
    });
}
