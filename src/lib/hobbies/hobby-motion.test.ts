import { describe, expect, it } from "vitest";
import { TIP_MS, netPath, tipLean } from "./aquarium";
import { stippleDots } from "./bird-ink";

const DEG = 180 / Math.PI;

describe("tipLean", () => {
  it("starts and ends level", () => {
    for (const side of [1, -1] as const) {
      expect(tipLean(0, side)).toBe(0);
      expect(tipLean(TIP_MS, side)).toBe(0);
      expect(tipLean(TIP_MS + 500, side)).toBe(0);
    }
  });

  it("leans the way it's tipped, holds, then rocks back", () => {
    expect(tipLean(500, 1) * DEG).toBeCloseTo(16, 9);
    expect(tipLean(500, -1) * DEG).toBeCloseTo(-16, 9);
    // past level for a moment on the way back, like setting it down
    const back = Array.from({ length: 60 }, (_, i) =>
      tipLean(900 + (i * (TIP_MS - 900)) / 60, 1),
    );
    expect(Math.min(...back)).toBeLessThan(0);
    expect(Math.min(...back) * DEG).toBeGreaterThan(-2);
  });

  it("never jumps between frames", () => {
    let previous = tipLean(0, 1);
    for (let ms = 8; ms <= TIP_MS; ms += 8) {
      const now = tipLean(ms, 1);
      expect(Math.abs(now - previous) * DEG).toBeLessThan(1.2);
      previous = now;
    }
  });
});

describe("netPath", () => {
  const fish = { x: 300, y: 220 };
  const top = -24;

  it("comes down from above the tank to the fish, then lifts it out", () => {
    const start = netPath(0, fish.x, fish.y, top, 1);
    expect(start.y).toBe(top);
    expect(start.holding).toBe(false);
    const reached = netPath(0.38, fish.x, fish.y, top, 1);
    expect(reached.y).toBeCloseTo(fish.y, 6);
    const lifting = netPath(0.7, fish.x, fish.y, top, 1);
    expect(lifting.holding).toBe(true);
    expect(lifting.y).toBeLessThan(fish.y);
    const gone = netPath(0.97, fish.x, fish.y, top, 1);
    expect(gone.done).toBe(true);
    expect(gone.y).toBeLessThan(top);
  });

  it("only has the fish once it has scooped it", () => {
    for (let t = 0; t < 0.38; t += 0.02) {
      expect(netPath(t, fish.x, fish.y, top, -1).holding).toBe(false);
    }
  });

  it("moves smoothly the whole way", () => {
    let previous = netPath(0, fish.x, fish.y, top, 1);
    for (let t = 0.01; t <= 0.96; t += 0.01) {
      const now = netPath(t, fish.x, fish.y, top, 1);
      expect(Math.hypot(now.x - previous.x, now.y - previous.y)).toBeLessThan(
        16,
      );
      previous = now;
    }
  });
});

describe("stippleDots", () => {
  // Left half black, right half white.
  const w = 80;
  const h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const v = x < w / 2 ? 0 : 255;
      data.set([v, v, v, 255], p);
    }
  }

  it("puts most of the dots where the picture is dark", () => {
    const dots = stippleDots(data, w, h, 600, 3);
    expect(dots.length).toBe(600);
    const dark = dots.filter((d) => d.x < w / 2).length;
    expect(dark / dots.length).toBeGreaterThan(0.85);
  });

  it("inks the darkest first, in the picture's own colours", () => {
    const dots = stippleDots(data, w, h, 600, 3);
    const firstHalf = dots.slice(0, 300);
    expect(firstHalf.every((d) => d.x < w / 2)).toBe(true);
    expect(dots[0].color).toBe("rgb(0, 0, 0)");
    // and bigger dots where it's darker
    expect(dots[0].r).toBeGreaterThan(dots[dots.length - 1].r);
  });

  it("stipples the same picture the same way every time", () => {
    expect(stippleDots(data, w, h, 200, 9)).toEqual(
      stippleDots(data, w, h, 200, 9),
    );
  });
});
