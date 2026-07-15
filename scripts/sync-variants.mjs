#!/usr/bin/env node
/**
 * sync-variants.mjs
 *
 * After `astro build`, this script:
 *   1. Finds responsive image variants in dist/_astro/ (*.avif/*.webp/*.jpeg/*.jpg)
 *   2. Rewrites every reference to them in dist HTML (and CSS) from
 *        /_astro/<file>.<ext>
 *      to
 *        https://<storage>.blob.core.windows.net/variants/<file>.<ext>
 *   3. Uploads the variants to the `variants/` blob container
 *      (skipping any blob that already exists with a matching size, since
 *      Astro uses content-hashed filenames so identical bytes = same name).
 *   4. Deletes the variant files from dist/_astro/ to shrink the SWA payload.
 *
 * Result: SWA deploy artifact stays ~5 MB (HTML + CSS + JS + favicon) no
 * matter how many photos are on the site. SWA Free tier 250 MB cap is no
 * longer a concern.
 *
 * Auth: uses DefaultAzureCredential (az login locally, OIDC in GitHub Actions).
 * Env: AZURE_STORAGE_ACCOUNT must be set.
 */
import { readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const ASTRO_DIR = join(DIST, '_astro');

const STORAGE = process.env.AZURE_STORAGE_ACCOUNT;
if (!STORAGE) {
  console.error('AZURE_STORAGE_ACCOUNT env var is required.');
  process.exit(2);
}

const BLOB_HOST = `${STORAGE}.blob.core.windows.net`;
const CONTAINER = 'variants';
const BLOB_PREFIX = `https://${BLOB_HOST}/${CONTAINER}/`;
const IMAGE_EXTS = new Set(['.avif', '.webp', '.jpeg', '.jpg']);
const CONTENT_TYPE = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
};
const UPLOAD_CONCURRENCY = 12;

async function main() {
  // 1. List candidate files to migrate.
  const allFiles = await readdir(ASTRO_DIR);
  const imageFiles = allFiles.filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()));
  console.log(`Found ${imageFiles.length} image variants in ${ASTRO_DIR}`);
  if (imageFiles.length === 0) {
    console.log('Nothing to sync. Done.');
    return;
  }

  // 2. Rewrite all HTML/CSS references in dist/ from /_astro/<image> to blob URL.
  let rewrittenFiles = 0;
  await walkAndRewrite(DIST, imageFiles, () => rewrittenFiles++);
  console.log(`Rewrote URLs in ${rewrittenFiles} HTML/CSS file(s)`);

  // 3. Upload images to blob with year-long immutable cache headers.
  const { BlobServiceClient } = await import('@azure/storage-blob');
  const { DefaultAzureCredential } = await import('@azure/identity');
  const credential = new DefaultAzureCredential();
  const service = new BlobServiceClient(`https://${BLOB_HOST}`, credential);
  const container = service.getContainerClient(CONTAINER);
  // Container should already exist (created by Bicep), but be safe:
  await container.createIfNotExists();

  // Concurrency-limited upload.
  let uploaded = 0;
  let reused = 0;
  let failed = 0;
  await runWithConcurrency(imageFiles, UPLOAD_CONCURRENCY, async (filename) => {
    const localPath = join(ASTRO_DIR, filename);
    const ext = extname(filename).toLowerCase();
    const blob = container.getBlockBlobClient(filename);

    // Skip if already present with matching size — Astro uses content-hashed
    // names, so same size + same name == same content.
    try {
      const props = await blob.getProperties();
      const local = await stat(localPath);
      if (props.contentLength === local.size) {
        reused++;
        return;
      }
    } catch (e) {
      if (e.statusCode !== 404) {
        console.warn(`  probe failed for ${filename}: ${e.message}`);
      }
    }

    try {
      await blob.uploadFile(localPath, {
        blobHTTPHeaders: {
          blobContentType: CONTENT_TYPE[ext],
          blobCacheControl: 'public, max-age=31536000, immutable',
        },
      });
      uploaded++;
    } catch (e) {
      console.error(`  [FAILED] ${filename}: ${e.message}`);
      failed++;
    }
  });

  console.log(`Upload summary: ${uploaded} new, ${reused} reused, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }

  // 4. Delete from dist/_astro/ now that blob has them.
  let deleted = 0;
  for (const f of imageFiles) {
    await rm(join(ASTRO_DIR, f));
    deleted++;
  }
  console.log(`Deleted ${deleted} variant files from dist/_astro/`);

  // 5. Report final dist size.
  const newSize = await directorySize(DIST);
  console.log(`Final dist/ size: ${formatBytes(newSize)}`);
}

async function walkAndRewrite(dir, imageFiles, onRewrite) {
  // Build a Set for fast membership test.
  const set = new Set(imageFiles);
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      await walkAndRewrite(p, imageFiles, onRewrite);
      continue;
    }
    if (!/\.(html|css)$/i.test(e.name)) continue;

    let text = await readFile(p, 'utf8');
    const original = text;

    text = text.replace(
      /\/_astro\/([^\s"'(),?]+)/g,
      (match, filename) => {
        if (set.has(filename)) return `${BLOB_PREFIX}${filename}`;
        return match;
      },
    );

    if (text !== original) {
      await writeFile(p, text);
      onRewrite();
    }
  }
}

async function runWithConcurrency(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

async function directorySize(dir) {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await directorySize(p);
    else {
      const s = await stat(p);
      total += s.size;
    }
  }
  return total;
}

function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(2)} ${units[i]}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
