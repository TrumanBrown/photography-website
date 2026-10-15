import { defineScene, LIFT_MS } from "./engine";
import {
  along,
  type Cam,
  camLerp,
  chain,
  clamp01,
  dive,
  type Dots,
  lerp,
  type Mat,
  move,
  type Pt,
  scale,
  seg,
  seeded,
  segDist,
  smootherstep,
  stipple,
  turn,
} from "./stage";

/**
 * Hiking: a little hiker climbs the ridge to the summit, throws both arms
 * up, and the camera dives into him until his dots are big enough to open
 * the page through. He walks the mountain's real skyline, read off the
 * plate's dots.
 */

const DEG = Math.PI / 180;
/** The ridge he climbs: from its foot on the right to the summit. */
const FOOT_X = 806;
const SUMMIT_NEAR = 430;

const APPEAR = 360;
const WALK_FROM = LIFT_MS;
const WALK_MS = 1120;
const CHEER_FROM = WALK_FROM + WALK_MS;
const CHEER_MS = 420;
const DIVE_FROM = CHEER_FROM + CHEER_MS;
const DIVE_MS = 760;
/** Ground covered per stride, card units. */
const STRIDE = 15;

/** Joints, hiker units: feet at the origin, he faces -x. */
const HIP = 17;
const SHOULDER = 30;
const HEAD = 38;
/** How big he is on the mountain. */
const SIZE = 1.45;

interface Prep {
  path: Pt[];
  leg: Dots;
  arm: Dots;
  torso: Dots;
  head: Dots;
  pack: Dots;
  r: number;
}

/** The ridge's top edge, read off the dots, from its foot up to the summit. */
function skyline(d: Dots): Pt[] {
  const tops: Pt[] = [];
  for (let x = FOOT_X; x >= SUMMIT_NEAR - 40; x -= 5) {
    const ys: number[] = [];
    for (let i = 0; i < d.n; i++)
      if (Math.abs(d.x[i] - x) <= 4 && d.y[i] < 330) ys.push(d.y[i]);
    ys.sort((a, b) => a - b);
    // The second-highest dot, so a stray one doesn't make a spike.
    if (ys.length > 1) tops.push([x, ys[1]]);
  }
  // Smooth it, and stop at the summit.
  const smooth: Pt[] = tops.map(([x], i) => {
    const near = tops.slice(Math.max(0, i - 1), i + 2);
    return [x, near.reduce((sum, [, y]) => sum + y, 0) / near.length];
  });
  let peak = 0;
  smooth.forEach(([, y], i) => {
    if (y < smooth[peak][1]) peak = i;
  });
  return smooth.slice(0, peak + 1);
}

/** A limb: a stippled capsule hanging down from a joint at the origin. */
function capsule(length: number, width: number, r: number, rand: () => number) {
  return stipple(
    (x, y) => (segDist(x, y, 0, 0, 0, length) <= width / 2 ? 1 : 0),
    [-width, -width, width, length + width],
    r,
    rand,
  );
}

export default defineScene<Prep>({
  prepare(dots, r0) {
    const rand = seeded(53);
    // Drawn small and scaled up by SIZE: on the mountain, the plate's own pen.
    const r = (r0 * 0.95) / SIZE;
    return {
      path: skyline(dots),
      leg: capsule(HIP - 1.5, 3.6, r, rand),
      arm: capsule(12, 3, r, rand),
      torso: capsule(SHOULDER - HIP + 2, 7, r, rand),
      head: stipple(
        (x, y) => (Math.hypot(x, y) <= 4.6 ? 1 : 0),
        [-5, -5, 5, 5],
        r,
        rand,
      ),
      pack: stipple(
        (x, y) => (x > 0 && x < 6 && y > 0 && y < 11 ? 0.8 : 0),
        [0, 0, 6, 11],
        r,
        rand,
      ),
      r,
    };
  },

  start(ctx, prep) {
    const { w, h } = ctx;
    const path =
      prep.path.length > 1
        ? prep.path
        : ([
            [FOOT_X, 288],
            [SUMMIT_NEAR, 64],
          ] as Pt[]);
    const length = path.reduce(
      (sum, [x, y], i) =>
        i ? sum + Math.hypot(x - path[i - 1][0], y - path[i - 1][1]) : 0,
      0,
    );

    // A steady pace, picking up at the start and slowing at the top.
    const walked = (t: number) => {
      const u = seg(t, WALK_FROM, WALK_FROM + WALK_MS);
      const ramp = 0.15;
      const v = 1 / (1 - ramp);
      if (u < ramp) return (v * u * u) / (2 * ramp);
      if (u > 1 - ramp) return 1 - (v * (1 - u) * (1 - u)) / (2 * ramp);
      return v * (u - ramp / 2);
    };
    const where = (t: number) => along(path, clamp01(walked(t)));
    const cheer = (t: number) =>
      smootherstep(seg(t, CHEER_FROM, CHEER_FROM + 160));
    const hop = (t: number) => {
      const k = seg(t, CHEER_FROM + 60, CHEER_FROM + 300);
      return k > 0 && k < 1 ? -7 * 4 * k * (1 - k) : 0;
    };

    /** The hiker's frame: feet on the ridge, upright, a little leaned in. */
    const bodyAt = (t: number): Mat => {
      const { x, y, angle } = where(t);
      const pop = smootherstep(seg(t, APPEAR, APPEAR + 160));
      // Climbing, he leans into the slope.
      const lean = (1 - cheer(t)) * -12 * Math.abs(Math.sin(angle)) * DEG;
      const k = SIZE * lerp(0.6, 1, pop);
      return chain(move(x, y - 0.6 + hop(t)), turn(lean), scale(k, k));
    };

    const step = (t: number) => (walked(t) * length) / STRIDE;
    const swing = (t: number) => Math.sin(step(t) * Math.PI) * (1 - cheer(t));

    const look = (t: number): Cam => {
      const base = ctx.lift(t);
      const { x, y } = where(t);
      const near: Cam = {
        ax: w / 2,
        ay: h * 0.55,
        fx: x,
        fy: y - 34,
        s:
          base.s *
          lerp(1.5, 2.1, smootherstep(seg(t, CHEER_FROM - 300, DIVE_FROM))),
      };
      return camLerp(
        base,
        near,
        0.88 * smootherstep(seg(t, WALK_FROM, CHEER_FROM + 200)),
      );
    };
    const from = look(DIVE_FROM);
    const end = ctx.big(prep.r * SIZE);

    return {
      duration: DIVE_FROM + DIVE_MS,
      reveal: { from: [0.5, 0.5] },
      draw(t, p) {
        const body = bodyAt(t);
        if (t < DIVE_FROM) p.cam(look(t));
        else {
          const [cx, cy] = [body[2] * -26 + body[4], body[3] * -26 + body[5]];
          p.cam(
            dive(
              from,
              cx,
              cy,
              end,
              seg(t, DIVE_FROM, DIVE_FROM + DIVE_MS),
              w / 2,
              h / 2,
            ),
          );
        }
        p.part("rest", undefined, {
          alpha: 1 - smootherstep(seg(t, DIVE_FROM, DIVE_FROM + DIVE_MS * 0.5)),
        });

        const shown = smootherstep(seg(t, APPEAR, APPEAR + 120));
        if (shown <= 0) return;
        const s = swing(t);
        const up = cheer(t);
        const limb = (y: number, a: number) =>
          chain(body, move(0, -y), turn(a));
        // Far side first, then the body, then the near side.
        const pieces: Array<[Dots, Mat]> = [
          [prep.arm, limb(SHOULDER, (-24 * s + lerp(0, 205, up)) * DEG)],
          [prep.leg, limb(HIP, -28 * s * DEG)],
          [prep.pack, chain(body, move(2.5, -SHOULDER + 1))],
          [prep.torso, chain(body, move(0, -SHOULDER - 1))],
          [prep.head, chain(body, move(-0.5, -HEAD))],
          [prep.leg, limb(HIP, 28 * s * DEG)],
          [prep.arm, limb(SHOULDER, (24 * s + lerp(0, 155, up)) * DEG)],
        ];
        // Paper round the whole figure first, so it stands off the mountain.
        for (const [d, m] of pieces)
          p.dots(d, m, { alpha: shown, halo: 1.3, pass: "halo" });
        for (const [d, m] of pieces)
          p.dots(d, m, { alpha: shown, target: true, pass: "ink" });
      },
    };
  },
});
