import { describe, expect, it } from "vitest";
import {
  LAND_MS,
  hopInk,
  hopLift,
  hopScale,
  hopTarget,
  landDip,
  landFrames,
} from "./journal-hop";

describe("hopScale and hopInk", () => {
  it("leaves full size in its own colours and lands small, in ink", () => {
    expect(hopScale(0, 0.34)).toBe(1);
    expect(hopScale(1, 0.34)).toBeCloseTo(0.34, 9);
    expect(hopInk(0)).toBe(0);
    expect(hopInk(1)).toBe(1);
  });

  it("changes smoothly and only one way along the hop", () => {
    const dk = 1 / 120;
    let scale = hopScale(0, 0.3);
    let ink = hopInk(0);
    for (let k = dk; k <= 1; k += dk) {
      const s = hopScale(k, 0.3);
      const i = hopInk(k);
      expect(s).toBeLessThanOrEqual(scale);
      expect(scale - s).toBeLessThan(0.03);
      expect(i).toBeGreaterThanOrEqual(ink);
      expect(i - ink).toBeLessThan(0.05);
      scale = s;
      ink = i;
    }
  });
});

describe("landDip and landFrames", () => {
  it("dips the count 2px and brings it back within its time", () => {
    expect(landDip(0)).toBe(0);
    expect(landDip(0.05)).toBeCloseTo(2, 9);
    expect(landDip(LAND_MS / 1000)).toBe(0);
    for (let t = 0; t <= 0.3; t += 0.005) {
      expect(landDip(t)).toBeGreaterThanOrEqual(0);
      expect(landDip(t)).toBeLessThanOrEqual(2);
    }
  });

  it("only moves the holder, starting and ending in place", () => {
    const frames = landFrames();
    for (const f of frames) {
      expect(Object.keys(f).sort()).toEqual(["offset", "transform"]);
    }
    expect(frames[0].transform).toBe("translateY(0px)");
    expect(frames[frames.length - 1].transform).toBe("translateY(0px)");
  });
});

describe("hopTarget", () => {
  const vh = 844;

  it("lands in the middle of the count when it's on screen", () => {
    const to = hopTarget({ left: 100, top: 300, width: 20, height: 16 }, vh);
    expect(to).toEqual({ x: 110, y: 308 });
  });

  it("hops off the nearest edge when the count is scrolled off a phone", () => {
    expect(
      hopTarget({ left: 100, top: -200, width: 20, height: 16 }, vh).y,
    ).toBe(-24);
    expect(
      hopTarget({ left: 100, top: 1200, width: 20, height: 16 }, vh).y,
    ).toBe(vh + 24);
  });
});

describe("hopLift", () => {
  it("varies between finds", () => {
    expect(hopLift(400, () => 0)).toBe(40);
    expect(hopLift(400, () => 1)).toBe(76);
  });

  it("keeps the top of the arc on screen when the count is near the top", () => {
    for (const y of [30, 60, 90]) {
      for (const r of [0, 0.5, 1]) {
        const lift = hopLift(y, () => r);
        expect(y - lift).toBeGreaterThanOrEqual(Math.min(14, y - 8));
      }
    }
  });
});
