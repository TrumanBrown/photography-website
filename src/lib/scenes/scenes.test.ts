import { beforeAll, describe, expect, it } from "vitest";
import type { DrawOpts, Painter, SceneContext } from "./engine";
import { ready, SCENES } from "./index";
import {
  type Cam,
  camLerp,
  camMat,
  type Dots,
  grow,
  ID,
  makeDots,
  type Mat,
  median,
  mul,
  seeded,
  smootherstep,
  toScreen,
} from "./stage";

/**
 * Every scene, driven through a stand-in painter: it has to run start to
 * finish, and end on nothing but its big target dots, since those are all
 * the next page gets to open through.
 */

beforeAll(() => {
  // The globe rasterises its coastlines on a canvas; here, a blank one.
  const ctx = new Proxy(
    {
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
    },
    {
      get: (target, key) =>
        key in target ? target[key as "getImageData"] : () => {},
    },
  );
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  } as unknown as Document;
});

/** A plate's worth of stipple: jittered dots over the whole card. */
function plate(): Dots {
  const rand = seeded(5);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 2; y < 660; y += 4)
    for (let x = 2; x < 880; x += 4) {
      xs.push(x + (rand() - 0.5) * 2);
      ys.push(y + (rand() - 0.5) * 2);
    }
  return makeDots(
    xs,
    ys,
    xs.map(() => 1.6),
  );
}

interface Call {
  kind: "dots" | "line" | "label";
  alpha: number;
  target: boolean;
  halo: boolean;
  /** On-screen radius of a typical dot, px. */
  r: number;
}

class Recorder implements Painter {
  calls: Call[] = [];
  private c: Cam = { ax: 0, ay: 0, fx: 0, fy: 0, s: 1 };
  constructor(
    readonly w: number,
    readonly h: number,
    private parts: Record<string, Dots>,
  ) {}
  cam(c: Cam) {
    for (const v of Object.values(c)) expect(Number.isFinite(v)).toBe(true);
    this.c = c;
  }
  part(name: string, m: Mat = ID, o: DrawOpts = {}) {
    const d = this.parts[name];
    expect(d, `part ${name}`).toBeDefined();
    this.dots(d, m, o);
  }
  dots(d: Dots, m: Mat = ID, o: DrawOpts = {}) {
    const k = grow(mul(camMat(this.c), m)) * (o.size ?? 1);
    this.calls.push({
      kind: "dots",
      alpha: o.alpha ?? 1,
      target: Boolean(o.target),
      halo: o.pass === "halo",
      // Only the first n are live: the globe reuses one buffer.
      r: d.n ? median(d.r.subarray(0, d.n)) * k : 0,
    });
  }
  line(_pts: unknown, o: { alpha?: number }) {
    this.calls.push({
      kind: "line",
      alpha: o.alpha ?? 1,
      target: false,
      halo: false,
      r: 0,
    });
  }
  label(_text: string, _x: number, _y: number, o: { alpha?: number }) {
    this.calls.push({
      kind: "label",
      alpha: o.alpha ?? 1,
      target: false,
      halo: false,
      r: 0,
    });
  }
  screen(x: number, y: number) {
    return toScreen(this.c, x, y);
  }
}

const dots = plate();

describe.each(Object.keys(SCENES))("the %s scene", (slug) => {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    it(`plays through and ends on its big dots alone (${w}×${h})`, () => {
      const scene = SCENES[slug];
      const staged = ready(scene, dots, false);
      const card: Cam = { ax: 300, ay: 300, fx: 440, fy: 330, s: 0.4 };
      const stage: Cam = {
        ax: w / 2,
        ay: h / 2,
        fx: 440,
        fy: 330,
        s: (0.86 * w) / 880,
      };
      const big = Math.max(22, Math.min(56, 0.05 * Math.min(w, h)));
      const ctx: SceneContext = {
        dots,
        parts: staged.parts,
        r0: median(dots.r),
        rand: seeded(1),
        dark: false,
        w,
        h,
        lift: (t) => camLerp(card, stage, smootherstep(t / 450)),
        stage,
        big: (r) => big / r,
      };
      const run = scene.start(ctx, staged.prep);
      expect(run.duration).toBeGreaterThan(1800);
      expect(run.duration).toBeLessThan(3200);

      const p = new Recorder(w, h, staged.parts);
      for (let t = 0; t < run.duration; t += 50) {
        p.calls = [];
        run.draw(t, p);
        expect(p.calls.length).toBeGreaterThan(0);
      }

      p.calls = [];
      run.draw(run.duration, p);
      const showing = p.calls.filter((c) => !c.halo && c.alpha > 0.01);
      expect(showing.length).toBeGreaterThan(0);
      for (const c of showing) {
        expect(c.target, `${c.kind} still showing at the end`).toBe(true);
        // Big enough to open the page through.
        expect(c.r).toBeGreaterThan(big * 0.3);
      }
    });
  }
});
