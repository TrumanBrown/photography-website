import { describe, expect, it } from "vitest";
import {
  pickSpinTarget,
  planGlide,
  planSpin,
  planThrow,
  type GlobePlace,
  type GlobeState,
  type Plan,
} from "./globe";

const pin = (
  name: string,
  region: string,
  lat: number,
  lon: number,
): GlobePlace => ({ name, region, lat, lon, slugs: [name] });

const PLACES: GlobePlace[] = [
  pin("Limón Province, Costa Rica", "Costa Rica", 10.2, -83.5),
  pin("Guanacaste, Costa Rica", "Costa Rica", 10.63, -85.44),
  pin("Puget Sound, Washington", "Washington", 47.7, -122.45),
  pin("North Cascades, Washington", "Washington", 48.7, -121.2),
  pin("Eastern Washington", "Washington", 47.1, -119.3),
  pin("Kauai, Hawaii", "Hawaii", 22.05, -159.5),
  pin("Reykjavík, Iceland", "Iceland", 64.1, -21.9),
  pin("Tibet, China", "China", 29.65, 91.13),
  pin("Shanghai, China", "China", 31.23, 121.47),
];

/** Seeded stand-in for Math.random (mulberry32), so failures reproduce. */
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

const STEP = 1 / 240;

function sample(plan: Plan) {
  const points: { t: number; lon: number[]; lat: number[] }[] = [];
  for (let t = 0; t < plan.duration; t += STEP) {
    points.push({ t, lon: plan.lon.at(t), lat: plan.lat.at(t) });
  }
  const end = plan.duration;
  points.push({ t: end, lon: plan.lon.at(end), lat: plan.lat.at(end) });
  return points;
}

/** Longitude difference once whole turns are ignored, in [-180, 180). */
const turnless = (a: number, b: number) =>
  ((((a - b) % 360) + 540) % 360) - 180;

/** Comes to rest with its place dead centre: nothing left to snap to. */
function expectLanded(plan: Plan) {
  const [lon, lonVel] = plan.lon.at(plan.duration);
  const [lat, latVel] = plan.lat.at(plan.duration);
  expect(Math.abs(turnless(lon, plan.place.lon))).toBeLessThan(1e-9);
  expect(Math.abs(lat - plan.place.lat)).toBeLessThan(1e-9);
  expect(Math.abs(lonVel)).toBeLessThan(1e-9);
  expect(Math.abs(latVel)).toBeLessThan(1e-9);
}

/** Picks up at the speed it was already going, so starting is seamless too. */
function expectSeamlessStart(plan: Plan, from: GlobeState) {
  const [lon, lonVel] = plan.lon.at(0);
  const [lat, latVel] = plan.lat.at(0);
  expect(lon).toBeCloseTo(from.lon, 9);
  expect(lat).toBeCloseTo(from.lat, 9);
  expect(lonVel).toBeCloseTo(from.lonVel, 6);
  expect(latVel).toBeCloseTo(from.latVel, 6);
}

/** No jumps in position and no jolts in speed anywhere along the way. */
function expectSmooth(plan: Plan) {
  const points = sample(plan);
  let drift = 0;
  let jolt = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = b.t - a.t;
    if (dt <= 1e-12) continue;
    for (const axis of ["lon", "lat"] as const) {
      // the distance covered matches the reported speeds (no teleporting)
      const covered = b[axis][0] - a[axis][0];
      const expected = ((a[axis][1] + b[axis][1]) / 2) * dt;
      drift = Math.max(drift, Math.abs(covered - expected));
      // and the speed itself never changes abruptly
      jolt = Math.max(jolt, Math.abs(b[axis][1] - a[axis][1]) / dt);
    }
  }
  expect(drift).toBeLessThan(0.01);
  expect(jolt).toBeLessThan(10000);
}

/** Lowest speed in the direction of travel; below zero means it turned back. */
function slowest(plan: Plan, dir: number, until = Infinity): number {
  let low = Infinity;
  for (const point of sample(plan)) {
    if (point.t < until) low = Math.min(low, point.lon[1] * dir);
  }
  return low;
}

function randomState(random: () => number, moving: boolean): GlobeState {
  return {
    lon: random() * 720 - 360,
    lat: random() * 140 - 70,
    lonVel: moving ? (random() < 0.5 ? -1 : 1) * (100 + random() * 800) : 0,
    latVel: moving ? random() * 160 - 80 : 0,
  };
}

describe("planSpin", () => {
  it("always comes to rest exactly on the place it was sent to", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const random = seeded(seed);
      const from = randomState(random, seed % 3 === 0);
      const place = pickSpinTarget(PLACES, null, random);
      const plan = planSpin(from, place, random);
      expect(plan.place).toBe(place);
      expectLanded(plan);
      expectSeamlessStart(plan, from);
      expectSmooth(plan);
    }
  });

  it("turns one way only, at least a full turn, in a couple of seconds", () => {
    const directions = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) {
      const random = seeded(seed);
      const from = randomState(random, false);
      const plan = planSpin(from, pickSpinTarget(PLACES, null, random), random);
      const travelled = plan.lon.at(plan.duration)[0] - from.lon;
      const dir = Math.sign(travelled);
      directions.add(dir);
      expect(Math.abs(travelled)).toBeGreaterThanOrEqual(360);
      expect(Math.abs(travelled)).toBeLessThan(720);
      expect(plan.duration).toBeGreaterThan(1.9);
      expect(plan.duration).toBeLessThan(3);
      expect(slowest(plan, dir)).toBeGreaterThanOrEqual(-1e-9);
    }
    // a coin toss from a standstill, so both ways come up
    expect(directions).toEqual(new Set([1, -1]));
  });

  it("varies how far and how long it spins, so spins don't look alike", () => {
    const durations = new Set<string>();
    const turns = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      const random = seeded(seed);
      const from = { lon: -122.45, lat: 47.7, lonVel: 0, latVel: 0 };
      const plan = planSpin(from, pickSpinTarget(PLACES, null, random), random);
      durations.add(plan.duration.toFixed(2));
      turns.add(
        (Math.abs(plan.lon.at(plan.duration)[0] - from.lon) / 360).toFixed(2),
      );
    }
    expect(durations.size).toBeGreaterThan(20);
    expect(turns.size).toBeGreaterThan(5);
  });

  it("keeps going the same way without braking when pressed again mid-spin", () => {
    for (const lonVel of [700, -700, 1000, 30, -5]) {
      const random = seeded(Math.abs(lonVel));
      const from = { lon: 12, lat: 20, lonVel, latVel: 25 };
      const plan = planSpin(from, PLACES[6], random);
      expectLanded(plan);
      expectSeamlessStart(plan, from);
      const dir = Math.sign(lonVel);
      expect(slowest(plan, dir)).toBeGreaterThanOrEqual(-1e-9);
      // while it's being pushed it only ever speeds up
      expect(slowest(plan, dir, 0.18)).toBeGreaterThanOrEqual(
        Math.abs(lonVel) - 1e-6,
      );
    }
  });

  it("holds its latitude for the first part of the spin", () => {
    const from = { lon: 0, lat: 0, lonVel: 0, latVel: 0 };
    const plan = planSpin(from, PLACES[6], seeded(7));
    expect(plan.lat.at(plan.duration * 0.3)[0]).toBe(0);
    expect(plan.lat.at(plan.duration * 0.7)[0]).toBeGreaterThan(10);
  });
});

describe("pickSpinTarget", () => {
  it("never lands back on the place it's already on", () => {
    const random = seeded(3);
    for (const current of PLACES) {
      for (let i = 0; i < 200; i++) {
        expect(pickSpinTarget(PLACES, current, random)).not.toBe(current);
      }
    }
  });

  it("gives each region an equal share rather than each pin", () => {
    const random = seeded(11);
    const counts = new Map<string, number>();
    const draws = 8000;
    for (let i = 0; i < draws; i++) {
      const { region } = pickSpinTarget(PLACES, null, random);
      counts.set(region, (counts.get(region) ?? 0) + 1);
    }
    expect(counts.size).toBe(5);
    for (const count of counts.values()) {
      expect(count / draws).toBeGreaterThan(0.17);
      expect(count / draws).toBeLessThan(0.23);
    }
  });

  it("spins back to the only place there is", () => {
    expect(pickSpinTarget([PLACES[0]], PLACES[0])).toBe(PLACES[0]);
  });
});

describe("planThrow", () => {
  it("settles a throw on the place nearest where it would coast to", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const random = seeded(seed);
      const from = randomState(random, true);
      const plan = planThrow(from, PLACES);
      expect(PLACES).toContain(plan.place);
      expectLanded(plan);
      expectSeamlessStart(plan, from);
      expectSmooth(plan);
      expect(plan.duration).toBeLessThanOrEqual(2.6);
    }
  });

  it("slows a hard throw down without ever turning it back", () => {
    const from = { lon: -100, lat: 40, lonVel: 600, latVel: 0 };
    const plan = planThrow(from, PLACES);
    // 600°/s coasts about 200° east of -100, which is western China
    expect(plan.place.region).toBe("China");
    expect(slowest(plan, 1)).toBeGreaterThanOrEqual(-1e-9);
  });

  it("lets go onto the place in the middle when it wasn't thrown", () => {
    const from = { lon: -122.4, lat: 47.6, lonVel: 0, latVel: 0 };
    const plan = planThrow(from, PLACES);
    expect(plan.place.name).toBe("Puget Sound, Washington");
    expect(plan.duration).toBeLessThan(0.4);
    expectLanded(plan);
  });
});

describe("planGlide", () => {
  it("goes the short way round", () => {
    const from = { lon: 170, lat: 22, lonVel: 0, latVel: 0 };
    const plan = planGlide(from, PLACES[5]); // Kauai, at -159.5
    expectLanded(plan);
    expect(plan.lon.at(plan.duration)[0]).toBeCloseTo(200.5, 9);
  });
});
