import { describe, it, expect } from "vitest";
import {
  FIT_MAX_ZOOM,
  MAX_ZOOM,
  buildLut,
  clampView,
  fitView,
  graticuleStep,
  levelFor,
  projectAt,
  scaleBar,
  worldBase,
} from "./day-list-map";
import relief from "./day-list-relief.json";

const rgb = (lut: Uint8ClampedArray, e: number) => [
  lut[e * 4],
  lut[e * 4 + 1],
  lut[e * 4 + 2],
];
const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("clampView", () => {
  it("keeps zoom between the whole world and the closest zoom", () => {
    expect(clampView({ k: 0.2, cu: 0.5, cv: 0.5 }).k).toBe(1);
    expect(clampView({ k: 1e6, cu: 0.5, cv: 0.5 }).k).toBe(MAX_ZOOM);
  });

  it("never lets the view leave the world", () => {
    expect(clampView({ k: 1, cu: 0.1, cv: 0.9 })).toEqual({
      k: 1,
      cu: 0.5,
      cv: 0.5,
    });
    const v = clampView({ k: 4, cu: 0, cv: 1 });
    expect(v.cu).toBeCloseTo(0.125);
    expect(v.cv).toBeCloseTo(0.875);
  });

  it("holds a world narrower than the canvas in the middle until it's zoomed past the edges", () => {
    // A 3440 by 1230 screen shows a 2,460 px world at zoom 1.
    const across = 3440 / 2460;
    expect(clampView({ k: 1.3, cu: 0.1, cv: 0.5 }, MAX_ZOOM, across).cu).toBe(
      0.5,
    );
    const v = clampView({ k: 4, cu: 0, cv: 0.5 }, MAX_ZOOM, across);
    expect(v.cu).toBeCloseTo((0.5 * across) / 4);
  });
});

describe("worldBase", () => {
  it("fills the canvas up to the widest shape allowed", () => {
    expect(worldBase(1280, 800)).toBe(1280);
    expect(worldBase(1280, 800, 2)).toBe(1280);
    expect(worldBase(3440, 1230, 2)).toBe(2460);
  });

  it("keeps a wide screen's world its own shape, with sea either side", () => {
    const [width, height] = [3440, 1232];
    const base = worldBase(width, height, 2);
    const view = { k: 1, cu: 0.5, cv: 0.5 };
    const west = projectAt(view, width, height, -180, 0, base);
    const east = projectAt(view, width, height, 180, 0, base);
    expect(east.x - west.x).toBe(2 * height);
    expect(west.x).toBe((width - base) / 2);
  });
});

describe("fitView", () => {
  it("centres on the box and fits it with the padding to spare", () => {
    const box = { w: 0, e: 36, s: 0, n: 18 };
    const v = fitView(box, 800, 400, 0);
    expect(v.cu).toBeCloseTo((0 + 18 + 180) / 360);
    expect(v.cv).toBeCloseTo((90 - 9) / 180);
    expect(v.k).toBeCloseTo(10);
    expect(fitView(box, 800, 400, 40).k).toBeLessThan(v.k);
  });

  it("stops short of zooming all the way into a tiny place", () => {
    const v = fitView({ w: 10, e: 10.01, s: 50, n: 50.01 }, 800, 400, 40);
    expect(v.k).toBe(FIT_MAX_ZOOM);
  });

  it("keeps the box left of the buttons when given a right-hand inset", () => {
    const box = { w: 20, e: 30, s: 40, n: 45 };
    const width = 400;
    const v = fitView(box, width, 200, 20, FIT_MAX_ZOOM, { right: 40 });
    const right = ((box.e + 180) / 360 - v.cu) * width * v.k + width / 2;
    expect(right).toBeLessThanOrEqual(width - 20 - 40 + 0.5);
    const left = ((box.w + 180) / 360 - v.cu) * width * v.k + width / 2;
    expect(left).toBeGreaterThanOrEqual(20 - 0.5);
  });

  it("keeps the box out of a band asked for at the top or the bottom", () => {
    const box = { w: 0, e: 10, s: 10, n: 30 };
    const [width, height, pad] = [390, 195, 28];
    const top = fitView(box, width, height, pad, FIT_MAX_ZOOM, { top: 60 });
    expect(projectAt(top, width, height, 0, box.n).y).toBeGreaterThan(
      pad + 60 - 0.5,
    );
    expect(projectAt(top, width, height, 0, box.s).y).toBeLessThan(
      height - pad + 0.5,
    );
    const low = fitView(box, width, height, pad, FIT_MAX_ZOOM, { bottom: 60 });
    expect(projectAt(low, width, height, 0, box.s).y).toBeLessThan(
      height - pad - 60 + 0.5,
    );
  });

  it("frames a box on a world narrower than the canvas", () => {
    // Korea to Hokkaido on a 3440 by 1232 screen, the world 2,464 px across.
    const box = { w: 125, e: 146, s: 33, n: 46 };
    const [width, height, pad] = [3440, 1232, 44];
    const base = worldBase(width, height, 2);
    const v = fitView(box, width, height, pad, FIT_MAX_ZOOM, {}, base);
    const at = (lon: number, lat: number) =>
      projectAt(v, width, height, lon, lat, base);
    expect(at(box.w, box.n).x).toBeGreaterThanOrEqual(pad - 0.5);
    expect(at(box.e, box.s).x).toBeLessThanOrEqual(width - pad + 0.5);
    expect(at(box.w, box.n).y).toBeGreaterThanOrEqual(pad - 0.5);
    expect(at(box.e, box.s).y).toBeLessThanOrEqual(height - pad + 0.5);
    // Tight to one side or the other: the box is as big as the room allows.
    const wide = at(box.e, 0).x - at(box.w, 0).x;
    const tall = at(0, box.s).y - at(0, box.n).y;
    expect(
      Math.max(wide / (width - 2 * pad), tall / (height - 2 * pad)),
    ).toBeCloseTo(1, 3);
  });
});

describe("relief tiles", () => {
  const widths = relief.levels.map((l) => l.w);

  it("picks the coarsest level that's sharp enough", () => {
    expect(levelFor(600, widths)).toBe(0);
    // A level can be stretched up to about 1.4x before the next one loads.
    expect(levelFor(widths[2] * 1.2, widths)).toBe(2);
    expect(levelFor(widths[2] * 1.5, widths)).toBe(3);
    expect(levelFor(1e9, widths)).toBe(widths.length - 1);
  });

  it("describes every level with a land flag per tile", () => {
    for (const level of relief.levels) {
      expect(level.land).toHaveLength(level.cols * level.rows);
      expect(level.land).toMatch(/^[01]+$/);
      expect(level.cols).toBe(Math.ceil(level.w / relief.tile));
    }
  });
});

describe("graticuleStep and scaleBar", () => {
  it("keeps graticule lines at least 60px apart", () => {
    for (const pxPerDegree of [1, 3, 10, 40, 200]) {
      const step = graticuleStep(pxPerDegree);
      expect(step * pxPerDegree >= 60 || step === 30).toBe(true);
    }
  });

  it("rounds the scale bar to 1, 2 or 5 and keeps it inside the room", () => {
    for (const kmPerPx of [0.3, 1.7, 12, 55, 410]) {
      const { km, px } = scaleBar(kmPerPx, 90);
      expect(px).toBeLessThanOrEqual(90);
      expect(String(km)).toMatch(/^[125]0*$|^0\.[0-9]*[125]$/);
    }
  });
});

describe("buildLut", () => {
  it("light mode: tan sea, paper land with relief shaded toward ink", () => {
    const lut = buildLut("#fbfaf8", "#16150f", "#d8d2c4");
    expect(rgb(lut, 0)).toEqual([216, 210, 196]);
    expect(rgb(lut, 255)).toEqual([251, 250, 248]);
    expect(lum(rgb(lut, 60))).toBeLessThan(lum(rgb(lut, 255)));
  });

  it("dark mode: a sea darker than the page under lighter land", () => {
    const lut = buildLut("#121211", "#ece9e1", "#2e2c27");
    const sea = lum(rgb(lut, 0));
    expect(sea).toBeLessThan(lum([18, 18, 17]));
    expect(lum(rgb(lut, 48))).toBeGreaterThan(sea);
    expect(lum(rgb(lut, 255))).toBeGreaterThan(lum(rgb(lut, 48)));
  });
});
