import { ACT, defineScene, LEAVE } from "./engine";
import {
  apply,
  backOut,
  type Cam,
  chain,
  clamp01,
  dotLine,
  dotRing,
  type Dots,
  easeIn,
  easeOut,
  exitDistance,
  lastOf,
  lerp,
  type Mat,
  merge,
  move,
  outline,
  type Passing,
  type Pt,
  screenGrid,
  seg,
  seeded,
  smootherstep,
  spring,
  stipple,
  toScreen,
  turn,
  wakeHoles,
  wakeStep,
  wakeTimes,
} from "./stage";

/**
 * Fishing: the trout holds in the current, tail working, while a rod swings
 * in and casts, and the lure lands a little way off its nose. It notices,
 * draws back and strikes, the hook is set, and it's hauled up out of the
 * top right of the screen; the hobby page opens in dots behind it, along
 * the way it went. Rod, line and lure are stippled in the plate's pen.
 *
 * It all plays over the hobby page, after the hold (see engine.ts).
 */

const DEG = Math.PI / 180;
/** The trout on the plate faces right; its mouth is here. */
const MOUTH = [812, 338] as const;
/** Where its tail fin starts, and its pectoral fin's root. */
const TAIL_ROOT = 195;
const PECTORAL = [618, 372] as const;
/** The rod's length; its butt is off the top right of the screen. */
const ROD = 540;

/** It starts to swim as the scene starts... */
const LIFE_MS = 320;
/** ...and the rod swings in a beat later. */
const ENTER_FROM = ACT + 110;
const ENTER_MS = 380;
const CAST_FROM = ENTER_FROM + 280;
const CAST_MS = 200;
const RELEASE = CAST_FROM + 90;
const FLY_MS = 300;
const LANDED = RELEASE + FLY_MS;
const SETTLE_MS = 260;
/** The trout notices and draws back... */
const NOTICE = LANDED + 40;
const BITE = NOTICE + 130;
/** ...then strikes. */
const BITE_MS = 190;
const SET_FROM = BITE + BITE_MS + 20;
const YANK_FROM = SET_FROM + 50;
const YANK_MS = 430;
/** How long a dot of the page takes to open, and how fast the opening spreads, px/ms. */
const GROW = 140;
const SPREAD = 2.6;
/** The trout's body, tail to head: centres and half-heights, card units. */
const BODY: ReadonlyArray<readonly [number, number, number]> = [
  [110, 330, 70],
  [230, 325, 80],
  [350, 305, 95],
  [470, 300, 100],
  [590, 300, 90],
  [700, 315, 70],
  [790, 335, 40],
];

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
    // On a tall screen there's less room in front of it.
    const tall = h > w;
    const LANDING = [MOUTH[0] + (tall ? 100 : 150), 334] as const;
    // The rod reaches in from off the top right, its tip over the trout.
    const BUTT = tall ? [1000, -300] : [1160, -130];
    const REST = (tall ? 125 : 146) * DEG;
    const yank = (t: number) =>
      easeIn(seg(t, YANK_FROM, YANK_FROM + YANK_MS), 2.2);
    let haul = 0;

    // The rod comes in wound back, casts with a whip, sets the hook, then
    // goes back up and away with the trout.
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
      const away = yank(t);
      return chain(
        move(BUTT[0] + 380 * k + 320 * away, BUTT[1] - 280 * k - 420 * away),
        turn(angle(t)),
      );
    };
    const tipAt = (t: number) => apply(rodAt(t), ROD, 0);

    // It holds in the current, tail working, until the lure lands; then it
    // draws back a touch, strikes, and is hauled up and away, nose first.
    const gap = LANDING[0] - 4 - MOUTH[0];
    const toward = Math.atan2(BUTT[1] - MOUTH[1], BUTT[0] - MOUTH[0]);
    const strike = (t: number) => easeOut(seg(t, BITE, BITE + BITE_MS), 2.2);
    const fishAt = (t: number): Mat => {
      const back =
        smootherstep(seg(t, NOTICE, BITE)) *
        (1 - smootherstep(seg(t, BITE, BITE + 70)));
      const lunge = strike(t);
      const tug = backOut(seg(t, SET_FROM, SET_FROM + 120), 2);
      const k = yank(t);
      const tilt = (-4 * lunge - 6 * tug) * DEG + toward * 0.6 * k;
      const along = -12 * back + gap * lunge + 18 * tug + haul * k;
      return chain(
        move(along * Math.cos(toward * k), along * Math.sin(toward * k)),
        turn(tilt, MOUTH[0], MOUTH[1]),
      );
    };
    const mouthAt = (t: number) => apply(fishAt(t), MOUTH[0], MOUTH[1]);

    // Swimming in place: its tail fin sweeps (so looks shorter and longer),
    // a gentle wave runs down its body, its pectoral fin sculls and it
    // drifts a little. It beats harder as it strikes.
    const life = (t: number) => smootherstep((t - ACT) / LIFE_MS);
    const phase = (t: number) =>
      0.0135 * Math.max(0, t - ACT) + 0.02 * Math.max(0, t - NOTICE);
    const swimIn = (x: number, y: number, t: number, out: Float64Array) => {
      const amp = life(t) * (1 + 0.6 * smootherstep(seg(t, NOTICE, BITE)));
      if (amp <= 0) {
        out[0] = x;
        out[1] = y;
        return;
      }
      const ph = phase(t);
      const a = t - ACT;
      let X = x;
      let Y = y;
      if (x < TAIL_ROOT)
        X = TAIL_ROOT + (x - TAIL_ROOT) * (1 - 0.13 * amp * (1 - Math.cos(ph)));
      const back = clamp01((MOUTH[0] - x) / (MOUTH[0] - 60));
      Y +=
        amp *
        2.6 *
        Math.pow(back, 1.6) *
        Math.sin(((MOUTH[0] - x) / 700) * Math.PI * 2 - ph);
      // The pectoral fin, turning a little about its root.
      const fin =
        clamp01((y - PECTORAL[1]) / 16) * clamp01(1 - Math.abs(x - 642) / 58);
      if (fin > 0) {
        const r = 7 * DEG * amp * fin * Math.sin(1.7 * ph + 1);
        const dx = X - PECTORAL[0];
        const dy = Y - PECTORAL[1];
        X = PECTORAL[0] + dx * Math.cos(r) - dy * Math.sin(r);
        Y = PECTORAL[1] + dx * Math.sin(r) + dy * Math.cos(r);
      }
      out[0] = X + 3 * amp * Math.sin(a * 0.0029);
      out[1] = Y + 2.5 * amp * Math.sin(a * 0.0041 + 0.6);
    };
    const swimmer = (t: number) => {
      const m = fishAt(t);
      return (x: number, y: number, out: Float64Array) => {
        swimIn(x, y, t, out);
        const X = out[0];
        const Y = out[1];
        out[0] = m[0] * X + m[2] * Y + m[4];
        out[1] = m[1] * X + m[3] * Y + m[5];
      };
    };

    // The lure: hanging off the tip, cast in an arc, landing, then taken.
    const lureAt = (t: number): [number, number] => {
      if (t < RELEASE) {
        const [x, y] = tipAt(t);
        return [x + 6 * Math.sin((t - ENTER_FROM) * 0.008), y + 34];
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
      const settle = spring(seg(t, LANDED, LANDED + SETTLE_MS), 1.5, 0.3);
      const bob: [number, number] = [
        LANDING[0],
        LANDING[1] - 8 + 8 * settle + 2 * Math.sin((t - LANDED) * 0.012),
      ];
      // Taken as the trout's mouth gets to it.
      const taken = smootherstep(seg(strike(t), 0.72, 1));
      if (taken <= 0) return bob;
      const [mx, my] = mouthAt(t);
      return [lerp(bob[0], mx, taken), lerp(bob[1], my, taken)];
    };

    // The camera eases in, and over a touch on a narrow screen, so the lure
    // lands in the picture.
    const zoomed = ctx.stage.s * 1.08;
    const fit = Math.max(
      ctx.stage.fx + 40,
      LANDING[0] + 30 - (0.94 * w - ctx.stage.ax) / zoomed,
    );
    const cam = (t: number): Cam => {
      const base = ctx.lift(t);
      const k = smootherstep(seg(t, ACT, LANDED));
      return {
        ...base,
        fx: lerp(base.fx, fit, k),
        s: base.s * lerp(1, 1.08, k),
      };
    };
    const held = cam(LANDED);

    // How far it's hauled: until every dot of it is off the screen.
    const end = YANK_FROM + YANK_MS;
    const pts = new Float64Array(fish.n * 2);
    haul =
      exitDistance(
        (k) => {
          haul = k;
          const m = fishAt(end);
          for (let i = 0; i < fish.n; i++) {
            const [x, y] = apply(m, fish.x[i], fish.y[i]);
            [pts[i * 2], pts[i * 2 + 1]] = toScreen(held, x, y);
          }
          return pts;
        },
        w,
        h,
        30,
      ) + 20;

    // The page opens behind it: dots of it first where the trout has just
    // been, spreading out from there.
    const step = wakeStep(w, h);
    const grid = screenGrid(w, h, step);
    const passing: Passing[] = [];
    for (let at = YANK_FROM; at <= end; at += 25) {
      const m = fishAt(at);
      const discs: number[] = [];
      for (const [x, y, r] of BODY) {
        const [X, Y] = apply(m, x, y);
        const [sx, sy] = toScreen(held, X, Y);
        discs.push(sx, sy, r * held.s);
      }
      passing.push({ t: at, discs });
    }
    const times = wakeTimes(grid, passing, (d) => 50 + d / SPREAD, 50);
    const holes = new Float32Array(grid.cols * grid.rows * 3);
    const duration = Math.max(end + 60, lastOf(times) + GROW);

    return {
      duration,
      leave: LEAVE,
      depart: ACT,
      draw(t, p) {
        p.cam(t < LANDED ? cam(t) : held);
        if (t > YANK_FROM) p.cut(holes, wakeHoles(times, grid, t, GROW, holes));

        // Props come in once the paper is down.
        const props = smootherstep(seg(t, ENTER_FROM, ENTER_FROM + 160));

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
        // The line goes with the trout, fading as it's hauled clear.
        const lineAlpha =
          props *
          smootherstep(seg(t, ENTER_FROM + 200, ENTER_FROM + ENTER_MS)) *
          (1 - smootherstep(seg(t, YANK_FROM + 100, end - 40)));
        p.dots(
          dotLine(curve, prep.r0 * 0.55, prep.r0 * 1.6, seeded(5), 0.05),
          undefined,
          { alpha: lineAlpha },
        );

        const swallowed =
          1 - smootherstep(seg(t, BITE + BITE_MS * 0.4, BITE + BITE_MS * 1.4));
        const lureAngle =
          t < LANDED
            ? Math.PI / 2
            : Math.PI / 2 + 0.2 * Math.sin((t - LANDED) * 0.01);
        p.dots(prep.lure, chain(move(x1, y1), turn(lureAngle)), {
          alpha: props * swallowed * lineAlpha,
        });

        // Hauled out, it leaves a smear of itself behind.
        if (t > YANK_FROM) {
          const fade = 1 - smootherstep(seg(t, end - 120, end));
          for (const [lag, alpha] of [
            [36, 0.14],
            [18, 0.3],
          ] as const)
            p.part("rest", undefined, {
              alpha: alpha * fade,
              warp: swimmer(t - lag),
            });
        }
        // No paper round it once the page shows through behind it.
        const halo = 1.6 * (1 - seg(t, YANK_FROM, YANK_FROM + 60));
        p.part("rest", undefined, { halo, warp: swimmer(t) });
        p.dots(prep.rod, rodAt(t), {
          alpha: props,
          halo: 1.2 * (1 - seg(t, YANK_FROM, YANK_FROM + 60)),
        });
      },
    };
  },
});
