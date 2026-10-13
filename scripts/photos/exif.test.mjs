import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { heifTiffOffset, readFacts } from "./exif.mjs";

/** A HEIF-shaped buffer exifr doesn't recognise, holding a real EXIF block. */
async function strayHeic() {
  const jpeg = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#888" },
  })
    .jpeg()
    .withExif({
      IFD0: { Make: "Apple", Model: "iPhone 16 Pro" },
      IFD2: { DateTimeOriginal: "2026:06:21 11:55:46" },
    })
    .toBuffer();
  const mark = jpeg.indexOf(Buffer.from("Exif\0\0", "latin1"));
  const app1Length = jpeg.readUInt16BE(mark - 2);
  const tiff = jpeg.subarray(mark + 6, mark - 2 + app1Length);
  return Buffer.concat([
    Buffer.from([0, 0, 0, 16]),
    Buffer.from("ftypheic", "latin1"),
    Buffer.alloc(4),
    Buffer.from("junk before the item data", "latin1"),
    Buffer.from([0, 0, 0, 6]),
    Buffer.from("Exif\0\0", "latin1"),
    tiff,
  ]);
}

describe("camera facts", () => {
  it("finds the EXIF in a HEIC that exifr doesn't recognise", async () => {
    const heic = await strayHeic();
    expect(heifTiffOffset(heic)).toBeGreaterThan(0);
    const facts = await readFacts(heic);
    expect(facts).toMatchObject({
      clock: "2026-06-21T11:55:46",
      make: "Apple",
      model: "iPhone 16 Pro",
    });
  });

  it("leaves files without EXIF empty-handed", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#000" },
    })
      .png()
      .toBuffer();
    expect(heifTiffOffset(png)).toBe(-1);
    expect((await readFacts(png)).clock).toBeNull();
  });
});
