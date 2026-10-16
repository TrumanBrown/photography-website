import { describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ADMIN_THUMB_SIZES,
  BUILD_COPY_VERSION,
  buildCopyIsCurrent,
  buildCopyWidth,
  generateAdminThumbs,
  hashKey,
  makeBuildCopy,
  pruneCache,
  reorderByList,
  restoreBuildCopy,
  sanitizeSlug,
  targetFileForBlob,
  uprightSize,
  validateImageTargets,
  validateSessionSidecar,
  validateSessionSlugs,
} from "./prebuild.mjs";

describe("prebuild session slugs", () => {
  it("preserves the established URL format", () => {
    expect(sanitizeSlug("June Sauk Mtn_and Nearby")).toBe(
      "june-sauk-mtn_and-nearby",
    );
  });

  it("rejects distinct folders that map to the same public slug", () => {
    expect(() => validateSessionSlugs(["Hiking 2025", "Hiking-2025"])).toThrow(
      'both map to "hiking-2025"',
    );
  });

  it("rejects a folder name that maps to an empty slug", () => {
    expect(() => validateSessionSlugs(["東京"])).toThrow(
      "does not contain any characters usable in a public URL",
    );
  });

  it("rejects slugs too long for reliable local files and public URLs", () => {
    expect(() => validateSessionSlugs(["a".repeat(201)])).toThrow(
      "the limit is 200",
    );
  });
});

describe("prebuild image targets", () => {
  it("converts non-web source extensions to JPEG filenames", () => {
    expect(targetFileForBlob({ base: "DSC0123.ARW", ext: ".arw" })).toBe(
      "DSC0123.jpg",
    );
    expect(targetFileForBlob({ base: "IMG_0042.HEIC", ext: ".heic" })).toBe(
      "IMG_0042.jpg",
    );
    expect(targetFileForBlob({ base: "ready.webp", ext: ".webp" })).toBe(
      "ready.webp",
    );
  });

  it("rejects source files that would overwrite the same generated image", () => {
    expect(() =>
      validateImageTargets(
        [
          { base: "DSC0123.ARW", ext: ".arw" },
          { base: "DSC0123.jpg", ext: ".jpg" },
        ],
        "raw-plus-jpeg",
      ),
    ).toThrow('both produce "DSC0123.jpg"');
  });

  it("applies ordering and captions written against converted source names", () => {
    const images = [{ file: "other.jpg" }, { file: "DSC0123.jpg" }];
    const ordered = reorderByList(
      images,
      [{ file: "DSC0123.ARW", caption: "Converted RAW" }],
      new Map([["DSC0123.ARW", "DSC0123.jpg"]]),
    );

    expect(ordered.map((image) => image.file)).toEqual([
      "DSC0123.jpg",
      "other.jpg",
    ]);
    expect(ordered[0].caption).toBe("Converted RAW");
  });
});

describe("prebuild cache keys", () => {
  it("does not alias known collisions from the previous 32-bit hash", () => {
    expect(hashKey("Aa")).not.toBe(hashKey("BB"));
  });

  it("is deterministic and filesystem-safe", () => {
    expect(hashKey("originals/example.jpg@etag@target.jpg")).toMatch(
      /^[a-f0-9]{64}\.bin$/,
    );
    expect(hashKey("same input")).toBe(hashKey("same input"));
  });
});

describe("session sidecar validation", () => {
  it("accepts the documented metadata shape", () => {
    const sidecar = {
      title: "Spring trip",
      date: "2026-04-18",
      location: "Coast",
      description: "",
      cover: "DSC0123.ARW",
      banner: "DSC0124.jpg",
      order: 2,
      images: [{ file: "DSC0123.ARW", caption: "Sunrise" }, "DSC0124.jpg"],
    };
    expect(validateSessionSidecar(sidecar)).toBe(sidecar);
  });

  it("rejects a banner that is not a string", () => {
    expect(() => validateSessionSidecar({ banner: 7 })).toThrow(
      "banner must be a string",
    );
  });

  it("rejects invalid dates and field types with actionable paths", () => {
    expect(() =>
      validateSessionSidecar(
        { title: "", date: "2025-02-29", order: "first", images: [null] },
        "trip/_session.json",
      ),
    ).toThrow(
      /trip\/_session\.json is invalid:[\s\S]*date must be a real ISO calendar date[\s\S]*order must be an integer[\s\S]*images\[0\]/,
    );
  });

  it("rejects non-object JSON values", () => {
    expect(() => validateSessionSidecar(null)).toThrow(
      "must contain a JSON object",
    );
    expect(() => validateSessionSidecar([])).toThrow(
      "must contain a JSON object",
    );
  });

  it("rejects captions longer than the public content limit", () => {
    expect(() =>
      validateSessionSidecar({
        images: [{ file: "DSC0123.jpg", caption: "x".repeat(501) }],
      }),
    ).toThrow("caption must be at most 500 characters");
  });
});

describe("image sizes", () => {
  it("records a portrait the camera stored sideways the way it's shown", () => {
    expect(uprightSize({ width: 6192, height: 4128, orientation: 8 })).toEqual({
      width: 4128,
      height: 6192,
    });
    expect(uprightSize({ width: 5712, height: 4284, orientation: 6 })).toEqual({
      width: 4284,
      height: 5712,
    });
  });

  it("leaves upright, upside-down, and untagged frames alone", () => {
    expect(uprightSize({ width: 6192, height: 4128, orientation: 1 })).toEqual({
      width: 6192,
      height: 4128,
    });
    expect(uprightSize({ width: 6192, height: 4128, orientation: 3 })).toEqual({
      width: 6192,
      height: 4128,
    });
    expect(uprightSize({ width: 4128, height: 6192 })).toEqual({
      width: 4128,
      height: 6192,
    });
  });

  it("reads the orientation sharp reports for a real JPEG", async () => {
    const { default: sharp } = await import("sharp");
    const sideways = await sharp({
      create: {
        width: 300,
        height: 200,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(uprightSize(await sharp(sideways).metadata())).toEqual({
      width: 200,
      height: 300,
    });
  });

  it("reports nothing for a file sharp couldn't size", () => {
    expect(uprightSize({})).toEqual({ width: 0, height: 0 });
  });
});

/** Stand-in for a blob container that records what the build would upload. */
function fakeContainer(existing = {}) {
  const uploads = [];
  return {
    uploads,
    getBlockBlobClient(name) {
      return {
        async getProperties() {
          if (!(name in existing)) {
            const error = new Error("BlobNotFound");
            error.statusCode = 404;
            throw error;
          }
          return { metadata: { width: String(existing[name]) } };
        },
        async upload(buffer, length, options) {
          uploads.push({ name, buffer, length, metadata: options.metadata });
        },
      };
    },
  };
}

describe("admin thumbnails", () => {
  const slug = "costa-rica-2026";
  const file = "DSC0001.JPEG";
  let imagesDir;

  beforeAll(async () => {
    const { default: sharp } = await import("sharp");
    imagesDir = await mkdtemp(join(tmpdir(), "admin-thumbs-"));
    // A 3000px wide frame, big enough for both admin widths to downscale from.
    const source = await sharp({
      create: {
        width: 3000,
        height: 2000,
        channels: 3,
        background: { r: 40, g: 90, b: 60 },
      },
    })
      .jpeg()
      .toBuffer();
    await writeFile(join(imagesDir, file), source);
  });

  afterAll(async () => {
    await rm(imagesDir, { recursive: true, force: true });
  });

  it("writes one JPEG per admin width, stamped with the width it used", async () => {
    const container = fakeContainer();
    await generateAdminThumbs({
      slug,
      imagesDir,
      images: [{ file }],
      containerClient: container,
    });

    expect(container.uploads.map((u) => u.name)).toEqual([
      `thumbs/${slug}/DSC0001.jpg`,
      `thumbs-lg/${slug}/DSC0001.jpg`,
    ]);
    expect(container.uploads.map((u) => u.metadata)).toEqual([
      { width: "512" },
      { width: "1280" },
    ]);

    const { default: sharp } = await import("sharp");
    const widths = [];
    for (const upload of container.uploads) {
      widths.push((await sharp(upload.buffer).metadata()).width);
    }
    expect(widths).toEqual(ADMIN_THUMB_SIZES.map((size) => size.width));
  });

  it("skips what is already big enough and reruns what is not", async () => {
    const container = fakeContainer({
      [`thumbs/${slug}/DSC0001.jpg`]: 512,
      [`thumbs-lg/${slug}/DSC0001.jpg`]: 120,
    });
    await generateAdminThumbs({
      slug,
      imagesDir,
      images: [{ file }],
      containerClient: container,
    });

    expect(container.uploads.map((u) => u.name)).toEqual([
      `thumbs-lg/${slug}/DSC0001.jpg`,
    ]);
  });

  it("never fails a build over one unreadable photograph", async () => {
    const container = fakeContainer();
    await generateAdminThumbs({
      slug,
      imagesDir,
      images: [{ file: "missing.JPEG" }],
      containerClient: container,
    });
    expect(container.uploads).toEqual([]);
  });
});

describe("build copy size", () => {
  it("keeps the photo's exact shape", () => {
    expect(buildCopyWidth(6192, 4128)).toBe(2400);
    expect(buildCopyWidth(4128, 6192)).toBe(2400);
    expect(buildCopyWidth(4032, 3024)).toBe(2400);
    // 115:129, so the nearest exact width is a few pixels past 2400.
    expect(buildCopyWidth(3680, 4128)).toBe(2415);
  });

  it("settles for 2400 when no exact width is close", () => {
    expect(buildCopyWidth(6191, 4127)).toBe(2400);
  });

  it("leaves a photo that's already small enough alone", () => {
    expect(buildCopyWidth(2400, 1600)).toBeNull();
    expect(buildCopyWidth(1808, 1205)).toBeNull();
    // Its nearest exact width is its own.
    expect(buildCopyWidth(2450, 1633)).toBeNull();
  });

  it("makes no copy of a photo sharp couldn't size", () => {
    expect(buildCopyWidth(0, 0)).toBeNull();
    expect(buildCopyWidth(6192, 0)).toBeNull();
    expect(buildCopyWidth(undefined, undefined)).toBeNull();
  });
});

describe("build copy freshness", () => {
  it("trusts a copy made from the same source with the current settings", () => {
    expect(
      buildCopyIsCurrent(
        { sourceetag: "0x8DE1", buildcopy: BUILD_COPY_VERSION },
        '"0x8DE1"',
      ),
    ).toBe(true);
  });

  it("refuses a copy of an older source, older settings, or no record", () => {
    expect(
      buildCopyIsCurrent(
        { sourceetag: "0x8DE0", buildcopy: BUILD_COPY_VERSION },
        '"0x8DE1"',
      ),
    ).toBe(false);
    expect(
      buildCopyIsCurrent({ sourceetag: "0x8DE1", buildcopy: "0" }, '"0x8DE1"'),
    ).toBe(false);
    expect(buildCopyIsCurrent(undefined, '"0x8DE1"')).toBe(false);
  });
});

/** Stand-in for the blob that holds one photo's build copy. */
function fakeCopyBlob({ metadata, bytes, status, downloadStatus } = {}) {
  const calls = { downloads: [], uploads: [] };
  return {
    name: "build-copies/costa-rica-2026/DSC0001.JPEG",
    calls,
    async getProperties() {
      if (status) {
        const error = new Error("BlobNotFound");
        error.statusCode = status;
        throw error;
      }
      return { metadata, etag: '"0xC0FFEE"' };
    },
    async downloadToFile(path, offset, count, options) {
      calls.downloads.push(options?.conditions?.ifMatch);
      if (downloadStatus) {
        await writeFile(path, Buffer.from("partial"));
        const error = new Error("ConditionNotMet");
        error.statusCode = downloadStatus;
        throw error;
      }
      await writeFile(path, bytes);
    },
    async uploadData(data, options) {
      calls.uploads.push({ data, options });
    },
  };
}

describe("making a build copy", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "build-copy-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A camera JPEG stored sideways, the way a portrait comes off a Sony. */
  async function sidewaysPhoto(path) {
    const { default: sharp } = await import("sharp");
    await sharp({
      create: {
        width: 4800,
        height: 3200,
        channels: 3,
        background: { r: 40, g: 90, b: 60 },
      },
    })
      .jpeg()
      .withExif({
        IFD0: { Make: "SONY", Model: "ILCE-6700" },
        IFD2: { DateTimeOriginal: "2026:06:21 11:55:46" },
      })
      .withMetadata({ orientation: 6 })
      .toFile(path);
    return uprightSize(await sharp(path).metadata());
  }

  it("shrinks the photo upright, keeps its EXIF, and uploads it", async () => {
    const localPath = join(dir, "DSC0001.JPEG");
    const cacheFile = join(dir, "cache", "copy.bin");
    const { width, height } = await sidewaysPhoto(localPath);
    const client = fakeCopyBlob();

    await makeBuildCopy({
      localPath,
      width,
      height,
      client,
      sourceEtag: '"0x8DE1"',
      cacheFile,
    });

    const { default: sharp } = await import("sharp");
    const meta = await sharp(localPath).metadata();
    expect([meta.width, meta.height]).toEqual([2400, 3600]);
    expect(meta.orientation ?? 1).toBe(1);
    const { default: exifr } = await import("exifr");
    const exif = await exifr.parse(localPath, {
      tiff: true,
      ifd0: true,
      exif: true,
    });
    expect(exif.Model).toBe("ILCE-6700");
    expect(exif.DateTimeOriginal).toBeInstanceOf(Date);

    expect(client.calls.uploads).toHaveLength(1);
    const [{ data, options }] = client.calls.uploads;
    expect(options.metadata).toEqual({
      sourceetag: "0x8DE1",
      buildcopy: BUILD_COPY_VERSION,
    });
    expect(options.blobHTTPHeaders.blobContentType).toBe("image/jpeg");
    expect(Buffer.compare(data, await readFile(localPath))).toBe(0);
    expect(Buffer.compare(await readFile(cacheFile), data)).toBe(0);
  });

  it("only swaps the working copy when there's nowhere to keep it", async () => {
    const localPath = join(dir, "DSC0001.JPEG");
    const { width, height } = await sidewaysPhoto(localPath);

    await makeBuildCopy({ localPath, width, height });

    const { default: sharp } = await import("sharp");
    expect((await sharp(localPath).metadata()).width).toBe(2400);
    expect(await readdir(dir)).toEqual(["DSC0001.JPEG"]);
  });

  it("uses a photo that's already small as its own copy", async () => {
    const { default: sharp } = await import("sharp");
    const localPath = join(dir, "small.JPEG");
    await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#345" },
    })
      .jpeg()
      .toFile(localPath);
    const before = await readFile(localPath);
    const client = fakeCopyBlob();

    await makeBuildCopy({
      localPath,
      width: 1200,
      height: 800,
      client,
      sourceEtag: '"0x8DE1"',
      cacheFile: join(dir, "copy.bin"),
    });

    expect(Buffer.compare(await readFile(localPath), before)).toBe(0);
    expect(Buffer.compare(client.calls.uploads[0].data, before)).toBe(0);
  });
});

describe("restoring a build copy", () => {
  let dir;
  let localPath;
  let cacheFile;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "restore-copy-"));
    localPath = join(dir, "images", "DSC0001.JPEG");
    cacheFile = join(dir, "cache", "copy.bin");
    await mkdir(join(dir, "images"), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("takes the cached copy without asking Blob", async () => {
    await mkdir(join(dir, "cache"), { recursive: true });
    await writeFile(cacheFile, "cached copy");
    const client = fakeCopyBlob({ status: 500 });

    await expect(
      restoreBuildCopy({ client, etag: '"0x8DE1"', localPath, cacheFile }),
    ).resolves.toBe(true);
    expect(await readFile(localPath, "utf8")).toBe("cached copy");
    expect(client.calls.downloads).toEqual([]);
  });

  it("downloads a current copy and keeps it in the cache", async () => {
    const client = fakeCopyBlob({
      metadata: { sourceetag: "0x8DE1", buildcopy: BUILD_COPY_VERSION },
      bytes: Buffer.from("copy from blob"),
    });

    await expect(
      restoreBuildCopy({ client, etag: '"0x8DE1"', localPath, cacheFile }),
    ).resolves.toBe(true);
    expect(await readFile(localPath, "utf8")).toBe("copy from blob");
    expect(await readFile(cacheFile, "utf8")).toBe("copy from blob");
    // Only the copy it checked, not one replaced in between.
    expect(client.calls.downloads).toEqual(['"0xC0FFEE"']);
  });

  it("never downloads a copy of an older source", async () => {
    const client = fakeCopyBlob({
      metadata: { sourceetag: "0x8DE0", buildcopy: BUILD_COPY_VERSION },
      bytes: Buffer.from("stale"),
    });

    await expect(
      restoreBuildCopy({ client, etag: '"0x8DE1"', localPath, cacheFile }),
    ).resolves.toBe(false);
    expect(client.calls.downloads).toEqual([]);
    expect(existsSync(localPath)).toBe(false);
  });

  it("falls back to the full photo when there's no copy yet", async () => {
    const client = fakeCopyBlob({ status: 404 });

    await expect(
      restoreBuildCopy({ client, etag: '"0x8DE1"', localPath, cacheFile }),
    ).resolves.toBe(false);
  });

  it("leaves nothing half-downloaded in the cache", async () => {
    const client = fakeCopyBlob({
      metadata: { sourceetag: "0x8DE1", buildcopy: BUILD_COPY_VERSION },
      downloadStatus: 412,
    });

    await expect(
      restoreBuildCopy({ client, etag: '"0x8DE1"', localPath, cacheFile }),
    ).resolves.toBe(false);
    expect(await readdir(join(dir, "cache"))).toEqual([]);
    expect(existsSync(localPath)).toBe(false);
  });
});

describe("prebuild cache pruning", () => {
  it("keeps only what this build used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prune-"));
    try {
      for (const name of ["full-photo.bin", "copy.bin", "old-copy.bin"]) {
        await writeFile(join(dir, name), name);
      }
      await expect(pruneCache(dir, new Set(["copy.bin"]))).resolves.toBe(2);
      expect(await readdir(dir)).toEqual(["copy.bin"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does nothing when there's no cache yet", async () => {
    await expect(
      pruneCache(join(tmpdir(), "no-such-prebuild-cache"), new Set()),
    ).resolves.toBe(0);
  });
});
