import { beforeAll, describe, expect, it } from "vitest";
import type { DrawOpts, Painter, SceneContext, SceneRun } from "./engine";
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
 * Every scene, driven through a stand-in painter. Each has to play start to
 * finish; a scene that changes page has to hold still while the next page
 * loads, come out the same when the next page builds it again, and leave
 * the next page showing with nothing of itself left on it.
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
  /** How many of its dots land on the screen. */
  seen: number;
  /** Drawn before a cut, which takes it off with the paper. */
  erased?: boolean;
}

const bent = new Float64Array(3);

class Recorder implements Painter {
  calls: Call[] = [];
  holes: number[] = [];
  opacity = 1;
  /** A running sum of everything drawn, to tell frames apart. */
  print = 0;
  private c: Cam = { ax: 0, ay: 0, fx: 0, fy: 0, s: 1 };
  constructor(
    readonly w: number,
    readonly h: number,
    private parts: Record<string, Dots>,
  ) {}
  cam(c: Cam) {
    for (const v of Object.values(c)) expect(Number.isFinite(v)).toBe(true);
    this.c = c;
    // What the camera does, not how it's written down.
    const m = camMat(c);
    this.print += m[4] * 3 + m[5] * 5 + m[0] * 7;
  }
  part(name: string, m: Mat = ID, o: DrawOpts = {}) {
    const d = this.parts[name];
    expect(d, `part ${name}`).toBeDefined();
    this.dots(d, m, o);
  }
  dots(d: Dots, m: Mat = ID, o: DrawOpts = {}) {
    const cam = o.screen ? ID : camMat(this.c);
    const M = mul(cam, m);
    const k = grow(M) * (o.size ?? 1);
    let seen = 0;
    const alpha = o.alpha ?? 1;
    for (let i = 0; i < d.n; i += 7) {
      let X: number;
      let Y: number;
      let R = d.r[i] * k;
      if (o.warp) {
        const x = m[0] * d.x[i] + m[2] * d.y[i] + m[4];
        const y = m[1] * d.x[i] + m[3] * d.y[i] + m[5];
        bent[0] = x;
        bent[1] = y;
        bent[2] = 1;
        o.warp(x, y, bent);
        X = cam[0] * bent[0] + cam[4];
        Y = cam[3] * bent[1] + cam[5];
        R *= bent[2];
      } else {
        X = M[0] * d.x[i] + M[2] * d.y[i] + M[4];
        Y = M[1] * d.x[i] + M[3] * d.y[i] + M[5];
      }
      if (R > 0.05 && X > -R && Y > -R && X < this.w + R && Y < this.h + R)
        seen++;
      this.print += (X * 0.37 + Y * 0.61 + R) * alpha;
    }
    this.calls.push({
      kind: "dots",
      alpha,
      target: Boolean(o.target),
      halo: o.pass === "halo",
      // Only the first n are live: the globe reuses one buffer.
      r: d.n ? median(d.r.subarray(0, d.n)) * k : 0,
      seen,
    });
  }
  line(_pts: unknown, o: { alpha?: number }) {
    this.calls.push({
      kind: "line",
      alpha: o.alpha ?? 1,
      target: false,
      halo: false,
      r: 0,
      seen: 1,
    });
  }
  label(_text: string, _x: number, _y: number, o: { alpha?: number }) {
    this.calls.push({
      kind: "label",
      alpha: o.alpha ?? 1,
      target: false,
      halo: false,
      r: 0,
      seen: 1,
    });
  }
  cut(holes: ArrayLike<number>, count = Math.floor(holes.length / 3)) {
    for (const c of this.calls) c.erased = true;
    for (let i = 0; i < count * 3; i++) {
      this.holes.push(holes[i]);
      this.print += holes[i] * 0.11;
    }
  }
  look(o: { opacity?: number; blur?: number }) {
    if (o.opacity !== undefined) this.opacity = o.opacity;
    this.print += (o.opacity ?? 1) * 13 + (o.blur ?? 0) * 17;
  }
  screen(x: number, y: number) {
    return toScreen(this.c, x, y);
  }
  reset() {
    this.calls = [];
    this.holes = [];
    this.opacity = 1;
    this.print = 0;
  }
}

function begin(slug: string, w: number, h: number, dots: Dots) {
  const scene = SCENES[slug];
  const staged = ready(scene, dots, false);
  const card: Cam = { ax: 300, ay: 300, fx: 440, fy: 330, s: 0.4 };
  const stage: Cam = {
    ax: w / 2,
    ay: h / 2,
    fx: 440,
    fy: 330,
    s: Math.min(0.86 * w, ((0.78 * h) / 3) * 4, 1180) / 880,
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
  return { run, painter: new Recorder(w, h, staged.parts), big };
}

function frame(run: SceneRun, p: Recorder, t: number) {
  p.reset();
  run.draw(t, p);
  return p.print;
}

const dots = plate();

describe.each(Object.keys(SCENES))("the %s scene", (slug) => {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    it(`plays through (${w}×${h})`, () => {
      const { run, painter } = begin(slug, w, h, dots);
      expect(run.duration).toBeGreaterThan(1800);
      expect(run.duration).toBeLessThan(3400);
      for (let t = 0; t < run.duration; t += 40) {
        frame(run, painter, t);
        expect(painter.calls.length).toBeGreaterThan(0);
      }
    });

    if (slug === "narrow-nature") {
      it(`ends on its big dots alone (${w}×${h})`, () => {
        const { run, painter, big } = begin(slug, w, h, dots);
        expect(run.leave ?? run.duration).toBe(run.duration);
        frame(run, painter, run.duration);
        const showing = painter.calls.filter((c) => !c.halo && c.alpha > 0.01);
        expect(showing.length).toBeGreaterThan(0);
        for (const c of showing) {
          expect(c.target, `${c.kind} still showing at the end`).toBe(true);
          expect(c.r).toBeGreaterThan(big * 0.3);
        }
      });
      continue;
    }

    it(`holds still while the next page loads (${w}×${h})`, () => {
      const { run, painter } = begin(slug, w, h, dots);
      const leave = run.leave!;
      const depart = run.depart!;
      expect(leave).toBeGreaterThan(900);
      expect(depart - leave).toBeGreaterThanOrEqual(150);
      expect(depart).toBeLessThan(run.duration - 300);
      const still = frame(run, painter, leave);
      for (const t of [leave + 1, (leave + depart) / 2, depart])
        expect(frame(run, painter, t)).toBeCloseTo(still, 3);
      // ...and it was moving up to the hold, and moves on after it.
      expect(frame(run, painter, leave - 200)).not.toBeCloseTo(still, 3);
      expect(frame(run, painter, depart + 60)).not.toBeCloseTo(still, 3);
    });

    it(`comes out the same when the next page builds it again (${w}×${h})`, () => {
      const a = begin(slug, w, h, dots);
      const b = begin(slug, w, h, plate());
      for (const t of [
        a.run.leave!,
        a.run.depart! + 100,
        (a.run.depart! + a.run.duration) / 2,
        a.run.duration,
      ])
        expect(frame(b.run, b.painter, t)).toBeCloseTo(
          frame(a.run, a.painter, t),
          6,
        );
    });

    it(`ends with the page showing and nothing of itself left (${w}×${h})`, () => {
      const { run, painter } = begin(slug, w, h, dots);
      frame(run, painter, run.duration);
      if (painter.opacity > 0.01) {
        const holes = painter.holes;
        for (let y = 0; y <= h; y += 20)
          for (let x = 0; x <= w; x += 20) {
            let open = false;
            for (let i = 0; i < holes.length && !open; i += 3)
              open = Math.hypot(x - holes[i], y - holes[i + 1]) <= holes[i + 2];
            expect(open, `paper left at ${x}, ${y}`).toBe(true);
          }
        for (const c of painter.calls)
          if (c.kind === "dots" && c.alpha > 0.01 && !c.halo && !c.erased)
            expect(
              c.seen,
              `dots still on the screen: call ${painter.calls.indexOf(c)} of ${painter.calls.length}, alpha ${c.alpha}, r ${c.r}`,
            ).toBe(0);
      }
    });
  }
});
