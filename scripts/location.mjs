#!/usr/bin/env node
/**
 * Keeps where a photo was taken out of everything the site publishes.
 *
 * Every photo container except `metadata` and `incoming` can be read by anyone
 * who has a file's URL, and the lightbox links straight to the full-size
 * files. Phones, and cameras paired with one, record where each frame was
 * taken to within a few metres, so a photo taken at home would publish the
 * address.
 *
 * exiftool deletes the EXIF GPS block and any XMP geotags. It rewrites only the
 * metadata: the image data stays byte-identical, and camera, lens, exposure and
 * capture time stay for the lightbox and the photo pipeline. It runs in CI:
 * uploads land in the private `incoming` container and the build removes the
 * location before publishing them (scripts/prebuild.mjs), so nothing here is
 * needed on your own machine.
 *
 *   node scripts/location.mjs check <file>...
 *       list the files that record a location
 *   node scripts/location.mjs strip <file>...
 *       remove it, in place (needs exiftool)
 *   node scripts/location.mjs blobs [--apply] [--fail-if-found]
 *       find photos in the public containers (originals, derivatives,
 *       hobby-media, and Astro's copies in variants) that still record a
 *       location; --apply removes it, keeping each file's URL, headers and
 *       metadata (blob soft delete keeps the old bytes for 7 days, privately).
 *       The "Photo locations" workflow runs this in GitHub Actions, where the
 *       log shows counts only.
 *
 * The blob scan signs in like the other scripts (`az login` locally, OIDC in
 * Actions) and reads the storage account from blobHost in site.config.ts, or
 * AZURE_STORAGE_ACCOUNT.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import exifr from "exifr";

/** exiftool arguments that delete every location tag: EXIF GPS and XMP geotags. */
export const STRIP_ARGS = ["-gps:all=", "-xmp:geotag="];

/**
 * Containers anyone can read by URL. `variants` matters too: Astro copies some
 * originals byte for byte next to the resized files, metadata and all.
 */
export const PUBLIC_CONTAINERS = [
  "originals",
  "derivatives",
  "hobby-media",
  "variants",
];

export const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
  ".arw",
  ".nef",
  ".cr2",
  ".cr3",
  ".dng",
  ".raf",
]);

export const INSTALL_HINT =
  "Install exiftool (sudo apt install libimage-exiftool-perl, or brew install exiftool) and run this again.";

const LARGE_HEADER_EXTS = new Set([
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".arw",
  ".nef",
  ".cr2",
  ".cr3",
  ".dng",
  ".raf",
]);

/**
 * How much of a file the blob scan reads. JPEG, PNG and WebP keep their
 * metadata in the first segments (a JPEG's EXIF and XMP blocks are at most
 * 64 KB each); HEIC and RAW files can put it further in.
 */
export function probeBytes(ext) {
  return LARGE_HEADER_EXTS.has(ext) ? 2 * 1024 * 1024 : 128 * 1024;
}

let cachedVersion;

/** The installed exiftool's version, or null when it isn't on PATH. */
export function exiftoolVersion() {
  if (cachedVersion === undefined) {
    const result = spawnSync("exiftool", ["-ver"], { encoding: "utf8" });
    cachedVersion = result.status === 0 ? result.stdout.trim() : null;
  }
  return cachedVersion;
}

// exiftool reads an argument starting with "-" as an option, and an argfile
// line starting with "#" as a comment. Absolute paths are neither.
function fileArg(path) {
  return resolve(path);
}

/** True when parsed metadata (exifr output) holds any GPS or geotag field. */
export function metadataHasLocation(meta) {
  if (!meta || typeof meta !== "object") return false;
  return Object.keys(meta).some(
    (key) => /^GPS/i.test(key) || key === "latitude" || key === "longitude",
  );
}

async function exifrHasLocation(input) {
  const meta = await exifr
    .parse(input, {
      tiff: true,
      ifd0: true,
      gps: true,
      xmp: true,
      exif: false,
      iptc: false,
      icc: false,
      jfif: false,
      ihdr: false,
    })
    .catch(() => null);
  return metadataHasLocation(meta);
}

/**
 * The subset of `paths` that record where they were taken. exiftool reads every
 * format here, so it's used when installed, in one process for the whole list;
 * otherwise exifr, which covers JPEG, HEIC, PNG, TIFF and the TIFF-based RAW
 * formats.
 */
export async function filesWithLocation(paths) {
  const located = new Set();
  const unchecked = new Set(paths);
  if (paths.length > 0 && exiftoolVersion()) {
    const byArg = new Map(paths.map((path) => [fileArg(path), path]));
    const dir = await mkdtemp(join(tmpdir(), "location-"));
    try {
      const argfile = join(dir, "files.txt");
      await writeFile(argfile, `${[...byArg.keys()].join("\n")}\n`);
      const result = spawnSync(
        "exiftool",
        ["-json", "-q", "-q", "-m", "-gps:all", "-xmp:gps*", "-@", argfile],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );
      const rows = result.stdout?.trim() ? JSON.parse(result.stdout) : [];
      for (const row of rows) {
        const path = byArg.get(row.SourceFile);
        if (path === undefined) continue;
        unchecked.delete(path);
        if (metadataHasLocation(row)) located.add(path);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  // Anything exiftool couldn't read, or every file when it isn't installed.
  for (const path of unchecked) {
    if (await exifrHasLocation(path)) located.add(path);
  }
  return located;
}

/** Whether one file (path) or buffer records where it was taken. */
export async function hasLocation(input) {
  if (typeof input === "string") {
    return (await filesWithLocation([input])).has(input);
  }
  return exifrHasLocation(input);
}

/**
 * Remove the location from `src`, writing the result to `dest` (which must not
 * exist yet) or, without one, back over `src`. Throws when exiftool is missing
 * or fails, so a caller never publishes a file it thinks is clean.
 */
export function stripLocation(src, dest) {
  if (!exiftoolVersion())
    throw new Error(`exiftool is needed. ${INSTALL_HINT}`);
  const target = dest ? ["-o", fileArg(dest)] : ["-overwrite_original"];
  const result = spawnSync(
    "exiftool",
    ["-q", "-q", "-m", ...STRIP_ARGS, ...target, fileArg(src)],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    const reason = (result.stderr || result.error?.message || "").trim();
    throw new Error(
      `exiftool couldn't remove the location from ${basename(src)}${reason ? `: ${reason}` : ""}`,
    );
  }
}

async function storageService() {
  const { storageAccountFromSite } = await import("./photos/settings.mjs");
  const account = process.env.AZURE_STORAGE_ACCOUNT || storageAccountFromSite();
  if (!account) {
    throw new Error(
      "Set AZURE_STORAGE_ACCOUNT, or blobHost in site.config.ts, to your storage account.",
    );
  }
  const { BlobServiceClient } = await import("@azure/storage-blob");
  const { DefaultAzureCredential } = await import("@azure/identity");
  return new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    new DefaultAzureCredential(),
  );
}

async function stripBlob(container, name, dir) {
  const ext = extname(name).toLowerCase();
  const src = join(dir, `full${ext}`);
  const dest = join(dir, `clean${ext}`);
  await rm(src, { force: true });
  await rm(dest, { force: true });

  const client = container.getBlockBlobClient(name);
  const props = await client.getProperties();
  const conditions = { ifMatch: props.etag };
  await client.downloadToFile(src, 0, undefined, { conditions });
  stripLocation(src, dest);
  if (await hasLocation(dest)) {
    throw new Error(`${name} still records a location after stripping.`);
  }
  // Same headers and metadata (derivatives keep their source-etag), and only
  // if nobody replaced the blob in the meantime.
  await client.uploadFile(dest, {
    blobHTTPHeaders: {
      blobContentType: props.contentType,
      blobCacheControl: props.cacheControl,
      blobContentDisposition: props.contentDisposition,
      blobContentEncoding: props.contentEncoding,
      blobContentLanguage: props.contentLanguage,
    },
    metadata: props.metadata,
    conditions,
  });
}

async function scanBlobs({ apply, failIfFound }) {
  // Public Actions logs list counts only: a file name next to "records a
  // location" would point straight at it until the run has cleaned it.
  const quiet = process.env.GITHUB_ACTIONS === "true";
  if (apply && !exiftoolVersion()) {
    throw new Error(`--apply needs exiftool. ${INSTALL_HINT}`);
  }
  const service = await storageService();
  const dir = await mkdtemp(join(tmpdir(), "location-"));
  let scanned = 0;
  const found = [];
  try {
    for (const containerName of PUBLIC_CONTAINERS) {
      const container = service.getContainerClient(containerName);
      const before = scanned;
      const foundBefore = found.length;
      process.stdout.write(`Scanning ${containerName}... `);
      let batch = [];
      const flush = async () => {
        await Promise.all(
          batch.map(async (item) =>
            writeFile(
              item.probe,
              await container
                .getBlobClient(item.name)
                .downloadToBuffer(0, item.bytes),
            ),
          ),
        );
        const located = await filesWithLocation(
          batch.map((item) => item.probe),
        );
        for (const item of batch) {
          if (!located.has(item.probe)) continue;
          found.push(`${containerName}/${item.name}`);
          if (apply) await stripBlob(container, item.name, dir);
        }
        await Promise.all(batch.map((item) => rm(item.probe, { force: true })));
        batch = [];
      };
      for await (const blob of container.listBlobsFlat()) {
        const ext = extname(blob.name).toLowerCase();
        const size = blob.properties.contentLength ?? 0;
        if (!IMAGE_EXTS.has(ext) || size === 0) continue;
        // Astro writes every resized variant as fresh WebP or JPEG with no
        // metadata; only its byte-for-byte copies of originals can carry any.
        if (containerName === "variants" && ext === ".webp") continue;
        scanned++;
        batch.push({
          name: blob.name,
          probe: join(dir, `probe-${scanned}${ext}`),
          bytes: Math.min(size, probeBytes(ext)),
        });
        if (batch.length >= 50) await flush();
      }
      await flush();
      const here = found.length - foundBefore;
      console.log(
        `${scanned - before} photo(s)${here ? `, ${here} with a location` : ""}`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    `Scanned ${scanned} photo(s) in ${PUBLIC_CONTAINERS.join(", ")}.`,
  );
  if (found.length === 0) {
    console.log("None record a location.");
    return;
  }
  if (!quiet) for (const name of found) console.log(`  ${name}`);
  if (apply) {
    console.log(
      `Removed the location from ${found.length} photo(s). The next build picks up the new files.`,
    );
    // Something got past the upload and build checks; say so loudly.
    if (failIfFound) process.exitCode = 1;
  } else {
    console.log(
      `${found.length} photo(s) record a location. Run again with --apply to remove it.`,
    );
    process.exitCode = 1;
  }
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "check") {
    const located = await filesWithLocation(rest);
    for (const file of rest) if (located.has(file)) console.log(file);
    if (located.size > 0) process.exitCode = 1;
  } else if (command === "strip") {
    for (const file of await filesWithLocation(rest)) stripLocation(file);
  } else if (command === "blobs") {
    await scanBlobs({
      apply: rest.includes("--apply"),
      failIfFound: rest.includes("--fail-if-found"),
    });
  } else {
    console.error(
      "Usage: node scripts/location.mjs check|strip <file>... | blobs [--apply] [--fail-if-found]",
    );
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
