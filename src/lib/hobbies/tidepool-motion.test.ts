import { describe, expect, it } from "vitest";
import {
  DROP,
  REST,
  TILT,
  UP,
  critterReact,
  heaviness,
  lowerEnd,
  lowerPose,
  makeTide,
  raiseEnd,
  raisePose,
  reactionFor,
  reactionLength,
  tideAt,
  tideFront,
  tideWashing,
  upAt,
  type Reaction,
} from "./tidepool-motion";

/** A repeatable random stream, so a test can ask for two different waves. */
function seq(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe("raisePose", () => {
  const weights = [0, 0.5, 1];

  it("starts at rest, shudders 2px in place, and settles all the way up", () => {
    for (const heavy of weights) {
      const first = raisePose(0, heavy);
      expect(first.lift).toBe(0);
      expect(first.tilt).toBeCloseTo(0, 9);
      for (let t = 0; t < 0.09; t += 0.005) {
        const p = raisePose(t, heavy);
        expect(p.lift).toBe(0);
        expect(Math.abs(p.dx)).toBeLessThanOrEqual(2);
      }
      expect(raisePose(raiseEnd(heavy), heavy)).toMatchObject(UP);
    }
  });

  it("is up 0.30 to 0.35s after the tap, however heavy, when the card opens", () => {
    for (const heavy of weights) {
      const at = upAt(heavy);
      expect(at).toBeGreaterThanOrEqual(0.3);
      expect(at).toBeLessThanOrEqual(0.35);
      expect(raisePose(at, heavy).lift).toBeCloseTo(1, 9);
    }
    expect(upAt(heaviness(30, 20))).toBeLessThan(upAt(heaviness(100, 56)));
  });

  it("leans about 18% past its angle, then comes back", () => {
    let most = 0;
    for (let t = 0; t <= raiseEnd(1); t += 0.002) {
      most = Math.min(most, raisePose(t, 1).tilt);
    }
    expect(most / TILT).toBeGreaterThan(1.15);
    expect(most / TILT).toBeLessThan(1.22);
  });

  it("never jumps between frames once it's moving", () => {
    const dt = 1 / 240;
    for (const heavy of weights) {
      let prev = raisePose(0.13, heavy);
      for (let t = 0.13; t <= raiseEnd(heavy) + dt; t += dt) {
        const p = raisePose(t, heavy);
        expect(Math.abs(p.lift - prev.lift)).toBeLessThan(0.06);
        expect(Math.abs(p.tilt - prev.tilt)).toBeLessThan(0.05);
        prev = p;
      }
    }
  });

  it("caught on its way down, it goes straight back up from there", () => {
    const p = raisePose(0, 0.5, 0.6);
    expect(p.lift).toBeCloseTo(0.6, 9);
    expect(p.dx).toBe(0);
    expect(upAt(0.5, 0.6)).toBeLessThan(upAt(0.5));
  });
});

describe("lowerPose", () => {
  it("drops in 0.15s, squashes as it lands, and ends at rest", () => {
    expect(lowerPose(0, 1).lift).toBe(1);
    expect(lowerPose(DROP - 0.001, 1).lift).toBeLessThan(0.05);
    expect(lowerPose(DROP + 0.01, 1)).toMatchObject({ lift: 0, squash: 1 });
    expect(lowerPose(lowerEnd(1), 1)).toEqual(REST);
  });

  it("falls faster as it goes, the way a dropped thing does", () => {
    const a = 1 - lowerPose(DROP / 4, 1).lift;
    const b = lowerPose(DROP / 4, 1).lift - lowerPose(DROP / 2, 1).lift;
    expect(b).toBeGreaterThan(a);
  });

  it("doesn't squash a stone that was barely up", () => {
    for (let t = 0; t <= lowerEnd(0.1); t += 0.005) {
      expect(lowerPose(t, 0.1).squash).toBe(0);
    }
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
