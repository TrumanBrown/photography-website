import { describe, expect, it } from "vitest";
import { LANDING_KEY } from "../landing";
import {
  ampOf,
  layoutFrame,
  SHOW_MIN,
  SHOW_TO,
  TOP_AT,
  WIDE,
  type Geo,
} from "./frame";
import { CAPH, fitName, JERSEY_100, shapeOf, snapFloor } from "./fit";
import { ARRIVAL_KEY } from "./title";

/** Lay the photo out the way the title screen does on a desktop. */
function desk(vw: number, vh: number, zoom = 1): Geo {
  return layoutFrame(vw, vh, false, ampOf(vw, vh), (g, w0, h0) =>
    g.kind === "wide"
      ? { x: (vw - w0) / 2, y: -TOP_AT * h0, zoom }
      : { x: 0, y: -TOP_AT * h0, zoom },
  );
}

describe("title screen frame", () => {
  it("covers a 21:9 monitor with the browser open and still shows the shore", () => {
    const g = desk(3440, 1230);
    expect(g.kind).toBe("land");
    expect(g.x).toBeLessThanOrEqual(0);
    expect(g.x + g.w).toBeGreaterThanOrEqual(3440);
    // The window's bottom edge is at least SHOW_MIN down the photo.
    expect((1230 - g.y) / g.h).toBeGreaterThanOrEqual(SHOW_MIN - 1e-6);
  });

  it("centres the photo with its soft edges on a 32:9 monitor", () => {
    const g = desk(5120, 1440);
    expect(g.kind).toBe("wide");
    expect(Math.abs(g.x + g.w / 2 - 2560)).toBeLessThan(1);
    // The photo and its carried-on edges reach both sides.
    expect(g.x - WIDE.ext * g.w).toBeLessThanOrEqual(0);
    expect(g.x + g.w + WIDE.ext * g.w).toBeGreaterThanOrEqual(5120);
  });

  it("never zooms past the point where the mountains' foot leaves the screen", () => {
    const g = desk(1920, 1080, 3);
    expect(g.w).toBeLessThanOrEqual((1.5 * 1080) / (SHOW_TO - 0.135) + 1);
  });
});

describe("fitting the name to the summit", () => {
  const shape = shapeOf(JERSEY_100);
  const apex = { x: 700, y: 300 };
  // The summit: a triangle under the apex, 1 px wider each row down.
  const summit = (y: number): [number, number] => {
    const d = y - apex.y;
    return [apex.x - d, apex.x + d];
  };

  it("sits the summit in the gap between the words", () => {
    const spans = (y: number) => (y > apex.y ? [summit(y)] : []);
    const f = fitName(shape, {
      spans,
      apex,
      vw: 1440,
      dpr: 1,
      size: 164,
      room: 1300,
    });
    expect(f.size).toBe(164);
    const gapMid = f.left + shape.gapC * f.size;
    expect(Math.abs(gapMid - apex.x)).toBeLessThan(2);
    expect(f.poke).toBeGreaterThan(0);
  });

  it("steps down a size when a tree would cross a letter", () => {
    const right = apex.x + (shape.inkR - shape.gapC) * 164;
    // A tree just inside the right end of "Brown" at full size.
    const tree: [number, number] = [right - 20, right + 40];
    const spans = (y: number) => {
      const runs: [number, number][] = y > apex.y ? [summit(y)] : [];
      if (y > apex.y - CAPH * 164) runs.push(tree);
      return runs;
    };
    const f = fitName(shape, {
      spans,
      apex,
      vw: 1440,
      dpr: 1,
      size: 164,
      room: 1300,
    });
    expect(f.size).toBeLessThan(164);
    expect(f.size).toBe(snapFloor(f.size, 1));
    expect(f.left + shape.inkR * f.size).toBeLessThan(tree[0]);
  });
});

it("leaves its page-change note under the key landing.ts reads", () => {
  expect(ARRIVAL_KEY).toBe(LANDING_KEY);
});
