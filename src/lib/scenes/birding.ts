import { ACT, defineScene, LEAVE, type Painter } from "./engine";
import {
  apply,
  chain,
  clamp01,
  type Dots,
  easeIn,
  easeOut,
  exitDistance,
  grow,
  lastOf,
  lerp,
  makeDots,
  type Mat,
  move,
  outline,
  type Passing,
  pick,
  type Pt,
  scale,
  screenGrid,
  seg,
  seeded,
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
 * Birding: the oystercatcher looks about, tipping and turning its head,
 * crouches and springs into the air, wings opening, and flies up and out of
 * the top of the screen with its legs trailing. Its shadow on the sand
 * fades as it goes, and the hobby page opens in dots along its trail.
 *
 * It all plays over the hobby page, after the hold (see engine.ts).
 */

const DEG = Math.PI / 180;
/**
 * The head bends on the neck: dots on the head's side of this line (a point
 * on it, and the normal toward the head) move with it, shading off across
 * the neck so the dots never part.
 */
const NECK = [585, 70] as const;
const TOWARD_HEAD = [0.916, -0.4] as const;
const NECK_SOFT = 60;
/** It tips about the base of the neck... */
const PIVOT = [604, 214] as const;
/** ...and turning toward you, its beak looks shorter. */
const HEAD_MID = [632, 140] as const;
const BEAK = [0.739, 0.674] as const;
/** Where the near wing joins the back; the far wing sits a little behind. */
const SHOULDER = [500, 214] as const;
const FAR_SHOULDER = [478, 204] as const;
const FEET = [450, 482] as const;
/** Its legs, white on the plate against the shadow: hip, foot, half-widths. */
const LEGS: ReadonlyArray<
  readonly [number, number, number, number, number, number]
> = [
  [407, 390, 409, 474, 11, 7],
  [452, 402, 466, 442, 9, 7],
];
/** The shadow round its feet, as an ellipse. */
const SHADOW = [474, 448, 104, 46] as const;

/** Head poses, ms after the hold: tilt (degrees, + is down) and turn toward you (0 to 1). */
const LOOKS: Array<[number, number, number]> = [
  [0, -5, 0],
  [330, 5, 0.6],
  [650, -2, 0],
];
const LOOK_MS = 210;
const CROUCH_FROM = ACT + 640;
const LAUNCH = ACT + 860;
const FLY_MS = 560;
/** Which way it flies: up, and a little ahead. */
const HEADING = Math.atan2(-1, 0.36);
/** How long a dot of the page takes to open, and how fast the opening spreads, px/ms. */
const GROW = 140;
const SPREAD = 2.4;

/**
 * Wing beats, ms after it springs: how far each wing is raised (degrees; 90
 * straight up, -90 straight down) and how far it's spread.
 */
const BEATS: Array<[number, number, number]> = [
  [0, 20, 0.3],
  [110, 75, 0.9],
  [250, -62, 1],
  [390, 74, 0.85],
  [530, -58, 1],
  [660, 72, 0.85],
];
/** The wings sweep back, and you see them from a little above. */
const SWEEP = 24 * DEG;
const ABOVE = 12 * DEG;
const WING_SIZE = 0.86;
/** The shadow thins to the sand round it, as dots this share of it stays. */
const SAND = 0.22;

/**
 * A black oystercatcher's wing from above, shoulder at the origin, reaching
 * along +x, leading edge up (-y): broad secondaries along the arm, then the
 * primaries sweeping to a point, the outer ones fingered apart.
 */
const SPAN = 400;
/** Where the hand starts, and how far apart the feathers' tips are. */
const HAND = 170;
const PRIMARY = 23;
const SECONDARY = 21;
const lead = (x: number) =>
  -18 - 10 * Math.sin((Math.PI * 0.9 * x) / SPAN) + 10 * (x / SPAN) ** 3;
/** The trailing edge's line, before the feathers' tips are cut into it. */
const trailLine = (x: number) =>
  x < HAND ? 70 - 0.024 * x : 66 - 70 * ((x - HAND) / (SPAN - HAND)) ** 1.15;
/** How deep the notch between feathers is at x, 0 at a feather's tip. */
function notch(x: number): number {
  const from = x < HAND ? 0 : HAND;
  const gap = x < HAND ? SECONDARY : PRIMARY;
  const f = ((((x - from) / gap) % 1) + 1) % 1;
  const depth = x < HAND ? 3 : x > SPAN - 4 * PRIMARY ? 15 : 6;
  return depth * (1 - smoothstep(Math.min(f, 1 - f) / 0.2));
}

function wingShape() {
  const edge: Pt[] = [];
  for (let x = 0; x <= SPAN; x += 4) edge.push([x, lead(x)]);
  for (let x = SPAN; x >= 0; x -= 1) edge.push([x, trailLine(x) - notch(x)]);
  // Where the feathers part: from each notch, raked out toward the tip.
  const parts: Array<readonly [number, number, number]> = [];
  for (let x = SECONDARY; x < HAND; x += SECONDARY)
    parts.push([x, trailLine(x) - 3, 0.25]);
  for (let x = HAND + PRIMARY; x < SPAN; x += PRIMARY)
    parts.push([x, trailLine(x) - notch(x), 0.55]);
  return { edge: outline(edge), parts };
}

/** Its wing, from above (dark) or below (a shade paler). */
function makeWing(r0: number, under: boolean): Dots {
  const { edge, parts } = wingShape();
  const dots = stipple(
    (x, y) => {
      if (!edge.inside(x, y)) return 0;
      if (edge.near(x, y, 1.8)) return 1;
      const top = lead(x);
      const chord = (y - top) / Math.max(20, trailLine(x) - top);
      // Feathers part along lines from each notch, raked toward the tip.
      for (const [px, py, rake] of parts) {
        const k = (py - y) / (0.5 * (trailLine(px) - lead(px)));
        if (k < 0 || k > 1) continue;
        if (Math.abs(x - (px - 18 * k + rake * 30 * k)) < 1.1)
          return under ? 0.12 : 0.18;
      }
      // Small coverts by the leading edge, a line of greater coverts, then
      // the flight feathers.
      if (chord < 0.3) return under ? 0.36 : 0.5;
      if (chord < 0.5)
        return Math.abs(chord - 0.5) * (trailLine(x) - top) < 1.3
          ? 0.95
          : under
            ? 0.46
            : 0.68;
      return under ? 0.58 : 0.86;
    },
    [-2, -34, SPAN + 2, 76],
    r0,
    seeded(under ? 33 : 31),
  );
  // In no order, so any first share of them is spread over the whole wing.
  const rand = seeded(under ? 35 : 34);
  const order = Array.from({ length: dots.n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return pick(dots, order);
}

interface Prep {
  /** A wing seen from above, and from below. */
  wing: Dots;
  under: Dots;
  /** Dots to close the white of its legs in the shadow once they've gone. */
  fill: Dots;
  /** Its legs: a pen outline, and discs of paper inside it. */
  legs: Dots;
  legPaper: Dots;
}

/** Where the plate's dots leave white gaps for its legs, filled at the shadow's density. */
function legGaps(d: Dots, r0: number): Dots {
  const box = [384, 384, 482, 484] as const;
  const near: number[] = [];
  for (let i = 0; i < d.n; i++)
    if (
      d.x[i] > box[0] - 8 &&
      d.x[i] < box[2] + 8 &&
      d.y[i] > box[1] - 8 &&
      d.y[i] < box[3] + 8
    )
      near.push(d.x[i], d.y[i]);
  const clear = (x: number, y: number, r: number) => {
    for (let i = 0; i < near.length; i += 2)
      if (Math.hypot(near[i] - x, near[i + 1] - y) < r) return false;
    return true;
  };
  return stipple(
    (x, y) => (inLeg(x, y, 4) && clear(x, y, 3.6) ? 0.85 : 0),
    box,
    r0,
    seeded(37),
  );
}

/** How far inside a leg a point is, give or take `more`. */
function inLeg(x: number, y: number, more = 0): boolean {
  for (const [x0, y0, x1, y1, r0, r1] of LEGS) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const u = clamp01(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy));
    const r = lerp(r0, r1, u) + more;
    if (Math.hypot(x - x0 - u * dx, y - y0 - u * dy) < r) return true;
  }
  return false;
}

/**
 * The legs drawn as the plate draws them: white, edged in dots, or on the
 * dark plates, in light dots.
 */
function makeLegs(r0: number, dark: boolean) {
  const rand = seeded(43);
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  const px: number[] = [];
  const py: number[] = [];
  const pr: number[] = [];
  for (const [x0, y0, x1, y1, w0, w1] of LEGS) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    for (let at = 0; at <= len; at += 3) {
      const k = at / len;
      const half = lerp(w0, w1, k);
      const cx = x0 + ux * at;
      const cy = y0 + uy * at;
      px.push(cx);
      py.push(cy);
      pr.push(Math.max(1, half - 1.5));
      // Its edges, a dot every so often, either side.
      for (const side of [-1, 1]) {
        if (rand() < 0.25) continue;
        xs.push(cx - uy * side * (half + 0.6) + (rand() - 0.5) * 0.8);
        ys.push(cy + ux * side * (half + 0.6) + (rand() - 0.5) * 0.8);
        rs.push(r0 * (0.85 + 0.2 * rand()));
      }
    }
    // Toes.
    for (const [tx, ty] of [
      [-12, 4],
      [10, 5],
      [2, 7],
    ]) {
      for (let k = 0.2; k <= 1; k += 0.2) {
        xs.push(x1 + tx * k);
        ys.push(y1 + ty * k);
        rs.push(r0 * 0.85);
      }
    }
  }
  if (dark)
    return {
      legs: stipple(
        (x, y) => (inLeg(x, y) ? 0.8 : 0),
        [384, 384, 482, 484],
        r0,
        rand,
      ),
      legPaper: makeDots(px, py, pr),
    };
  return {
    legs: makeDots(xs, ys, rs),
    legPaper: makeDots(px, py, pr),
  };
}

export default defineScene<Prep>({
  parts: [
    [
      "shadow",
      (x: number, y: number) =>
        ((x - SHADOW[0]) / SHADOW[2]) ** 2 +
          ((y - SHADOW[1]) / SHADOW[3]) ** 2 <
          1 && y > 392,
    ],
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

  prepare(dots, r0, dark) {
    return {
      wing: makeWing(r0, false),
      under: makeWing(r0, true),
      fill: dark ? makeDots([], [], []) : legGaps(dots, r0),
      ...makeLegs(r0, dark),
    };
  },

  start(ctx, prep) {
    const { w, h } = ctx;

    // The head: tipped and turned by a field that fades across the neck.
    const lookAt = (t: number) => {
      let tilt = 0;
      let turned = 0;
      for (const [at, toTilt, toTurn] of LOOKS) {
        const k = smootherstep(seg(t, ACT + at, ACT + at + LOOK_MS));
        tilt = lerp(tilt, toTilt, k);
        turned = lerp(turned, toTurn, k);
      }
      // As it springs, the neck stretches up and forward.
      const reach = smootherstep(seg(t, LAUNCH - 40, LAUNCH + 160));
      return { tilt: (tilt - 6 * reach) * DEG, turned };
    };
    let tilt = 0;
    let turned = 0;
    const bendHead = (x: number, y: number, out: Float64Array) => {
      const d = (x - NECK[0]) * TOWARD_HEAD[0] + (y - NECK[1]) * TOWARD_HEAD[1];
      const k = smoothstep((d + 16) / NECK_SOFT);
      out[0] = x;
      out[1] = y;
      if (k <= 0) return;
      // Turned toward you, the beak and the front of the head foreshorten.
      const along = (x - HEAD_MID[0]) * BEAK[0] + (y - HEAD_MID[1]) * BEAK[1];
      let px = x;
      let py = y;
      if (along > 0 && turned > 0) {
        const short = 0.3 * turned * k * Math.min(1, along / 60);
        px -= BEAK[0] * along * short;
        py -= BEAK[1] * along * short;
      }
      const a = tilt * k;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = px - PIVOT[0];
      const dy = py - PIVOT[1];
      out[0] = PIVOT[0] + c * dx - s * dy;
      out[1] = PIVOT[1] + s * dx + c * dy;
    };

    // A crouch that runs straight into a spring up off the ground.
    const crouch = (t: number) =>
      smootherstep(seg(t, CROUCH_FROM, LAUNCH)) *
      (1 - smootherstep(seg(t, LAUNCH, LAUNCH + 70)));
    const stretch = (t: number) =>
      Math.sin(Math.PI * seg(t, LAUNCH, LAUNCH + 200));
    const fly = (t: number) => seg(t, LAUNCH, LAUNCH + FLY_MS);
    let distance = 0;
    const birdAt = (t: number): Mat => {
      const u = fly(t);
      const pop = easeOut(seg(t, LAUNCH, LAUNCH + 180), 2);
      const d = distance * easeIn(u, 1.8);
      const k = 1 + 0.15 * easeIn(u, 1.5);
      const c = crouch(t);
      const st = stretch(t);
      return chain(
        move(
          14 * pop + Math.cos(HEADING) * d,
          -60 * pop + Math.sin(HEADING) * d,
        ),
        scale(k, k, SHOULDER[0], SHOULDER[1]),
        turn(-13 * DEG * smoothstep(u / 0.45), SHOULDER[0], SHOULDER[1]),
        scale(
          1 + 0.025 * c - 0.02 * st,
          1 - 0.08 * c + 0.06 * st,
          FEET[0],
          FEET[1],
        ),
      );
    };
    // Its legs go with it, swinging back to trail under its tail.
    const legsAt = (t: number): Mat => {
      const k = smootherstep(seg(t, LAUNCH + 40, LAUNCH + 300));
      return chain(
        birdAt(t),
        turn(68 * DEG * k, 420, 392),
        scale(1, 1 - 0.3 * k, 420, 392),
      );
    };

    let birdM: Mat = birdAt(0);
    const pose = (x: number, y: number, out: Float64Array) => {
      bendHead(x, y, out);
      const px = out[0];
      const py = out[1];
      out[0] = birdM[0] * px + birdM[2] * py + birdM[4];
      out[1] = birdM[1] * px + birdM[3] * py + birdM[5];
      out[2] = 1;
    };

    // The wing beats, read off BEATS.
    const beat = (t: number) => {
      const at = t - LAUNCH;
      let up = BEATS[0][1];
      let spread = BEATS[0][2];
      for (let i = 1; i < BEATS.length; i++) {
        const [t0] = BEATS[i - 1];
        const [t1, u1, s1] = BEATS[i];
        const k = smootherstep(seg(at, t0, t1));
        up = lerp(up, u1, k);
        spread = lerp(spread, s1, k);
      }
      return { up: up * DEG, spread };
    };
    /**
     * A wing seen from the side and a little above: its span swings up and
     * down about the body, swept back, while its trailing edge always
     * trails; the far wing is the near one mirrored through the body.
     */
    const wingAt = (t: number, far = false): Mat => {
      const { up, spread } = beat(t);
      const side = far ? -1 : 1;
      const sb = Math.sin(SWEEP);
      const cb = Math.cos(SWEEP);
      const sp = Math.sin(up);
      const cp = Math.cos(up) * side;
      const ca = Math.cos(ABOVE);
      const sa = Math.sin(ABOVE);
      // Span and chord in 3D (x ahead, y up, z toward you), then on screen.
      const span = [-sb, sp * cb, cp * cb];
      const chord = [-cb, -sb * sp, -sb * cp];
      const L = WING_SIZE * spread;
      const W = WING_SIZE;
      const [sx, sy] = far ? FAR_SHOULDER : SHOULDER;
      return chain(birdAt(t), move(sx, sy), [
        span[0] * L,
        (-span[1] * ca + span[2] * sa) * L,
        chord[0] * W,
        (-chord[1] * ca + chord[2] * sa) * W,
        0,
        0,
      ]);
    };
    /**
     * How square on you see a wing, 1 flat on and 0 edge on, and from which
     * side: the near wing shows its underside raised, the far one its top.
     */
    const facing = (t: number, far: boolean) => {
      const m = wingAt(t, far);
      const det = (m[0] * m[3] - m[1] * m[2]) / grow(birdAt(t)) ** 2;
      const seen = Math.abs(det) / (WING_SIZE * WING_SIZE);
      return { seen: Math.min(1, seen), under: far ? det > 0 : det < 0 };
    };
    const drawWing = (p: Painter, t: number, far: boolean, alpha: number) => {
      const m = wingAt(t, far);
      const { seen, under } = facing(t, far);
      // In the plate's pen, as evenly spread, whatever its angle: the less
      // of it faces you, the fewer of its dots (they're in no order). Edge
      // on, it all but goes, the way a quick wing blurs.
      const d = under ? prep.under : prep.wing;
      p.dots({ ...d, n: Math.round(d.n * Math.min(1, 1.1 * seen)) }, m, {
        alpha: alpha * smoothstep(seen / 0.12),
        size: 1 / (WING_SIZE * Math.sqrt(Math.max(seen, 0.04))),
        halo: far ? 1.2 : 1.4,
      });
    };

    const held = ctx.lift(LEAVE);
    const onScreen = (m: Mat, x: number, y: number) => {
      const [X, Y] = apply(m, x, y);
      return toScreen(held, X, Y);
    };

    // How far it flies: until the bird, its wings and legs are off the screen.
    const end = LAUNCH + FLY_MS;
    const bird = ctx.parts.rest;
    const tips = [0, 150, 300, 440];
    const pts = new Float64Array((bird.n + tips.length * 2 + 2) * 2);
    distance =
      exitDistance(
        (k) => {
          distance = k;
          const m = birdAt(end);
          for (let i = 0; i < bird.n; i++)
            [pts[i * 2], pts[i * 2 + 1]] = onScreen(m, bird.x[i], bird.y[i]);
          let at = bird.n * 2;
          for (const wing of [wingAt(end), wingAt(end, true)])
            for (const x of tips) {
              [pts[at], pts[at + 1]] = onScreen(wing, x, 0);
              at += 2;
            }
          for (const [, , x1, y1] of LEGS) {
            [pts[at], pts[at + 1]] = onScreen(legsAt(end), x1, y1);
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

    // The shadow thins out to the sand round it as it rises: most of its
    // dots shrink away, each in its own time.
    let gone = 0;
    const thin = (x: number, y: number, out: Float64Array) => {
      out[0] = x;
      out[1] = y;
      out[2] = 1;
      const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const k = hash - Math.floor(hash);
      if (k < SAND) return;
      const at = ((k - SAND) / (1 - SAND)) * 0.6;
      out[2] *= 1 - smootherstep((gone - at) / 0.4);
    };
    const shadowAt = (x: number, y: number, out: Float64Array) => {
      thin(x, y, out);
      // Its legs, where the plate draws them, go with it at once.
      if (inLeg(x, y, 1)) out[2] = 1 - seg(gone, 0, 0.12);
    };

    return {
      duration,
      leave: LEAVE,
      depart: ACT,
      draw(t, p) {
        p.cam(t < LEAVE ? ctx.lift(t) : held);
        ({ tilt, turned } = lookAt(t));
        birdM = birdAt(t);
        const flying = t >= LAUNCH;
        gone = smootherstep(seg(t, LAUNCH, LAUNCH + 320));
        // The sand stays put, paling as it goes, and goes as the page opens.
        p.part("ground", undefined, {
          alpha: 1 - 0.5 * smootherstep(seg(t, LAUNCH + 40, LAUNCH + 360)),
        });
        p.part("shadow", undefined, { warp: shadowAt });
        // Its legs' white in the shadow closes up as they leave.
        if (flying)
          p.dots(prep.fill, undefined, {
            alpha: smootherstep(seg(t, LAUNCH, LAUNCH + 70)),
            warp: thin,
          });
        if (flying) p.cut(holes, wakeHoles(times, grid, t, GROW, holes));

        const open = smootherstep(seg(t, LAUNCH, LAUNCH + 60));
        // The far wing, behind it all.
        if (flying) {
          drawWing(p, t, true, open);
          const legs = legsAt(t);
          p.dots(prep.legPaper, legs, { halo: 1.2, pass: "halo" });
          p.dots(prep.legs, legs, { halo: 1 });
        }
        p.part("rest", undefined, { warp: pose, halo: flying ? 1.2 : 0 });
        if (flying) drawWing(p, t, false, open);
      },
    };
  },
});
