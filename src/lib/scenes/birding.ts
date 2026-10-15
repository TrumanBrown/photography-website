import { defineScene } from "./engine";
import {
  apply,
  chain,
  clamp01,
  type Dots,
  easeIn,
  easeOut,
  exitDistance,
  lastOf,
  lerp,
  type Mat,
  move,
  outline,
  type Passing,
  type Pt,
  scale,
  screenGrid,
  seg,
  seeded,
  segDist,
  smootherstep,
  smoothstep,
  stipple,
  toScreen,
  turn,
  wakeHoles,
  wakeStep,
  wakeTimes,
} from "./stage";

/**
 * Birding: the oystercatcher looks about in quick bird-like snaps, crouches,
 * and takes off up and out of the top of the screen, wings beating. The
 * hobby page opens in dots along the trail it leaves.
 *
 * The page changes while it's crouched to spring; the takeoff plays over the
 * hobby page (see engine.ts).
 */

const DEG = Math.PI / 180;
/** Where the head turns on the neck. */
const NECK = [612, 196] as const;
/**
 * The head on the plate, and the edges where it meets the body: dots blend
 * from the body's pose into the head's across those edges, so turning it
 * never opens a gap in the dots.
 */
const HEAD: Pt[] = [
  [580, 60],
  [705, 60],
  [775, 212],
  [748, 242],
  [640, 212],
  [585, 200],
];
const NECK_EDGES: ReadonlyArray<readonly [Pt, Pt]> = [
  [
    [640, 212],
    [585, 200],
  ],
  [
    [585, 200],
    [580, 60],
  ],
];
/** Where the near wing joins the back; the far wing sits a little behind. */
const SHOULDER = [500, 214] as const;
const FAR_SHOULDER = [478, 204] as const;
const FEET = [450, 482] as const;
const HIP = [450, 398] as const;

/** Head poses: when the snap starts, tilt (degrees, + is down), and how far it leans forward. */
const LOOKS: Array<[number, number, number]> = [
  [480, -15, 0],
  [650, 13, 8],
  [800, 3, 3],
  [950, -7, 0],
  [1060, 0, 0],
];
const SNAP_MS = 80;
const CROUCH_FROM = 1080;
const LEAVE = 1240;
const HOLD = 190;
const LAUNCH = LEAVE + HOLD;
const FLY_MS = 640;
/** Which way it flies: up, and a little ahead. */
const HEADING = Math.atan2(-1, 0.42);
/** How long a dot of the page takes to open, and how fast the opening spreads, px/ms. */
const GROW = 140;
const SPREAD = 2.4;

/** Wing angle (degrees; 0 points ahead, -90 up, 90 down) through the flight. */
const BEATS: Array<[number, number]> = [
  [0, -165],
  [100, -126],
  [250, 32],
  [390, -118],
  [530, 34],
  [700, -110],
];

/** An oystercatcher's wing, shoulder at the origin, reaching along +x. */
const WING: Pt[] = [
  [0, -18],
  [60, -34],
  [150, -42],
  [240, -40],
  [320, -30],
  [390, -16],
  [440, -2],
  [430, 8],
  [400, 6],
  [410, 16],
  [380, 16],
  [388, 28],
  [356, 26],
  [362, 40],
  [330, 38],
  [334, 52],
  [300, 50],
  [300, 62],
  [262, 62],
  [230, 70],
  [200, 68],
  [170, 76],
  [140, 74],
  [110, 80],
  [80, 76],
  [50, 72],
  [20, 56],
  [4, 30],
  [0, 10],
];
/** Where the white bar runs along the inner wing. */
const bar = (x: number) => lerp(34, 16, clamp01(x / 330));

interface Prep {
  wing: Dots;
}

function makeWing(r0: number): Dots {
  const wing = outline(WING);
  return stipple(
    (x, y) => {
      if (!wing.inside(x, y)) return 0;
      if (wing.near(x, y, 1.8)) return 1;
      const b = bar(x);
      if (x > 26 && x < 330 && Math.abs(y - b) < 8) return 0.06;
      if (y < b) return 0.6;
      // Paper between the flight feathers.
      for (let k = 44; k < 300; k += 30)
        if (Math.abs(x - (k + (y - b) * 0.3)) < 1.3) return 0.18;
      return 0.9;
    },
    [-2, -44, 444, 82],
    r0,
    seeded(31),
  );
}

export default defineScene<Prep>({
  parts: [
    [
      "ground",
      [
        [
          [0, 372],
          [360, 372],
          [400, 398],
          [560, 404],
          [600, 396],
          [880, 390],
          [880, 660],
          [0, 660],
        ],
      ],
    ],
  ],

  prepare(_dots, r0) {
    return { wing: makeWing(r0) };
  },

  start(ctx, prep) {
    const { w, h } = ctx;
    const head = outline(HEAD);

    /** How much of a dot moves with the head: 1 in the head, 0 in the body. */
    const headShare = (x: number, y: number) => {
      let d = Infinity;
      for (const [[ax, ay], [bx, by]] of NECK_EDGES)
        d = Math.min(d, segDist(x, y, ax, ay, bx, by));
      const inside = head.inside(x, y);
      if (!inside && d > 20) return 0;
      return inside
        ? 0.5 + 0.5 * smoothstep(d / 26)
        : 0.5 - 0.5 * smoothstep(d / 20);
    };
    /** How much of a dot is leg, below the hip. */
    const legShare = (x: number, y: number) =>
      x < 398 || x > 512 ? 0 : smoothstep((y - 392) / 16);

    const headAt = (t: number): Mat => {
      let tilt = 0;
      let lean = 0;
      for (const [at, toTilt, toLean] of LOOKS) {
        const k = easeOut(seg(t, at, at + SNAP_MS), 3);
        tilt = lerp(tilt, toTilt, k);
        lean = lerp(lean, toLean, k);
      }
      return chain(move(lean, 0.4 * lean), turn(tilt * DEG, NECK[0], NECK[1]));
    };

    // A crouch, held, then a spring up off the ground, stretching.
    const crouch = (t: number) =>
      smootherstep(seg(t, CROUCH_FROM, LEAVE)) *
      (1 - smootherstep(seg(t, LAUNCH, LAUNCH + 70)));
    const stretch = (t: number) =>
      Math.sin(Math.PI * seg(t, LAUNCH, LAUNCH + 180));
    const fly = (t: number) => seg(t, LAUNCH, LAUNCH + FLY_MS);
    let distance = 0;
    const birdAt = (t: number): Mat => {
      const u = fly(t);
      const pop = easeOut(seg(t, LAUNCH, LAUNCH + 170), 2);
      const d = distance * easeIn(u, 1.7);
      const k = 1 + 0.35 * easeIn(u, 1.5);
      const c = crouch(t);
      const st = stretch(t);
      return chain(
        move(
          16 * pop + Math.cos(HEADING) * d,
          -54 * pop + Math.sin(HEADING) * d,
        ),
        scale(k, k, SHOULDER[0], SHOULDER[1]),
        turn(-12 * DEG * smoothstep(u / 0.4), SHOULDER[0], SHOULDER[1]),
        scale(
          1 + 0.025 * c - 0.02 * st,
          1 - 0.08 * c + 0.06 * st,
          FEET[0],
          FEET[1],
        ),
      );
    };
    // Legs tuck back under it as it goes.
    const legsAt = (t: number): Mat => {
      const k = smootherstep(seg(t, LAUNCH + 60, LAUNCH + 260));
      return chain(
        turn(70 * DEG * k, HIP[0], HIP[1]),
        scale(1, 1 - 0.45 * k, HIP[0], HIP[1]),
      );
    };

    let headM: Mat = headAt(0);
    let legM: Mat = legsAt(0);
    let birdM: Mat = birdAt(0);
    const pose = (x: number, y: number, out: Float64Array) => {
      let px = x;
      let py = y;
      const hw = headShare(x, y);
      if (hw > 0) {
        const [hx, hy] = apply(headM, x, y);
        px += hw * (hx - x);
        py += hw * (hy - y);
      }
      const lw = legShare(x, y);
      if (lw > 0) {
        const [lx, ly] = apply(legM, px, py);
        px += lw * (lx - px);
        py += lw * (ly - py);
      }
      const [bx, by] = apply(birdM, px, py);
      out[0] = bx;
      out[1] = by;
      out[2] = 1;
    };

    const beat = (t: number) => {
      const at = t - LAUNCH;
      let a = BEATS[0][1];
      for (let i = 1; i < BEATS.length; i++) {
        const [t0] = BEATS[i - 1];
        const [t1, a1] = BEATS[i];
        a = lerp(a, a1, smootherstep(seg(at, t0, t1)));
      }
      return a * DEG;
    };
    /** How much of the wing's length shows: unfolding, and foreshortened mid-stroke. */
    const span = (t: number) => {
      const open = smootherstep(seg(t, LAUNCH, LAUNCH + 120));
      return lerp(0.35, 1, open) * (0.6 + 0.4 * Math.abs(Math.sin(beat(t))));
    };
    /** A wing on the bird, beating; the far one sits behind, a little lower. */
    const wingAt = (t: number, far = false): Mat => {
      const a = beat(t) + (far ? 26 * DEG : 0);
      const [sx, sy] = far ? FAR_SHOULDER : SHOULDER;
      return chain(
        birdAt(t),
        move(sx, sy),
        turn(a),
        scale(span(t) * (far ? 0.8 : 1), far ? 0.85 : 1),
      );
    };

    const cam = ctx.lift;
    const held = cam(LEAVE);
    const onScreen = (m: Mat, x: number, y: number) => {
      const [X, Y] = apply(m, x, y);
      return toScreen(held, X, Y);
    };

    // How far it flies: until the bird and its wings are off the screen.
    const end = LAUNCH + FLY_MS;
    const bird = ctx.parts.rest;
    const tips = [0, 150, 300, 440];
    const pts = new Float64Array((bird.n + tips.length * 2) * 2);
    const far: Mat[] = [];
    distance =
      exitDistance(
        (k) => {
          distance = k;
          const m = birdAt(end);
          for (let i = 0; i < bird.n; i++)
            [pts[i * 2], pts[i * 2 + 1]] = onScreen(m, bird.x[i], bird.y[i]);
          far[0] = wingAt(end);
          far[1] = wingAt(end, true);
          let at = bird.n * 2;
          for (const wing of far)
            for (const x of tips) {
              [pts[at], pts[at + 1]] = onScreen(wing, x, 0);
              at += 2;
            }
          return pts;
        },
        w,
        h,
        30,
      ) + 20;

    // The page opens along its trail, spreading out from it.
    const grid = screenGrid(w, h, wakeStep(w, h));
    const passing: Passing[] = [];
    for (let at = LAUNCH + 60; at <= end; at += 30) {
      const m = birdAt(at);
      const wing = wingAt(at);
      const discs: number[] = [];
      for (const [x, y, r] of [
        [300, 300, 90],
        [440, 290, 110],
        [620, 160, 60],
      ] as const) {
        const [sx, sy] = onScreen(m, x, y);
        discs.push(sx, sy, r * held.s);
      }
      for (const [x, r] of [
        [140, 50],
        [330, 36],
      ] as const) {
        const [sx, sy] = onScreen(wing, x, 18);
        discs.push(sx, sy, r * held.s);
      }
      passing.push({ t: at, discs });
    }
    const times = wakeTimes(grid, passing, (d) => 40 + d / SPREAD, 50);
    const holes = new Float32Array(grid.cols * grid.rows * 3);
    const duration = Math.max(end, lastOf(times) + GROW);

    return {
      duration,
      leave: LEAVE,
      depart: LAUNCH,
      draw(t, p) {
        p.cam(t < LEAVE ? cam(t) : held);
        headM = headAt(t);
        legM = legsAt(t);
        birdM = birdAt(t);
        const flying = t >= LAUNCH;

        // The ground stays put, paling where it stood once it's gone, and
        // goes as the page opens over it.
        p.part("ground", undefined, {
          alpha: 1 - 0.55 * smootherstep(seg(t, LAUNCH + 40, LAUNCH + 300)),
        });
        if (flying) p.cut(holes, wakeHoles(times, grid, t, GROW, holes));

        // The far wing, behind the body: raised with the near one in a V,
        // and hidden by the body on the downstroke.
        if (flying)
          p.dots(prep.wing, wingAt(t, true), {
            alpha: 0.8 * smootherstep(seg(t, LAUNCH, LAUNCH + 80)),
            size: 1 / Math.sqrt(span(t)),
          });
        // No paper round it once the page shows through behind it.
        const halo = flying ? 1.2 * (1 - seg(t, LAUNCH + 60, LAUNCH + 160)) : 0;
        p.part("rest", undefined, { warp: pose, halo });
        // Foreshortening packs the dots closer; the pen stays the same.
        if (flying)
          p.dots(prep.wing, wingAt(t), {
            halo: 1.4 * (1 - seg(t, LAUNCH + 60, LAUNCH + 160)),
            alpha: smootherstep(seg(t, LAUNCH, LAUNCH + 60)),
            size: 1 / Math.sqrt(span(t)),
          });
      },
    };
  },
});
