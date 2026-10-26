#!/usr/bin/env node
/**
 * Builds the terrain under the Day list map: a tile pyramid cut from Natural
 * Earth's "Gray Earth with Shaded Relief, Hypsography, and Flat Water" (1:10m,
 * 21600 x 10800, public domain).
 *
 *   npm run build:day-list-relief    (downloads ~46 MB to .cache once)
 *
 * The raster is plate carrée, the same projection the map draws in, so tiles
 * line up with the pins and boundaries without any reprojection.
 *
 * Tiles are one grey channel that carries two things. Water is 0. Land is
 * 48-255, the relief and height shading from the source. The browser maps that
 * channel through the page's own palette (--paper, --ink, --stack-1), so one set
 * of tiles serves light and dark mode and follows the theme toggle. Tiles that
 * would be all water aren't written; the map paints open water itself.
 *
 * Output (both committed):
 *   public/day-list/relief/v1/<level>/<x>-<y>.webp   about 2,900 tiles, 7.6 MB
 *   src/lib/hobbies/day-list-relief.json             which tiles exist
 *
 * Bump VERSION when the tiles change, so browsers holding the old ones (they're
 * served as immutable) fetch the new set.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "https://naciscdn.org/naturalearth/10m/raster/GRAY_HR_SR_W.zip";
const CACHE = join(root, ".cache/natural-earth/GRAY_HR_SR_W.zip");
const VERSION = "v1";
const OUT_DIR = join(root, "public/day-list/relief", VERSION);
const MANIFEST = join(root, "src/lib/hobbies/day-list-relief.json");

const TILE = 256;
/** Level 5 is the source's own resolution; each level below halves it. */
const LEVELS = 6;
/** Open water in the source is exactly this grey. */
const SOURCE_WATER = 106;
const QUALITY = 70;

async function download() {
  try {
    return readFileSync(CACHE);
  } catch {
    // Not cached yet.
  }
  console.log(`Downloading ${SOURCE}`);
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, buf);
  return buf;
}

/** Pull one file out of a zip via its central directory. Deflate or stored. */
function unzip(zip, suffix) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Not a zip file");
  const entries = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  for (let i = 0; i < entries; i++) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (name.endsWith(suffix)) {
      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const body = zip.subarray(start, start + size);
      return method === 0 ? Buffer.from(body) : inflateRawSync(body);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${suffix} not found in zip`);
}

/**
 * Water is 0 and land is 48-255. A pixel at the water grey only counts as
 * water when at least three neighbours are too, because a few thousand
 * shaded slopes on land happen to be the same grey.
 */
function encode(grey, width, height) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = grey[i];
      if (v === SOURCE_WATER) {
        let water = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = (x + dx + width) % width;
            if (grey[yy * width + xx] === SOURCE_WATER) water++;
          }
        }
        if (water >= 3) continue;
      }
      out[i] = Math.max(
        48,
        Math.min(255, 48 + Math.round(((v - 42) * 207) / 209)),
      );
    }
  }
  return out;
}

const zip = await download();
const tif = unzip(zip, "GRAY_HR_SR_W.tif");
const { data, info } = await sharp(tif, { limitInputPixels: false })
  .extractChannel(0)
  .raw()
  .toBuffer({ resolveWithObject: true });
const encoded = encode(data, info.width, info.height);

rmSync(OUT_DIR, { recursive: true, force: true });
const levels = [];
let files = 0;
let bytes = 0;

for (let level = 0; level < LEVELS; level++) {
  const scale = 2 ** (LEVELS - 1 - level);
  const w = Math.round(info.width / scale);
  const h = Math.round(info.height / scale);
  const pixels = await sharp(Buffer.from(encoded), {
    raw: { width: info.width, height: info.height, channels: 1 },
    limitInputPixels: false,
  })
    .resize(w, h, { kernel: "lanczos3" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  const cols = Math.ceil(w / TILE);
  const rows = Math.ceil(h / TILE);
  let land = "";
  mkdirSync(join(OUT_DIR, String(level)), { recursive: true });
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      const tw = Math.min(TILE, w - x0);
      const th = Math.min(TILE, h - y0);
      const tile = Buffer.alloc(tw * th);
      let max = 0;
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const v = pixels[(y0 + y) * w + x0 + x];
          tile[y * tw + x] = v;
          if (v > max) max = v;
        }
      }
      // Below 8 is resampling ripple in open water, not land.
      if (max <= 8) {
        land += "0";
        continue;
      }
      land += "1";
      const file = join(OUT_DIR, String(level), `${tx}-${ty}.webp`);
      const out = await sharp(tile, {
        raw: { width: tw, height: th, channels: 1 },
      })
        .webp({ quality: QUALITY, effort: 6 })
        .toBuffer();
      writeFileSync(file, out);
      files++;
      bytes += out.length;
    }
  }
  levels.push({ w, h, cols, rows, land });
  console.log(
    `Level ${level}: ${w} x ${h}, ${land.split("1").length - 1} of ${cols * rows} tiles`,
  );
}

writeFileSync(
  MANIFEST,
  `${JSON.stringify(
    {
      source:
        "Natural Earth, Gray Earth with Shaded Relief, Hypsography, and Flat Water, 1:10m",
      path: `/day-list/relief/${VERSION}`,
      tile: TILE,
      levels,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Wrote ${files} tiles (${(bytes / 1048576).toFixed(2)} MB) and ${MANIFEST}`,
);
