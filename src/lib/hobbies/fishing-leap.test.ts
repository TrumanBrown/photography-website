import { describe, expect, it } from "vitest";
import {
  RISE,
  SURFACE,
  aimLeap,
  dropAt,
  leapAt,
  planLeap,
  ringAt,
  ringPixels,
  riseAt,
  splashDrops,
  surfaceAt,
  type LeapPlan,
} from "./fishing-leap";

/** A seeded random, so a run of presses is the same every test run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A run of presses on fish 10 to 40 CSS px long, facing left as on the map. */
function presses(count: number, seed = 7): LeapPlan[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, () =>
    planLeap(10 + rand() * 30, -1, rand),
  );
}

describe("planLeap and leapAt", () => {
  it("leaves its spot and goes back in a short way along, inside 0.55 s", () => {
    for (const p of presses(200)) {
      const start = leapAt(p, 0);
      expect(start.x).toBeCloseTo(0, 9);
      expect(start.y).toBeCloseTo(0, 9);
      const end = leapAt(p, p.air);
      expect(end.x).toBeCloseTo(p.dir * p.dist, 6);
      expect(end.y).toBeCloseTo(0, 6);
      expect(p.dist).toBeGreaterThanOrEqual(10);
      expect(p.dist).toBeLessThanOrEqual(42);
      expect(p.air).toBeGreaterThanOrEqual(0.4);
      expect(p.air).toBeLessThanOrEqual(0.55);
      let top = 0;
      for (let t = 0; t <= p.air; t += p.air / 400) {
        top = Math.min(top, leapAt(p, t).y);
      }
      expect(top).toBeCloseTo(-p.lift, 0);
    }
  });

  it("varies between presses: height, distance, direction and the odd roll", () => {
    const plans = presses(400);
    expect(new Set(plans.map((p) => p.lift.toFixed(2))).size).toBeGreaterThan(
      100,
    );
    expect(new Set(plans.map((p) => p.dist.toFixed(2))).size).toBeGreaterThan(
      100,
    );
    const back = plans.filter((p) => p.dir === 1).length / plans.length;
    expect(back).toBeGreaterThan(0.15);
    expect(back).toBeLessThan(0.35);
    const rolls = plans.filter((p) => p.roll).length / plans.length;
    expect(rolls).toBeGreaterThan(0.12);
    expect(rolls).toBeLessThan(0.28);
  });

  it("leaves level, goes up nose first and comes down nose first", () => {
    for (const p of presses(100)) {
      expect(leapAt(p, 0).angle).toBeCloseTo(0, 12);
      // Positive angles tip the nose down for a fish facing right.
      expect(leapAt(p, p.air * 0.2).angle * p.dir).toBeLessThan(0);
      expect(leapAt(p, p.air * 0.9).angle * p.dir).toBeGreaterThan(0);
    }
  });

  it("rolls over once on the way and goes in upright", () => {
    for (const p of presses(100)) {
      const flips = Array.from(
        { length: 101 },
        (_, i) => leapAt(p, (p.air * i) / 100).flip,
      );
      expect(flips[0]).toBeCloseTo(1, 9);
      expect(flips[100]).toBeCloseTo(1, 9);
      if (p.roll) expect(Math.min(...flips)).toBeLessThan(-0.99);
      else expect(Math.min(...flips)).toBe(1);
    }
  });

  it("never jumps between frames, through the water and under it", () => {
    for (const p of [
      ...presses(40),
      ...presses(40, 11).map((p) => aimLeap(p, () => false)),
    ]) {
      let prev = leapAt(p, 0);
      for (let ms = 1; ms <= (p.air + 0.2) * 1000; ms++) {
        const now = leapAt(p, ms / 1000);
        expect(Math.hypot(now.x - prev.x, now.y - prev.y)).toBeLessThan(0.5);
        expect(Math.abs(now.angle - prev.angle)).toBeLessThan(0.25);
        expect(Math.abs(now.flip - prev.flip)).toBeLessThan(0.04);
        prev = now;
      }
    }
  });
});

describe("aimLeap", () => {
  const plan: LeapPlan = {
    dir: -1,
    lift: 40,
    dist: 30,
    twist: 0,
    roll: false,
    air: 0.48,
  };

  it("keeps a leap that comes down in water", () => {
    expect(aimLeap(plan, () => true)).toEqual(plan);
  });

  it("goes shorter, then the other way, to come down in water", () => {
    const shorter = aimLeap(plan, (dx) => dx > -20 && dx < 0);
    expect(shorter.dir).toBe(-1);
    expect(shorter.dist).toBeCloseTo(18, 9);
    const turned = aimLeap(plan, (dx) => dx > 0);
    expect(turned.dir).toBe(1);
    expect(turned.dist).toBe(30);
  });

  it("makes a short hop where there's no water to aim at", () => {
    const hop = aimLeap(plan, () => false);
    expect(hop.dir).toBe(-1);
    expect(hop.dist).toBeCloseTo(9, 9);
  });
});

describe("rings and drops", () => {
  it("a ring starts after its delay, spreads, thins out and goes", () => {
    const ring = { delay: 0.2, life: 0.8, reach: 12 };
    expect(ringAt(ring, 0.1)).toBeNull();
    expect(ringAt(ring, 1)).toBeNull();
    let prev = ringAt(ring, 0.2)!;
    expect(prev.every).toBe(1);
    for (let t = 0.21; t < 1; t += 0.01) {
      const now = ringAt(ring, t)!;
      expect(now.rx).toBeGreaterThan(prev.rx);
      expect(now.rx).toBeLessThanOrEqual(ring.reach);
      expect(now.every).toBeGreaterThanOrEqual(prev.every);
      prev = now;
    }
    expect(prev.every).toBe(4);
  });

  it("a ring is each pixel once, in order round it", () => {
    for (const [rx, ry] of [
      [2, 1],
      [6, 2.5],
      [11, 4.6],
    ]) {
      const px = ringPixels(rx, ry);
      expect(new Set(px.map(([x, y]) => `${x},${y}`)).size).toBe(px.length);
      for (let i = 0; i < px.length; i++) {
        const [x0, y0] = px[i];
        const [x1, y1] = px[(i + 1) % px.length];
        expect(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))).toBe(1);
      }
    }
  });

  it("drops go up, lean the way the fish went and fall back into the water", () => {
    const drops = splashDrops(400, 1, 1, ["#82c2da"], seeded(3));
    const lean = drops.reduce((sum, d) => sum + d.vx, 0) / drops.length;
    expect(lean).toBeGreaterThan(30);
    for (const d of drops) {
      expect(d.vy).toBeLessThan(0);
      const at = (t: number) => dropAt(d, t);
      expect(at(0)).toEqual({ x: d.x, y: d.y });
      expect(at(0.05)!.y).toBeLessThan(0);
      expect(at(d.life)).toBeNull();
      // Once it's back under it stays gone.
      let gone = false;
      for (let t = 0; t < d.life; t += 0.005) {
        if (!at(t)) gone = true;
        else expect(gone).toBe(false);
      }
    }
  });
});

describe("the rise and coming back up", () => {
  it("a rise lifts a touch and settles without a jump", () => {
    expect(riseAt(0)).toBe(0);
    expect(riseAt(RISE)).toBe(0);
    let prev = 0;
    let top = 0;
    for (let ms = 1; ms <= RISE * 1000; ms++) {
      const now = riseAt(ms / 1000);
      expect(Math.abs(now - prev)).toBeLessThan(0.03);
      top = Math.max(top, now);
      prev = now;
    }
    expect(top).toBeCloseTo(1, 2);
  });

  it("comes back up through the surface and stops on its spot", () => {
    expect(surfaceAt(0)).toBe(1);
    expect(surfaceAt(SURFACE)).toBe(0);
    let prev = 1;
    for (let ms = 1; ms <= SURFACE * 1000; ms++) {
      const now = surfaceAt(ms / 1000);
      expect(now).toBeLessThanOrEqual(prev);
      prev = now;
    }
  });
});
