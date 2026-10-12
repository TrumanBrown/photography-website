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
 *   - full/<name>      full-resolution, opened in the lightbox: the original
 *                      bytes for web formats; HEIC/TIFF, which browsers can't
 *                      show, become one high-quality JPEG at full size. These
 *                      go to the private `incoming` container first: phones
 *                      record where each photo was taken, hobby photos are
 *                      often shot at home, and the next build removes that
 *                      (metadata only, the image itself is untouched) before
 *                      publishing them to hobby-media/ (scripts/prebuild.mjs).
 *   - display/<name>.jpg  a smaller, orientation-baked JPEG shown inline, with
 *                      no metadata, uploaded straight to hobby-media/
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
// Private; the build publishes incoming/hobby-media/... to hobby-media/.
const INBOX = 'incoming';
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
  const service = new BlobServiceClient(origin, new DefaultAzureCredential());
  const container = service.getContainerClient(CONTAINER);
  const inbox = service.getContainerClient(INBOX);
  await inbox.createIfNotExists();
  if ((await inbox.getProperties()).blobPublicAccess) {
    throw new Error(`The ${INBOX} container allows public access; it must be private. Nothing was uploaded.`);
  }

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
      fullBuffer = input; // the original bytes, exactly
      fullExt = ext;
      fullType = CONTENT_TYPE[ext];
    } else {
      // HEIC/TIFF are not browser-displayable: one JPEG encode at full size,
      // the same settings the photography build uses for its HEIC copies.
      fullBuffer = await sharp(input)
        .rotate()
        .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
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
    await uploadBlob(inbox, `${CONTAINER}/${fullName}`, fullBuffer, fullType);
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
  console.log(
    `Full-size photos wait privately in ${INBOX}/ until that build removes any GPS position and publishes them, so the lightbox links work from then.`,
  );
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
