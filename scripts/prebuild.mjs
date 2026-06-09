#!/usr/bin/env node
/**
 * prebuild.mjs — populate src/content/sessions/ from Azure Blob Storage.
 *
 * Modes:
 *   (default)        Connect to Azure Blob and sync. Requires env vars:
 *                      AZURE_STORAGE_ACCOUNT   - storage account name
 *                      (auth via DefaultAzureCredential: works with `az login`
 *                       locally and with OIDC federation in GitHub Actions)
 *   --local-only     Skip Azure entirely. If no sessions exist locally, run
 *                    scripts/generate-fixtures.mjs to seed dev content.
 *
 * What it does in remote mode:
 *   1. Read metadata/manifest.json (last-seen blob etags).
 *   2. List session prefixes under originals/.
 *   3. For each prefix:
 *        - Read _session.json if present, else synthesize from defaults.
 *        - For each image blob:
 *            * Unchanged etag → reuse cached local copy.
 *            * RAW + matching derivative exists → reuse the derivative.
 *            * RAW without derivative → dcraw_emu → sharp → upload to
 *              derivatives/<session>/<name>.jpg with source-etag metadata.
 *            * Other → download into src/content/sessions/<slug>/images/.
 *        - Write src/content/sessions/<slug>.json.
 *   4. Save updated manifest back to metadata/manifest.json.
 *
 * Exit code 0 even when no sessions exist — the site renders an empty state.
 */
import { mkdir, writeFile, readFile, rm, access, copyFile as fsCopyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SESSIONS_DIR = join(ROOT, 'src', 'content', 'sessions');
const CACHE_DIR = join(ROOT, '.cache', 'prebuild');

const RAW_EXTS = new Set(['.arw', '.nef', '.cr2', '.cr3', '.dng', '.raf']);
// Formats Astro's sharp service can read but browsers can't display, or that
// have inconsistent web support. Convert to JPEG sidecar during prebuild.
const CONVERT_EXTS = new Set(['.heic', '.heif', '.tif', '.tiff']);
// Formats sharp + browsers handle natively. Passed through unchanged.
const WEB_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const STANDARD_IMG_EXTS = new Set([...WEB_EXTS, ...CONVERT_EXTS]);
const SESSION_JSON = '_session.json';

const ORIGINALS = 'originals';
const DERIVATIVES = 'derivatives';
const METADATA = 'metadata';
const MANIFEST_BLOB = 'manifest.json';

const argv = new Set(process.argv.slice(2));
const LOCAL_ONLY = argv.has('--local-only');

async function main() {
  await mkdir(SESSIONS_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  if (LOCAL_ONLY) {
    await runLocalOnly();
    return;
  }

  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) {
    console.error('AZURE_STORAGE_ACCOUNT env var is required (or pass --local-only).');
    process.exit(2);
  }

  // Lazy-load Azure SDKs only when actually needed.
  const { BlobServiceClient } = await import('@azure/storage-blob');
  const { DefaultAzureCredential } = await import('@azure/identity');

  const credential = new DefaultAzureCredential();
  const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
  const originalsClient = service.getContainerClient(ORIGINALS);
  const derivativesClient = service.getContainerClient(DERIVATIVES);
  const metadataClient = service.getContainerClient(METADATA);

  // Auto-create metadata container if missing (others must exist via IaC).
  await metadataClient.createIfNotExists();

  const manifest = await loadManifest(metadataClient);
  const nextManifest = { blobs: {}, generatedAt: new Date().toISOString(), account };

  // Clear sessions dir so removed sessions disappear. Keep .gitkeep.
  await clearSessionsDir();

  const sessionPrefixes = await listSessionPrefixes(originalsClient);
  console.log(`Found ${sessionPrefixes.length} session(s) in originals/`);

  for (const prefix of sessionPrefixes) {
    await processSession({
      prefix,
      originalsClient,
      derivativesClient,
      service,
      manifest,
      nextManifest,
    });
  }

  await saveManifest(metadataClient, nextManifest);
  console.log('Prebuild complete.');
}

async function runLocalOnly() {
  // If the sessions dir is empty (no JSON files), seed fixtures.
  const entries = (await readdirSafe(SESSIONS_DIR)).filter((n) => n.endsWith('.json'));
  if (entries.length > 0) {
    console.log(`Local-only mode: ${entries.length} session(s) already present. No-op.`);
    return;
  }
  console.log('Local-only mode: no sessions found; generating fixtures…');
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(__dirname, 'generate-fixtures.mjs')], { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`fixtures exit ${code}`))));
  });
}

async function readdirSafe(dir) {
  try {
    const { readdir } = await import('node:fs/promises');
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function clearSessionsDir() {
  const names = await readdirSafe(SESSIONS_DIR);
  for (const n of names) {
    if (n === '.gitkeep') continue;
    await rm(join(SESSIONS_DIR, n), { recursive: true, force: true });
  }
}

async function loadManifest(metadataClient) {
  try {
    const blob = metadataClient.getBlobClient(MANIFEST_BLOB);
    const buf = await blob.downloadToBuffer();
    const parsed = JSON.parse(buf.toString('utf8'));
    return parsed.blobs ?? {};
  } catch (e) {
    if (e.statusCode === 404) return {};
    console.warn('Could not load manifest, starting fresh:', e.message);
    return {};
  }
}

async function saveManifest(metadataClient, manifest) {
  const block = metadataClient.getBlockBlobClient(MANIFEST_BLOB);
  const body = JSON.stringify(manifest, null, 2);
  await block.upload(body, Buffer.byteLength(body, 'utf8'), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
}

async function listSessionPrefixes(originalsClient) {
  const prefixes = [];
  for await (const item of originalsClient.listBlobsByHierarchy('/')) {
    if (item.kind === 'prefix') {
      // Strip trailing slash.
      prefixes.push(item.name.replace(/\/$/, ''));
    }
  }
  return prefixes.sort();
}

async function processSession({ prefix, originalsClient, derivativesClient, service, manifest, nextManifest }) {
  const slug = sanitizeSlug(prefix);
  const sessionDir = join(SESSIONS_DIR, slug);
  const imagesDir = join(sessionDir, 'images');
  await mkdir(imagesDir, { recursive: true });

  // Load _session.json if present.
  let sidecar = {};
  const sidecarPath = `${prefix}/${SESSION_JSON}`;
  try {
    const sb = originalsClient.getBlobClient(sidecarPath);
    const buf = await sb.downloadToBuffer();
    sidecar = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    if (e.statusCode !== 404) console.warn(`Could not read ${sidecarPath}:`, e.message);
  }

  // Enumerate image blobs under this prefix.
  const blobs = [];
  for await (const blob of originalsClient.listBlobsFlat({ prefix: `${prefix}/` })) {
    const name = blob.name;
    if (name === sidecarPath) continue;
    const ext = extname(name).toLowerCase();
    if (!RAW_EXTS.has(ext) && !STANDARD_IMG_EXTS.has(ext)) continue;
    blobs.push({
      name,
      base: basename(name),
      ext,
      etag: blob.properties.etag,
      contentLength: blob.properties.contentLength,
    });
  }

  if (blobs.length === 0) {
    console.warn(`Session "${prefix}" has no images; skipping.`);
    return;
  }

  const images = [];
  let earliestExifDate;

  for (const b of blobs) {
    const isRaw = RAW_EXTS.has(b.ext);
    const needsConvert = CONVERT_EXTS.has(b.ext);
    const willConvert = isRaw || needsConvert;
    const targetFile = willConvert ? `${stripExt(b.base)}.jpg` : b.base;
    const localPath = join(imagesDir, targetFile);
    // Cache key includes targetFile so a format change (e.g. HEIC→jpg
    // conversion logic added) invalidates old cached bytes.
    const cacheKey = `${b.name}@${b.etag}@${targetFile}`;
    const manifestEntry = manifest[b.name];

    let useCached = false;
    if (manifestEntry?.etag === b.etag && manifestEntry?.target === targetFile) {
      const cached = join(CACHE_DIR, hashKey(cacheKey));
      if (existsSync(cached)) {
        await copyFile(cached, localPath);
        useCached = true;
      }
    }

    if (!useCached) {
      if (isRaw) {
        await processRawBlob({
          blob: b,
          originalsClient,
          derivativesClient,
          slug,
          targetFile,
          localPath,
          cacheKey,
        });
      } else if (needsConvert) {
        await processConvertBlob({
          blob: b,
          originalsClient,
          derivativesClient,
          slug,
          targetFile,
          localPath,
          cacheKey,
        });
      } else {
        await processStandardBlob({
          blob: b,
          originalsClient,
          localPath,
          cacheKey,
        });
      }
    }

    // Read intrinsic dimensions + EXIF date.
    const { default: sharp } = await import('sharp');
    const meta = await sharp(localPath).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    let captureDate;
    try {
      const { default: exifr } = await import('exifr');
      const exif = await exifr.parse(localPath, { tiff: true, ifd0: true, exif: true });
      captureDate = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
    } catch {
      // ignore — synthetic JPEGs and stripped images may have no EXIF
    }
    if (captureDate) {
      const iso = new Date(captureDate).toISOString();
      if (!earliestExifDate || iso < earliestExifDate) earliestExifDate = iso;
    }

    images.push({
      file: targetFile,
      width,
      height,
      fullUrl: willConvert
        ? blobPublicUrl(derivativesClient, `${slug}/${targetFile}`)
        : blobPublicUrl(originalsClient, b.name),
    });

    nextManifest.blobs[b.name] = { etag: b.etag, target: targetFile, derivative: willConvert ? `${slug}/${targetFile}` : undefined };
  }

  // Sort images by filename for stable ordering (override via sidecar.images if provided).
  const orderedImages = Array.isArray(sidecar.images)
    ? reorderByList(images, sidecar.images)
    : images.sort((a, b) => a.file.localeCompare(b.file));

  const sessionRecord = {
    title: sidecar.title ?? humanize(slug),
    date: sidecar.date ?? earliestExifDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    location: sidecar.location ?? '',
    description: sidecar.description ?? '',
    ...(sidecar.cover ? { cover: sidecar.cover } : {}),
    ...(sidecar.order != null ? { order: sidecar.order } : {}),
    images: orderedImages,
  };

  const jsonPath = join(SESSIONS_DIR, `${slug}.json`);
  await writeFile(jsonPath, JSON.stringify(sessionRecord, null, 2) + '\n');
  console.log(`session: ${slug} (${orderedImages.length} images)`);

  // Generate tiny admin thumbnails and upload to variants/thumbs/<slug>/.
  // The variants container is publicly readable so the admin page can fetch them.
  if (service) {
    const variantsClient = service.getContainerClient('variants');
    await generateAdminThumbs({ slug, imagesDir, images: orderedImages, containerClient: variantsClient });
  }
}

async function processStandardBlob({ blob, originalsClient, localPath, cacheKey }) {
  const client = originalsClient.getBlobClient(blob.name);
  const tmp = join(CACHE_DIR, hashKey(cacheKey));
  await client.downloadToFile(tmp);
  await copyFile(tmp, localPath);
  console.log(`  download: ${blob.name}`);
}

async function processRawBlob({ blob, originalsClient, derivativesClient, slug, targetFile, localPath, cacheKey }) {
  const derivBlobName = `${slug}/${targetFile}`;
  const derivClient = derivativesClient.getBlobClient(derivBlobName);

  // Check if a derivative with matching source-etag already exists.
  try {
    const props = await derivClient.getProperties();
    if (props.metadata && props.metadata.sourceetag === stripQuotes(blob.etag)) {
      const tmp = join(CACHE_DIR, hashKey(cacheKey));
      await derivClient.downloadToFile(tmp);
      await copyFile(tmp, localPath);
      console.log(`  reuse:    ${derivBlobName} (matching source-etag)`);
      return;
    }
  } catch (e) {
    if (e.statusCode !== 404) console.warn(`derivative probe failed: ${e.message}`);
  }

  // Download the RAW, convert with dcraw_emu, encode JPEG with sharp.
  const rawClient = originalsClient.getBlobClient(blob.name);
  const tmpRaw = join(tmpdir(), `raw-${Date.now()}-${basename(blob.name)}`);
  await rawClient.downloadToFile(tmpRaw);
  console.log(`  raw:      ${blob.name}`);

  const tmpTiff = `${tmpRaw}.tiff`;
  await runCmd('dcraw_emu', ['-w', '-q', '3', '-T', '-o', '1', tmpRaw]);
  // dcraw_emu writes alongside input with .tiff extension by default? Actually
  // it writes to <input>.tiff. Sanity-check.
  const generatedTiff = await firstExisting([tmpTiff, `${tmpRaw}.tif`]);
  if (!generatedTiff) {
    throw new Error(`dcraw_emu did not produce a TIFF for ${blob.name}`);
  }

  const { default: sharp } = await import('sharp');
  await sharp(generatedTiff).jpeg({ quality: 95, mozjpeg: true }).toFile(localPath);

  // Upload to derivatives/ with source-etag metadata.
  const upload = derivativesClient.getBlockBlobClient(derivBlobName);
  const data = await readFile(localPath);
  await upload.uploadData(data, {
    blobHTTPHeaders: {
      blobContentType: 'image/jpeg',
      blobCacheControl: 'public, max-age=31536000, immutable',
    },
    metadata: { sourceetag: stripQuotes(blob.etag) },
  });
  console.log(`  upload:   ${derivBlobName}`);

  // Cache locally.
  await copyFile(localPath, join(CACHE_DIR, hashKey(cacheKey)));

  // Best-effort cleanup.
  await rm(tmpRaw, { force: true }).catch(() => {});
  await rm(generatedTiff, { force: true }).catch(() => {});
}

async function processConvertBlob({ blob, originalsClient, derivativesClient, slug, targetFile, localPath, cacheKey }) {
  // Same shape as processRawBlob, but the source is already a format sharp can
  // (often) read directly. HEIC/HEIF: sharp on Ubuntu's npm binary lacks the
  // libheif decoder plugin (no libde265 bundled), so we shell out to
  // heif-convert (from `libheif-examples` apt package) for those.
  const derivBlobName = `${slug}/${targetFile}`;
  const derivClient = derivativesClient.getBlobClient(derivBlobName);

  try {
    const props = await derivClient.getProperties();
    if (props.metadata && props.metadata.sourceetag === stripQuotes(blob.etag)) {
      const tmp = join(CACHE_DIR, hashKey(cacheKey));
      await derivClient.downloadToFile(tmp);
      await copyFile(tmp, localPath);
      console.log(`  reuse:    ${derivBlobName} (matching source-etag)`);
      return;
    }
  } catch (e) {
    if (e.statusCode !== 404) console.warn(`derivative probe failed: ${e.message}`);
  }

  const srcClient = originalsClient.getBlobClient(blob.name);
  const tmpSrc = join(tmpdir(), `conv-${Date.now()}-${basename(blob.name)}`);
  await srcClient.downloadToFile(tmpSrc);
  console.log(`  convert:  ${blob.name}`);

  const isHeic = blob.ext === '.heic' || blob.ext === '.heif';
  const { default: sharp } = await import('sharp');

  if (isHeic) {
    // iPhone HEIC files with HDR tone-mapping (brands like tmap/MiHE/MiHB)
    // can't be decoded by Ubuntu's heif-convert or ImageMagick's libheif
    // delegate. pillow-heif handles them reliably; we shell out to a tiny
    // Python helper that does the conversion.
    const tmpJpg = `${tmpSrc}.jpg`;
    await runCmd('python3', [join(__dirname, 'heic-to-jpeg.py'), tmpSrc, tmpJpg, '92']);
    // sharp re-encode polishes the JPEG (mozjpeg for ~10% smaller files).
    await sharp(tmpJpg).jpeg({ quality: 92, mozjpeg: true }).toFile(localPath);
    await rm(tmpJpg, { force: true }).catch(() => {});
  } else {
    // TIFF and friends: sharp handles natively.
    await sharp(tmpSrc).rotate().jpeg({ quality: 92, mozjpeg: true }).toFile(localPath);
  }

  const upload = derivativesClient.getBlockBlobClient(derivBlobName);
  const data = await readFile(localPath);
  await upload.uploadData(data, {
    blobHTTPHeaders: {
      blobContentType: 'image/jpeg',
      blobCacheControl: 'public, max-age=31536000, immutable',
    },
    metadata: { sourceetag: stripQuotes(blob.etag) },
  });
  console.log(`  upload:   ${derivBlobName}`);

  await copyFile(localPath, join(CACHE_DIR, hashKey(cacheKey)));
  await rm(tmpSrc, { force: true }).catch(() => {});
}

function blobPublicUrl(containerClient, blobPath) {
  // containerClient.url is like https://acct.blob.core.windows.net/container
  const base = containerClient.url.replace(/\/$/, '');
  return `${base}/${blobPath.split('/').map(encodeURIComponent).join('/')}`;
}

// Generate tiny thumbnails for the admin panel (120px wide, ~3-8KB each).
async function generateAdminThumbs({ slug, imagesDir, images, containerClient }) {
  const { default: sharp } = await import('sharp');
  const THUMB_WIDTH = 120;
  let uploaded = 0;
  for (const img of images) {
    const src = join(imagesDir, img.file);
    const thumbName = `thumbs/${slug}/${img.file.replace(/\.[^.]+$/, '.jpg')}`;
    const blobClient = containerClient.getBlockBlobClient(thumbName);
    // Skip if thumb already exists (cheap HEAD check).
    try {
      await blobClient.getProperties();
      continue;
    } catch (_) {}
    try {
      const buf = await sharp(src)
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 50, mozjpeg: true })
        .toBuffer();
      await blobClient.upload(buf, buf.length, {
        blobHTTPHeaders: { blobContentType: 'image/jpeg' },
      });
      uploaded++;
    } catch (e) {
      console.warn(`  thumb skip: ${img.file}: ${e.message}`);
    }
  }
  if (uploaded > 0) console.log(`  thumbs: ${uploaded} new for ${slug}`);
}

function sanitizeSlug(prefix) {
  return prefix
    .toLowerCase()
    .replace(/[^a-z0-9-_/]+/g, '-')
    .replace(/\/+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function humanize(slug) {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

function stripQuotes(s) {
  if (!s) return s;
  return s.replace(/^"+|"+$/g, '');
}

function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(16)}-${s.length}.bin`;
}

async function copyFile(src, dst) {
  await mkdir(dirname(dst), { recursive: true });
  await fsCopyFile(src, dst);
}

async function firstExisting(paths) {
  for (const p of paths) {
    try {
      await access(p);
      return p;
    } catch {}
  }
  return undefined;
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function reorderByList(images, listed) {
  const map = new Map(images.map((i) => [i.file, i]));
  const ordered = [];
  for (const item of listed) {
    const file = typeof item === 'string' ? item : item.file;
    const found = map.get(file);
    if (found) {
      if (typeof item === 'object' && item.caption) found.caption = item.caption;
      ordered.push(found);
      map.delete(file);
    }
  }
  // Append any not-listed images alphabetically.
  for (const remaining of [...map.values()].sort((a, b) => a.file.localeCompare(b.file))) {
    ordered.push(remaining);
  }
  return ordered;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
