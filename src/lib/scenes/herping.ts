import { defineScene } from "./engine";
import {
  aim,
  apply,
  backOut,
  type Cam,
  camLerp,
  chain,
  clamp01,
  dive,
  dotLine,
  type Dots,
  easeOut,
  grow,
  lerp,
  type Mat,
  merge,
  move,
  outline,
  type Pt,
  radiusNear,
  scale,
  seg,
  seeded,
  smootherstep,
  stipple,
  turn,
} from "./stage";

/**
 * Herping: a hand slides in along the ground, scoops up the salamander, and
 * lifts it up close to the screen, thumb over it; the camera dives into its
 * spots. The hand is stippled in the plate's own pen.
 */

const DEG = Math.PI / 180;
/** Where the hand ends up under the salamander: its wrist, at the palm's surface. */
const WRIST = [842, 344] as const;
/** The tail hangs off the fingertips; it bends here. */
const TAIL_ROOT = [206, 216] as const;

const SLIDE_FROM = 380;
const SLIDE_MS = 560;
const LIFT_FROM = SLIDE_FROM + SLIDE_MS + 90;
const LIFT_UP_MS = 380;
const CLOSE_FROM = LIFT_FROM + LIFT_UP_MS - 60;
const CLOSE_MS = 420;
const DIVE_FROM = CLOSE_FROM + CLOSE_MS - 80;
const DIVE_MS = 760;

/**
 * A right hand, palm up, from the side: wrist at the origin, the palm's top
 * where the salamander lies, fingers along -x curling up at the tips, their
 * four tips stacked one behind the other.
 */
const HAND: Pt[] = [
  [420, -30],
  [220, -14],
  [100, -6],
  [0, 0],
  [-100, 6],
  [-200, 9],
  [-300, 6],
  [-380, 0],
  [-430, -10],
  [-458, -24],
  [-470, -36],
  [-479, -30],
  [-477, -14],
  [-467, 2],
  [-471, 12],
  [-466, 25],
  [-456, 34],
  [-459, 45],
  [-449, 55],
  [-437, 62],
  [-433, 71],
  [-418, 77],
  [-380, 81],
  [-300, 83],
  [-240, 89],
  [-150, 104],
  [-60, 118],
  [0, 122],
  [100, 116],
  [220, 110],
  [420, 120],
];
/** The thumb, up over the salamander from the near side of the palm. */
const THUMB: Pt[] = [
  [-20, 12],
  [-60, -10],
  [-110, -36],
  [-150, -56],
  [-172, -61],
  [-183, -51],
  [-171, -36],
  [-131, -14],
  [-92, 10],
  [-62, 30],
  [-30, 34],
];
/** Where the sleeve starts. */
const CUFF = 236;

interface Prep {
  hand: Dots;
  thumb: Dots;
}

function makeHand(r0: number): Prep {
  const rand = seeded(41);
  const palm = outline(HAND);
  const hand = stipple(
    (x, y) => {
      if (!palm.inside(x, y)) return 0;
      if (palm.near(x, y, 1.9)) return 1;
      if (x > CUFF) {
        // The sleeve: a dark cuff edge and a ribbed mid-tone.
        if (x < CUFF + 5) return 1;
        return 0.42 + 0.22 * Math.sin(y * 0.45);
      }
      // Skin: pale on top, shading into the underside.
      const v = clamp01(y / 120);
      return 0.05 + 0.5 * Math.pow(v, 1.6);
    },
    [-482, -34, 424, 124],
    r0,
    rand,
  );
  // Light dotted pen lines, not strokes: the plates draw edges with dots.
  const line = (pts: Pt[], k = 1) =>
    dotLine(pts, r0 * 0.8 * k, r0 * 2.7 * k, rand);
  const details = merge(
    // Where the fingers lie against each other, each curling up at its tip.
    line([
      [-236, 22],
      [-340, 20],
      [-420, 14],
      [-462, 4],
    ]),
    line([
      [-232, 44],
      [-340, 42],
      [-418, 38],
      [-452, 30],
    ]),
    line([
      [-226, 64],
      [-330, 64],
      [-408, 60],
      [-438, 54],
    ]),
    // Knuckles, and the nail on the top finger.
    line([
      [-252, 4],
      [-246, 12],
    ]),
    line([
      [-382, 2],
      [-376, 10],
    ]),
    line([
      [-440, -16],
      [-454, -24],
      [-466, -32],
    ]),
    // The crease across the palm.
    line(
      [
        [-40, 46],
        [-110, 56],
        [-190, 60],
      ],
      0.85,
    ),
  );
  const thumbShape = outline(THUMB);
  const thumb = stipple(
    (x, y) => {
      if (!thumbShape.inside(x, y)) return 0;
      if (thumbShape.near(x, y, 1.9)) return 1;
      const v = clamp01((y + 50) / 90);
      return 0.06 + 0.42 * Math.pow(v, 1.5);
    },
    [-186, -64, -16, 38],
    r0,
    rand,
  );
  const nail = line([
    [-150, -50],
    [-162, -56],
    [-172, -58],
  ]);
  return { hand: merge(hand, details), thumb: merge(thumb, nail) };
}

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

  prepare(_dots, r0) {
    return makeHand(r0);
  },

  start(ctx, prep) {
    const { w, h } = ctx;
    const body = ctx.parts.body;
    const [ax, ay] = aim(body, [430, 268], 110);

    // The hand slides in under it, lifts, and brings it close.
    const lifted = (t: number) =>
      backOut(seg(t, LIFT_FROM, LIFT_FROM + LIFT_UP_MS), 1.1);
    const close = (t: number) =>
      smootherstep(seg(t, CLOSE_FROM, CLOSE_FROM + CLOSE_MS));
    /** Hand and salamander together, once it's scooped. */
    const carry = (t: number): Mat => {
      const up = lifted(t);
      const k = lerp(1, 1.55, close(t));
      return chain(
        move(-30 * close(t), -120 * up - 40 * close(t)),
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
      const near = { ...base, fy: base.fy - 70, s: base.s * 1.12 };
      return camLerp(base, near, smootherstep(seg(t, LIFT_FROM, DIVE_FROM)));
    };
    const from = look(DIVE_FROM);
    const end = ctx.big(
      radiusNear(body, ax, ay, 20) * grow(carry(DIVE_FROM + DIVE_MS)),
    );

    return {
      duration: DIVE_FROM + DIVE_MS,
      reveal: { from: [0.5, 0.5] },
      draw(t, p) {
        const u = seg(t, DIVE_FROM, DIVE_FROM + DIVE_MS);
        if (t < DIVE_FROM) p.cam(look(t));
        else {
          const [tx, ty] = apply(carry(t), ax, ay);
          p.cam(dive(from, tx, ty, end, u, w / 2, h / 2));
        }
        const ground =
          1 - smootherstep(seg(t, LIFT_FROM + 60, CLOSE_FROM + 200));
        const hand =
          smootherstep(seg(t, SLIDE_FROM, SLIDE_FROM + 120)) *
          (1 - smootherstep(seg(t, DIVE_FROM + 40, DIVE_FROM + DIVE_MS * 0.5)));
        const tail =
          1 - smootherstep(seg(t, DIVE_FROM, DIVE_FROM + DIVE_MS * 0.5));

        p.part("rest", undefined, { alpha: ground });
        p.dots(prep.hand, handAt(t), { alpha: hand, halo: 1.6 });
        droop = -24 * lifted(t) * DEG;
        held = carry(t);
        heldGrow = grow(held);
        p.part("tail", undefined, { alpha: tail, halo: 1.2, warp: bend });
        p.part("body", carry(t), { target: true, halo: 1.2 });
        p.dots(prep.thumb, handAt(t), { alpha: hand, halo: 1.6 });
      },
    };
  },
});
