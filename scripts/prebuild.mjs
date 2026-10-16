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
 *   0. Publish new uploads from the private incoming/ container to originals/,
 *      removing any GPS position first (publishIncoming).
 *   1. Read metadata/manifest.json (last-seen blob etags).
 *   2. List session prefixes under originals/.
 *   3. For each prefix:
 *        - Read _session.json if present, else synthesize from defaults.
 *        - For each image blob:
 *            * Already checked for a location, full size on record → use its
 *              2400 px build copy, from the cache or metadata/build-copies/.
 *            * Unchanged etag → reuse cached local copy.
 *            * RAW + matching derivative exists → reuse the derivative.
 *            * RAW without derivative → dcraw_emu → sharp → upload to
 *              derivatives/<session>/<name>.jpg with source-etag metadata.
 *            * Other → download into src/content/sessions/<slug>/images/.
 *        - Strip GPS from every photo that records one, everywhere it's
 *          published (keepLocationsPrivate, scripts/location.mjs).
 *        - Swap every photo read in full for its build copy, and upload the
 *          copy so later builds never need the full photo.
 *        - Write src/content/sessions/<slug>.json.
 *   4. Save updated manifest back to metadata/manifest.json.
 *   5. Delete whatever this run didn't use from .cache/prebuild.
 *
 * Exit code 0 even when no sessions exist — the site renders an empty state.
 */
import { mkdir, mkdtemp, writeFile, readFile, rename, rm, access, copyFile as fsCopyFile } from 'node:fs/promises';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  exiftoolVersion,
  filesWithLocation,
  IMAGE_EXTS as LOCATION_EXTS,
  INSTALL_HINT,
  probeBytes,
  stripLocation,
} from './location.mjs';

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
// Originals are addressed by filename and never edited in place, so they can be
// cached hard. The lightbox loads them directly; without this every viewing
// costs another several megabytes.
const ORIGINALS_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const ORIGINALS = 'originals';
// Private: where uploads wait until a build has removed their location. The
// first path segment names the public container a file is published to:
// incoming/originals/<session>/<file>, incoming/hobby-media/<hobby>/full/<file>.
const INCOMING = 'incoming';
const HOBBY_MEDIA = 'hobby-media';
// Bump when RAW/HEIC conversion changes, so every derivative is made again once.
const DERIVATIVE_VERSION = '2';
// A converted photo's only lossy step: one JPEG encode, from lossless input,
// at full resolution, with full colour resolution (no chroma subsampling).
const DERIVATIVE_JPEG = { quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' };
const DERIVATIVES = 'derivatives';
const METADATA = 'metadata';
const MANIFEST_BLOB = 'manifest.json';
// The build never needs a photo bigger than this. Astro's widest page image is
// the 2000 px session banner and the lightbox loads the original straight from
// Blob, so prebuild works from a 2400 px copy of each photo. GitHub's runners
// are Azure VMs in other regions, so every byte a build downloads is billed:
// a cold cache costs the copies, about a fifth of the originals, instead of
// every original. Each page image is still a downscale, to the same size it
// would have from the original (buildCopyWidth), and visually the same at 1:1.
// Bump the version when the copy changes, so each one is made again once.
const BUILD_COPY_WIDTH = 2400;
const BUILD_COPY_JPEG = { quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' };
export const BUILD_COPY_VERSION = '1';
// Private, in the metadata container: build-copies/<slug>/<file>.
const BUILD_COPIES = 'build-copies';
const IMAGE_CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};
const MAX_TITLE = 200;
const MAX_LOCATION = 200;
const MAX_DESCRIPTION = 1000;
const MAX_CAPTION = 500;

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

  // New uploads wait, private, in incoming/ until they're clean (no GPS).
  await publishIncoming({
    incomingClient: service.getContainerClient(INCOMING),
    destinations: {
      [ORIGINALS]: originalsClient,
      [HOBBY_MEDIA]: service.getContainerClient(HOBBY_MEDIA),
    },
  });

  const manifest = await loadManifest(metadataClient);
  const nextManifest = { blobs: {}, generatedAt: new Date().toISOString(), account };

  const sessionPrefixes = await listSessionPrefixes(originalsClient);
  validateSessionSlugs(sessionPrefixes);
  console.log(`Found ${sessionPrefixes.length} session(s) in originals/`);

  // Clear sessions only after the remote inventory is known to be valid, so a
  // naming error cannot destroy the last usable local build inputs.
  await clearSessionsDir();

  const cacheInUse = new Set();
  const indexRecords = [];
  for (const prefix of sessionPrefixes) {
    const rec = await processSession({
      prefix,
      originalsClient,
      derivativesClient,
      metadataClient,
      service,
      manifest,
      nextManifest,
      cacheInUse,
    });
    if (rec) indexRecords.push(rec);
  }

  await saveManifest(metadataClient, nextManifest);
  await writeAdminIndex(metadataClient, indexRecords);
  await reportNewPhotos(metadataClient, indexRecords);
  await pruneCache(CACHE_DIR, cacheInUse);
  console.log('Prebuild complete.');
}

/**
 * Count photos the photo pipeline (scripts/photos, docs/photos.md) hasn't seen
 * yet, by checking its private catalog. The build workflow starts the pipeline
 * when this is above zero, so a new session gets captions and a description
 * soon after it goes live instead of waiting for the nightly run.
 */
async function reportNewPhotos(metadataClient, records) {
  let known;
  try {
    const buf = await metadataClient.getBlockBlobClient('photos/catalog.json').downloadToBuffer();
    known = new Set(Object.keys(JSON.parse(buf.toString('utf8')).files ?? {}));
  } catch (e) {
    if (e?.statusCode !== 404) {
      console.warn('Could not read the photo catalog:', e.message);
      return;
    }
    known = new Set();
  }
  const fresh = records
    .flatMap((r) => r.images.map((file) => `${r.slug}/${file}`))
    .filter((id) => !known.has(id)).length;
  console.log(`Photos the photo pipeline hasn't seen yet: ${fresh}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `new_photos=${fresh}\n`);
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

async function processSession({
  prefix,
  originalsClient,
  derivativesClient,
  metadataClient,
  service,
  manifest,
  nextManifest,
  cacheInUse,
}) {
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
      contentType: blob.properties.contentType,
      cacheControl: blob.properties.cacheControl,
    });
  }
  validateImageTargets(blobs, prefix);

  // The lightbox serves these originals directly, so they must be cacheable or
  // every viewing re-downloads several megabytes. Uploads don't set the header,
  // so backfill it here: listBlobsFlat already reports it, making this a no-op
  // on every build after the first.
  const needCache = blobs.filter(
    (b) => b.cacheControl !== ORIGINALS_CACHE_CONTROL && b.contentType,
  );
  for (let i = 0; i < needCache.length; i += 8) {
    await Promise.all(
      needCache.slice(i, i + 8).map(async (blob) => {
        try {
          // setHTTPHeaders replaces every header, so the content type has to be
          // passed back in or it would be cleared.
          await originalsClient.getBlockBlobClient(blob.name).setHTTPHeaders({
            blobContentType: blob.contentType,
            blobCacheControl: ORIGINALS_CACHE_CONTROL,
          });
        } catch (e) {
          // Never fail a build over a cache header.
          console.warn(`  cache-control skip: ${blob.name}: ${e.message}`);
        }
      }),
    );
  }
  if (needCache.length > 0) {
    console.log(`  cache-control: set on ${needCache.length} original(s)`);
  }

  if (blobs.length === 0) {
    console.warn(`Session "${prefix}" has no images; skipping.`);
    return;
  }

  const images = [];
  const targetBySource = new Map(blobs.map((blob) => [blob.base, targetFileForBlob(blob)]));
  let earliestExifDate;
  /** Every photo's working copy, for the location check after the loop. */
  const published = [];

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
    const sameSource = manifestEntry?.etag === b.etag && manifestEntry?.target === targetFile;
    const copyClient = metadataClient.getBlockBlobClient(buildCopyBlobName(slug, targetFile));
    const copyCacheFile = join(CACHE_DIR, hashKey(buildCopyCacheKey(b.name, b.etag, targetFile)));

    // A photo an earlier build checked for a location, with its full size on
    // record, is built from its copy and never downloaded in full again.
    const fromCopy =
      sameSource &&
      manifestEntry.private === true &&
      manifestEntry.width > 0 &&
      manifestEntry.height > 0 &&
      (await restoreBuildCopy({ client: copyClient, etag: b.etag, localPath, cacheFile: copyCacheFile }));

    let useCached = fromCopy;
    if (fromCopy) {
      cacheInUse.add(basename(copyCacheFile));
    } else if (sameSource) {
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

    // Read intrinsic dimensions + EXIF date. A build copy is smaller than the
    // photo, so the photo's size comes from the manifest; its EXIF is the photo's.
    const { default: sharp } = await import('sharp');
    const { width, height } = fromCopy
      ? { width: manifestEntry.width, height: manifestEntry.height }
      : uprightSize(await sharp(localPath).metadata());

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

    nextManifest.blobs[b.name] = {
      etag: b.etag,
      target: targetFile,
      derivative: willConvert ? `${slug}/${targetFile}` : undefined,
      width,
      height,
    };
    published.push({
      blob: b,
      localPath,
      targetFile,
      willConvert,
      derivName: `${slug}/${targetFile}`,
      fromCopy,
      copyClient,
    });
  }

  await keepLocationsPrivate({
    items: published,
    manifest,
    nextManifest,
    originalsClient,
    derivativesClient,
  });

  // Photos read in full this time are swapped for their build copy now that
  // any location is gone, so Astro always works from the same file. This has
  // to come after keepLocationsPrivate, which uploads a cleaned working copy
  // back as the original. Only a photo cleared of its location is uploaded:
  // anything else is read in full again next build anyway. Four at a time,
  // since each JPEG encode uses one core.
  const toCopy = published.filter((item) => !item.fromCopy);
  for (let i = 0; i < toCopy.length; i += 4) {
    await Promise.all(
      toCopy.slice(i, i + 4).map(async (item) => {
        const entry = nextManifest.blobs[item.blob.name];
        const cleared = entry.private === true;
        const cacheFile = join(CACHE_DIR, hashKey(buildCopyCacheKey(item.blob.name, entry.etag, item.targetFile)));
        try {
          await makeBuildCopy({
            localPath: item.localPath,
            width: entry.width,
            height: entry.height,
            ...(cleared ? { client: item.copyClient, sourceEtag: entry.etag, cacheFile } : {}),
          });
          if (cleared) cacheInUse.add(basename(cacheFile));
        } catch (e) {
          // Never fail a build over a copy; this photo is read in full again next time.
          console.warn(`  build copy skip: ${item.blob.name}: ${e.message}`);
        }
      }),
    );
  }

  // Sort images by filename for stable ordering (override via sidecar.images if provided).
  const orderedImages = Array.isArray(sidecar.images)
    ? reorderByList(images, sidecar.images, targetBySource)
    : images.sort((a, b) => a.file.localeCompare(b.file));

  // Captions and descriptions aren't written here: the photo pipeline
  // (scripts/photos) writes them into _session.json, and they arrive through
  // the sidecar like anything typed in /admin.

  const cover = sidecar.cover
    ? (targetBySource.get(sidecar.cover) ?? sidecar.cover)
    : undefined;

  // The photograph cropped into the session page's header banner, when the
  // admin panel pinned one. Goes through the same rename table as the cover.
  const banner = sidecar.banner
    ? (targetBySource.get(sidecar.banner) ?? sidecar.banner)
    : undefined;

  // Photographs chosen in the admin panel for the rotating lead box. Names go
  // through the same rename table as the cover, and anything no longer in the
  // session is dropped.
  const presentFiles = new Set(orderedImages.map((image) => image.file));
  const showcase = (Array.isArray(sidecar.showcase) ? sidecar.showcase : [])
    .map((file) => targetBySource.get(file) ?? file)
    .filter((file) => presentFiles.has(file));

  const sessionRecord = {
    title: sidecar.title ?? humanize(slug),
    date: sidecar.date ?? earliestExifDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    location: sidecar.location ?? '',
    description: sidecar.description ?? '',
    ...(cover ? { cover } : {}),
    ...(banner ? { banner } : {}),
    ...(sidecar.bannerFocus ? { bannerFocus: sidecar.bannerFocus } : {}),
    ...(sidecar.order != null ? { order: sidecar.order } : {}),
    ...(showcase.length ? { showcase } : {}),
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
    banner: sessionRecord.banner ?? '',
    order: sessionRecord.order ?? null,
    images: orderedImages.map((i) => i.file),
    showcase,
    // Aspect ratios so the admin can show which frames fit the 3:2 lead box.
    ratios: Object.fromEntries(
      orderedImages
        .filter((i) => i.width > 0 && i.height > 0)
        .map((i) => [i.file, Number((i.width / i.height).toFixed(4))]),
    ),
    // Public URLs of the full-size frames, so the admin's preview can show the
    // photograph itself rather than an enlarged thumbnail.
    urls: Object.fromEntries(
      orderedImages.filter((i) => i.fullUrl).map((i) => [i.file, i.fullUrl]),
    ),
    captions: Object.fromEntries(
      orderedImages
        .filter((image) => image.caption)
        .map((image) => [image.file, image.caption]),
    ),
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
    if (derivativeIsCurrent(props.metadata, blob)) {
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
  await sharp(generatedTiff).keepExif().jpeg(DERIVATIVE_JPEG).toFile(localPath);

  // Upload to derivatives/ with source-etag metadata.
  const upload = derivativesClient.getBlockBlobClient(derivBlobName);
  const data = await readFile(localPath);
  await upload.uploadData(data, {
    blobHTTPHeaders: {
      blobContentType: 'image/jpeg',
      blobCacheControl: 'public, max-age=31536000, immutable',
    },
    metadata: { sourceetag: stripQuotes(blob.etag), derivative: DERIVATIVE_VERSION },
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
    if (derivativeIsCurrent(props.metadata, blob)) {
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
    // Python helper that decodes to a lossless TIFF, so the JPEG encode
    // below is the one and only lossy step.
    const tmpTiff = `${tmpSrc}.tiff`;
    await runCmd('python3', [join(__dirname, 'heic-to-jpeg.py'), tmpSrc, tmpTiff]);
    await sharp(tmpTiff).jpeg(DERIVATIVE_JPEG).toFile(localPath);
    await rm(tmpTiff, { force: true }).catch(() => {});
  } else {
    // TIFF and friends: sharp handles natively.
    await sharp(tmpSrc).rotate().keepExif().jpeg(DERIVATIVE_JPEG).toFile(localPath);
  }

  const upload = derivativesClient.getBlockBlobClient(derivBlobName);
  const data = await readFile(localPath);
  await upload.uploadData(data, {
    blobHTTPHeaders: {
      blobContentType: 'image/jpeg',
      blobCacheControl: 'public, max-age=31536000, immutable',
    },
    metadata: { sourceetag: stripQuotes(blob.etag), derivative: DERIVATIVE_VERSION },
  });
  console.log(`  upload:   ${derivBlobName}`);

  await copyFile(localPath, join(CACHE_DIR, hashKey(cacheKey)));
  await rm(tmpSrc, { force: true }).catch(() => {});
}

const realLocationTools = { exiftoolVersion, filesWithLocation, stripLocation };

/**
 * Publish what the upload scripts left in the private `incoming` container.
 *
 * Uploads land there rather than in a public container, so a photo is never
 * readable by URL while it still records where it was taken. Each file moves
 * to its public container once any location is removed (exiftool, installed by
 * the build), and only then leaves `incoming`. exiftool rewrites metadata
 * only: the image data published is byte for byte what was uploaded.
 * A photo that records a location when exiftool is missing, or that can't be
 * cleaned, stops the build and stays private. Safe to rerun: a build that
 * stops part-way leaves the rest for the next one.
 */
export async function publishIncoming({
  incomingClient,
  destinations,
  tools = realLocationTools,
  batchSize = 8,
}) {
  const waiting = [];
  try {
    for await (const blob of incomingClient.listBlobsFlat()) {
      const [container, ...rest] = blob.name.split('/');
      if (destinations[container] && rest.length > 0) {
        waiting.push({ ...blob, container, target: rest.join('/') });
      } else {
        console.warn(`  ${INCOMING}: leaving ${blob.name}; it doesn't start with ${Object.keys(destinations).join('/ or ')}/`);
      }
    }
  } catch (e) {
    if (e.statusCode === 404) return 0; // no inbox yet, so nothing uploaded through it
    throw e;
  }
  if (waiting.length === 0) return 0;

  const scratch = await mkdtemp(join(tmpdir(), 'incoming-'));
  let published = 0;
  let cleaned = 0;
  try {
    for (let i = 0; i < waiting.length; i += batchSize) {
      const batch = [];
      await Promise.all(
        waiting.slice(i, i + batchSize).map(async (blob, j) => {
          const path = join(scratch, `${i + j}${extname(blob.name).toLowerCase()}`);
          try {
            await incomingClient
              .getBlobClient(blob.name)
              .downloadToFile(path, 0, undefined, { conditions: { ifMatch: blob.properties.etag } });
          } catch (e) {
            // Replaced, or published by another build, since the listing.
            if (e.statusCode === 404 || e.statusCode === 412) return;
            throw e;
          }
          batch.push({ blob, path, photo: LOCATION_EXTS.has(extname(path)) });
        }),
      );

      const located = await tools.filesWithLocation(batch.filter((f) => f.photo).map((f) => f.path));
      if (located.size > 0) {
        if (!tools.exiftoolVersion()) {
          throw new Error(
            `${located.size} uploaded photo(s) record where they were taken; they stay private in ${INCOMING}/. ${INSTALL_HINT}`,
          );
        }
        for (const path of located) await tools.stripLocation(path);
        const still = await tools.filesWithLocation([...located]);
        if (still.size > 0) {
          throw new Error(
            `${still.size} uploaded photo(s) still record a location after stripping; they stay private in ${INCOMING}/.`,
          );
        }
        cleaned += located.size;
      }

      await Promise.all(
        batch.map(async ({ blob, path, photo }) => {
          await destinations[blob.container].getBlockBlobClient(blob.target).uploadFile(path, {
            blobHTTPHeaders: {
              blobContentType: blob.properties.contentType || undefined,
              ...(photo ? { blobCacheControl: ORIGINALS_CACHE_CONTROL } : {}),
            },
          });
          try {
            await incomingClient
              .getBlobClient(blob.name)
              .deleteIfExists({ conditions: { ifMatch: blob.properties.etag } });
          } catch (e) {
            // Uploaded again meanwhile: the next build publishes the new one.
            if (e.statusCode !== 412) throw e;
          }
          await rm(path, { force: true });
          published++;
        }),
      );
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  console.log(
    `${INCOMING}: published ${published} file(s)${cleaned ? `, removing the location from ${cleaned}` : ''}`,
  );
  return published;
}

/**
 * Where a photo was taken never goes public (scripts/location.mjs).
 *
 * Every image container but `metadata` can be read by anyone with a URL, and
 * Astro copies some working copies byte for byte into variants/. So once per
 * photo and ETag this checks the working copy Astro will read and, for
 * converted photos, the HEIC/RAW source too, whose URL is easy to guess from
 * the derivative's. Whatever records a position is stripped everywhere it's
 * published: the working copy, the derivative and the original. exiftool
 * rewrites only metadata, each blob keeps its name, headers and metadata, and
 * blob soft delete keeps the previous bytes for 7 days. A working copy,
 * derivative, linked original or new RAW/HEIC source that can't be cleaned
 * stops the build rather than going out with its position. A RAW/HEIC source
 * published by an earlier build gets a warning and another try next build,
 * since stopping wouldn't hide it.
 *
 * Uploads through scripts/upload-session.sh are already clean by now
 * (publishIncoming); this catches anything put in `originals` another way, and
 * photos published before the check existed.
 */
export async function keepLocationsPrivate({
  items,
  manifest,
  nextManifest,
  originalsClient,
  derivativesClient,
  cacheDir = CACHE_DIR,
  tools = realLocationTools,
}) {
  const pending = items.filter(({ blob, targetFile }) => {
    const seen = manifest[blob.name];
    const verified = seen?.private === true && seen.etag === blob.etag && seen.target === targetFile;
    if (verified) nextManifest.blobs[blob.name].private = true;
    return !verified;
  });
  if (pending.length === 0) return;
  // A cleaned working copy goes back up as the original, so it must never be
  // a build copy. processSession only uses one for a photo already verified.
  const copies = pending.filter((item) => item.fromCopy);
  if (copies.length > 0) {
    throw new Error(`Build copies can't be checked for a location: ${copies.map((item) => item.blob.name).join(', ')}`);
  }

  const scratch = await mkdtemp(join(tmpdir(), 'location-'));
  try {
    const localLocated = await tools.filesWithLocation(pending.map((item) => item.localPath));

    // Converted sources are never linked from the site, so only their header
    // is read here unless it turns out to need cleaning.
    const probes = new Map();
    for (const item of pending) {
      const size = item.blob.contentLength ?? 0;
      if (!item.willConvert || size === 0) continue;
      const probe = join(scratch, `probe-${probes.size}${item.blob.ext}`);
      const head = await originalsClient
        .getBlobClient(item.blob.name)
        .downloadToBuffer(0, Math.min(size, probeBytes(item.blob.ext)));
      await writeFile(probe, head);
      probes.set(item, probe);
    }
    const sourceLocated = await tools.filesWithLocation([...probes.values()]);

    const located = pending.filter(
      (item) => localLocated.has(item.localPath) || sourceLocated.has(probes.get(item)),
    );
    if (located.length > 0) {
      console.log(`  location: removing it from ${located.length} photo(s)`);
      if (!tools.exiftoolVersion()) {
        throw new Error(
          `${located.length} photo(s) record where they were taken, and every container they're published from is public. ${INSTALL_HINT}`,
        );
      }
    }

    for (const item of pending) {
      const { blob } = item;
      const localHas = localLocated.has(item.localPath);
      const sourceHas = sourceLocated.has(probes.get(item));
      let etag = blob.etag;
      let sourceFailed = false;
      try {
        if (localHas) await tools.stripLocation(item.localPath);
        if (!item.willConvert && localHas) {
          // The working copy is the original's own bytes, so it goes back as the original.
          etag = await replaceBlob(originalsClient, blob.name, item.localPath, blob.etag);
        }
        if (sourceHas) {
          try {
            const full = join(scratch, `source${blob.ext}`);
            const clean = join(scratch, `clean${blob.ext}`);
            await rm(full, { force: true });
            await rm(clean, { force: true });
            await originalsClient
              .getBlobClient(blob.name)
              .downloadToFile(full, 0, undefined, { conditions: { ifMatch: blob.etag } });
            await tools.stripLocation(full, clean);
            etag = await replaceBlob(originalsClient, blob.name, clean, blob.etag);
          } catch (e) {
            if (e.statusCode === 412) throw e;
            // A source this build is about to publish for the first time stops
            // the build, so its derivative's link never gives the URL away. One
            // already published can't be hidden that way; stopping would only
            // hold back everything else.
            if (!manifest[blob.name]) throw e;
            console.warn(
              `::warning::Couldn't remove the GPS position from ${blob.name} (${e.message}). The next build tries again; node scripts/location.mjs blobs --apply does it by hand.`,
            );
            sourceFailed = true;
          }
        }
        if (item.willConvert && (localHas || etag !== blob.etag)) {
          // Keep the derivative matched to its source, so it isn't converted again.
          const metadata = { sourceetag: stripQuotes(etag) };
          if (localHas) {
            await replaceBlob(derivativesClient, item.derivName, item.localPath, undefined, metadata);
          } else {
            const derivative = derivativesClient.getBlobClient(item.derivName);
            const { metadata: current } = await derivative.getProperties();
            await derivative.setMetadata({ ...current, ...metadata });
          }
        }
      } catch (e) {
        if (e.statusCode !== 412) throw e;
        // Replaced while this ran. The working copy is clean; the next build checks the new file.
        console.warn(`  location: ${blob.name} changed during the check; checking it next build`);
        continue;
      }
      if (localHas || etag !== blob.etag) {
        await copyFile(item.localPath, join(cacheDir, hashKey(`${blob.name}@${etag}@${item.targetFile}`)));
      }
      if (etag !== blob.etag) {
        // The old ETag's copy would never be read again; the cache is gigabytes already.
        await rm(join(cacheDir, hashKey(`${blob.name}@${blob.etag}@${item.targetFile}`)), { force: true });
      }
      Object.assign(nextManifest.blobs[blob.name], { etag, ...(sourceFailed ? {} : { private: true }) });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Upload `path` over an existing blob, keeping its headers and metadata (with
 * `metadata` merged in), and only if it's still the version this build read.
 * Returns the new ETag.
 */
async function replaceBlob(containerClient, name, path, ifMatch, metadata) {
  const client = containerClient.getBlockBlobClient(name);
  const props = await client.getProperties(ifMatch ? { conditions: { ifMatch } } : undefined);
  const response = await client.uploadFile(path, {
    blobHTTPHeaders: {
      blobContentType: props.contentType,
      blobCacheControl: props.cacheControl,
      blobContentDisposition: props.contentDisposition,
      blobContentEncoding: props.contentEncoding,
      blobContentLanguage: props.contentLanguage,
    },
    metadata: { ...props.metadata, ...metadata },
    conditions: { ifMatch: props.etag },
  });
  console.log(`  location: cleaned ${containerClient.containerName}/${name}`);
  return response.etag;
}

function blobPublicUrl(containerClient, blobPath) {
  // containerClient.url is like https://acct.blob.core.windows.net/container
  const base = containerClient.url.replace(/\/$/, '');
  return `${base}/${blobPath.split('/').map(encodeURIComponent).join('/')}`;
}

// Thumbnails for the admin panel's pickers, in two sizes.
//
// The grid stretches its columns to fill the row, so a tile can be 600px wide
// on a big screen, and twice that in device pixels on a retina display. One
// small thumbnail can't cover that without going soft, so the admin uses a
// srcset: the 512px file for list rows and small tiles, the 1280px file when a
// tile is genuinely large. Both stamp the width they were made at, so raising
// either one reruns the files that are now too small instead of leaving a
// mixed set behind.
export const ADMIN_THUMB_SIZES = [
  { dir: 'thumbs', width: 512, quality: 72 },
  { dir: 'thumbs-lg', width: 1280, quality: 70 },
];

export async function generateAdminThumbs({ slug, imagesDir, images, containerClient }) {
  const { default: sharp } = await import('sharp');
  const uploaded = new Map(ADMIN_THUMB_SIZES.map((size) => [size.dir, 0]));

  for (const img of images) {
    const src = join(imagesDir, img.file);
    const jpegName = img.file.replace(/\.[^.]+$/, '.jpg');

    for (const size of ADMIN_THUMB_SIZES) {
      const blobClient = containerClient.getBlockBlobClient(`${size.dir}/${slug}/${jpegName}`);
      // Skip if a file of at least this width already exists (cheap HEAD check).
      try {
        const props = await blobClient.getProperties();
        if (Number(props.metadata?.width ?? 0) >= size.width) continue;
      } catch {}
      try {
        const buf = await sharp(src)
          .rotate() // apply EXIF orientation so portrait photos aren't sideways
          .resize({ width: size.width, withoutEnlargement: true })
          .jpeg({ quality: size.quality, mozjpeg: true })
          .toBuffer();
        await blobClient.upload(buf, buf.length, {
          blobHTTPHeaders: { blobContentType: 'image/jpeg' },
          metadata: { width: String(size.width) },
        });
        uploaded.set(size.dir, uploaded.get(size.dir) + 1);
      } catch (e) {
        console.warn(`  ${size.dir} skip: ${img.file}: ${e.message}`);
      }
    }
  }

  for (const [dir, count] of uploaded) {
    if (count > 0) console.log(`  ${dir}: ${count} new for ${slug}`);
  }
}

/**
 * Width and height the way the photograph is shown. A camera held sideways
 * stores landscape pixels plus an EXIF orientation of 5 to 8, and browsers and
 * Astro's image service turn those upright. Recording the stored size would
 * call a portrait 3:2, so the admin would offer it for the 3:2 lead box and the
 * home page would put it there.
 */
export function uprightSize(meta) {
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  return (meta.orientation ?? 1) >= 5 ? { width: height, height: width } : { width, height };
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
  validateOptionalString(value, 'banner', undefined, problems);
  validateOptionalString(value, 'bannerFocus', 40, problems);

  if (value.date !== undefined && (typeof value.date !== 'string' || !isIsoCalendarDate(value.date))) {
    problems.push('date must be a real ISO calendar date (YYYY-MM-DD)');
  }
  if (value.order !== undefined && value.order !== null && !Number.isInteger(value.order)) {
    problems.push('order must be an integer or null');
  }
  if (value.showcase !== undefined) {
    if (!Array.isArray(value.showcase)) {
      problems.push('showcase must be an array of filenames');
    } else {
      value.showcase.forEach((item, index) => {
        if (typeof item !== 'string' || !item) {
          problems.push(`showcase[${index}] must be a non-empty filename`);
        }
      });
    }
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
        } else if (typeof item.caption === 'string' && item.caption.length > MAX_CAPTION) {
          problems.push(`images[${index}].caption must be at most ${MAX_CAPTION} characters`);
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

/** A derivative made from this exact source, by the current conversion. */
export function derivativeIsCurrent(metadata, blob) {
  return metadata?.sourceetag === stripQuotes(blob.etag) && metadata?.derivative === DERIVATIVE_VERSION;
}

function buildCopyBlobName(slug, targetFile) {
  return `${BUILD_COPIES}/${slug}/${targetFile}`;
}

function buildCopyCacheKey(name, etag, targetFile) {
  return `build-copy-${BUILD_COPY_VERSION}@${name}@${etag}@${targetFile}`;
}

/** A build copy made from this exact source, by the current settings. */
export function buildCopyIsCurrent(metadata, etag) {
  return metadata?.sourceetag === stripQuotes(etag) && metadata?.buildcopy === BUILD_COPY_VERSION;
}

/**
 * Width of a photo's build copy, or null when the photo is small enough to
 * use as it is. The smallest width from BUILD_COPY_WIDTH that keeps the
 * photo's exact aspect ratio (3:2 is 2400 x 1600, an odd crop a few pixels
 * more), so Astro rounds every page image to the height it would from the
 * original. A crop with no such width close by gets BUILD_COPY_WIDTH, and its
 * page images may come out a pixel shorter.
 */
export function buildCopyWidth(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || height <= 0) return null;
  if (width <= BUILD_COPY_WIDTH) return null;
  const step = width / gcd(width, height);
  const exact = Math.ceil(BUILD_COPY_WIDTH / step) * step;
  const copy = exact - BUILD_COPY_WIDTH <= 160 ? exact : BUILD_COPY_WIDTH;
  return copy < width ? copy : null;
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

/**
 * Put a photo's build copy at `localPath`, from the local cache or else from
 * Blob. False when there's no copy made from this exact source, and the
 * caller reads the full photo instead. Cache files only ever appear whole
 * (written aside, then renamed), since a cancelled run's cache is still saved.
 */
export async function restoreBuildCopy({ client, etag, localPath, cacheFile }) {
  if (existsSync(cacheFile)) {
    await copyFile(cacheFile, localPath);
    return true;
  }
  const part = `${cacheFile}.part`;
  try {
    const props = await client.getProperties();
    if (!buildCopyIsCurrent(props.metadata, etag)) return false;
    await mkdir(dirname(cacheFile), { recursive: true });
    await client.downloadToFile(part, 0, undefined, { conditions: { ifMatch: props.etag } });
    await rename(part, cacheFile);
    await copyFile(cacheFile, localPath);
    console.log(`  copy:     ${client.name}`);
    return true;
  } catch (e) {
    await rm(part, { force: true });
    if (e.statusCode !== 404) console.warn(`  build copy probe failed: ${client.name}: ${e.message}`);
    return false;
  }
}

/**
 * Replace the full-size photo at `localPath` with its build copy. With a
 * `client`, also upload the copy and keep it in the local cache, so later
 * builds never need the full photo. The camera's EXIF stays, since the session
 * date and the lightbox's settings line are read from it; any GPS position is
 * gone by now (keepLocationsPrivate). Photos that are already small, and the
 * rare PNG, WebP or AVIF, are their own copy.
 */
export async function makeBuildCopy({ localPath, width, height, client, sourceEtag, cacheFile }) {
  const copyWidth = buildCopyWidth(width, height);
  let data;
  if (copyWidth && /\.jpe?g$/i.test(localPath)) {
    const { default: sharp } = await import('sharp');
    data = await sharp(localPath)
      .rotate()
      .resize({ width: copyWidth, height: Math.round((copyWidth * height) / width), fit: 'fill' })
      .keepExif()
      .jpeg(BUILD_COPY_JPEG)
      .toBuffer();
    await writeFile(localPath, data);
  }
  if (!client) return;
  data ??= await readFile(localPath);
  await client.uploadData(data, {
    blobHTTPHeaders: {
      blobContentType: IMAGE_CONTENT_TYPES[extname(localPath).toLowerCase()] ?? 'application/octet-stream',
    },
    metadata: { sourceetag: stripQuotes(sourceEtag), buildcopy: BUILD_COPY_VERSION },
  });
  console.log(`  upload:   ${client.name}`);
  await mkdir(dirname(cacheFile), { recursive: true });
  await writeFile(`${cacheFile}.part`, data);
  await rename(`${cacheFile}.part`, cacheFile);
}

/**
 * Leave only what this run used in the prebuild cache. CI restores and saves
 * the whole folder, and GitHub keeps 10 GB of caches per repository: full-size
 * photos left in here pushed this cache or the image-variant cache out on most
 * runs, and the next build downloaded every photo again.
 */
export async function pruneCache(dir, keep) {
  let removed = 0;
  for (const name of await readdirSafe(dir)) {
    if (keep.has(name)) continue;
    await rm(join(dir, name), { recursive: true, force: true });
    removed++;
  }
  if (removed > 0) console.log(`cache: removed ${removed} file(s) this build didn't use`);
  return removed;
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
