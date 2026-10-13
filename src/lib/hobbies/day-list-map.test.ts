import { describe, it, expect } from "vitest";
import {
  FIT_MAX_ZOOM,
  MAX_ZOOM,
  buildLut,
  clampView,
  fitView,
  graticuleStep,
  levelFor,
  scaleBar,
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
    const v = fitView(box, width, 200, 20, FIT_MAX_ZOOM, 40);
    const right = ((box.e + 180) / 360 - v.cu) * width * v.k + width / 2;
    expect(right).toBeLessThanOrEqual(width - 20 - 40 + 0.5);
    const left = ((box.w + 180) / 360 - v.cu) * width * v.k + width / 2;
    expect(left).toBeGreaterThanOrEqual(20 - 0.5);
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
