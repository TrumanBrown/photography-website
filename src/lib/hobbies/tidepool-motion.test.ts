import { describe, expect, it } from "vitest";
import {
  BACK_S,
  HEAVE_S,
  OVER,
  OVER_S,
  backAngle,
  critterReact,
  edgeHeight,
  heaveAngle,
  heavePeak,
  makeTide,
  overAngle,
  reactionFor,
  reactionLength,
  tideAt,
  tideFront,
  tideWashing,
  type Reaction,
} from "./tidepool-motion";

/** A repeatable random stream, so a test can ask for two different waves. */
function seq(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe("overAngle", () => {
  it("starts lying down and ends on its back", () => {
    expect(overAngle(0)).toBe(0);
    expect(overAngle(OVER_S)).toBe(OVER);
    expect(overAngle(OVER_S + 1)).toBe(OVER);
  });

  it("stands on end about halfway, and rocks past flat as it lands", () => {
    const mid = overAngle(OVER_S * 0.5);
    expect(mid).toBeGreaterThan(Math.PI * 0.35);
    expect(mid).toBeLessThan(Math.PI * 0.65);
    let past = 0;
    for (let t = OVER_S * 0.8; t < OVER_S; t += 0.005)
      past = Math.max(past, overAngle(t));
    expect(past).toBeGreaterThan(OVER);
    expect(past).toBeLessThan(OVER + 0.12);
  });

  it("never jumps between frames", () => {
    let prev = overAngle(0);
    for (let t = 1 / 120; t <= OVER_S + 0.02; t += 1 / 120) {
      const a = overAngle(t);
      expect(Math.abs(a - prev)).toBeLessThan(0.16);
      prev = a;
    }
  });

  it("carries on from where a heave left it", () => {
    expect(overAngle(0.001, 0.8)).toBeCloseTo(0.8, 1);
    expect(overAngle(OVER_S, 0.8)).toBe(OVER);
  });
});

describe("backAngle", () => {
  it("goes from its back to lying where it was", () => {
    expect(backAngle(0)).toBe(OVER);
    expect(backAngle(BACK_S)).toBe(0);
    let prev = backAngle(0);
    for (let t = 1 / 120; t <= BACK_S; t += 1 / 120) {
      const a = backAngle(t);
      expect(Math.abs(a - prev)).toBeLessThan(0.2);
      prev = a;
    }
  });
});

describe("heaveAngle", () => {
  it("comes up to its peak and slips back to lying down", () => {
    const peak = heavePeak(0, 3);
    expect(heaveAngle(0, peak)).toBe(0);
    expect(heaveAngle(HEAVE_S, peak)).toBe(0);
    let top = 0;
    for (let t = 0; t < HEAVE_S; t += 0.01)
      top = Math.max(top, heaveAngle(t, peak));
    expect(top).toBeGreaterThan(peak * 0.95);
    expect(top).toBeLessThan(peak * 1.05);
  });

  it("gets further up with each heave, but never over before the last", () => {
    expect(heavePeak(1, 3)).toBeGreaterThan(heavePeak(0, 3));
    expect(heavePeak(1, 3)).toBeLessThan(Math.PI / 2);
  });

  it("lifts its far edge highest when it stands on end", () => {
    expect(edgeHeight(0)).toBe(0);
    expect(edgeHeight(Math.PI / 2)).toBeCloseTo(1);
    expect(edgeHeight(OVER)).toBeCloseTo(0);
  });
});

describe("critterReact", () => {
  const kinds: Reaction[] = ["scuttle", "dart", "flick", "clench", "still"];

  it("ends where it started, so the beach ends as it always did", () => {
    for (const kind of kinds) {
      const end = critterReact(kind, reactionLength(kind), 1, 16);
      expect(end).toEqual({ dx: 0, dy: 0, open: 1 });
      expect(critterReact(kind, 0, -1, 16)).toEqual({ dx: 0, dy: 0, open: 1 });
    }
  });

  it("sends a crab sideways either way, and leaves a star where it is", () => {
    expect(reactionFor("crab")).toBe("scuttle");
    expect(reactionFor("star")).toBe("still");
    const right = critterReact("scuttle", 0.1, 1, 12);
    const left = critterReact("scuttle", 0.1, -1, 12);
    expect(right.dx).toBeCloseTo(12, 9);
    expect(left.dx).toBeCloseTo(-12, 9);
    expect(right.dy).toBe(0);
    for (let t = 0; t < 1; t += 0.05) {
      expect(critterReact("still", t, 1, 16)).toEqual({
        dx: 0,
        dy: 0,
        open: 1,
      });
    }
  });

  it("squeezes an anemone shut and opens it again", () => {
    expect(critterReact("clench", 0.2, 1, 16).open).toBe(0);
    expect(critterReact("clench", 1.0, 1, 16).open).toBeGreaterThan(0.3);
  });
});

describe("the tide", () => {
  const W = 800;
  const H = 500;

  it("washes in from the water past the bottom, then draws back", () => {
    const tide = makeTide(W, H, 0, seq(7));
    for (let x = 0; x <= W; x += 50) {
      expect(tideFront(tide, 0, x)).toBe(tide.top);
      expect(tideFront(tide, tide.up, x)).toBeGreaterThan(H);
    }
    expect(tideWashing(tide, tide.up - 0.01)).toBe(true);
    expect(tideWashing(tide, tide.up)).toBe(false);
  });

  it("is a different wave each press", () => {
    const a = makeTide(W, H, 0, seq(7));
    const b = makeTide(W, H, 0, seq(11));
    expect(tideFront(a, 0.3, 200)).not.toBeCloseTo(tideFront(b, 0.3, 200), 1);
  });

  it("never jumps between frames as it comes in", () => {
    const tide = makeTide(W, H, 0, seq(3));
    const dt = 1 / 60;
    let prev = tideFront(tide, 0, 400);
    for (let t = dt; t <= tide.up + tide.back; t += dt) {
      const y = tideFront(tide, t, 400);
      expect(Math.abs(y - prev)).toBeLessThan(40);
      prev = y;
    }
  });

  it("leaves wet sand that dries from the bottom up in about a second", () => {
    const tide = makeTide(W, H, 0, seq(5));
    const end = tide.up + tide.back + tide.dry;
    const t = tide.up + tide.back + 0.4;
    const low = tideAt(tide, t, 400, H * 0.9, 100, 4).wet;
    const high = tideAt(tide, t, 400, H * 0.4, 100, 4).wet;
    expect(high).toBeGreaterThan(low);
    expect(tideAt(tide, end, 400, H * 0.4, 100, 4).wet).toBe(0);
    expect(tide.dry).toBeCloseTo(1, 9);
  });
});
