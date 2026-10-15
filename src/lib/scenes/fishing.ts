import { defineScene, LIFT_MS } from "./engine";
import {
  aim,
  apply,
  backOut,
  chain,
  clamp01,
  dive,
  dotLine,
  dotRing,
  type Dots,
  easeOut,
  lerp,
  type Mat,
  merge,
  move,
  outline,
  type Pt,
  radiusNear,
  seg,
  seeded,
  smootherstep,
  spring,
  stipple,
  turn,
} from "./stage";

/**
 * Fishing: a rod swings in and casts, the lure lands just off the trout's
 * nose, the trout takes it, and the hook-set hauls it up at you until its
 * dots fill the screen. Rod, line and lure are stippled in the plate's pen.
 */

const DEG = Math.PI / 180;
/** The trout on the plate faces right; its mouth is here. */
const MOUTH = [812, 338] as const;
/** Where the lure lands, just off its nose. */
const LANDING = [874, 330] as const;
/** The rod's length; its butt is off the top right of the screen. */
const ROD = 540;

const ENTER_FROM = 260;
const ENTER_MS = 440;
const CAST_FROM = 760;
const CAST_MS = 200;
const RELEASE = CAST_FROM + 90;
const FLY_MS = 300;
const LANDED = RELEASE + FLY_MS;
const BITE = LANDED + 260;
const BITE_MS = 120;
const SET_FROM = BITE + 110;
const DIVE_FROM = SET_FROM + 150;
const DIVE_MS = 780;

interface Prep {
  rod: Dots;
  lure: Dots;
  r0: number;
}

/** The rod, butt at the origin, pointing along +x. */
function makeRod(r0: number, rand: () => number): Dots {
  const half = (x: number) =>
    x < 22
      ? 7
      : x < 128
        ? 9.5
        : lerp(6, 1.7, Math.pow(clamp01((x - 128) / (ROD - 128)), 0.8));
  const blank = stipple(
    (x, y) => {
      const hw = half(x);
      if (x < 0 || x > ROD || Math.abs(y) > hw) return 0;
      const rim = hw - Math.abs(y) < 1.7;
      // The cork grip is lighter, the blank dark.
      if (x >= 22 && x < 128) return rim ? 1 : 0.38;
      return rim ? 1 : 0.85;
    },
    [-2, -12, ROD + 2, 12],
    r0,
    rand,
  );
  const reel = merge(
    dotRing(150, 25, 17, r0, r0 * 2, rand),
    dotRing(150, 25, 10, r0 * 0.9, r0 * 2.2, rand),
    stipple(
      (x, y) => (Math.hypot(x - 150, y - 25) < 4.5 ? 1 : 0),
      [144, 19, 156, 31],
      r0,
      rand,
    ),
    dotLine(
      [
        [146, 9],
        [148, 2],
        [156, 2],
        [158, 9],
      ],
      r0,
      undefined,
      rand,
    ),
    dotLine(
      [
        [150, 25],
        [168, 40],
      ],
      r0,
      undefined,
      rand,
    ),
  );
  const guides = merge(
    ...[250, 340, 420, 488].map((x, i) =>
      dotRing(
        x,
        4 + half(x) + 3.2 - i * 0.4,
        3.4 - i * 0.4,
        r0 * 0.8,
        r0 * 1.7,
        rand,
      ),
    ),
  );
  return merge(blank, reel, guides);
}

/** A spoon lure, its eye at the origin, trailing along +x, with a treble hook. */
function makeLure(r0: number, rand: () => number): Dots {
  const edge: Pt[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const x = 20 - 15 * Math.cos(a);
    // Fatter at the back, like a spoon.
    edge.push([x, Math.sin(a) * (3 + 6 * clamp01((x - 5) / 26))]);
  }
  const shape = outline(edge);
  const spoon = stipple(
    (x, y) => {
      if (!shape.inside(x, y)) return 0;
      if (shape.near(x, y, 1.6)) return 1;
      return Math.hypot(x - 22, y + 2) < 4 ? 0.06 : 0.45;
    },
    [3, -11, 37, 11],
    r0,
    rand,
  );
  const ring = dotRing(1, 0, 2.6, r0 * 0.7, r0 * 1.5, rand);
  const hook = dotLine(
    [
      [35, 0],
      [42, 3],
      [45, 11],
      [41, 17],
      [35, 15],
      [33, 11],
    ],
    r0 * 0.8,
    undefined,
    rand,
  );
  return merge(spoon, ring, hook);
}

export default defineScene<Prep>({
  prepare(_dots, r0) {
    const rand = seeded(23);
    return { rod: makeRod(r0, rand), lure: makeLure(r0, rand), r0 };
  },

  start(ctx, prep) {
    const { w, h } = ctx;
    const fish = ctx.parts.rest;
    // On a tall screen there's more room above the trout than beside it.
    const tall = h > w;
    const BUTT = tall ? [1000, -300] : [1160, -130];
    const REST = (tall ? 125 : 146) * DEG;
    const [ax, ay] = aim(fish, [500, 320], 120);

    // The rod comes in wound back, casts with a whip, then sets the hook.
    const angle = (t: number) => {
      const wound =
        -32 *
        DEG *
        (1 - smootherstep(seg(t, CAST_FROM, CAST_FROM + CAST_MS * 0.7)));
      const whip =
        16 *
        DEG *
        Math.sin(Math.PI * seg(t, CAST_FROM + 60, CAST_FROM + CAST_MS + 160));
      const set = -16 * DEG * backOut(seg(t, SET_FROM, SET_FROM + 140), 1.6);
      return REST + wound + whip + set;
    };
    const rodAt = (t: number): Mat => {
      const k = 1 - easeOut(seg(t, ENTER_FROM, ENTER_FROM + ENTER_MS), 3);
      return chain(move(BUTT[0] + 380 * k, BUTT[1] - 280 * k), turn(angle(t)));
    };
    const tipAt = (t: number) => apply(rodAt(t), ROD, 0);

    // The trout lunges for the lure, then is hauled up toward the rod.
    const fishAt = (t: number): Mat => {
      const lunge = easeOut(seg(t, BITE, BITE + BITE_MS), 2);
      const haul = smootherstep(seg(t, SET_FROM, DIVE_FROM + DIVE_MS));
      const tilt = (-4 * lunge - 14 * haul) * DEG;
      return chain(
        move(54 * lunge + 70 * haul, -60 * haul),
        turn(tilt, MOUTH[0], MOUTH[1]),
      );
    };
    const mouthAt = (t: number) => apply(fishAt(t), MOUTH[0], MOUTH[1]);

    // The lure: hanging off the tip, cast in an arc, landing, then taken.
    const lureAt = (t: number): [number, number] => {
      if (t < RELEASE) {
        const [x, y] = tipAt(t);
        return [x + 6 * Math.sin(t * 0.008), y + 34];
      }
      if (t < LANDED) {
        const [x0, y0] = (() => {
          const [x, y] = tipAt(RELEASE);
          return [x, y + 34];
        })();
        const u = seg(t, RELEASE, LANDED);
        return [
          lerp(x0, LANDING[0], u),
          lerp(y0, LANDING[1], u) - 150 * 4 * u * (1 - u),
        ];
      }
      if (t < BITE + BITE_MS * 0.6) {
        const settle = spring(seg(t, LANDED, LANDED + 260), 1.5, 0.3);
        return [
          LANDING[0],
          LANDING[1] - 8 + 8 * settle + 2 * Math.sin(t * 0.012),
        ];
      }
      return mouthAt(t);
    };

    const end = ctx.big(radiusNear(fish, ax, ay, 20));
    const from = (() => {
      const base = ctx.lift(DIVE_FROM);
      return { ...base, s: base.s * 1.08 };
    })();

    return {
      duration: DIVE_FROM + DIVE_MS,
      reveal: { from: [0.5, 0.5] },
      draw(t, p) {
        const u = seg(t, DIVE_FROM, DIVE_FROM + DIVE_MS);
        if (t < DIVE_FROM) {
          const base = ctx.lift(t);
          p.cam({
            ...base,
            s: base.s * lerp(1, 1.08, smootherstep(seg(t, LIFT_MS, DIVE_FROM))),
          });
        } else {
          const [tx, ty] = apply(fishAt(t), ax, ay);
          p.cam(dive(from, tx, ty, end, u, w / 2, h / 2));
        }
        // Props come in once the paper is down, and go as the dive begins.
        const props =
          smootherstep(seg(t, ENTER_FROM, ENTER_FROM + 160)) *
          (1 - smootherstep(seg(t, DIVE_FROM, DIVE_FROM + 260)));
        const fishM = fishAt(t);
        p.part("rest", fishM, { target: true, halo: 1.6 });

        // Line from the rod tip to the lure: slack while it flies, taut once set.
        const [x0, y0] = tipAt(t);
        const [x1, y1] = lureAt(t);
        const slack =
          t < LANDED
            ? 0.18
            : 0.12 * (1 - smootherstep(seg(t, SET_FROM, SET_FROM + 120)));
        const len = Math.hypot(x1 - x0, y1 - y0);
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2 + slack * len;
        const curve: Pt[] = [];
        for (let i = 0; i <= 20; i++) {
          const k = i / 20;
          curve.push([
            (1 - k) * (1 - k) * x0 + 2 * k * (1 - k) * mx + k * k * x1,
            (1 - k) * (1 - k) * y0 + 2 * k * (1 - k) * my + k * k * y1,
          ]);
        }
        const lineAlpha =
          props * smootherstep(seg(t, ENTER_FROM + 200, ENTER_FROM + ENTER_MS));
        p.dots(
          dotLine(curve, prep.r0 * 0.55, prep.r0 * 1.6, seeded(5), 0.05),
          undefined,
          { alpha: lineAlpha },
        );

        const swallowed =
          1 - smootherstep(seg(t, BITE + BITE_MS * 0.4, BITE + BITE_MS * 1.4));
        const lureAngle =
          t < LANDED ? Math.PI / 2 : Math.PI / 2 + 0.2 * Math.sin(t * 0.01);
        p.dots(prep.lure, chain(move(x1, y1), turn(lureAngle)), {
          alpha: props * swallowed * lineAlpha,
        });
        p.dots(prep.rod, rodAt(t), { alpha: props, halo: 1.2 });
      },
    };
  },
});
