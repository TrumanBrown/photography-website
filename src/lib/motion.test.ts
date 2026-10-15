import { describe, expect, it } from "vitest";
import { STAMP_MS, stampFrames, stampLandFrames } from "./motion";

describe("stampFrames", () => {
  for (const reduced of [false, true]) {
    const frames = stampFrames(-6, reduced);
    const label = reduced ? "reduced motion" : "full motion";

    it(`runs in order and starts and ends unseen (${label})`, () => {
      const offsets = frames.map((frame) => frame.offset as number);
      expect(offsets[0]).toBe(0);
      expect(offsets.at(-1)).toBe(1);
      for (let i = 1; i < offsets.length; i++) {
        expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
      }
      expect(frames[0].opacity).toBe(0);
      expect(frames.at(-1)!.opacity).toBe(0);
    });

    it(`only animates transform and opacity (${label})`, () => {
      for (const frame of frames) {
        for (const key of Object.keys(frame)) {
          expect(["offset", "opacity", "transform", "easing"]).toContain(key);
        }
      }
    });
  }

  it("slams in, sits still, then drifts down and away", () => {
    const frames = stampFrames(-6);
    // big and rising before it hits
    expect(frames[0].transform).toContain("scale(1.9)");
    // lands within the first eighth of a second or so
    const landed = frames.find((frame) => frame.opacity === 1)!;
    expect((landed.offset as number) * STAMP_MS).toBeLessThan(150);
    // still for a while before it goes
    const still = frames.filter(
      (frame) => frame.transform === frames[2].transform,
    );
    expect(still.length).toBeGreaterThanOrEqual(2);
    expect(frames.at(-1)!.transform).toMatch(/translateY\(28px\)/);
  });

  it("keeps still under reduced motion", () => {
    const transforms = new Set(
      stampFrames(-6, true).map((frame) => frame.transform),
    );
    expect(transforms.size).toBe(1);
  });
});

describe("stampLandFrames", () => {
  it("comes down hard and stays where it lands", () => {
    const frames = stampLandFrames(-6);
    expect(frames[0].opacity).toBe(0);
    expect(frames.at(-1)!.opacity).toBe(1);
    expect(frames.at(-1)!.transform).toBe(
      "translateY(0px) scale(1) rotate(-6deg)",
    );
  });
});
