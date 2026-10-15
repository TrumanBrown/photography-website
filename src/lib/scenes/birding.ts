import { defineScene } from "./engine";
import {
  aim,
  apply,
  chain,
  clamp01,
  dive,
  type Dots,
  easeOut,
  grow,
  lerp,
  type Mat,
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
 * Birding: the oystercatcher looks about in quick bird-like snaps, crouches,
 * and takes off at you. Its wings open and beat, the last downstroke
 * sweeping right over the screen, and the page opens behind the wing's dots
 * the way it swept.
 */

const DEG = Math.PI / 180;
/** Where the head turns on the neck; turning toward you, its back edge stays put. */
const NECK = [612, 196] as const;
const HEAD_BACK = 598;
/** Where the near wing joins the back; the far wing sits a little behind. */
const SHOULDER = [500, 214] as const;
const FAR_SHOULDER = [478, 204] as const;
const FEET = [450, 482] as const;
const HIP = [450, 398] as const;

const CROUCH_FROM = 1130;
const LAUNCH = 1270;
const DIVE_FROM = 1700;
const DIVE_MS = 760;

/**
 * Head poses: when the snap starts, tilt (degrees, + is down), and how much
 * of its profile shows (1 side on; small, turned to look right at you).
 */
const LOOKS: Array<[number, number, number]> = [
  [500, -16, 1],
  [680, 8, 1],
  [850, -4, 0.6],
  [1030, 0, 1],
];
const SNAP_MS = 70;

/** Wing angle (degrees; 0 points ahead, -90 up, 90 down) through the flight. */
const BEATS: Array<[number, number]> = [
  [LAUNCH, -165],
  [LAUNCH + 100, -126],
  [LAUNCH + 270, 32],
  [LAUNCH + 420, -118],
  [DIVE_FROM + DIVE_MS * 0.85, 44],
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
      "head",
      [
        [
          [580, 60],
          [705, 60],
          [775, 212],
          [748, 242],
          [640, 212],
          [585, 200],
        ],
      ],
    ],
    [
      "legs",
      [
        [
          [405, 397],
          [500, 397],
          [505, 488],
          [405, 488],
        ],
      ],
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

  prepare(_dots, r0) {
    return { wing: makeWing(r0) };
  },

  start(ctx, prep) {
    const { w, h } = ctx;

    const headAt = (t: number): Mat => {
      let tilt = 0;
      let facing = 1;
      for (const [at, toTilt, toFacing] of LOOKS) {
        const k = easeOut(seg(t, at, at + SNAP_MS), 3);
        tilt = lerp(tilt, toTilt, k);
        facing = lerp(facing, toFacing, k);
      }
      return chain(
        turn(tilt * DEG, NECK[0], NECK[1]),
        scale(facing, 1, HEAD_BACK, 0),
      );
    };
    // A crouch, then up and away toward you.
    const crouch = (t: number) =>
      Math.sin(Math.PI * seg(t, CROUCH_FROM, LAUNCH + 60)) *
      (t < LAUNCH ? 1 : 1 - seg(t, LAUNCH, LAUNCH + 60));
    const birdAt = (t: number): Mat => {
      const fly = smootherstep(seg(t, LAUNCH, DIVE_FROM + 300));
      const k = 1 + 0.75 * fly;
      const c = crouch(t);
      return chain(
        move(150 * fly, -210 * fly),
        scale(k, k, SHOULDER[0], SHOULDER[1]),
        turn(-6 * fly * DEG, SHOULDER[0], SHOULDER[1]),
        scale(1 + 0.02 * c, 1 - 0.07 * c, FEET[0], FEET[1]),
      );
    };
    const beat = (t: number) => {
      let a = BEATS[0][1];
      for (let i = 1; i < BEATS.length; i++) {
        const [t0] = BEATS[i - 1];
        const [t1, a1] = BEATS[i];
        a = lerp(a, a1, smootherstep(seg(t, t0, t1)));
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

    // Dive into the inner wing, as it comes down over the screen.
    const [ax, ay] = aim(prep.wing, [150, 40], 70, 20, 110);
    const rWing = radiusNear(prep.wing, ax, ay, 20);
    const from = ctx.lift(DIVE_FROM);
    const last = DIVE_FROM + DIVE_MS;
    const end = ctx.big((rWing * grow(wingAt(last))) / Math.sqrt(span(last)));

    return {
      duration: DIVE_FROM + DIVE_MS,
      reveal: { wave: [0.35, 1] },
      draw(t, p) {
        if (t < DIVE_FROM) p.cam(ctx.lift(t));
        else {
          const [tx, ty] = apply(wingAt(t), ax, ay);
          p.cam(
            dive(
              from,
              tx,
              ty,
              end,
              seg(t, DIVE_FROM, DIVE_FROM + DIVE_MS),
              w / 2,
              h / 2,
            ),
          );
        }
        const flying = t >= LAUNCH;
        const away = 1 - smootherstep(seg(t, LAUNCH + 100, LAUNCH + 420));
        const behind =
          1 - smootherstep(seg(t, DIVE_FROM + 80, DIVE_FROM + DIVE_MS * 0.55));
        const bird = birdAt(t);

        p.part("ground", undefined, { alpha: away });
        // The far wing, behind the body: raised with the near one in a V,
        // and hidden by the body on the downstroke.
        if (flying)
          p.dots(prep.wing, wingAt(t, true), {
            alpha: 0.8 * behind * smootherstep(seg(t, LAUNCH, LAUNCH + 80)),
            size: 1 / Math.sqrt(span(t)),
          });
        p.part(
          "legs",
          chain(bird, scale(1, lerp(1, 0.35, 1 - away), HIP[0], HIP[1])),
          { alpha: away },
        );
        p.part("rest", bird, { alpha: behind, halo: flying ? 1.2 : 0 });
        p.part("head", chain(bird, headAt(t)), { alpha: behind });
        // Foreshortening packs the dots closer; the pen stays the same.
        if (flying)
          p.dots(prep.wing, wingAt(t), {
            target: true,
            halo: 1.4,
            alpha: smootherstep(seg(t, LAUNCH, LAUNCH + 60)),
            size: 1 / Math.sqrt(span(t)),
          });
      },
    };
  },
});
