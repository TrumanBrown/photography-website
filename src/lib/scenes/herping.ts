import { ACT, defineScene, LEAVE } from "./engine";
import { type HandDots, makeHand } from "./hand";
import {
  apply,
  backOut,
  type Cam,
  camLerp,
  chain,
  clamp01,
  easeIn,
  easeOut,
  exitDistance,
  grow,
  lastOf,
  lerp,
  type Mat,
  move,
  type Passing,
  scale,
  screenGrid,
  seg,
  smootherstep,
  toScreen,
  turn,
  wakeHoles,
  wakeStep,
  wakeTimes,
} from "./stage";

/**
 * Herping: a hand slides in along the ground, scoops up the salamander and
 * lifts it up close, holds it there a moment while its tail sways, then
 * pulls it away off the side of the screen. The hobby page opens in dots
 * along the way it went. The hand is stippled in the plate's own pen
 * (hand.ts).
 *
 * It all plays over the hobby page, after the hold (see engine.ts).
 */

const DEG = Math.PI / 180;
/** Where the hand ends up under the salamander: its wrist, at the palm's surface. */
const WRIST = [842, 344] as const;
/** The tail hangs off the fingertips; it bends here. */
const TAIL_ROOT = [206, 216] as const;

const SLIDE_FROM = ACT;
const SLIDE_MS = 520;
const LIFT_FROM = SLIDE_FROM + SLIDE_MS + 60;
const LIFT_UP_MS = 380;
const CLOSE_FROM = LIFT_FROM + LIFT_UP_MS - 60;
const CLOSE_MS = 400;
const HELD = CLOSE_FROM + CLOSE_MS;
/** Held up close a moment, its tail swaying... */
const SHOW_MS = 400;
/** ...then pulled away. */
const PULL = HELD + SHOW_MS;
const PULL_MS = 460;
/** How much bigger it's brought up to you, and how far the camera leans in. */
const CLOSER = 1.3;
const LEAN = 1.06;
/** How long a dot of the page takes to open, and how fast the opening spreads, px/ms. */
const GROW = 140;
const SPREAD = 2.4;
/** The salamander and the hand, as discs, card units and hand units. */
const BODY: ReadonlyArray<readonly [number, number, number]> = [
  [45, 200, 35],
  [120, 210, 40],
  [260, 220, 45],
  [400, 250, 60],
  [540, 260, 70],
  [680, 220, 65],
  [790, 190, 45],
];
const PALM: ReadonlyArray<readonly [number, number, number]> = [
  [-440, 20, 40],
  [-320, 30, 45],
  [-180, 42, 55],
  [-40, 46, 55],
  [110, 46, 58],
  [240, 42, 70],
];

type Prep = HandDots;

export default defineScene<Prep>({
  parts: [
    [
      "tail",
      [
        [
          [40, 160],
          [207, 168],
          [207, 306],
          [120, 292],
          [40, 264],
        ],
      ],
    ],
    [
      "body",
      [
        [
          [200, 160],
          [640, 180],
          [660, 128],
          [842, 128],
          [842, 244],
          [772, 290],
          [772, 412],
          [690, 412],
          [648, 362],
          [604, 352],
          [536, 352],
          [530, 362],
          [522, 400],
          [562, 418],
          [562, 462],
          [498, 464],
          [492, 440],
          [468, 410],
          [446, 370],
          [428, 340],
          [300, 324],
          [207, 306],
        ],
      ],
    ],
  ],

  prepare(_dots, r0, dark) {
    return makeHand(r0, dark);
  },

  start(ctx, prep) {
    const { w, h } = ctx;

    // The hand slides in under it, lifts, and brings it close.
    const lifted = (t: number) =>
      backOut(seg(t, LIFT_FROM, LIFT_FROM + LIFT_UP_MS), 1.1);
    const close = (t: number) =>
      smootherstep(seg(t, CLOSE_FROM, CLOSE_FROM + CLOSE_MS));
    // Then away off the right, the way the arm came in, faster and faster.
    const pull = (t: number) => easeIn(seg(t, PULL, PULL + PULL_MS), 2);
    // Held up close, the hand rises and settles a little, and the tail sways.
    const showing = (t: number) =>
      smootherstep(seg(t, HELD - 140, HELD + 80)) *
      (1 - smootherstep(seg(t, PULL - 60, PULL + 140)));
    const sway = (t: number) =>
      showing(t) * Math.sin((t - HELD + 140) * 0.0095);
    const bob = (t: number) => showing(t) * Math.sin((t - HELD + 140) * 0.0072);
    let distance = 0;
    /** Hand and salamander together, once it's scooped. */
    const carry = (t: number): Mat => {
      const up = lifted(t);
      const k = lerp(1, CLOSER, close(t));
      const away = pull(t);
      return chain(
        move(
          -30 * close(t) + distance * away,
          -120 * up - 40 * close(t) - 30 * away - 5 * bob(t),
        ),
        turn(5 * DEG * away, WRIST[0], WRIST[1]),
        scale(k, k, 470, 300),
        turn(-5 * up * DEG, WRIST[0], WRIST[1]),
      );
    };
    const handAt = (t: number): Mat => {
      const slide = 1 - easeOut(seg(t, SLIDE_FROM, SLIDE_FROM + SLIDE_MS), 3);
      return chain(
        carry(t),
        move(WRIST[0] + 760 * slide, WRIST[1] + 6 * slide),
      );
    };
    // The tail droops off the fingertips, bending more toward its tip.
    let droop = 0;
    let held: Mat = carry(0);
    let heldGrow = 1;
    const bend = (x: number, y: number, out: Float64Array) => {
      const a = droop * clamp01((TAIL_ROOT[0] - x) / 150);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const dx = x - TAIL_ROOT[0];
      const dy = y - TAIL_ROOT[1];
      const bx = TAIL_ROOT[0] + c * dx - sn * dy;
      const by = TAIL_ROOT[1] + sn * dx + c * dy;
      // Then carried with the rest of it.
      out[0] = held[0] * bx + held[2] * by + held[4];
      out[1] = held[1] * bx + held[3] * by + held[5];
      out[2] = heldGrow;
    };

    const look = (t: number): Cam => {
      const base = ctx.lift(t);
      // Up with it as it's lifted, so it's held in the middle of the screen.
      const near = { ...base, fy: base.fy - 190, s: base.s * LEAN };
      return camLerp(base, near, smootherstep(seg(t, LIFT_FROM, HELD)));
    };
    const still = look(HELD);
    const onScreen = (m: Mat, x: number, y: number) => {
      const [X, Y] = apply(m, x, y);
      return toScreen(still, X, Y);
    };
    const discsAt = (t: number) => {
      const m = carry(t);
      const hand = handAt(t);
      const k = grow(m) * still.s;
      const out: number[] = [];
      for (const [x, y, r] of BODY) out.push(...onScreen(m, x, y), r * k);
      for (const [x, y, r] of PALM) out.push(...onScreen(hand, x, y), r * k);
      return out;
    };

    // How far it's pulled: until all of it is off the right of the screen.
    const end = PULL + PULL_MS;
    distance =
      exitDistance(
        (k) => {
          distance = k;
          const d = discsAt(end);
          const pts: number[] = [];
          // The discs' left edges are the last of it to go.
          for (let i = 0; i < d.length; i += 3)
            pts.push(d[i] - d[i + 2], d[i + 1]);
          return pts;
        },
        w,
        h,
        30,
      ) + 40;

    // The page opens where it's been, spreading out from there.
    const grid = screenGrid(w, h, wakeStep(w, h));
    const passing: Passing[] = [];
    for (let at = PULL + 40; at <= end; at += 25)
      passing.push({ t: at, discs: discsAt(at) });
    const times = wakeTimes(grid, passing, (d) => 40 + d / SPREAD, 50);
    const holes = new Float32Array(grid.cols * grid.rows * 3);
    const duration = Math.max(end, lastOf(times) + GROW);

    return {
      duration,
      leave: LEAVE,
      depart: ACT,
      draw(t, p) {
        p.cam(t < HELD ? look(t) : still);
        if (t > PULL) p.cut(holes, wakeHoles(times, grid, t, GROW, holes));
        const ground =
          1 - smootherstep(seg(t, LIFT_FROM + 60, CLOSE_FROM + 200));
        const hand = smootherstep(seg(t, SLIDE_FROM, SLIDE_FROM + 120));
        // No paper round them once the page shows through behind.
        const paper = 1 - seg(t, PULL + 40, PULL + 140);

        p.part("rest", undefined, { alpha: ground });
        const at = handAt(t);
        p.dots(prep.handFill, at, {
          alpha: hand,
          halo: 1.6 * paper,
          pass: "halo",
        });
        p.dots(prep.hand, at, { alpha: hand, halo: 1.6 * paper });
        droop = (-24 * lifted(t) + 8 * sway(t)) * DEG;
        held = carry(t);
        heldGrow = grow(held);
        p.part("tail", undefined, { halo: 1.2 * paper, warp: bend });
        p.part("body", carry(t), { halo: 1.2 * paper });
        p.dots(prep.thumbFill, at, {
          alpha: hand,
          halo: 1.6 * paper,
          pass: "halo",
        });
        p.dots(prep.thumb, at, { alpha: hand, halo: 1.6 * paper });
      },
    };
  },
});
