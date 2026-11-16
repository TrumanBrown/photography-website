import { describe, expect, it } from "vitest";
import {
  aimPost,
  foldAt,
  foldFrames,
  leaveAt,
  leaveFrames,
  pressFrames,
} from "./post-letter";

const scaleOf = (frame: Keyframe) =>
  Number(/scale[XY]\(([-\d.]+)\)/.exec(String(frame.transform))![1]);

function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("foldAt", () => {
  it("starts flat, goes on edge halfway and ends flat on the other side", () => {
    expect(foldAt(0)).toBeCloseTo(1, 9);
    expect(foldAt(0.5)).toBeCloseTo(0, 9);
    expect(foldAt(1)).toBeCloseTo(-1, 9);
    expect(foldAt(-1)).toBe(foldAt(0));
    expect(foldAt(2)).toBe(foldAt(1));
  });

  it("only ever turns one way, without a jump", () => {
    let last = foldAt(0);
    for (let i = 1; i <= 1000; i++) {
      const next = foldAt(i / 1000);
      expect(next).toBeLessThanOrEqual(last);
      expect(last - next).toBeLessThan(0.01);
      last = next;
    }
  });
});

describe("foldFrames", () => {
  for (const axis of ["x", "y"] as const) {
    const front = foldFrames(axis, "front");
    const back = foldFrames(axis, "back");

    it(`hands the flap over on edge (${axis})`, () => {
      expect(scaleOf(front[0])).toBe(1);
      expect(scaleOf(front.at(-1)!)).toBe(0);
      expect(scaleOf(back[0])).toBe(0);
      expect(scaleOf(back.at(-1)!)).toBe(1);
    });

    it(`scales on its own axis only, in order (${axis})`, () => {
      for (const frames of [front, back]) {
        expect(frames[0].offset).toBe(0);
        expect(frames.at(-1)!.offset).toBe(1);
        for (let i = 0; i < frames.length; i++) {
          expect(Object.keys(frames[i]).sort()).toEqual([
            "offset",
            "transform",
          ]);
          expect(frames[i].transform).toMatch(
            axis === "x" ? /^scaleX\(/ : /^scaleY\(/,
          );
          if (i > 0) {
            expect(frames[i].offset!).toBeGreaterThan(frames[i - 1].offset!);
          }
        }
      }
    });
  }
});

describe("pressFrames", () => {
  it("gives a pixel and comes back to rest", () => {
    const frames = pressFrames();
    expect(frames[0].transform).toBe("translateY(0px) scale(1)");
    expect(frames.at(-1)!.transform).toBe(frames[0].transform);
    for (const frame of frames) {
      const dip = Number(
        /translateY\(([-\d.]+)px\)/.exec(String(frame.transform))![1],
      );
      expect(dip).toBeGreaterThanOrEqual(0);
      expect(dip).toBeLessThanOrEqual(1);
    }
  });
});

describe("aimPost", () => {
  it("varies the postmark and the way out from one letter to the next", () => {
    const first = aimPost(400, seq(0.1, 0.2, 0.3));
    const second = aimPost(400, seq(0.8, 0.7, 0.6));
    expect(first.tilt).not.toBe(second.tilt);
    expect(first.leave.lift).not.toBe(second.leave.lift);
    expect(first.leave.turn).not.toBe(second.leave.turn);
  });

  it("keeps the postmark tipped and the envelope rising a little", () => {
    for (const r of [0, 0.5, 0.999]) {
      const { tilt, leave } = aimPost(400, () => r);
      expect(tilt).toBeGreaterThanOrEqual(-12);
      expect(tilt).toBeLessThanOrEqual(-6);
      expect(leave.distance).toBe(400);
      expect(leave.lift).toBeGreaterThanOrEqual(4);
      expect(leave.lift).toBeLessThanOrEqual(10);
      expect(leave.turn).toBeLessThan(0);
      expect(leave.turn).toBeGreaterThanOrEqual(-4);
    }
  });
});

describe("leaveAt", () => {
  const { leave } = aimPost(420, seq(0.4, 0.9, 0.1));

  it("starts where the envelope folded and ends past the drawer's edge", () => {
    const start = leaveAt(0, leave);
    expect(start.x).toBeCloseTo(0, 9);
    expect(start.y).toBeCloseTo(0, 9);
    expect(start.turn).toBeCloseTo(0, 9);
    const end = leaveAt(1, leave);
    expect(end.x).toBeCloseTo(leave.distance, 9);
    expect(end.y).toBeCloseTo(-leave.lift, 9);
    expect(end.turn).toBeCloseTo(leave.turn, 9);
  });

  it("picks up speed to the right and never jumps", () => {
    let last = leaveAt(0, leave);
    let lastStep = 0;
    const steps = 2000;
    for (let i = 1; i <= steps; i++) {
      const at = leaveAt(i / steps, leave);
      const step = at.x - last.x;
      expect(step).toBeGreaterThanOrEqual(lastStep - 1e-9);
      // No faster than its top speed, 2.2 × distance over the whole move.
      expect(step).toBeLessThanOrEqual((2.2 * leave.distance) / steps + 1e-9);
      expect(Math.abs(at.y - last.y)).toBeLessThan(leave.lift / 100);
      lastStep = step;
      last = at;
    }
  });

  it("makes keyframes of translate and rotate only, in order", () => {
    const frames = leaveFrames(leave);
    expect(frames[0].offset).toBe(0);
    expect(frames.at(-1)!.offset).toBe(1);
    expect(frames[0].transform).toBe("translate(0px, 0px) rotate(0deg)");
    for (const frame of frames) {
      expect(Object.keys(frame).sort()).toEqual(["offset", "transform"]);
    }
  });
});
