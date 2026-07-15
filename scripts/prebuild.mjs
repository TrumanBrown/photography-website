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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

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
const MAX_TITLE = 200;
const MAX_LOCATION = 200;
const MAX_DESCRIPTION = 1000;

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

  const sessionPrefixes = await listSessionPrefixes(originalsClient);
  validateSessionSlugs(sessionPrefixes);
  console.log(`Found ${sessionPrefixes.length} session(s) in originals/`);

  // Clear sessions only after the remote inventory is known to be valid, so a
  // naming error cannot destroy the last usable local build inputs.
  await clearSessionsDir();

  const indexRecords = [];
  for (const prefix of sessionPrefixes) {
    const rec = await processSession({
      prefix,
      originalsClient,
      derivativesClient,
      service,
      manifest,
      nextManifest,
    });
    if (rec) indexRecords.push(rec);
  }

  await saveManifest(metadataClient, nextManifest);
  await writeAdminIndex(metadataClient, indexRecords);
  console.log('Prebuild complete.');
}

// Write a consolidated index of resolved session metadata to the (private)
// metadata container. The admin API reads this single blob so it sees the
// SAME resolved values as the public site — including EXIF-derived dates that
// don't live in the _session.json sidecar. Far fewer reads than scanning.
async function writeAdminIndex(metadataClient, records) {
  try {
    const sorted = [...records].sort((a, b) => {
      if (a.order != null && b.order != null) return a.order - b.order;
      if (a.order != null) return -1;
      if (b.order != null) return 1;
      return (b.date || '').localeCompare(a.date || '');
    });
    const data = JSON.stringify({ generatedAt: new Date().toISOString(), sessions: sorted }, null, 2);
    const blob = metadataClient.getBlockBlobClient('admin-index.json');
    await blob.upload(data, Buffer.byteLength(data), {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });
    console.log(`admin-index.json written (${sorted.length} sessions).`);
  } catch (e) {
    console.warn('Could not write admin-index.json:', e.message);
  }
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
    sidecar = validateSessionSidecar(JSON.parse(buf.toString('utf8')), sidecarPath);
  } catch (e) {
    if (e.statusCode !== 404) {
      throw new Error(`Invalid session metadata at ${sidecarPath}: ${e.message}`, { cause: e });
    }
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
  validateImageTargets(blobs, prefix);

  if (blobs.length === 0) {
    console.warn(`Session "${prefix}" has no images; skipping.`);
    return;
  }

  const images = [];
  const targetBySource = new Map(blobs.map((blob) => [blob.base, targetFileForBlob(blob)]));
  let earliestExifDate;

  for (const b of blobs) {
    const isRaw = RAW_EXTS.has(b.ext);
    const needsConvert = CONVERT_EXTS.has(b.ext);
    const willConvert = isRaw || needsConvert;
    const targetFile = targetFileForBlob(b);
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
    let exifSettings;
    try {
      const { default: exifr } = await import('exifr');
      const exif = await exifr.parse(localPath, { tiff: true, ifd0: true, exif: true });
      captureDate = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
      exifSettings = buildExifSettings(exif);
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
      ...(exifSettings ? { exif: exifSettings } : {}),
      fullUrl: willConvert
        ? blobPublicUrl(derivativesClient, `${slug}/${targetFile}`)
        : blobPublicUrl(originalsClient, b.name),
    });

    nextManifest.blobs[b.name] = { etag: b.etag, target: targetFile, derivative: willConvert ? `${slug}/${targetFile}` : undefined };
  }

  // Sort images by filename for stable ordering (override via sidecar.images if provided).
  const orderedImages = Array.isArray(sidecar.images)
    ? reorderByList(images, sidecar.images, targetBySource)
    : images.sort((a, b) => a.file.localeCompare(b.file));

  const cover = sidecar.cover
    ? (targetBySource.get(sidecar.cover) ?? sidecar.cover)
    : undefined;

  const sessionRecord = {
    title: sidecar.title ?? humanize(slug),
    date: sidecar.date ?? earliestExifDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    location: sidecar.location ?? '',
    description: sidecar.description ?? '',
    ...(cover ? { cover } : {}),
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

  // Return a resolved summary for the admin index (see writeAdminIndex).
  return {
    prefix, // raw originals/ folder name (used for blob read/write)
    slug, // sanitized slug (thumbnail URLs + public /sessions path)
    title: sessionRecord.title,
    date: sessionRecord.date,
    location: sessionRecord.location,
    description: sessionRecord.description,
    cover: sessionRecord.cover ?? '',
    order: sessionRecord.order ?? null,
    images: orderedImages.map((i) => i.file),
  };
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
  await sharp(generatedTiff).keepExif().jpeg({ quality: 95, mozjpeg: true }).toFile(localPath);

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
    await sharp(tmpJpg).keepExif().jpeg({ quality: 92, mozjpeg: true }).toFile(localPath);
    await rm(tmpJpg, { force: true }).catch(() => {});
  } else {
    // TIFF and friends: sharp handles natively.
    await sharp(tmpSrc).rotate().keepExif().jpeg({ quality: 92, mozjpeg: true }).toFile(localPath);
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
    } catch {}
    try {
      const buf = await sharp(src)
        .rotate() // apply EXIF orientation so portrait photos aren't sideways
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

export function sanitizeSlug(prefix) {
  return prefix
    .toLowerCase()
    .replace(/[^a-z0-9-_/]+/g, '-')
    .replace(/\/+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function validateSessionSlugs(prefixes) {
  const prefixBySlug = new Map();
  const problems = [];

  for (const prefix of prefixes) {
    const slug = sanitizeSlug(prefix);
    if (!slug) {
      problems.push(`"${prefix}" does not contain any characters usable in a public URL`);
      continue;
    }
    if (slug.length > 200) {
      problems.push(`"${prefix}" maps to a ${slug.length}-character slug; the limit is 200`);
      continue;
    }

    const existingPrefix = prefixBySlug.get(slug);
    if (existingPrefix) {
      problems.push(`"${existingPrefix}" and "${prefix}" both map to "${slug}"`);
      continue;
    }
    prefixBySlug.set(slug, prefix);
  }

  if (problems.length > 0) {
    throw new Error(`Invalid session folder names:\n- ${problems.join('\n- ')}\nRename the folders in originals/ so every session has a unique URL slug.`);
  }
}

export function targetFileForBlob(blob) {
  return RAW_EXTS.has(blob.ext) || CONVERT_EXTS.has(blob.ext)
    ? `${stripExt(blob.base)}.jpg`
    : blob.base;
}

export function validateImageTargets(blobs, prefix) {
  const sourceByTarget = new Map();
  const collisions = [];

  for (const blob of blobs) {
    const target = targetFileForBlob(blob);
    const normalizedTarget = target.toLowerCase();
    const existingSource = sourceByTarget.get(normalizedTarget);
    if (existingSource) {
      collisions.push(`"${existingSource}" and "${blob.base}" both produce "${target}"`);
    } else {
      sourceByTarget.set(normalizedTarget, blob.base);
    }
  }

  if (collisions.length > 0) {
    throw new Error(
      `Session "${prefix}" has conflicting image filenames:\n- ${collisions.join('\n- ')}\nRename or remove one source image from each pair.`,
    );
  }
}

export function validateSessionSidecar(value, source = '_session.json') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must contain a JSON object.`);
  }

  const problems = [];
  validateOptionalString(value, 'title', MAX_TITLE, problems, { nonEmpty: true });
  validateOptionalString(value, 'location', MAX_LOCATION, problems);
  validateOptionalString(value, 'description', MAX_DESCRIPTION, problems);
  validateOptionalString(value, 'cover', undefined, problems);

  if (value.date !== undefined && (typeof value.date !== 'string' || !isIsoCalendarDate(value.date))) {
    problems.push('date must be a real ISO calendar date (YYYY-MM-DD)');
  }
  if (value.order !== undefined && value.order !== null && !Number.isInteger(value.order)) {
    problems.push('order must be an integer or null');
  }
  if (value.images !== undefined) {
    if (!Array.isArray(value.images)) {
      problems.push('images must be an array');
    } else {
      value.images.forEach((item, index) => {
        if (typeof item === 'string') {
          if (!item) problems.push(`images[${index}] must not be empty`);
          return;
        }
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          problems.push(`images[${index}] must be a filename or an object`);
          return;
        }
        if (typeof item.file !== 'string' || !item.file) {
          problems.push(`images[${index}].file must be a non-empty string`);
        }
        if (item.caption !== undefined && typeof item.caption !== 'string') {
          problems.push(`images[${index}].caption must be a string`);
        }
      });
    }
  }

  if (problems.length > 0) {
    throw new Error(`${source} is invalid:\n- ${problems.join('\n- ')}`);
  }
  return value;
}

function validateOptionalString(value, field, maxLength, problems, options = {}) {
  const fieldValue = value[field];
  if (fieldValue === undefined) return;
  if (typeof fieldValue !== 'string') {
    problems.push(`${field} must be a string`);
    return;
  }
  if (options.nonEmpty && !fieldValue.trim()) problems.push(`${field} must not be empty`);
  if (maxLength && fieldValue.length > maxLength) {
    problems.push(`${field} must be at most ${maxLength} characters`);
  }
}

function isIsoCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
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

/**
 * Build a compact, display-ready EXIF capture-settings object from a parsed
 * exifr record. Every field is optional; returns undefined when none are
 * present (synthetic fixtures, stripped images, most RAW-derived JPEGs).
 */
function buildExifSettings(exif) {
  if (!exif) return undefined;
  const out = {};

  const camera = exif.Model || exif.Make;
  if (camera) out.camera = String(camera).trim();
  if (exif.LensModel) out.lens = String(exif.LensModel).trim();

  if (typeof exif.FocalLength === 'number' && exif.FocalLength > 0) {
    out.focalLength = `${Math.round(exif.FocalLength)}mm`;
  }
  if (typeof exif.FNumber === 'number' && exif.FNumber > 0) {
    out.aperture = `f/${exif.FNumber % 1 === 0 ? exif.FNumber : exif.FNumber.toFixed(1)}`;
  }
  if (typeof exif.ExposureTime === 'number' && exif.ExposureTime > 0) {
    out.shutter =
      exif.ExposureTime >= 1
        ? `${Math.round(exif.ExposureTime * 10) / 10}s`
        : `1/${Math.round(1 / exif.ExposureTime)}s`;
  }
  let iso = exif.ISO ?? exif.ISOSpeedRatings ?? exif.PhotographicSensitivity;
  if (Array.isArray(iso)) iso = iso[0];
  if (typeof iso === 'number' && iso > 0) out.iso = `ISO ${iso}`;

  return Object.keys(out).length ? out : undefined;
}

export function hashKey(s) {
  return `${createHash('sha256').update(s).digest('hex')}.bin`;
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

export function reorderByList(images, listed, targetBySource = new Map()) {
  const map = new Map(images.map((i) => [i.file, i]));
  const ordered = [];
  for (const item of listed) {
    const sourceFile = typeof item === 'string' ? item : item?.file;
    if (typeof sourceFile !== 'string') continue;
    const file = targetBySource.get(sourceFile) ?? sourceFile;
    const found = map.get(file);
    if (found) {
      if (item && typeof item === 'object' && typeof item.caption === 'string' && item.caption) {
        found.caption = item.caption;
      }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
