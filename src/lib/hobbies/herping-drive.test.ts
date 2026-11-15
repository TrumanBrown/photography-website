import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildTile,
  camera,
  eyeshine,
  parseDrive,
  ROAD,
  spotDistance,
} from "./herping-drive";

const load = (name: string) => {
  const b = readFileSync(
    fileURLToPath(
      new URL(`../../assets/hobbies/herping/${name}`, import.meta.url),
    ),
  );
  return parseDrive(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe("the roadside props", () => {
  const light = load("herping-drive.bin");
  const dark = load("herping-drive-dark.bin");

  it("read the same props in both themes, ferns and trunks", () => {
    expect(light?.map((p) => p.name)).toEqual(dark?.map((p) => p.name));
    expect(light?.map((p) => p.name)).toEqual(
      expect.arrayContaining(["fern", "maple", "alder", "mossy"]),
    );
  });

  it("keep every dot inside its drawing, smallest size first", () => {
    for (const prop of [...light!, ...dark!]) {
      expect(prop.mask.length).toBe(prop.maskW * prop.maskH);
      for (let k = 1; k < prop.sizes.length; k++)
        expect(prop.sizes[k].h).toBeGreaterThan(prop.sizes[k - 1].h);
      for (const s of prop.sizes) {
        expect(s.n).toBeGreaterThan(10);
        for (let i = 0; i < s.n; i += 37) {
          expect(s.x[i]).toBeLessThanOrEqual(s.w);
          expect(s.y[i]).toBeLessThanOrEqual(s.h);
        }
      }
    }
  });

  it("rejects anything that isn't a drive file", () => {
    expect(
      parseDrive(new TextEncoder().encode("<html>404</html>").buffer),
    ).toBeNull();
  });
});

describe("the road", () => {
  const props = [{ name: "fern" }, { name: "maple" }];

  // The car drives through the same stretch for several seconds, and it's
  // rebuilt whenever it comes back into range, so it has to come out the same.
  it("is the same stretch each time it's built, and another after New road", () => {
    const a = buildTile(7, 1, props);
    const b = buildTile(7, 1, props);
    const c = buildTile(7, 2, props);
    expect(Array.from(a.marks)).toEqual(Array.from(b.marks));
    expect(a.placed).toEqual(b.placed);
    expect(Array.from(c.marks)).not.toEqual(Array.from(a.marks));
  });

  it("keeps ferns and trees off the road", () => {
    for (let t = 0; t < 30; t++)
      for (const p of buildTile(t, 1, props).placed)
        expect(Math.abs(p.x)).toBeGreaterThan(ROAD.half);
  });
});

// Hobby-pages lesson 9: eyeshine once vanished when the light hit the
// animal. It has to be brightest with the beam on it.
describe("eyeshine", () => {
  it("is brightest where the spotlight is, with a glint past its rim", () => {
    const c = camera(1104, 562, 0);
    const beam = { x: 400, y: 330 };
    const at = (dx: number) => eyeshine(c, beam, 2, 30, beam.x + dx, beam.y);
    expect(at(0)).toBe(1);
    const steps = [0, 40, 80, 120, 160, 200, 260, 320];
    for (let i = 1; i < steps.length; i++)
      expect(at(steps[i])).toBeLessThanOrEqual(at(steps[i - 1]) + 1e-9);
    let x = 0;
    while (spotDistance(c, beam, beam.x + x, beam.y) < 1.2) x += 2;
    expect(at(x)).toBeGreaterThan(0.1);
  });
});
