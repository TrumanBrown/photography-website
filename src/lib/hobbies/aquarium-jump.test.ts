import { describe, expect, it } from "vitest";
import { heading, jumpArc } from "./aquarium-jump";

const DEG = 180 / Math.PI;

describe("jumpArc", () => {
  const cases = [
    // picker under the tank, tank top well above
    { from: { x: 180, y: 445 }, to: { x: 700, y: -205 } },
    // straight up into the tank above
    { from: { x: 500, y: 900 }, to: { x: 520, y: 40 } },
    // a drop from just above the surface
    { from: { x: 300, y: 30 }, to: { x: 300, y: 100 } },
    // the picker beside the tank, level with it
    { from: { x: 1200, y: 200 }, to: { x: 400, y: 200 } },
  ];

  it("leaves the swatch and lands on the spot it was aimed at", () => {
    for (const { from, to } of cases) {
      const arc = jumpArc(from, to);
      expect(arc.at(0).x).toBeCloseTo(from.x, 9);
      expect(arc.at(0).y).toBeCloseTo(from.y, 9);
      const end = arc.at(arc.duration);
      expect(end.x).toBeCloseTo(to.x, 9);
      expect(end.y).toBeCloseTo(to.y, 9);
    }
  });

  it("peaks the set height above the higher end, then comes down into the water", () => {
    for (const { from, to } of cases) {
      const lift = 56;
      const arc = jumpArc(from, to, lift);
      let top = Infinity;
      for (let t = 0; t <= arc.duration; t += arc.duration / 4000) {
        top = Math.min(top, arc.at(t).y);
      }
      expect(top).toBeCloseTo(Math.min(from.y, to.y) - lift, 1);
      // still falling as it goes in, so it splashes rather than lands
      expect(arc.at(arc.duration).vy).toBeGreaterThan(0);
    }
  });

  it("moves like something thrown: steady sideways, constant pull down", () => {
    const arc = jumpArc(cases[0].from, cases[0].to);
    const dt = arc.duration / 200;
    const pulls: number[] = [];
    for (let t = dt; t < arc.duration - dt; t += dt) {
      const before = arc.at(t - dt);
      const after = arc.at(t + dt);
      expect(after.vx).toBeCloseTo(before.vx, 9);
      // reported speeds match the path
      expect((after.y - before.y) / (2 * dt)).toBeCloseTo(arc.at(t).vy, 3);
      pulls.push((after.vy - before.vy) / (2 * dt));
    }
    for (const pull of pulls) expect(pull).toBeCloseTo(pulls[0], 3);
    expect(pulls[0]).toBeGreaterThan(0);
  });

  it("takes about a second at most, however far it goes", () => {
    for (const { from, to } of cases) {
      const { duration } = jumpArc(from, to);
      expect(duration).toBeGreaterThanOrEqual(0.55);
      expect(duration).toBeLessThanOrEqual(0.95);
    }
  });
});

describe("heading", () => {
  it("is level going sideways, nose up rising and nose down falling", () => {
    expect(heading(300, 0, 1)).toBe(0);
    expect(heading(300, -300, 1) * DEG).toBeCloseTo(-45, 9);
    expect(heading(300, 300, 1) * DEG).toBeCloseTo(45, 9);
  });

  it("mirrors for a fish facing left", () => {
    expect(heading(-300, -300, -1)).toBeCloseTo(-heading(300, -300, 1), 12);
  });

  it("never stands a fish on its head", () => {
    expect(Math.abs(heading(1, 4000, 1)) * DEG).toBeLessThanOrEqual(70);
    expect(Math.abs(heading(-1, -4000, -1)) * DEG).toBeLessThanOrEqual(70);
  });
});
