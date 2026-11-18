import { describe, expect, it } from "vitest";
import { liftFrames } from "./specimen-reveal";

const parse = (t: unknown) => {
  const m = String(t).match(
    /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/,
  )!;
  return { x: +m[1], y: +m[2], s: +m[3] };
};

describe("liftFrames", () => {
  const from = { x: 900, y: 600 };
  const to = { x: 700, y: 300 };
  const { fly, shadow } = liftFrames(from, to, 40, 280);

  it("starts on the animal at its own size and lands exactly where the photo takes over", () => {
    const a = parse(fly[0].transform);
    expect(a.x).toBeCloseTo(from.x - to.x);
    expect(a.y).toBeCloseTo(from.y - to.y);
    expect(a.s).toBeCloseTo(40 / 280);
    expect(parse(fly[fly.length - 1].transform)).toEqual({ x: 0, y: 0, s: 1 });
    expect(shadow[shadow.length - 1].opacity).toBeCloseTo(1);
  });

  it("moves in small steps, on transform only", () => {
    for (let i = 1; i < fly.length; i++) {
      expect(fly[i].offset!).toBeGreaterThan(fly[i - 1].offset!);
      expect(Object.keys(fly[i]).sort()).toEqual(["offset", "transform"]);
      const p = parse(fly[i - 1].transform);
      const q = parse(fly[i].transform);
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(80);
    }
  });
});
