#!/usr/bin/env node
/**
 * Publish the "Fish I've caught" gallery's photos: a small committed copy for
 * the page, and the full-size original for the lightbox.
 *
 * Usage:
 *   node scripts/upload-fishing-catches.mjs [--dir <folder>] [--force]
 *
 * Originals live in staging/fishing/ (gitignored), named after each catch's
 * `photo` in src/lib/hobbies/fishing-catches.json, in any case, as
 * .jpg/.jpeg/.png/.heic/.heif/.tif/.tiff. For each catch with an original:
 *
 *   - display copy: src/assets/hobbies/fishing/<photo>.jpg, at most 1600 px,
 *     no metadata. Committed; Astro makes the thumbnail and the lightbox's
 *     quick preview from it. Written only when missing, or with --force.
 *   - full size: JPEG and PNG originals byte for byte; HEIC and TIFF, which
 *     browsers can't show, as one full-size JPEG at quality 95 with full colour
 *     resolution (the photography build's settings). Uploaded to the private
 *     `incoming` container as hobby-media/fishing/full/<photo>.<ext>; the next
 *     build removes any GPS position (metadata only) and publishes it.
 *   - fishing-catches.json gets the full-size URL and its true dimensions.
 *
 * Needs `az login` (DefaultAzureCredential), the storage account from
 * AZURE_STORAGE_ACCOUNT or blobHost in site.config.ts, and for HEIC, python3
 * with pillow-heif (scripts/heic-to-jpeg.py).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import sharp from "sharp";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { ROOT, storageAccountFromSite } from "./photos/settings.mjs";

const CATCHES = join(ROOT, "src/lib/hobbies/fishing-catches.json");
const DISPLAY_DIR = join(ROOT, "src/assets/hobbies/fishing");
const DISPLAY_MAX = 1600;
const INBOX = "incoming";
const PUBLIC = "hobby-media";
const PREFIX = "fishing/full";
const AS_IS = new Map([
  [".jpg", { ext: ".jpg", type: "image/jpeg" }],
  [".jpeg", { ext: ".jpg", type: "image/jpeg" }],
  [".png", { ext: ".png", type: "image/png" }],
]);
const CONVERT = new Set([".heic", ".heif", ".tif", ".tiff"]);
const FULL_JPEG = { quality: 95, mozjpeg: true, chromaSubsampling: "4:4:4" };

function parseArgs(argv) {
  const args = { dir: join(ROOT, "staging/fishing"), force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") args.dir = argv[++i];
    else if (argv[i] === "--force") args.force = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

/** Pixels of a HEIC or TIFF, decoded losslessly. */
async function decodeLossless(path, ext, scratch) {
  if (ext === ".tif" || ext === ".tiff") return readFile(path);
  const tiff = join(scratch, "decoded.tiff");
  const result = spawnSync(
    "python3",
    [join(ROOT, "scripts/heic-to-jpeg.py"), path, tiff],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `Couldn't decode ${path}: ${(result.stderr || result.error?.message || "").trim()}`,
    );
  }
  return readFile(tiff);
}

/** One catch per line, the way the file is written by hand. */
function inline(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const fields = Object.entries(value).map(
      ([key, v]) => `${JSON.stringify(key)}: ${inline(v)}`,
    );
    return `{ ${fields.join(", ")} }`;
  }
  return JSON.stringify(value);
}

function formatCatches(data) {
  const head = Object.entries(data)
    .filter(([key]) => key !== "catches")
    .map(
      ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
    );
  const rows = data.catches.map((c) => `    ${inline(c)}`).join(",\n");
  return `{\n${head.join("\n")}\n  "catches": [\n${rows}\n  ]\n}\n`;
}

/** Displayed size, after the EXIF orientation browsers apply. */
async function orientedSize(buffer) {
  const meta = await sharp(buffer).metadata();
  return (meta.orientation ?? 1) >= 5
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}

async function main() {
  const { dir, force } = parseArgs(process.argv.slice(2));
  const account = process.env.AZURE_STORAGE_ACCOUNT || storageAccountFromSite();
  if (!account) {
    throw new Error(
      "Set AZURE_STORAGE_ACCOUNT, or blobHost in site.config.ts, to your storage account.",
    );
  }

  const data = JSON.parse(await readFile(CATCHES, "utf8"));
  const originals = new Map();
  for (const file of await readdir(dir)) {
    const ext = extname(file).toLowerCase();
    if (AS_IS.has(ext) || CONVERT.has(ext)) {
      originals.set(file.slice(0, -ext.length).toLowerCase(), file);
    }
  }

  const service = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    new DefaultAzureCredential(),
  );
  const inbox = service.getContainerClient(INBOX);
  await inbox.createIfNotExists();
  if ((await inbox.getProperties()).blobPublicAccess) {
    throw new Error(
      `The ${INBOX} container allows public access; it must be private. Nothing was uploaded.`,
    );
  }

  const scratch = await mkdtemp(join(tmpdir(), "fishing-"));
  let uploaded = 0;
  try {
    for (const c of data.catches) {
      const file = originals.get(c.photo);
      if (!file) {
        console.warn(`  ${c.photo}: no original in ${dir}; left as it is`);
        continue;
      }
      const path = join(dir, file);
      const ext = extname(file).toLowerCase();
      const original = await readFile(path);

      // Full size: the original itself where browsers can show it.
      let full;
      let target;
      if (AS_IS.has(ext)) {
        full = original;
        target = AS_IS.get(ext);
      } else {
        const pixels = await decodeLossless(path, ext, scratch);
        full = await sharp(pixels).rotate().jpeg(FULL_JPEG).toBuffer();
        target = AS_IS.get(".jpg");
      }
      const { width, height } = await orientedSize(full);

      const display = join(DISPLAY_DIR, `${c.photo}.jpg`);
      if (force || !existsSync(display)) {
        const source = AS_IS.has(ext)
          ? original
          : await decodeLossless(path, ext, scratch);
        await writeFile(
          display,
          await sharp(source)
            .rotate()
            .resize(DISPLAY_MAX, DISPLAY_MAX, {
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: 82, mozjpeg: true })
            .toBuffer(),
        );
        console.log(`  wrote ${display}`);
      }

      const name = `${PREFIX}/${c.photo}${target.ext}`;
      await inbox.getBlockBlobClient(`${PUBLIC}/${name}`).uploadData(full, {
        blobHTTPHeaders: {
          blobContentType: target.type,
          blobCacheControl: "public, max-age=31536000, immutable",
        },
      });
      c.full = {
        src: `https://${account}.blob.core.windows.net/${PUBLIC}/${name}`,
        width,
        height,
      };
      uploaded++;
      console.log(`  ${file} -> ${PUBLIC}/${name} (${width}x${height})`);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  data.$comment =
    "Personal 'fish I've caught' gallery. fishId references fishing-species.ts (the same pixel sprite is drawn on each card). state splits the gallery into Washington and Minnesota. photo is the basename of the committed display copy, src/assets/hobbies/fishing/<photo>.jpg, which Astro turns into the thumbnail and the lightbox's quick preview. full is the full-size original in Blob Storage that the lightbox ends on, written by scripts/upload-fishing-catches.mjs.";
  await writeFile(CATCHES, formatCatches(data));
  console.log(
    `\nUploaded ${uploaded} full-size photo(s) to the private ${INBOX} container and updated ${CATCHES}.`,
  );
  console.log(
    "Commit and push: the build removes any GPS position, publishes them, and the lightbox opens them from then.",
  );
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
