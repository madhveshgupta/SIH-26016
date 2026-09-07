/**
 * Cesium ships its Workers, Assets, Widgets and ThirdParty files as separate runtime downloads
 * rather than bundling them, so they have to be served from a known path.
 */
import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const SRC = path.join(path.dirname(require.resolve("cesium/package.json")), "Build", "Cesium");
const DEST = path.resolve("frontend/public/cesium");
const DIRS = ["Workers", "Assets", "Widgets", "ThirdParty"];
const STAMP = path.join(DEST, ".version");

const version = JSON.parse(await readFile(path.join(SRC, "..", "..", "package.json"), "utf8")).version;
const current = await readFile(STAMP, "utf8").catch(() => null);
if (current === version && (await stat(path.join(DEST, "Workers")).catch(() => null))) {
  console.log(`cesium assets already at ${version}`);
  process.exit(0);
}

await mkdir(DEST, { recursive: true });
for (const dir of DIRS) {
  await cp(path.join(SRC, dir), path.join(DEST, dir), { recursive: true });
}
await writeFile(STAMP, version);
console.log(`cesium ${version} assets → frontend/public/cesium`);
