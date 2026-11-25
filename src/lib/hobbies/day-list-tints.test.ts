import { describe, expect, it } from "vitest";
import {
  RINGS,
  RING_SET,
  assignTints,
  hueGap,
  photoHues,
  type RGB,
} from "./day-list-tints";

/** A square photo `n` px across: `fill` with a block of `middle` in the centre. */
function photo(n: number, fill: RGB, middle?: RGB): Uint8ClampedArray {
  const d = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const inner =
        middle && Math.abs(x - n / 2) < n / 5 && Math.abs(y - n / 2) < n / 5;
      const c = inner ? middle : fill;
      d.set([c[0], c[1], c[2], 255], (y * n + x) * 4);
    }
  }
  return d;
}

const nearest = (h: number) =>
  RINGS.reduce((a, b) => (hueGap(b.h, h) < hueGap(a.h, h) ? b : a)).hex;

describe("photoHues", () => {
  it("finds no colour in a grey photo", () => {
    expect(photoHues(photo(32, [128, 128, 128]), 32)).toEqual([]);
  });

  it("weighs the middle of the frame over the edges", () => {
    // A red bird in the middle of a pale green background.
    const peaks = photoHues(photo(32, [150, 190, 140], [220, 40, 50]), 32);
    expect(nearest(peaks[0].h)).toBe("#ff4f7b");
  });
});

describe("assignTints", () => {
  it("gives six photos six different ring colours", () => {
    const blue = photoHues(photo(24, [40, 120, 230]), 24);
    const tints = assignTints([blue, blue, blue, blue, blue, blue]);
    expect(new Set(tints.map((t) => t.hex)).size).toBe(6);
    expect(tints.map((t) => t.hex).sort()).toEqual([...RING_SET].sort());
  });

  it("gives each photo the colour nearest its own when it can", () => {
    const photos: RGB[] = [
      [40, 200, 255],
      [255, 60, 110],
      [255, 220, 60],
    ];
    const tints = assignTints(photos.map((c) => photoHues(photo(24, c), 24)));
    expect(tints.map((t) => t.hex)).toEqual(["#3cd2ff", "#ff4f7b", "#ffd84a"]);
  });

  it("leaves a photo that couldn't be read a colour nobody else took", () => {
    const red = photoHues(photo(24, [230, 40, 60]), 24);
    const tints = assignTints([[], red]);
    expect(tints[1].hex).toBe("#ff4f7b");
    expect(tints[0].hex).not.toBe("#ff4f7b");
    expect(RING_SET).toContain(tints[0].hex);
  });
});
