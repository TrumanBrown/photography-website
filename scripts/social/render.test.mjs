import sharp from "sharp";
import {
  CROP_VERSION,
  canvasFor,
  cropPosition,
  placeCrop,
  renderForInstagram,
} from "./render.mjs";
import { loadSettings } from "./settings.mjs";
import { orientedSize } from "../photos/exif.mjs";
import { dhash, hamming } from "../photos/hash.mjs";

const solid = (width, height, background, extra = (s) => s) =>
  extra(sharp({ create: { width, height, channels: 3, background } }))
    .jpeg()
    .toBuffer();

/**
 * Plain blue-grey, like an empty sky, with a checkerboard ("something there")
 * over each [x, y, width, height] area.
 */
const scene = (width, height, areas) =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><pattern id="c" width="80" height="80" patternUnits="userSpaceOnUse">
<rect width="80" height="80" fill="#fff"/><rect width="40" height="40" fill="#000"/><rect x="40" y="40" width="40" height="40" fill="#000"/>
</pattern></defs>
<rect width="100%" height="100%" fill="#8a9bb0"/>
${areas.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#c)"/>`).join("")}
</svg>`),
  )
    .jpeg()
    .toBuffer();

/** How much the top rows of a rendered post vary: ~0 for plain sky. */
const topVariation = async ({ buffer, width }) => {
  const top = await sharp(buffer)
    .extract({ left: 0, top: 0, width, height: 40 })
    .greyscale()
    .png()
    .toBuffer();
  return (await sharp(top).stats()).channels[0].stdev;
};

describe("canvasFor", () => {
  it.each([
    [2907, 4128, 1440, 1800, "y"],
    [4128, 6192, 1440, 1800, "y"],
    [6192, 4128, 1440, 960, null],
    [3501, 4128, 1440, 1698, null],
    [4000, 1000, 1440, 754, "x"],
    [519, 346, 519, 346, null],
    [1000, 2000, 1000, 1250, "y"],
  ])("%ix%i is cropped to %ix%i (trimmed: %s)", (w, h, cw, ch, side) => {
    const c = canvasFor(w, h);
    expect([c.width, c.height, c.crop?.side ?? null, c.padded]).toEqual([
      cw,
      ch,
      side,
      false,
    ]);
  });

  it.each([
    [2907, 4128, 1440, 1800, true],
    [4128, 6192, 1440, 1800, true],
    [6192, 4128, 1440, 960, false],
    [3501, 4128, 1440, 1698, false],
    [4000, 1000, 1440, 754, true],
    [519, 346, 519, 346, false],
  ])(
    "%ix%i with borders fits as %ix%i (padded: %s)",
    (w, h, cw, ch, padded) => {
      const c = canvasFor(w, h, { fit: "pad" });
      expect([c.width, c.height, c.padded, c.crop]).toEqual([
        cw,
        ch,
        padded,
        null,
      ]);
    },
  );

  it("always lands inside 4:5 to 1.91:1 and never upscales", () => {
    for (let w = 300; w <= 7000; w += 373) {
      for (let h = 300; h <= 7000; h += 419) {
        const padded = canvasFor(w, h, { fit: "pad" });
        const cropped = canvasFor(w, h);
        for (const c of [padded, cropped]) {
          expect(c.width / c.height).toBeGreaterThanOrEqual(0.8);
          expect(c.width / c.height).toBeLessThanOrEqual(1.91);
        }
        expect(padded.width).toBeLessThanOrEqual(
          Math.min(1440, Math.max(w, Math.ceil(h * 0.8))),
        );
        expect(cropped.width).toBeLessThanOrEqual(Math.min(1440, w));
        expect(cropped.height).toBeLessThanOrEqual(h);
        if (cropped.crop) {
          const [kw, kh] =
            cropped.crop.side === "y"
              ? [w, cropped.crop.keep]
              : [cropped.crop.keep, h];
          expect(cropped.crop.keep).toBeLessThanOrEqual(
            cropped.crop.side === "y" ? h : w,
          );
          expect(kw / kh / (cropped.width / cropped.height)).toBeCloseTo(1, 2);
        }
      }
    }
  });
});

describe("cropPosition", () => {
  it("has nothing to place when the frame fits", async () => {
    expect(await cropPosition(await scene(3000, 2000, []))).toBeNull();
  });

  it("crops from the middle when both ends hold something", async () => {
    expect(
      await cropPosition(await scene(2000, 3000, [[0, 0, 2000, 3000]])),
    ).toBe(0.5);
  });

  it("takes the crop off an empty end", async () => {
    // Plain sky over the top third: the crop comes off the top.
    expect(
      await cropPosition(await scene(2000, 3000, [[0, 1000, 2000, 2000]])),
    ).toBe(1);
    // Plain water under the bottom third: it comes off the bottom.
    expect(
      await cropPosition(await scene(2000, 3000, [[0, 0, 2000, 2000]])),
    ).toBe(0);
    // A panorama with empty sky over its left 2500 px: off the left.
    expect(
      await cropPosition(await scene(4000, 1000, [[2500, 0, 1500, 1000]])),
    ).toBe(1);
  });

  it("stops short of what's at the empty end", async () => {
    // Something 450 px down: trimming all 500 px from the top would cut into
    // it, so the crop leaves room above it and takes the rest off the bottom.
    const at = await cropPosition(
      await scene(2000, 3000, [[0, 450, 2000, 2550]]),
    );
    expect(at).toBeGreaterThan(0.5);
    expect(at * 500).toBeLessThan(450 - 60);
  });

  it("keeps a subject near one end even when the other end is busier", async () => {
    // A heron's head near the top, a tangle of twigs filling the bottom.
    const at = await cropPosition(
      await scene(2000, 3000, [
        [800, 300, 400, 180],
        [0, 2500, 2000, 500],
      ]),
    );
    expect(at).toBe(0.5);
    expect(at * 500).toBeLessThan(300);
  });
});

describe("renderForInstagram", () => {
  it("keeps a frame that fits whole, with no border or crop", async () => {
    const out = await renderForInstagram(await solid(3000, 2000, "#808080"));
    expect([out.width, out.height, out.padded, out.crop]).toEqual([
      1440,
      960,
      false,
      null,
    ]);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.chromaSubsampling).toBe("4:4:4");
  });

  it("crops a too-tall frame to 4:5 instead of adding borders", async () => {
    const out = await renderForInstagram(
      await scene(2000, 3000, [[0, 1000, 2000, 2000]]),
    );
    expect([out.width, out.height, out.padded, out.background]).toEqual([
      1440,
      1800,
      false,
      null,
    ]);
    expect(out.crop).toEqual({ side: "y", at: 1 });
  });

  it("crops a panorama to 1.91:1", async () => {
    const out = await renderForInstagram(
      await scene(4000, 1000, [[0, 0, 1500, 1000]]),
    );
    expect([out.width, out.height]).toEqual([1440, 754]);
    expect(out.crop).toEqual({ side: "x", at: 0 });
  });

  it("uses the crop the catalog placed", async () => {
    const photo = await scene(2000, 3000, [[0, 500, 2000, 2500]]);
    const kept = await renderForInstagram(photo, { at: 0 });
    const trimmed = await renderForInstagram(photo, { at: 1 });
    expect([kept.crop.at, trimmed.crop.at]).toEqual([0, 1]);
    expect(await topVariation(kept)).toBeLessThan(5);
    expect(await topVariation(trimmed)).toBeGreaterThan(40);
  });

  it("borders a too-tall frame when asked to, matching its edges", async () => {
    const dark = await renderForInstagram(await solid(2000, 3000, "#101010"), {
      fit: "pad",
    });
    const light = await renderForInstagram(await solid(2000, 3000, "#f0f0f0"), {
      fit: "pad",
    });
    expect([dark.width, dark.height, dark.background, dark.crop]).toEqual([
      1440,
      1800,
      "#000000",
      null,
    ]);
    expect(light.background).toBe("#ffffff");
    const { data } = await sharp(light.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(245);
  });

  it("crops an EXIF-rotated photo exactly like the same photo stored upright", async () => {
    const upright = await scene(2000, 3000, [[0, 1000, 2000, 2000]]);
    const sideways = await sharp(upright)
      .rotate(270)
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect(await orientedSize(sideways)).toEqual({ width: 2000, height: 3000 });
    const a = await renderForInstagram(upright);
    const b = await renderForInstagram(sideways);
    expect([b.width, b.height]).toEqual([1440, 1800]);
    expect(b.crop).toEqual(a.crop);
    const [pa, pb] = await Promise.all(
      [a, b].map((r) =>
        sharp(r.buffer).resize(72, 90).greyscale().raw().toBuffer(),
      ),
    );
    const meanDiff =
      pa.reduce((s, v, i) => s + Math.abs(v - pb[i]), 0) / pa.length;
    expect(meanDiff).toBeLessThan(4);
  });
});

describe("placeCrop", () => {
  it("places a crop once, with a fingerprint that matches the post", async () => {
    const photo = await scene(2000, 3000, [
      [0, 900, 1200, 700],
      [600, 1700, 1400, 500],
      [300, 2300, 600, 700],
    ]);
    const placed = await placeCrop(photo);
    expect(placed).toMatchObject({ v: CROP_VERSION, at: 1 });
    expect(placed.hash).toMatch(/^[0-9a-f]{32}$/);
    // The account's posts are fingerprinted at 1080 px with edges trimmed,
    // and match a shot within 12 bits.
    const post = await renderForInstagram(photo, { at: placed.at });
    const served = await sharp(post.buffer).resize(1080).jpeg().toBuffer();
    expect(
      hamming(placed.hash, await dhash(served, { trim: true })),
    ).toBeLessThanOrEqual(12);
    expect(await placeCrop(await scene(3000, 2000, []))).toBeNull();
  });
});

describe("SOCIAL_TALL_IMAGES", () => {
  it("crops frames outside Instagram's shape unless told to pad or skip them", () => {
    expect(loadSettings({}).tallImages).toBe("crop");
    expect(loadSettings({ SOCIAL_TALL_IMAGES: "pad" }).tallImages).toBe("pad");
    expect(loadSettings({ SOCIAL_TALL_IMAGES: "skip" }).tallImages).toBe(
      "skip",
    );
    expect(loadSettings({ SOCIAL_TALL_IMAGES: "borders" }).tallImages).toBe(
      "crop",
    );
  });
});
