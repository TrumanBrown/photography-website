#!/usr/bin/env node
/**
 * Upload a hobby's photos to the `hobby-media` blob container and write the
 * gallery into that hobby's content JSON.
 *
 * Usage:
 *   AZURE_STORAGE_ACCOUNT=<account> \
 *   node scripts/upload-hobby-media.mjs <hobby-slug> [options]
 *
 * Options:
 *   --dir <path>    Source folder (default: staging/hobby-<slug>/)
 *   --hero <file>   Filename to feature at the top (default: first, alphabetical)
 *   --width <px>    Max width of the inline "display" images (default: 1600)
 *
 * For each image it uploads two blobs:
 *   - full/<name>      full-resolution (original bytes for web formats; a
 *                      high-quality JPEG for HEIC/TIFF) — opened in the lightbox
 *   - display/<name>.jpg  a smaller, orientation-baked JPEG shown inline
 * then rewrites the hobby JSON's `media` field (hero + gallery).
 *
 * Photos live in `hobby-media`, NEVER `originals/`, so the photography prebuild
 * never turns them into a photography session. Auth uses DefaultAzureCredential
 * (your `az login` locally, OIDC in CI).
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const CONTAINER = 'hobby-media';
const WEB_FULL = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const CONVERT = new Set(['.tif', '.tiff', '.heic', '.heif']);
const CONTENT_TYPE = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function parseArgs(argv) {
  const args = { slug: undefined, dir: undefined, hero: undefined, width: 1600 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--hero') args.hero = argv[++i];
    else if (a === '--width') args.width = Number(argv[++i]) || 1600;
    else rest.push(a);
  }
  args.slug = rest[0];
  return args;
}

async function uploadBlob(container, name, buffer, contentType) {
  const block = container.getBlockBlobClient(name);
  await block.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType,
      blobCacheControl: 'public, max-age=31536000, immutable',
    },
  });
}

async function main() {
  const { slug, dir, hero, width } = parseArgs(process.argv.slice(2));
  if (!slug) {
    console.error(
      'Usage: node scripts/upload-hobby-media.mjs <hobby-slug> [--dir <path>] [--hero <file>] [--width <px>]',
    );
    process.exit(1);
  }
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) {
    console.error('AZURE_STORAGE_ACCOUNT env var is required (the storage account name).');
    process.exit(1);
  }

  const srcDir = dir ?? join('staging', `hobby-${slug}`);
  const jsonPath = join('src', 'content', 'hobbies', `${slug}.json`);

  let files;
  try {
    files = (await readdir(srcDir))
      .filter((f) => {
        const e = extname(f).toLowerCase();
        return WEB_FULL.has(e) || CONVERT.has(e);
      })
      .sort((a, b) => a.localeCompare(b));
  } catch {
    console.error(`Source folder not found: ${srcDir}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`No images found in ${srcDir} (jpg/jpeg/png/webp/tif/tiff/heic/heif).`);
    process.exit(1);
  }

  const origin = `https://${account}.blob.core.windows.net`;
  const blobBase = `${origin}/${CONTAINER}`;
  const container = new BlobServiceClient(origin, new DefaultAzureCredential()).getContainerClient(CONTAINER);

  console.log(`Uploading ${files.length} photo(s) from ${srcDir} to ${CONTAINER}/${slug}/ ...`);
  const items = [];
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    const stem = basename(file, extname(file));
    const input = await readFile(join(srcDir, file));

    // Full-resolution blob.
    let fullBuffer;
    let fullExt;
    let fullType;
    if (WEB_FULL.has(ext)) {
      fullBuffer = input; // keep the original bytes for web-friendly formats
      fullExt = ext;
      fullType = CONTENT_TYPE[ext];
    } else {
      // HEIC/TIFF are not browser-displayable; bake to a high-quality JPEG.
      fullBuffer = await sharp(input).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      fullExt = '.jpg';
      fullType = 'image/jpeg';
    }

    // Oriented dimensions of the full image (PhotoSwipe needs the true size).
    const meta = await sharp(fullBuffer).metadata();
    let w = meta.width ?? 0;
    let h = meta.height ?? 0;
    if ((meta.orientation ?? 1) >= 5) [w, h] = [h, w];

    // Inline display blob: resized, orientation baked in, EXIF stripped.
    const displayBuffer = await sharp(input)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    const fullName = `${slug}/full/${stem}${fullExt}`;
    const displayName = `${slug}/display/${stem}.jpg`;
    await uploadBlob(container, fullName, fullBuffer, fullType);
    await uploadBlob(container, displayName, displayBuffer, 'image/jpeg');

    items.push({
      file,
      src: `${blobBase}/${fullName}`,
      display: `${blobBase}/${displayName}`,
      width: w,
      height: h,
    });
    console.log(`  ${file} -> ${w}x${h}`);
  }

  // Pick the hero (named, or the first), the rest become the gallery.
  const heroIndex = hero ? items.findIndex((it) => it.file === hero) : 0;
  const idx = heroIndex >= 0 ? heroIndex : 0;
  if (hero && heroIndex < 0) console.warn(`--hero "${hero}" not found; using the first photo.`);
  const toEntry = (it) => ({ src: it.src, display: it.display, width: it.width, height: it.height, caption: '' });
  const heroItem = toEntry(items[idx]);
  const gallery = items.filter((_, i) => i !== idx).map(toEntry);

  const json = JSON.parse(await readFile(jsonPath, 'utf8'));
  json.media = { hero: heroItem, gallery };
  await writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`);

  console.log(`\nWrote ${items.length} photo(s) into ${jsonPath} (hero: ${items[idx].file}).`);
  console.log('Add captions in the JSON if you like, then commit + push to deploy.');
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
