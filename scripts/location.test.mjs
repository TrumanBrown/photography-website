import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import exifr from "exifr";
import sharp from "sharp";
import {
  exiftoolVersion,
  filesWithLocation,
  hasLocation,
  IMAGE_EXTS,
  metadataHasLocation,
  probeBytes,
  PUBLIC_CONTAINERS,
  STRIP_ARGS,
  stripLocation,
} from "./location.mjs";

// A position in the open ocean, so the fixture never names a real place.
const GPS = {
  GPSLatitudeRef: "N",
  GPSLatitude: "1/1 30/1 0/1",
  GPSLongitudeRef: "E",
  GPSLongitude: "2/1 15/1 0/1",
};

function photo(exif) {
  const image = sharp({
    create: { width: 24, height: 16, channels: 3, background: "#6a8" },
  }).jpeg();
  return (exif ? image.withExif(exif) : image).toBuffer();
}

let dir;
let located;
let clean;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "location-test-"));
  located = join(dir, "located.jpg");
  clean = join(dir, "clean.jpg");
  await writeFile(
    located,
    await photo({ IFD0: { Make: "TestCam" }, IFD3: GPS }),
  );
  await writeFile(clean, await photo({ IFD0: { Make: "TestCam" } }));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("metadataHasLocation", () => {
  it("spots GPS tags and decoded coordinates", () => {
    expect(metadataHasLocation({ GPSLatitude: [1, 30, 0] })).toBe(true);
    expect(metadataHasLocation({ latitude: 1.5, longitude: 2.25 })).toBe(true);
    expect(metadataHasLocation({ GPSVersionID: "2.3.0.0" })).toBe(true);
  });

  it("ignores everything else", () => {
    expect(metadataHasLocation({ Make: "TestCam", ISO: 100 })).toBe(false);
    expect(metadataHasLocation({ SourceFile: "/a.jpg" })).toBe(false);
    expect(metadataHasLocation(null)).toBe(false);
    expect(metadataHasLocation(undefined)).toBe(false);
  });
});

describe("hasLocation", () => {
  it("finds the position a phone writes", async () => {
    expect(await hasLocation(located)).toBe(true);
  });

  it("passes a photo without one", async () => {
    expect(await hasLocation(clean)).toBe(false);
  });

  it("reads buffers too", async () => {
    expect(await hasLocation(await photo({ IFD3: GPS }))).toBe(true);
    expect(await hasLocation(await photo())).toBe(false);
  });

  it("checks a whole list at once", async () => {
    const found = await filesWithLocation([located, clean]);
    expect([...found]).toEqual([located]);
    expect((await filesWithLocation([])).size).toBe(0);
  });
});

describe("settings", () => {
  it("removes EXIF GPS and XMP geotags", () => {
    expect(STRIP_ARGS).toEqual(["-gps:all=", "-xmp:geotag="]);
  });

  it("scans every container anyone can read, never the private one", () => {
    expect(PUBLIC_CONTAINERS).toEqual(
      expect.arrayContaining([
        "originals",
        "derivatives",
        "hobby-media",
        "variants",
      ]),
    );
    expect(PUBLIC_CONTAINERS).not.toContain("metadata");
  });

  it("reads further into formats that keep metadata deeper", () => {
    expect(probeBytes(".heic")).toBeGreaterThan(probeBytes(".jpg"));
    expect(probeBytes(".arw")).toBe(probeBytes(".heic"));
    expect(probeBytes(".jpg")).toBeGreaterThanOrEqual(64 * 1024);
  });
});

// Committed images never pass through the private inbox: public/ deploys as
// is, and Astro copies some of src/ byte for byte into variants/. Without
// exiftool, WebP and AVIF go unchecked (exifr can't read them); CI has it.
describe("committed images", () => {
  it("record no location", async () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const images = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter((file) => IMAGE_EXTS.has(extname(file).toLowerCase()))
      .map((file) => join(root, file));
    expect(images.length).toBeGreaterThan(0);
    const located = await filesWithLocation(images);
    expect([...located].map((file) => relative(root, file))).toEqual([]);
  }, 60_000);
});

// A JPEG's compressed image data: everything from the start-of-scan marker on.
// Stripping metadata must leave it byte for byte, i.e. no re-compression.
function scanData(jpeg) {
  for (let i = 2; i < jpeg.length - 1; i++) {
    if (jpeg[i] !== 0xff) continue;
    const marker = jpeg[i + 1];
    if (marker === 0xda) return jpeg.subarray(i);
    if (marker >= 0xd0 && marker <= 0xd9) continue;
    i += 1 + jpeg.readUInt16BE(i + 2);
  }
  throw new Error("no start-of-scan marker");
}

describe.skipIf(!exiftoolVersion())("stripLocation (needs exiftool)", () => {
  it("leaves the compressed image data byte for byte: no re-encoding", async () => {
    const dest = join(dir, "lossless.jpg");
    stripLocation(located, dest);
    const [before, after] = await Promise.all([
      readFile(located),
      readFile(dest),
    ]);
    expect(scanData(after).equals(scanData(before))).toBe(true);
    expect(after.length).toBeLessThan(before.length);
  });

  it("removes the position and keeps the photo and its camera", async () => {
    const dest = join(dir, "stripped.jpg");
    stripLocation(located, dest);
    expect(await hasLocation(dest)).toBe(false);
    expect((await exifr.parse(dest))?.Make).toBe("TestCam");
    const [before, after] = await Promise.all([
      sharp(located).raw().toBuffer(),
      sharp(dest).raw().toBuffer(),
    ]);
    expect(after.equals(before)).toBe(true);
  });

  it("strips in place", async () => {
    const copy = join(dir, "in-place.jpg");
    await writeFile(copy, await photo({ IFD3: GPS }));
    stripLocation(copy);
    expect(await hasLocation(copy)).toBe(false);
  });

  it("copes with spaces and # in a file name", async () => {
    const odd = join(dir, "-odd #name copy.jpg");
    await writeFile(odd, await photo({ IFD3: GPS }));
    expect(await hasLocation(odd)).toBe(true);
    stripLocation(odd);
    expect(await hasLocation(odd)).toBe(false);
  });

  it("finds a WebP's position in the part the blob scan reads, though it comes after the image", async () => {
    const webp = await sharp({
      create: {
        width: 640,
        height: 640,
        channels: 3,
        noise: { type: "gaussian", mean: 128, sigma: 60 },
      },
    })
      .webp({ quality: 95 })
      .withExif({ IFD3: GPS })
      .toBuffer();
    expect(webp.length).toBeGreaterThan(128 * 1024);
    const probe = join(dir, "probe.webp");
    await writeFile(
      probe,
      webp.subarray(0, Math.min(webp.length, probeBytes(".webp"))),
    );
    expect(await hasLocation(probe)).toBe(true);
  });
});
