import { describe, expect, it } from "vitest";
import { findDots, quietSpot } from "./open";
import { DOTS_MS, holeRadius } from "./landing";

/** An RGBA image, transparent, with inked discs stamped on it. */
function plate(
  width: number,
  height: number,
  discs: Array<[number, number, number]>,
  ink: [number, number, number] = [22, 21, 15],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [cx, cy, r] of discs) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
        const p = (y * width + x) * 4;
        data.set([...ink, 255], p);
      }
    }
  }
  return data;
}

describe("findDots", () => {
  it("finds each separate dot where it is, about the right size", () => {
    const discs: Array<[number, number, number]> = [
      [10, 10, 2],
      [30, 12, 2],
      [20, 30, 2],
      [44, 40, 2],
    ];
    const field = findDots(plate(60, 50, discs), 60, 50);
    expect(field.n).toBe(4);
    for (const [cx, cy] of discs) {
      const found = Array.from({ length: field.n }, (_, i) =>
        Math.hypot(field.x[i] - cx, field.y[i] - cy),
      );
      expect(Math.min(...found)).toBeLessThan(0.6);
    }
    for (let i = 0; i < field.n; i++) {
      expect(field.r[i]).toBeGreaterThan(1.5);
      expect(field.r[i]).toBeLessThan(2.5);
    }
  });

  it("cuts a run of touching dots back into dots, not one big blot", () => {
    const discs: Array<[number, number, number]> = [];
    // a row of separate dots sets what a typical dot is
    for (let x = 6; x < 120; x += 9) discs.push([x, 6, 2]);
    // and a dense patch where they all run together
    for (let y = 30; y < 50; y += 3) {
      for (let x = 30; x < 70; x += 3) discs.push([x, y, 2]);
    }
    const field = findDots(plate(130, 60, discs), 130, 60);
    let biggest = 0;
    let inPatch = 0;
    for (let i = 0; i < field.n; i++) {
      biggest = Math.max(biggest, field.r[i]);
      if (field.y[i] > 25) inPatch++;
    }
    expect(biggest).toBeLessThan(3);
    expect(inPatch).toBeGreaterThan(20);
  });

  it("draws in the plate's own ink", () => {
    const light = findDots(plate(20, 20, [[10, 10, 3]]), 20, 20);
    expect(light.color).toBe("rgb(22, 21, 15)");
    const dark = findDots(
      plate(20, 20, [[10, 10, 3]], [236, 233, 225]),
      20,
      20,
    );
    expect(dark.color).toBe("rgb(236, 233, 225)");
  });
});

describe("quietSpot", () => {
  it("picks clear paper among the dots, near the middle", () => {
    const discs: Array<[number, number, number]> = [];
    for (let y = 4; y < 100; y += 6) {
      for (let x = 4; x < 100; x += 6) {
        // leave one gap a little off centre
        if (Math.hypot(x - 58, y - 46) < 9) continue;
        discs.push([x, y, 2]);
      }
    }
    const field = findDots(plate(104, 104, discs), 104, 104);
    const spot = quietSpot(field);
    let clear = Infinity;
    for (let i = 0; i < field.n; i++) {
      clear = Math.min(
        clear,
        Math.hypot(field.x[i] - spot.x, field.y[i] - spot.y) - field.r[i],
      );
    }
    expect(clear).toBeGreaterThan(4);
    expect(Math.hypot(spot.x - 58, spot.y - 46)).toBeLessThan(6);
  });
});

describe("holeRadius", () => {
  const step = 20;
  it("starts closed and ends overlapping its neighbours everywhere", () => {
    for (const reach of [0, 0.3, 0.7, 1]) {
      expect(holeRadius(reach, 0, step)).toBe(0);
      // past the cell's half-diagonal, so no paper is left between holes
      expect(holeRadius(reach, DOTS_MS, step)).toBeGreaterThan(
        (step * Math.SQRT2) / 2,
      );
    }
  });

  it("opens from the middle out, and only ever opens", () => {
    for (let ms = 0; ms <= DOTS_MS; ms += 20) {
      expect(holeRadius(0, ms, step)).toBeGreaterThanOrEqual(
        holeRadius(1, ms, step),
      );
      expect(holeRadius(0.5, ms + 20, step)).toBeGreaterThanOrEqual(
        holeRadius(0.5, ms, step),
      );
    }
  });
});
