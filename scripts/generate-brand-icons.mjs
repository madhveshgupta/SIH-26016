/**
 * Draws the Bhoomi Nayan emblem (frontend/components/Emblem.tsx) as the browser tab icon and the
 * field app's install icons.
 */
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const BRAND = "#1b4d36";
const ACCENT = "#b3592b";
const PAPER = "#f6f5ef";

/** The emblem on a paper tile. `inset` is the share of the tile it fills. */
function tile({ inset, radius }) {
  const s = inset / 48;
  const o = (1 - inset) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="512" height="512">
  <rect width="1" height="1" rx="${radius}" fill="${PAPER}"/>
  <g transform="translate(${o} ${o - 2 * s}) scale(${s})">
    <circle cx="24" cy="21" r="11" fill="${ACCENT}" fill-opacity="0.15"/>
    <path d="M24 26c0-6.2-4.3-10.8-10.2-11.6C13.2 20.4 17 26 24 26Z" fill="${BRAND}"/>
    <path d="M24 26c0-6.2 4.3-10.8 10.2-11.6C34.8 20.4 31 26 24 26Z" fill="${BRAND}" fill-opacity="0.7"/>
    <path d="M24 26v-9" stroke="${BRAND}" stroke-width="2" stroke-linecap="round" fill="none"/>
    <path d="M6 34c6-3 12-3 18 0s12 3 18 0" stroke="${ACCENT}" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <path d="M9 40c5-2.5 10-2.5 15 0s10 2.5 15 0" stroke="${BRAND}" stroke-opacity="0.45" stroke-width="2.2" stroke-linecap="round" fill="none"/>
  </g>
</svg>`;
}

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

/** An .ico holding PNG images — every browser since IE Vista reads these. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

// Tab icon: the emblem nearly fills a rounded tile, so it reads at 16 px.
const favicon = tile({ inset: 1, radius: 0.22 });
writeFileSync("frontend/app/icon.svg", favicon);
writeFileSync(
  "frontend/app/favicon.ico",
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(favicon, size) })))),
);

// Home-screen icons: full-bleed square, emblem kept inside the maskable safe zone.
const install = tile({ inset: 0.78, radius: 0 });
writeFileSync("frontend/app/apple-icon.png", await png(install, 180));
writeFileSync("frontend/public/icons/field-192.png", await png(install, 192));
writeFileSync("frontend/public/icons/field-512.png", await png(install, 512));

console.log("brand icons written");
