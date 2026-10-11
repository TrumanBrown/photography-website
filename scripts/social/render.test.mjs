import sharp from "sharp";
import { canvasFor, renderForInstagram } from "./render.mjs";
import { orientedSize } from "../photos/exif.mjs";

const solid = (width, height, background, extra = (s) => s) =>
  extra(sharp({ create: { width, height, channels: 3, background } }))
    .jpeg()
    .toBuffer();

describe("canvasFor", () => {
  it.each([
    [2907, 4128, 1440, 1800, true],
    [4128, 6192, 1440, 1800, true],
    [6192, 4128, 1440, 960, false],
    [3501, 4128, 1440, 1698, false],
    [4000, 1000, 1440, 754, true],
    [519, 346, 519, 346, false],
  ])("%ix%i fits Instagram as %ix%i (padded: %s)", (w, h, cw, ch, padded) => {
    const c = canvasFor(w, h);
    expect([c.width, c.height, c.padded]).toEqual([cw, ch, padded]);
  });

  it("always lands inside 4:5 to 1.91:1 and never upscales", () => {
    for (let w = 300; w <= 7000; w += 373) {
      for (let h = 300; h <= 7000; h += 419) {
        const c = canvasFor(w, h);
        expect(c.width / c.height).toBeGreaterThanOrEqual(0.8);
        expect(c.width / c.height).toBeLessThanOrEqual(1.91);
        expect(c.width).toBeLessThanOrEqual(
          Math.min(1440, Math.max(w, Math.ceil(h * 0.8))),
        );
      }
    }
  });
});

describe("renderForInstagram", () => {
  it("keeps a frame that fits whole, with no border", async () => {
    const out = await renderForInstagram(await solid(3000, 2000, "#808080"));
    expect([out.width, out.height, out.padded]).toEqual([1440, 960, false]);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.chromaSubsampling).toBe("4:4:4");
  });

  it("borders a too-tall frame instead of cropping it, matching its edges", async () => {
    const dark = await renderForInstagram(await solid(2000, 3000, "#101010"));
    const light = await renderForInstagram(await solid(2000, 3000, "#f0f0f0"));
    expect([dark.width, dark.height, dark.background]).toEqual([
      1440,
      1800,
      "#000000",
    ]);
    expect(light.background).toBe("#ffffff");
    const { data } = await sharp(light.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(245);
  });

  it("applies EXIF orientation before measuring", async () => {
    const rotated = await solid(3000, 2000, "#808080", (s) =>
      s.withMetadata({ orientation: 6 }),
    );
    expect(await orientedSize(rotated)).toEqual({ width: 2000, height: 3000 });
    const out = await renderForInstagram(rotated);
    expect([out.width, out.height]).toEqual([1440, 1800]);
  });
});
