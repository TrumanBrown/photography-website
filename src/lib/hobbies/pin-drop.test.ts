import { beforeEach, describe, expect, it, vi } from "vitest";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../motion", () => ({ prefersReducedMotion: () => motion.reduced }));

import {
  LIFT_MS,
  LIFT_RISE,
  PRESS_DOWN_MS,
  PRESS_MS,
  REST,
  RING_FROM,
  RING_MS,
  RING_TO,
  SQUASH_MS,
  createPinMotion,
  dealFrames,
  dropPose,
  liftPose,
  planDrop,
  pressPose,
  ringPose,
} from "./pin-drop";

describe("planDrop", () => {
  it("falls from 18 to 24 px, a little to one side, and lands in 128 to 148 ms", () => {
    const lows = planDrop(() => 0);
    const highs = planDrop(() => 0.999999);
    expect(lows.lift).toBeCloseTo(18, 3);
    expect(highs.lift).toBeCloseTo(24, 3);
    expect(Math.round(lows.fall)).toBe(128);
    expect(Math.round(highs.fall)).toBe(148);
    for (let i = 0; i < 200; i++) {
      const d = planDrop();
      expect(d.lift).toBeGreaterThanOrEqual(18);
      expect(d.lift).toBeLessThanOrEqual(24);
      expect(Math.abs(d.dx)).toBeLessThanOrEqual(3);
      expect(d.fall).toBeGreaterThanOrEqual(127.9);
      expect(d.fall).toBeLessThanOrEqual(147.8);
    }
  });

  it("is different each time", () => {
    const drops = Array.from({ length: 12 }, () => planDrop());
    expect(new Set(drops.map((d) => d.lift.toFixed(3))).size).toBeGreaterThan(
      1,
    );
    expect(new Set(drops.map((d) => d.dx.toFixed(3))).size).toBeGreaterThan(1);
  });
});

describe("dropPose", () => {
  const d = planDrop(() => 0.6);

  it("starts unseen above and to the side, and lands on the spot", () => {
    const start = dropPose(d, 0);
    expect(start.y).toBeCloseTo(-d.lift, 9);
    expect(start.x).toBeCloseTo(d.dx, 9);
    expect(start.alpha).toBe(0);
    const touch = dropPose(d, d.fall - 0.001);
    expect(touch.y).toBeCloseTo(0, 1);
    expect(touch.x).toBeCloseTo(0, 2);
    expect(touch.alpha).toBe(1);
    expect(dropPose(d, d.fall + SQUASH_MS)).toBe(REST);
  });

  it("falls faster and faster without jumping between frames", () => {
    let prev = dropPose(d, 0);
    let step = 0;
    for (let ms = 1; ms < d.fall; ms++) {
      const p = dropPose(d, ms);
      const dy = p.y - prev.y;
      expect(dy).toBeGreaterThanOrEqual(step - 1e-9);
      expect(dy).toBeLessThan(0.5);
      expect(Math.abs(p.x - prev.x)).toBeLessThan(0.1);
      expect(Math.abs(p.alpha - prev.alpha)).toBeLessThan(0.05);
      step = dy;
      prev = p;
    }
  });

  it("squashes wide and flat for a frame as it hits, then stands up", () => {
    const hit = dropPose(d, d.fall + 4);
    expect(hit.y).toBe(0);
    expect(hit.sx).toBeGreaterThan(1.15);
    expect(hit.sy).toBeLessThan(0.85);
    const letting = dropPose(d, d.fall + SQUASH_MS - 4);
    expect(letting.sx).toBeGreaterThan(1);
    expect(letting.sx).toBeLessThan(hit.sx);
  });
});

describe("liftPose", () => {
  it("leaves from where the pin got to, rises 8 px and fades out", () => {
    const from = dropPose(
      planDrop(() => 0.5),
      60,
    );
    const start = liftPose(from, 0)!;
    expect(start.x).toBe(from.x);
    expect(start.y).toBe(from.y);
    expect(start.alpha).toBe(from.alpha);
    const late = liftPose(from, LIFT_MS - 1)!;
    expect(from.y - late.y).toBeCloseTo(LIFT_RISE, 0);
    expect(late.alpha).toBeLessThan(0.01);
    expect(liftPose(from, LIFT_MS)).toBeNull();
  });
});

describe("ringPose", () => {
  it("spreads from the pin's circle to 22 px and fades over 300 ms", () => {
    expect(ringPose(0)!.r).toBe(RING_FROM);
    const late = ringPose(RING_MS - 1)!;
    expect(late.r).toBeCloseTo(RING_TO, 1);
    expect(late.alpha).toBeLessThan(0.01);
    expect(ringPose(RING_MS)).toBeNull();
    let prev = ringPose(0)!;
    for (let ms = 1; ms < RING_MS; ms++) {
      const r = ringPose(ms)!;
      expect(r.r).toBeGreaterThanOrEqual(prev.r);
      expect(r.alpha).toBeLessThanOrEqual(prev.alpha);
      expect(r.r - prev.r).toBeLessThan(0.2);
      prev = r;
    }
  });
});

describe("pressPose", () => {
  it("presses in smaller and heavier on the spot, then comes back up", () => {
    const deep = pressPose(PRESS_DOWN_MS);
    expect(deep.x).toBe(0);
    expect(deep.y).toBe(0);
    expect(deep.sx).toBeLessThan(0.85);
    expect(deep.weight).toBeGreaterThan(1.3);
    expect(pressPose(0)).toBe(REST);
    expect(pressPose(PRESS_MS)).toBe(REST);
    let prev = pressPose(0);
    for (let ms = 1; ms <= PRESS_MS; ms++) {
      const p = pressPose(ms);
      expect(Math.abs(p.sx - prev.sx)).toBeLessThan(0.02);
      prev = p;
    }
  });
});

describe("dealFrames", () => {
  const frames = dealFrames(14, -6, 1.2);

  it("slides in unseen from the next square and settles square", () => {
    const offsets = frames.map((frame) => frame.offset as number);
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(1);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }
    expect(frames[0].opacity).toBe(0);
    expect(frames[0].transform).toBe(
      "translate(14.00px, -6.00px) rotate(1.20deg)",
    );
    expect(frames.at(-1)!.opacity).toBe(1);
    expect(frames.at(-1)!.transform).toBe(
      "translate(0.00px, 0.00px) rotate(0.00deg)",
    );
  });

  it("only animates transform and opacity", () => {
    for (const frame of frames) {
      for (const key of Object.keys(frame)) {
        expect(["offset", "opacity", "transform", "easing"]).toContain(key);
      }
    }
  });
});

/** A canvas that writes down the circles drawn on it. */
function recorder() {
  const circles: {
    ring: boolean;
    x: number;
    y: number;
    r: number;
    alpha: number;
    width: number;
  }[] = [];
  const stack: [number, number][] = [];
  let alpha = 1;
  let width = 1;
  const note = (x: number, y: number, r: number) =>
    circles.push({ ring: width === 1, x, y, r, alpha, width });
  const ctx = {
    strokeStyle: "",
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(v: number) {
      alpha = v;
    },
    get lineWidth() {
      return width;
    },
    set lineWidth(v: number) {
      width = v;
    },
    save: () => stack.push([alpha, width]),
    restore: () => ([alpha, width] = stack.pop()!),
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc: (x: number, y: number, r: number) => note(x, y, r),
    ellipse: (x: number, y: number, rx: number) => note(x, y, rx),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, circles };
}

const project = (lon: number, lat: number) => ({ x: lon, y: lat });
const at = (lon: number) => ({ lon, lat: 0 });

describe("createPinMotion", () => {
  let clock = 0;
  const pins = () => createPinMotion(() => clock);
  beforeEach(() => {
    clock = 0;
    motion.reduced = false;
  });

  it("keeps one pin through a burst of taps, each tap leaving its own ring", () => {
    const m = pins();
    let was: { lon: number; lat: number } | null = null;
    for (let i = 0; i < 8; i++) {
      clock = i * 20;
      m.drop(at(i * 100), was);
      was = at(i * 100);
    }
    clock = 300;
    const { ctx, circles } = recorder();
    expect(m.draw(ctx, project, "#000", was)).toBe(true);
    const rings = circles.filter((c) => c.ring);
    expect(new Set(rings.map((c) => c.x))).toEqual(
      new Set(Array.from({ length: 8 }, (_, i) => i * 100)),
    );
    const standing = circles.filter((c) => !c.ring);
    expect(standing).toHaveLength(1);
    expect(standing[0].x).toBe(700);
  });

  it("lifts a pin re-aimed mid-fall out from where it got to", () => {
    const m = pins();
    m.drop(at(0), null);
    clock = 60;
    const before = recorder();
    m.draw(before.ctx, project, "#000", at(0));
    const mid = before.circles.find((c) => !c.ring)!;
    expect(mid.y).toBeLessThan(-2);
    m.drop(at(300), at(0));
    const after = recorder();
    m.draw(after.ctx, project, "#000", at(300));
    const lifting = after.circles.find((c) => !c.ring && c.x < 50)!;
    expect(lifting.y).toBeCloseTo(mid.y, 9);
    expect(lifting.x).toBeCloseTo(mid.x, 9);
    expect(lifting.alpha).toBeCloseTo(mid.alpha, 9);
  });

  it("rings a tap right by the pin without lifting it", () => {
    const m = pins();
    m.drop(at(0), null);
    clock = 1000;
    m.tapNear(at(4));
    clock = 1010;
    const { ctx, circles } = recorder();
    m.draw(ctx, project, "#000", at(4));
    expect(circles.filter((c) => c.ring).map((c) => c.x)).toEqual([4]);
    expect(circles.filter((c) => !c.ring)).toHaveLength(1);
  });

  it("slides the pin on an arrow key with no drop and no ring", () => {
    const m = pins();
    m.drop(at(0), null);
    clock = 1000;
    m.slide(at(3));
    const { ctx, circles } = recorder();
    expect(m.draw(ctx, project, "#000", at(3))).toBe(false);
    expect(circles).toEqual([
      expect.objectContaining({ ring: false, x: 3, y: 0, r: 6, alpha: 1 }),
    ]);
  });

  it("presses the pin in where it stands, and stops drawing once it's back up", () => {
    const m = pins();
    m.press(100);
    clock = 100 + PRESS_DOWN_MS;
    const deep = recorder();
    expect(m.draw(deep.ctx, project, "#000", at(50))).toBe(true);
    expect(deep.circles[0]).toMatchObject({ x: 50, y: 0 });
    expect(deep.circles[0].r).toBeLessThan(6);
    expect(deep.circles[0].width).toBeGreaterThan(1.6);
    clock = 100 + PRESS_MS;
    expect(m.draw(recorder().ctx, project, "#000", at(50))).toBe(false);
  });

  it("puts the pin straight down under reduced motion", () => {
    motion.reduced = true;
    const m = pins();
    m.drop(at(0), null);
    m.drop(at(200), at(0));
    m.tapNear(at(202));
    m.press(0);
    clock = 40;
    const { ctx, circles } = recorder();
    expect(m.draw(ctx, project, "#000", at(202))).toBe(false);
    expect(circles).toEqual([
      expect.objectContaining({
        ring: false,
        x: 202,
        y: 0,
        r: 6,
        alpha: 1,
        width: 1.6,
      }),
    ]);
  });

  it("drops everything in the air for a new round", () => {
    const m = pins();
    m.drop(at(0), null);
    clock = 20;
    m.drop(at(100), at(0));
    m.clear();
    const { ctx, circles } = recorder();
    expect(m.draw(ctx, project, "#000", null)).toBe(false);
    expect(circles).toHaveLength(0);
  });
});
