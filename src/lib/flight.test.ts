import { describe, expect, it } from "vitest";
import {
  flightTimeline,
  openingAt,
  shotAt,
  type Rail,
  type Timeline,
} from "./flight";

const RAIL: Rail = { cx: 106, cy: 640, r: 74 };
const W = 1440;
const H = 900;

function times(timeline: Timeline, step = 1 / 120) {
  const out: number[] = [];
  for (let t = 0; t <= timeline.land + 0.2; t += step) out.push(t);
  return out;
}

describe("flightTimeline", () => {
  it("puts each part of the flight after the last", () => {
    for (const spin of [0.25, 0.6, 1.2, 2.2, 2.5, 2.9, 4]) {
      const t = flightTimeline(spin);
      expect(t.liftStart).toBeGreaterThan(0);
      expect(t.liftStart).toBeLessThan(spin);
      expect(t.liftEnd).toBeGreaterThan(t.liftStart);
      // the globe has stopped turning before anything else happens
      expect(t.settle).toBeGreaterThanOrEqual(spin);
      expect(t.settle).toBeGreaterThanOrEqual(t.liftEnd);
      expect(t.dive).toBeGreaterThan(t.settle);
      expect(t.land).toBeGreaterThan(t.dive);
    }
  });

  it("lifts the globe while a spin is still slowing down", () => {
    const t = flightTimeline(2.5);
    expect(t.liftStart).toBeLessThan(1);
    expect(t.liftEnd).toBeLessThan(2.5);
    expect(t.land - 2.5).toBeLessThan(1.6);
  });
});

describe("shotAt", () => {
  const timeline = flightTimeline(2.5);

  it("starts as an exact copy of the rail's globe, over the page", () => {
    const shot = shotAt(timeline.liftStart, timeline, RAIL, W, H);
    expect(shot.cx).toBe(RAIL.cx);
    expect(shot.cy).toBe(RAIL.cy);
    expect(shot.radius).toBeCloseTo(RAIL.r, 9);
    expect(shot.backdrop).toBe(0);
    expect(shot.ring).toBe(0);
    expect(shot.dot).toBe(2);
    expect(shot.grids.every((grid) => grid.alpha === 0)).toBe(true);
  });

  it("fills the middle of the screen once lifted, and hides the page", () => {
    const shot = shotAt(timeline.liftEnd, timeline, RAIL, W, H);
    expect(shot.cx).toBe(W / 2);
    expect(shot.cy).toBe(H / 2);
    expect(shot.radius).toBeCloseTo(0.4 * H, 9);
    expect(shot.backdrop).toBe(1);
  });

  it("only rings the place and names it once the globe has stopped", () => {
    for (const t of times(timeline)) {
      const shot = shotAt(t, timeline, RAIL, W, H);
      if (t <= timeline.settle) {
        expect(shot.ring).toBe(0);
        expect(shot.label).toBe(0);
      }
    }
    const ringed = shotAt(timeline.dive, timeline, RAIL, W, H);
    expect(ringed.ring).toBeCloseTo(12, 9);
    expect(ringed.label).toBeGreaterThan(0.5);
  });

  it("only ever zooms in, smoothly, and ends well inside the globe", () => {
    let previous = shotAt(0, timeline, RAIL, W, H);
    let biggestStep = 0;
    for (const t of times(timeline).slice(1)) {
      const shot = shotAt(t, timeline, RAIL, W, H);
      expect(shot.radius).toBeGreaterThanOrEqual(previous.radius - 1e-9);
      // zoom per frame, as a ratio: no sudden lurch anywhere
      biggestStep = Math.max(biggestStep, shot.radius / previous.radius);
      expect(
        Math.hypot(shot.cx - previous.cx, shot.cy - previous.cy),
      ).toBeLessThan(25);
      previous = shot;
    }
    expect(biggestStep).toBeLessThan(1.06);
    const end = shotAt(timeline.land, timeline, RAIL, W, H);
    expect(end.radius / (0.4 * H)).toBeCloseTo(7, 6);
    expect(end.grids[1].alpha).toBeGreaterThan(0.5);
  });

  it("keeps creeping in while it waits for the photograph", () => {
    const still = shotAt(timeline.dive, timeline, RAIL, W, H, 0);
    const waiting = shotAt(timeline.dive, timeline, RAIL, W, H, 1.5);
    expect(waiting.radius).toBeGreaterThan(still.radius);
    expect(waiting.radius / still.radius).toBeLessThan(1.2);
  });
});

describe("openingAt", () => {
  it("starts as a circle exactly filling the landing ring", () => {
    for (const [w, h] of [
      [1440, 900],
      [390, 844],
      [1024, 768],
    ]) {
      const open = openingAt(0, w, h, 12);
      expect(open.width).toBe(open.height);
      expect(open.radius).toBe(open.width / 2);
      expect(open.scale * open.width).toBeCloseTo(24, 9);
    }
  });

  it("ends as the whole screen at full size, with square corners", () => {
    const open = openingAt(1, W, H);
    expect(open.scale).toBe(1);
    expect(open.width).toBe(W);
    expect(open.height).toBe(H);
    expect(open.radius).toBe(0);
  });

  it("only ever grows, without jumps", () => {
    let previous = openingAt(0, W, H);
    for (let p = 0.005; p <= 1.0001; p += 0.005) {
      const open = openingAt(p, W, H);
      expect(open.scale).toBeGreaterThanOrEqual(previous.scale);
      const shown = open.scale * open.width;
      const before = previous.scale * previous.width;
      expect(shown).toBeGreaterThanOrEqual(before);
      expect(shown - before).toBeLessThan(0.05 * W);
      previous = open;
    }
  });
});
