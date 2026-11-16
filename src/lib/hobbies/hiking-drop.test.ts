import { describe, expect, it } from "vitest";
import {
  MARKERS,
  TERRAIN_S,
  bitAt,
  dropFlight,
  emerge,
  landingLength,
  markerInk,
  markerTurn,
  revealScroll,
  ripple,
  terrainGrow,
  type Bit,
} from "./hiking-drop";
import type { FeatureId } from "./hiking-model";

const TYPES = Object.keys(MARKERS) as FeatureId[];
const DEG = 180 / Math.PI;

// mulberry32, so each seed is a different run of presses
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

describe("dropFlight", () => {
  // the "+" on a button under the scene, thrown up onto the trail
  const from = { x: 140, y: 820 };
  const to = { x: 520, y: 360 };

  it("leaves the button and lands on its spot within a second", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { arc } = dropFlight(from, to, seeded(seed));
      expect(arc.at(0).x).toBeCloseTo(from.x, 9);
      expect(arc.at(0).y).toBeCloseTo(from.y, 9);
      const end = arc.at(arc.duration);
      expect(end.x).toBeCloseTo(to.x, 9);
      expect(end.y).toBeCloseTo(to.y, 9);
      expect(arc.duration).toBeGreaterThanOrEqual(0.55);
      expect(arc.duration).toBeLessThanOrEqual(0.95);
    }
  });

  it("goes higher or lower and turns differently from press to press", () => {
    const peaks = new Set<number>();
    const spins = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      const flight = dropFlight(from, to, seeded(seed));
      let top = Infinity;
      for (let t = 0; t <= flight.arc.duration; t += 0.005)
        top = Math.min(top, flight.arc.at(t).y);
      peaks.add(Math.round(top));
      spins.add(Math.round(flight.spin * DEG));
    }
    expect(peaks.size).toBeGreaterThan(4);
    expect(spins.size).toBeGreaterThan(4);
  });
});

describe("markerTurn", () => {
  it("starts turned, lands upright and never jumps between frames", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const flight = dropFlight(
        { x: 900, y: 700 },
        { x: 300, y: 200 },
        seeded(seed),
      );
      expect(Math.abs(markerTurn(flight, 0))).toBeGreaterThan(0.1);
      expect(markerTurn(flight, flight.arc.duration)).toBeCloseTo(0, 9);
      let previous = markerTurn(flight, 0);
      for (let t = 1 / 60; t <= flight.arc.duration; t += 1 / 60) {
        const now = markerTurn(flight, t);
        expect(Math.abs(now - previous) * DEG).toBeLessThan(6);
        previous = now;
      }
    }
  });
});

describe("terrainGrow", () => {
  it("eases the ground from its old shape to its new one in about 0.3 s", () => {
    expect(terrainGrow(0)).toBe(0);
    expect(terrainGrow(TERRAIN_S)).toBe(1);
    expect(terrainGrow(TERRAIN_S + 1)).toBe(1);
    let previous = 0;
    for (let t = 1 / 60; t <= TERRAIN_S; t += 1 / 60) {
      const now = terrainGrow(t);
      expect(now).toBeGreaterThanOrEqual(previous);
      expect(now - previous).toBeLessThan(0.1);
      previous = now;
    }
  });
});

describe("emerge", () => {
  const spots = [0, 0.5, 1];

  it("starts unseen and is all there by the end of its landing", () => {
    for (const type of TYPES)
      for (const d of spots)
        for (const jitter of spots) {
          expect(emerge(type, 0, d, jitter)).toBeCloseTo(0, 9);
          expect(emerge(type, landingLength(type), d, jitter)).toBe(1);
        }
  });

  it("grows trees, grass and flowers outward from where it hit", () => {
    for (const type of ["forest", "meadow", "wildflowers"] as const) {
      const t = 0.12;
      expect(emerge(type, t, 0)).toBeGreaterThan(emerge(type, t, 0.5));
      expect(emerge(type, t, 0.5)).toBeGreaterThanOrEqual(emerge(type, t, 1));
    }
  });

  it("comes in over several frames, apart from snow settling patch by patch", () => {
    for (const type of TYPES) {
      if (type === "snowfield") continue;
      let previous = 0;
      for (let t = 1 / 60; t <= landingLength(type); t += 1 / 60) {
        const now = emerge(type, t, 0.3, 0.4);
        expect(Math.abs(now - previous)).toBeLessThan(0.45);
        previous = now;
      }
    }
    const patches = Array.from({ length: 60 }, (_, i) =>
      emerge("snowfield", (i / 59) * landingLength("snowfield"), 0.4, 0.6),
    );
    expect(new Set(patches)).toEqual(new Set([0, 1]));
  });
});

describe("ripple", () => {
  it("goes out across the lake after the splash and is gone by the end", () => {
    expect(ripple(0)).toEqual([]);
    expect(ripple(landingLength("lake"))).toEqual([]);
    const early = ripple(0.4)[0];
    const later = ripple(0.6)[0];
    expect(later.spread).toBeGreaterThan(early.spread);
    expect(later.alpha).toBeLessThan(early.alpha);
  });
});

describe("bitAt", () => {
  const base: Bit = {
    x: 100,
    y: 200,
    vx: 40,
    vy: -200,
    g: 1400,
    born: 0,
    life: 0.8,
    size: 3,
    color: "#ffffff",
    alpha: 1,
  };

  it("is worked out from its start, so a frame drawn twice doesn't move it", () => {
    expect(bitAt(base, 0.3)).toEqual(bitAt(base, 0.3));
    expect(bitAt(base, 0)).toMatchObject({ x: 100, y: 200 });
    expect(bitAt(base, -0.01)).toBeNull();
    expect(bitAt(base, 0.81)).toBeNull();
  });

  it("drops back into the water and is gone", () => {
    const drop = { ...base, surface: 205 };
    // still rising above the water, then under it on the way down
    expect(bitAt(drop, 0.05)).not.toBeNull();
    expect(bitAt(drop, 0.4)).toBeNull();
  });

  it("comes to rest on the ground and stays there until it fades", () => {
    const dust = { ...base, rest: 210 };
    const settled = bitAt(dust, 0.45);
    const later = bitAt(dust, 0.6);
    expect(settled?.y).toBe(210);
    expect(later?.y).toBe(210);
    expect(later?.x).toBe(settled?.x);
    expect(later!.alpha).toBeLessThanOrEqual(settled!.alpha);
  });
});

describe("revealScroll", () => {
  const viewport = 844;

  it("leaves the page alone when the landing is on screen", () => {
    expect(
      revealScroll(
        { top: 80, bottom: 380 },
        { top: 600, bottom: 640 },
        300,
        viewport,
        90,
      ),
    ).toBe(0);
  });

  it("scrolls up to the scene and keeps the pressed button in view", () => {
    const button = { top: 100, bottom: 140 };
    const delta = revealScroll(
      { top: -400, bottom: -120 },
      button,
      -250,
      viewport,
      80,
    );
    expect(delta).toBeLessThan(0);
    expect(button.bottom - delta).toBeLessThanOrEqual(viewport);
    expect(-250 - delta - 80).toBeGreaterThanOrEqual(0);
  });

  it("always brings the landing itself into view", () => {
    const delta = revealScroll(
      { top: -900, bottom: -600 },
      { top: 660, bottom: 700 },
      -700,
      viewport,
      80,
    );
    expect(-700 - delta - 80).toBeGreaterThanOrEqual(0);
    expect(-700 - delta + 24).toBeLessThanOrEqual(viewport);
  });
});

describe("markers", () => {
  const ink = {
    water: "#4f7f8f",
    tree: "#2e4a33",
    treeLight: "#6b8b4d",
    ground: "#5d6a4a",
    groundLight: "#8d9a6a",
    accent: "#c0643a",
    snow: "#eef3f4",
  };

  it("are 9 by 9 pixels with a colour for every letter", () => {
    for (const type of TYPES) {
      const grid = MARKERS[type];
      const colors = markerInk(type, ink);
      expect(grid).toHaveLength(9);
      for (const row of grid) {
        expect(row).toHaveLength(9);
        for (const key of row) {
          if (key !== ".") expect(colors[key]).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });
});
