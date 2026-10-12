import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  derivativeIsCurrent,
  hashKey,
  keepLocationsPrivate,
  publishIncoming,
} from "./prebuild.mjs";

// Stand-ins for the Azure containers: they keep each blob's bytes, headers and
// metadata, and record every write so the tests can check what went public.
function fakeContainer(containerName, blobs) {
  const writes = [];
  const metadataSets = [];
  const deletes = [];
  const blobClient = (name) => ({
    async downloadToBuffer(offset, count) {
      return blobs[name].data.subarray(offset, offset + count);
    },
    async downloadToFile(path, _offset, _count, options) {
      if (!blobs[name]) {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
      }
      if (
        options?.conditions?.ifMatch &&
        options.conditions.ifMatch !== blobs[name].etag
      ) {
        throw Object.assign(new Error("condition not met"), {
          statusCode: 412,
        });
      }
      await writeFile(path, blobs[name].data);
    },
    async getProperties(options) {
      const blob = blobs[name];
      if (
        options?.conditions?.ifMatch &&
        options.conditions.ifMatch !== blob.etag
      ) {
        throw Object.assign(new Error("condition not met"), {
          statusCode: 412,
        });
      }
      return { ...blob.headers, metadata: blob.metadata, etag: blob.etag };
    },
    async setMetadata(metadata) {
      metadataSets.push({ name, metadata });
      blobs[name].metadata = metadata;
    },
    async deleteIfExists(options) {
      if (!blobs[name]) return { succeeded: false };
      if (
        options?.conditions?.ifMatch &&
        options.conditions.ifMatch !== blobs[name].etag
      ) {
        throw Object.assign(new Error("condition not met"), {
          statusCode: 412,
        });
      }
      delete blobs[name];
      deletes.push(name);
      return { succeeded: true };
    },
  });
  return {
    containerName,
    blobs,
    writes,
    metadataSets,
    deletes,
    async *listBlobsFlat() {
      for (const [name, blob] of Object.entries(blobs)) {
        yield {
          name,
          properties: {
            etag: blob.etag,
            contentType: blob.headers?.contentType,
            contentLength: blob.data.length,
          },
        };
      }
    },
    getBlobClient: blobClient,
    getBlockBlobClient: (name) => ({
      ...blobClient(name),
      async uploadFile(path, options) {
        if (!options.conditions?.ifMatch) {
          // An unconditional upload creates or replaces the blob.
          blobs[name] = {
            data: await readFile(path),
            etag: `"new-${writes.length + 1}"`,
            headers: {
              contentType: options.blobHTTPHeaders?.blobContentType,
              cacheControl: options.blobHTTPHeaders?.blobCacheControl,
            },
            metadata: options.metadata ?? {},
          };
          writes.push({
            name,
            headers: options.blobHTTPHeaders,
            metadata: options.metadata,
          });
          return { etag: blobs[name].etag };
        }
        const blob = blobs[name];
        if (!blob || options.conditions.ifMatch !== blob.etag) {
          throw Object.assign(new Error("condition not met"), {
            statusCode: 412,
          });
        }
        blob.data = await readFile(path);
        blob.etag = `"${blob.etag.replace(/"/g, "")}-clean"`;
        blob.metadata = options.metadata;
        writes.push({
          name,
          headers: options.blobHTTPHeaders,
          metadata: options.metadata,
        });
        return { etag: blob.etag };
      },
    }),
  };
}

// Location detection and stripping without exiftool: a file "records a
// location" while its text contains GPS.
function fakeTools({ installed = true } = {}) {
  const stripped = [];
  return {
    stripped,
    exiftoolVersion: () => (installed ? "13.59" : null),
    async filesWithLocation(paths) {
      const found = new Set();
      for (const path of paths) {
        if ((await readFile(path, "utf8")).includes("GPS")) found.add(path);
      }
      return found;
    },
    stripLocation(src, dest) {
      stripped.push(dest ?? src);
      return readFile(src, "utf8").then((text) =>
        writeFile(dest ?? src, text.replace("GPS", "---")),
      );
    },
  };
}

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prebuild-location-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function photoItem(
  name,
  text,
  { willConvert = false, ext = ".jpg" } = {},
) {
  const localPath = join(dir, name.replace(/\W/g, "_") + ".jpg");
  await writeFile(localPath, text);
  return {
    blob: { name, etag: '"e1"', ext, contentLength: 100 },
    localPath,
    targetFile: name
      .split("/")
      .pop()
      .replace(/\.\w+$/, ".jpg"),
    willConvert,
    derivName: name.replace(/\.\w+$/, ".jpg"),
  };
}

function manifestFor(items, previous = {}) {
  return {
    manifest: previous,
    nextManifest: {
      blobs: Object.fromEntries(
        items.map((item) => [
          item.blob.name,
          { etag: item.blob.etag, target: item.targetFile },
        ]),
      ),
    },
  };
}

describe("keepLocationsPrivate", () => {
  it("cleans a published original and its working copy, keeping its headers", async () => {
    const item = await photoItem("trip/IMG_1.JPG", "pixels GPS");
    const originals = fakeContainer("originals", {
      "trip/IMG_1.JPG": {
        data: Buffer.from("pixels GPS"),
        etag: '"e1"',
        headers: {
          contentType: "image/jpeg",
          cacheControl: "public, max-age=31536000, immutable",
        },
        metadata: {},
      },
    });
    const derivatives = fakeContainer("derivatives", {});
    const tools = fakeTools();
    const { manifest, nextManifest } = manifestFor([item]);
    // The copy cached under the old ETag, as prebuild leaves it.
    const stale = join(dir, hashKey(`trip/IMG_1.JPG@"e1"@IMG_1.jpg`));
    await writeFile(stale, "pixels GPS");

    await keepLocationsPrivate({
      items: [item],
      manifest,
      nextManifest,
      originalsClient: originals,
      derivativesClient: derivatives,
      cacheDir: dir,
      tools,
    });

    expect(await readFile(item.localPath, "utf8")).toBe("pixels ---");
    expect(originals.writes).toEqual([
      {
        name: "trip/IMG_1.JPG",
        headers: expect.objectContaining({
          blobContentType: "image/jpeg",
          blobCacheControl: "public, max-age=31536000, immutable",
        }),
        metadata: {},
      },
    ]);
    expect(nextManifest.blobs["trip/IMG_1.JPG"]).toMatchObject({
      etag: '"e1-clean"',
      private: true,
    });
    // Cached under the new ETag, so the next build doesn't download it again.
    const cached = join(dir, hashKey(`trip/IMG_1.JPG@"e1-clean"@IMG_1.jpg`));
    expect(await readFile(cached, "utf8")).toBe("pixels ---");
    expect(existsSync(stale)).toBe(false);
  });

  it("cleans a HEIC source the site never links, and keeps its derivative matched to it", async () => {
    const item = await photoItem("trip/IMG_2.HEIC", "clean derivative", {
      willConvert: true,
      ext: ".heic",
    });
    const originals = fakeContainer("originals", {
      "trip/IMG_2.HEIC": {
        data: Buffer.from("heic GPS"),
        etag: '"e1"',
        headers: { contentType: "image/heic" },
        metadata: {},
      },
    });
    const derivatives = fakeContainer("derivatives", {
      "trip/IMG_2.jpg": {
        data: Buffer.from("clean derivative"),
        etag: '"d1"',
        headers: {},
        metadata: { sourceetag: "e1", derivative: "2" },
      },
    });
    const tools = fakeTools();
    const { manifest, nextManifest } = manifestFor([item]);

    await keepLocationsPrivate({
      items: [item],
      manifest,
      nextManifest,
      originalsClient: originals,
      derivativesClient: derivatives,
      cacheDir: dir,
      tools,
    });

    expect(originals.writes.map((write) => write.name)).toEqual([
      "trip/IMG_2.HEIC",
    ]);
    expect(derivatives.writes).toEqual([]);
    // Matched to the cleaned source and still marked as made by the current
    // conversion, so it isn't converted again.
    expect(derivatives.metadataSets).toEqual([
      {
        name: "trip/IMG_2.jpg",
        metadata: { sourceetag: "e1-clean", derivative: "2" },
      },
    ]);
    expect(nextManifest.blobs["trip/IMG_2.HEIC"]).toMatchObject({
      etag: '"e1-clean"',
      private: true,
    });
  });

  it("warns, rather than stopping the build, when a published source can't be cleaned", async () => {
    const item = await photoItem("trip/IMG_8.HEIC", "clean derivative", {
      willConvert: true,
      ext: ".heic",
    });
    const originals = fakeContainer("originals", {
      "trip/IMG_8.HEIC": {
        data: Buffer.from("heic GPS"),
        etag: '"e1"',
        headers: {},
        metadata: {},
      },
    });
    const derivatives = fakeContainer("derivatives", {});
    const tools = {
      ...fakeTools(),
      stripLocation() {
        throw new Error("unsupported HEIC variant");
      },
    };
    // Published by an earlier build, so its derivative's link is already out.
    const { manifest, nextManifest } = manifestFor([item], {
      "trip/IMG_8.HEIC": { etag: '"e1"', target: "IMG_8.jpg" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await keepLocationsPrivate({
      items: [item],
      manifest,
      nextManifest,
      originalsClient: originals,
      derivativesClient: derivatives,
      cacheDir: dir,
      tools,
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("trip/IMG_8.HEIC"),
    );
    warn.mockRestore();
    expect(originals.writes).toEqual([]);
    expect(derivatives.metadataSets).toEqual([]);
    expect(nextManifest.blobs["trip/IMG_8.HEIC"]).toEqual({
      etag: '"e1"',
      target: "IMG_8.jpg",
    });
  });

  it("re-uploads a derivative that carries a position", async () => {
    const item = await photoItem("trip/DSC_3.ARW", "derivative GPS", {
      willConvert: true,
      ext: ".arw",
    });
    const originals = fakeContainer("originals", {
      "trip/DSC_3.ARW": {
        data: Buffer.from("raw without position"),
        etag: '"e1"',
        headers: {},
        metadata: {},
      },
    });
    const derivatives = fakeContainer("derivatives", {
      "trip/DSC_3.jpg": {
        data: Buffer.from("derivative GPS"),
        etag: '"d1"',
        headers: { contentType: "image/jpeg" },
        metadata: { sourceetag: "e1" },
      },
    });
    const { manifest, nextManifest } = manifestFor([item]);

    await keepLocationsPrivate({
      items: [item],
      manifest,
      nextManifest,
      originalsClient: originals,
      derivativesClient: derivatives,
      cacheDir: dir,
      tools: fakeTools(),
    });

    expect(originals.writes).toEqual([]);
    expect(derivatives.writes).toEqual([
      expect.objectContaining({
        name: "trip/DSC_3.jpg",
        metadata: { sourceetag: "e1" },
      }),
    ]);
    expect(nextManifest.blobs["trip/DSC_3.ARW"]).toMatchObject({
      etag: '"e1"',
      private: true,
    });
  });

  it("skips photos already checked at this ETag", async () => {
    const item = await photoItem("trip/IMG_4.JPG", "pixels GPS");
    const tools = fakeTools();
    const { nextManifest } = manifestFor([item]);
    const manifest = {
      "trip/IMG_4.JPG": { etag: '"e1"', target: "IMG_4.jpg", private: true },
    };

    await keepLocationsPrivate({
      items: [item],
      manifest,
      nextManifest,
      originalsClient: fakeContainer("originals", {}),
      derivativesClient: fakeContainer("derivatives", {}),
      cacheDir: dir,
      tools,
    });

    expect(tools.stripped).toEqual([]);
    expect(nextManifest.blobs["trip/IMG_4.JPG"].private).toBe(true);
  });

  it("marks clean photos as checked without touching them", async () => {
    const item = await photoItem("trip/IMG_5.JPG", "pixels");
    const originals = fakeContainer("originals", {});
    const { manifest, nextManifest } = manifestFor([item]);

    await keepLocationsPrivate({
      items: [item],
      manifest,
      nextManifest,
      originalsClient: originals,
      derivativesClient: fakeContainer("derivatives", {}),
      cacheDir: dir,
      tools: fakeTools({ installed: false }),
    });

    expect(originals.writes).toEqual([]);
    expect(nextManifest.blobs["trip/IMG_5.JPG"]).toMatchObject({
      etag: '"e1"',
      private: true,
    });
  });

  it("stops the build when a photo records a position and exiftool is missing", async () => {
    const item = await photoItem("trip/IMG_6.JPG", "pixels GPS");
    const { manifest, nextManifest } = manifestFor([item]);

    await expect(
      keepLocationsPrivate({
        items: [item],
        manifest,
        nextManifest,
        originalsClient: fakeContainer("originals", {}),
        derivativesClient: fakeContainer("derivatives", {}),
        cacheDir: dir,
        tools: fakeTools({ installed: false }),
      }),
    ).rejects.toThrow("record where they were taken");
  });

  it("leaves a photo for the next build when it changes mid-check", async () => {
    const item = await photoItem("trip/IMG_7.JPG", "pixels GPS");
    const originals = fakeContainer("originals", {
      "trip/IMG_7.JPG": {
        data: Buffer.from("newer upload"),
        etag: '"e2"',
        headers: {},
        metadata: {},
      },
    });
    const { manifest, nextManifest } = manifestFor([item]);

    await keepLocationsPrivate({
      items: [item],
      manifest,
      nextManifest,
      originalsClient: originals,
      derivativesClient: fakeContainer("derivatives", {}),
      cacheDir: dir,
      tools: fakeTools(),
    });

    expect(originals.writes).toEqual([]);
    expect(await readFile(item.localPath, "utf8")).toBe("pixels ---");
    expect(nextManifest.blobs["trip/IMG_7.JPG"].private).toBeUndefined();
    expect(
      existsSync(join(dir, hashKey(`trip/IMG_7.JPG@"e1"@IMG_7.jpg`))),
    ).toBe(false);
  });
  it("stops the build when a new source can't be cleaned, so its link never goes out", async () => {
    const item = await photoItem("trip/IMG_9.HEIC", "clean derivative", {
      willConvert: true,
      ext: ".heic",
    });
    const originals = fakeContainer("originals", {
      "trip/IMG_9.HEIC": {
        data: Buffer.from("heic GPS"),
        etag: '"e1"',
        headers: {},
        metadata: {},
      },
    });
    const tools = {
      ...fakeTools(),
      stripLocation() {
        throw new Error("unsupported HEIC variant");
      },
    };
    const { manifest, nextManifest } = manifestFor([item]);

    await expect(
      keepLocationsPrivate({
        items: [item],
        manifest,
        nextManifest,
        originalsClient: originals,
        derivativesClient: fakeContainer("derivatives", {}),
        cacheDir: dir,
        tools,
      }),
    ).rejects.toThrow("unsupported HEIC variant");
  });
});

describe("publishIncoming", () => {
  function inbox(files) {
    return Object.fromEntries(
      Object.entries(files).map(([name, [text, contentType]], i) => [
        name,
        {
          data: Buffer.from(text),
          etag: `"in-${i}"`,
          headers: { contentType },
          metadata: {},
        },
      ]),
    );
  }

  it("publishes each upload to its container, removing locations first, and empties the inbox", async () => {
    const incoming = fakeContainer(
      "incoming",
      inbox({
        "originals/trip/IMG_1.JPG": ["pixels GPS", "image/jpeg"],
        "originals/trip/DSC_2.JPG": ["pixels", "image/jpeg"],
        "originals/trip/_session.json": [
          '{"title":"Trip"}',
          "application/json",
        ],
        "hobby-media/aquarium/full/IMG_3.JPG": ["tank GPS", "image/jpeg"],
      }),
    );
    const originals = fakeContainer("originals", {});
    const hobbyMedia = fakeContainer("hobby-media", {});
    const tools = fakeTools();

    expect(
      await publishIncoming({
        incomingClient: incoming,
        destinations: { originals, "hobby-media": hobbyMedia },
        tools,
      }),
    ).toBe(4);

    expect(originals.blobs["trip/IMG_1.JPG"].data.toString()).toBe(
      "pixels ---",
    );
    // A photo with no location is published exactly as uploaded.
    expect(originals.blobs["trip/DSC_2.JPG"].data.toString()).toBe("pixels");
    expect(originals.blobs["trip/_session.json"].data.toString()).toBe(
      '{"title":"Trip"}',
    );
    expect(hobbyMedia.blobs["aquarium/full/IMG_3.JPG"].data.toString()).toBe(
      "tank ---",
    );
    expect(originals.blobs["trip/IMG_1.JPG"].headers).toEqual({
      contentType: "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
    });
    expect(originals.blobs["trip/_session.json"].headers.cacheControl).toBe(
      undefined,
    );
    expect(tools.stripped).toHaveLength(2);
    expect(Object.keys(incoming.blobs)).toEqual([]);
  });

  it("leaves anything that doesn't name a destination", async () => {
    const incoming = fakeContainer(
      "incoming",
      inbox({ "stray/IMG_4.JPG": ["pixels", "image/jpeg"] }),
    );
    const originals = fakeContainer("originals", {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      await publishIncoming({
        incomingClient: incoming,
        destinations: { originals },
        tools: fakeTools(),
      }),
    ).toBe(0);
    warn.mockRestore();
    expect(originals.writes).toEqual([]);
    expect(Object.keys(incoming.blobs)).toEqual(["stray/IMG_4.JPG"]);
  });

  it("keeps photos private when one records a location and exiftool is missing", async () => {
    const incoming = fakeContainer(
      "incoming",
      inbox({ "originals/trip/IMG_1.JPG": ["pixels GPS", "image/jpeg"] }),
    );
    const originals = fakeContainer("originals", {});

    await expect(
      publishIncoming({
        incomingClient: incoming,
        destinations: { originals },
        tools: fakeTools({ installed: false }),
      }),
    ).rejects.toThrow("stay private");
    expect(originals.writes).toEqual([]);
    expect(Object.keys(incoming.blobs)).toEqual(["originals/trip/IMG_1.JPG"]);
  });

  it("does nothing when there's no inbox yet", async () => {
    const incoming = {
      // eslint-disable-next-line require-yield
      async *listBlobsFlat() {
        throw Object.assign(new Error("ContainerNotFound"), {
          statusCode: 404,
        });
      },
    };
    expect(
      await publishIncoming({
        incomingClient: incoming,
        destinations: { originals: fakeContainer("originals", {}) },
        tools: fakeTools(),
      }),
    ).toBe(0);
  });

  it("leaves a file uploaded again during the build for the next build", async () => {
    const incoming = fakeContainer(
      "incoming",
      inbox({ "originals/trip/IMG_1.JPG": ["first", "image/jpeg"] }),
    );
    const originals = fakeContainer("originals", {});
    const tools = fakeTools();
    const check = tools.filesWithLocation;
    tools.filesWithLocation = async (paths) => {
      // The photographer re-uploads the file between download and delete.
      incoming.blobs["originals/trip/IMG_1.JPG"].etag = '"in-again"';
      return check(paths);
    };

    await publishIncoming({
      incomingClient: incoming,
      destinations: { originals },
      tools,
    });

    expect(originals.blobs["trip/IMG_1.JPG"].data.toString()).toBe("first");
    expect(Object.keys(incoming.blobs)).toEqual(["originals/trip/IMG_1.JPG"]);
  });
});

describe("derivativeIsCurrent", () => {
  const blob = { etag: '"0x8DC"' };

  it("reuses a derivative made from this source by the current conversion", () => {
    expect(
      derivativeIsCurrent({ sourceetag: "0x8DC", derivative: "2" }, blob),
    ).toBe(true);
  });

  it("makes it again when the source changed or the conversion improved", () => {
    expect(
      derivativeIsCurrent({ sourceetag: "0x111", derivative: "2" }, blob),
    ).toBe(false);
    expect(derivativeIsCurrent({ sourceetag: "0x8DC" }, blob)).toBe(false);
    expect(derivativeIsCurrent(undefined, blob)).toBe(false);
  });
});
