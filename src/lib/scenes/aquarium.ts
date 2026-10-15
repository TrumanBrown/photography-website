import { defineScene, LIFT_MS } from "./engine";
import {
  aim,
  type Cam,
  clamp01,
  dive,
  dotRing,
  type Dots,
  easeIn,
  lerp,
  move,
  radiusNear,
  seg,
  seeded,
  smootherstep,
} from "./stage";

/**
 * Aquarium keeping: bubbles rise off the gourami, it noses a little way
 * right, turns around head first with its tail following, and heads off left
 * with the camera closing in on it the whole time, until its dots fill the
 * screen. The page opens behind them in a wave, the way it swam.
 */

/** The gourami on the plate, card units: it faces right. */
const HEAD = 712;
const TAIL = 165;
const TAIL_ROOT = 252;
const MID = 440;
const MOUTH = [712, 246] as const;

const SWIM_FROM = LIFT_MS;
const TURN_FROM = 1020;
const TURN_MS = 280;
/** How long the tail takes to come round after the head. */
const TURN_LAG = 110;
/** How thick the fish is, side to side, at its thickest: it shows as it turns. */
const GIRTH = 46;
const DIVE_FROM = 1460;
const DIVE_MS = 780;
/** When new bubbles leave its mouth, and how big each is. */
const BUBBLES = [
  [330, 7],
  [520, 10],
  [720, 6],
  [1150, 12],
  [1330, 8],
] as const;
const BUBBLE_MS = 900;

interface Prep {
  rings: Dots[];
}

export default defineScene<Prep>({
  parts: [
    [
      "bubbles",
      [
        [
          [721, 0],
          [812, 0],
          [812, 246],
          [721, 246],
        ],
      ],
    ],
  ],

  prepare(_dots, r0) {
    const rand = seeded(11);
    return {
      rings: BUBBLES.map(([, size]) =>
        dotRing(0, 0, size, r0 * 0.9, r0 * 2.3, rand),
      ),
    };
  },

  start(ctx, prep) {
    const { w, h } = ctx;
    const fish = ctx.parts.rest;
    const [ax, ay] = aim(fish, [560, 310], 110);
    const end = ctx.big(radiusNear(fish, ax, ay, 20));

    // A little way right, then off left, faster and faster.
    const swim = (t: number) =>
      110 * smootherstep(seg(t, SWIM_FROM, 1150)) -
      380 * easeIn(seg(t, 1360, DIVE_FROM + DIVE_MS), 1.7);
    // The body's ripple, gone by the last frame so the dots hold still.
    const ripple = (t: number) =>
      (3 + 3 * seg(t, DIVE_FROM, DIVE_FROM + 300)) *
      (1 -
        smootherstep(seg(t, DIVE_FROM + DIVE_MS * 0.4, DIVE_FROM + DIVE_MS)));

    /** Where a dot of the fish is at time t. */
    function place(x: number, y: number, t: number, out: Float64Array) {
      const d = clamp01((x - TAIL) / (HEAD - TAIL));
      const turn = smootherstep((t - TURN_FROM - (1 - d) * TURN_LAG) / TURN_MS);
      const facing = Math.cos(Math.PI * turn);
      // The tail fin beats in and out of the page.
      const fin =
        x < TAIL_ROOT
          ? TAIL_ROOT + (x - TAIL_ROOT) * (0.82 + 0.18 * Math.cos(t * 0.021))
          : x;
      // Side on, its dots spread through its body's thickness.
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const side =
        (h - Math.floor(h) - 0.5) *
        GIRTH *
        Math.pow(Math.sin(Math.PI * d), 0.6);
      out[0] =
        MID + swim(t) + (fin - MID) * facing + side * Math.sin(Math.PI * turn);
      out[1] =
        330 +
        (y - 330) * (1 - 0.1 * Math.sin(Math.PI * turn)) +
        2.5 * Math.sin(t * 0.007) +
        ripple(t) *
          Math.sin(((x - TAIL) / 300) * Math.PI * 2 - t * 0.012) *
          Math.pow(1 - d, 1.2);
      out[2] = 1;
    }

    let now = 0;
    const bend = (x: number, y: number, out: Float64Array) =>
      place(x, y, now, out);

    const spot = new Float64Array(3);
    const follow = (t: number): Cam => {
      const base = ctx.lift(t);
      const k = lerp(1, 1.35, smootherstep(seg(t, SWIM_FROM, DIVE_FROM)));
      return { ...base, fx: base.fx + 0.35 * swim(t), s: base.s * k };
    };
    const from = follow(DIVE_FROM);
    const mouths = BUBBLES.map(([at]) => {
      place(MOUTH[0], MOUTH[1], at, spot);
      return [spot[0], spot[1]] as const;
    });

    return {
      duration: DIVE_FROM + DIVE_MS,
      reveal: { wave: [-1, 0] },
      draw(t, p) {
        now = t;
        if (t < DIVE_FROM) p.cam(follow(t));
        else {
          place(ax, ay, t, spot);
          p.cam(
            dive(
              from,
              spot[0],
              spot[1],
              end,
              seg(t, DIVE_FROM, DIVE_FROM + DIVE_MS),
              w / 2,
              h / 2,
            ),
          );
        }
        const gone = 1 - smootherstep(seg(t, DIVE_FROM, DIVE_FROM + 360));

        // The plate's bubbles drift up and away.
        const up = Math.max(0, t - 120);
        p.part("bubbles", move(4 * Math.sin(up * 0.006), -0.12 * up), {
          alpha: 1 - smootherstep(seg(t, 450, 1250)),
        });
        // New ones leave its mouth, wherever it's got to.
        BUBBLES.forEach(([at], i) => {
          const age = t - at;
          if (age < 0 || age > BUBBLE_MS) return;
          const rise = 0.11 * age + 0.00004 * age * age;
          const [mx, my] = mouths[i];
          const k = lerp(0.6, 1.25, smootherstep(age / 500));
          p.dots(
            prep.rings[i],
            [k, 0, 0, k, mx + 5 * Math.sin(age * 0.008 + i), my - 12 - rise],
            {
              alpha:
                smootherstep(age / 80) *
                (1 - smootherstep((age - BUBBLE_MS + 320) / 320)) *
                gone,
            },
          );
        });

        p.part("rest", undefined, { warp: bend, target: true });
      },
    };
  },
});
