import { describe, expect, it } from "vitest";
import { svgLayer } from "./engine";
import {
  aim,
  apply,
  backOut,
  camLerp,
  chain,
  dive,
  dotLine,
  dotRing,
  exitDistance,
  grow,
  makeDots,
  move,
  scale,
  screenGrid,
  seeded,
  split,
  spring,
  stipple,
  toScreen,
  turn,
  wakeHoles,
  wakeTimes,
} from "./stage";

const close = (a: number, b: number, eps = 1e-6) =>
  expect(Math.abs(a - b)).toBeLessThan(eps);

describe("moves", () => {
  it("chains right to left, like composing functions", () => {
    const m = chain(move(10, 0), scale(2));
    const [x, y] = apply(m, 3, 4);
    close(x, 16);
    close(y, 8);
  });

  it("turns and scales about a point, leaving it put", () => {
    for (const m of [turn(1.1, 40, -7), scale(3, 0.5, 40, -7)]) {
      const [x, y] = apply(m, 40, -7);
      close(x, 40);
      close(y, -7);
    }
  });

  it("knows how much a move grows a dot", () => {
    close(grow(chain(turn(0.7), scale(3))), 3);
    close(grow(scale(4, 1)), 2);
  });
});

describe("camera", () => {
  const from = { ax: 100, ay: 80, fx: 440, fy: 330, s: 0.5 };
  const to = { ax: 720, ay: 450, fx: 440, fy: 330, s: 2 };

  it("lerps the zoom evenly in log scale", () => {
    close(camLerp(from, to, 0).s, 0.5);
    close(camLerp(from, to, 0.5).s, 1);
    close(camLerp(from, to, 1).s, 2);
  });

  it("dives from wherever the target is to the middle, stopping at the end zoom", () => {
    const start = dive(from, 500, 300, 40, 0, 720, 450);
    const [sx, sy] = toScreen(start, 500, 300);
    const [fx, fy] = toScreen(from, 500, 300);
    close(sx, fx);
    close(sy, fy);
    close(start.s, from.s);
    const end = dive(from, 500, 300, 40, 1, 720, 450);
    const [ex, ey] = toScreen(end, 500, 300);
    close(ex, 720);
    close(ey, 450);
    close(end.s, 40);
  });
});

describe("easing", () => {
  it("lands on 1 at the end, overshooting on the way", () => {
    close(spring(1), 1);
    close(backOut(1), 1);
    expect(
      Math.max(...[0.5, 0.6, 0.7, 0.8].map((k) => backOut(k))),
    ).toBeGreaterThan(1);
  });
});

describe("stipple", () => {
  const r0 = 1.6;

  it("only puts dots inside the shape", () => {
    const d = stipple(
      (x, y) => (Math.hypot(x - 50, y - 50) < 30 ? 1 : 0),
      [0, 0, 100, 100],
      r0,
      seeded(1),
    );
    expect(d.n).toBeGreaterThan(100);
    for (let i = 0; i < d.n; i++)
      expect(Math.hypot(d.x[i] - 50, d.y[i] - 50)).toBeLessThan(30);
  });

  it("is denser where the tone is darker, and never crowds", () => {
    const d = stipple(
      (x) => (x < 50 ? 1 : 0.25),
      [0, 0, 100, 60],
      r0,
      seeded(2),
    );
    let dark = 0;
    for (let i = 0; i < d.n; i++) if (d.x[i] < 50) dark++;
    expect(dark / (d.n - dark)).toBeGreaterThan(2.5);
    let nearest = Infinity;
    for (let i = 0; i < d.n; i++)
      for (let j = i + 1; j < d.n; j++)
        nearest = Math.min(
          nearest,
          Math.hypot(d.x[i] - d.x[j], d.y[i] - d.y[j]),
        );
    expect(nearest).toBeGreaterThan(1.7 * r0 * 0.99);
  });

  it("fills shapes thinner than its spacing, like a hiker's legs", () => {
    const d = stipple(
      (x, y) => (Math.abs(x) <= 1.8 && y >= 0 && y <= 15 ? 1 : 0),
      [-4, -4, 4, 19],
      1,
      seeded(53),
    );
    expect(d.n).toBeGreaterThan(5);
  });

  it("comes out the same from the same seed", () => {
    const make = () =>
      stipple((x) => (x < 30 ? 0.6 : 0), [0, 0, 60, 30], r0, seeded(9));
    expect(Array.from(make().x)).toEqual(Array.from(make().x));
  });

  it("draws lines and rings as evenly spaced dots", () => {
    const line = dotLine(
      [
        [0, 0],
        [100, 0],
      ],
      1,
      5,
      seeded(3),
      0,
    );
    expect(line.n).toBe(21);
    expect(dotRing(0, 0, 10, 1, 2 * Math.PI, seeded(4)).n).toBe(10);
  });
});

describe("split", () => {
  const d = makeDots([10, 50, 90, 150], [10, 10, 10, 10], [1, 1, 1, 1]);

  it("gives each dot to the first part that claims it, the rest to rest", () => {
    const parts = split(d, [
      [
        "left",
        [
          [
            [0, 0],
            [60, 0],
            [60, 20],
            [0, 20],
          ],
        ],
      ],
      ["wide", (x) => x < 100],
    ]);
    expect(Array.from(parts.left.x)).toEqual([10, 50]);
    expect(Array.from(parts.wide.x)).toEqual([90]);
    expect(Array.from(parts.rest.x)).toEqual([150]);
  });
});

describe("aim", () => {
  it("finds a spot with about the number of dots it wants", () => {
    // Sparse on the left, dense on the right.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = 0; y < 100; y += 2)
      for (let x = 0; x < 200; x += x < 100 ? 8 : 2) {
        xs.push(x);
        ys.push(y);
      }
    const d = makeDots(
      xs,
      ys,
      xs.map(() => 1),
    );
    const [x] = aim(d, [100, 50], 90, 10, 100);
    expect(x).toBeGreaterThan(100);
    const [sparse] = aim(d, [100, 50], 90, 10, 15);
    expect(sparse).toBeLessThan(100);
  });
});

describe("wakes", () => {
  const grid = screenGrid(200, 100, 10);

  it("reaches the points a figure passes at once, and the rest as it spreads", () => {
    const times = wakeTimes(
      grid,
      [{ t: 100, discs: [0, 50, 15] }],
      (d) => d * 2,
    );
    const at = (x: number, y: number) => times[(y / 10) * grid.cols + x / 10];
    expect(at(0, 50)).toBe(100);
    expect(at(100, 50)).toBeCloseTo(100 + 85 * 2, 3);
  });

  it("waits for the figure to go by, when asked", () => {
    const passing = [
      { t: 100, discs: [100, 50, 20] },
      { t: 300, discs: [100, 50, 20] },
    ];
    const times = wakeTimes(grid, passing, () => 0, 50);
    expect(times[5 * grid.cols + 10]).toBe(350);
  });

  it("opens every point fully in the end, leaving no paper", () => {
    const times = new Float32Array(grid.cols * grid.rows).fill(0);
    const holes = new Float32Array(grid.cols * grid.rows * 3);
    const n = wakeHoles(times, grid, 1000, 100, holes);
    expect(n).toBe(grid.cols * grid.rows);
    for (let y = 0; y <= 100; y += 3)
      for (let x = 0; x <= 200; x += 3) {
        let open = false;
        for (let i = 0; i < n && !open; i++)
          open =
            Math.hypot(x - holes[i * 3], y - holes[i * 3 + 1]) <=
            holes[i * 3 + 2];
        expect(open, `${x}, ${y}`).toBe(true);
      }
  });
});

describe("exitDistance", () => {
  it("finds how far a figure goes before all of it is off the screen", () => {
    const pts = [100, 100, 300, 120];
    const d = exitDistance(
      (k) => [pts[0] - k, pts[1], pts[2] - k, pts[3]],
      400,
      300,
      10,
    );
    expect(d).toBeCloseTo(310, 0);
  });
});

describe("svgLayer", () => {
  it("draws dots as round-capped strokes, safe inside a CSS url()", () => {
    const art = svgLayer(
      [
        { color: "#fbfaf8", alpha: 1, xyr: [10, 10, 3, 20, 20, 3] },
        { color: "rgb(22, 21, 15)", alpha: 0.5, xyr: [30.25, 40, 1.5] },
      ],
      400,
      300,
    );
    expect(art.endsWith(") 0 0 / 400px 300px no-repeat")).toBe(true);
    const data = art.slice(5, art.indexOf('")'));
    expect(data).not.toMatch(/["#<>]/);
    const svg = decodeURIComponent(data.slice("data:image/svg+xml,".length));
    expect(svg).toContain("width='400' height='300'");
    expect(svg).toContain("stroke-linecap='round'");
    // Same-size dots share one path; the faded group keeps its opacity.
    expect(svg).toContain("<path stroke-width='6' d='M10 10h0M20 20h0'/>");
    expect(svg).toContain("opacity='0.500'");
    expect(svg).toContain("M30.3 40h0");
  });
});
