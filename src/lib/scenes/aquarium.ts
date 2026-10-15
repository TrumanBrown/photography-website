import { ACT, defineScene, LEAVE } from "./engine";
import {
  type Cam,
  clamp01,
  dotRing,
  type Dots,
  easeIn,
  exitDistance,
  lastOf,
  lerp,
  makeDots,
  move,
  type Passing,
  screenGrid,
  seg,
  seeded,
  smootherstep,
  smoothstep,
  toScreen,
  wakeTimes,
} from "./stage";

/**
 * Aquarium keeping: bubbles rise off the gourami, it noses a little way
 * right, turns around head first with its tail following, backs up a touch
 * as it comes round and darts off the left of the screen. Ripples spread
 * from its wake, and the hobby page shows inside them.
 *
 * It all plays over the hobby page, after the hold (see engine.ts).
 */

/** The gourami on the plate, card units: it faces right. */
const HEAD = 712;
const TAIL = 165;
const TAIL_ROOT = 252;
const MID = 440;
const MOUTH = [712, 246] as const;

const SWIM_FROM = ACT;
const SWIM_MS = 560;
const TURN_FROM = ACT + 400;
const TURN_MS = 280;
/** How long the tail takes to come round after the head. */
const TURN_LAG = 110;
/** How thick the fish is, side to side, at its thickest: it shows as it turns. */
const GIRTH = 46;
/** As its tail comes round it backs up a touch, squashed like a spring... */
const COCK_FROM = ACT + 600;
/** ...and lets go. */
const DART = ACT + 800;
const DART_MS = 520;
/** Its fins and body start to move as it sets off. */
const LIFE_MS = 300;
/**
 * Ripples leave its tail this often as it goes, each as wide as the tail to
 * start with, so together they make one wake that widens behind it.
 */
const RIPPLE_EVERY = 16;
/** A ripple's growth, CSS px, `age` ms after it starts; it spreads faster as it goes. */
const SPREAD = 0.8;
const SPREAD_UP = 0.0011;
const ripple = (age: number) => SPREAD * age + SPREAD_UP * age * age;
/** How long a ripple takes to grow `d` px. */
const rippleAge = (d: number) =>
  (-SPREAD + Math.sqrt(SPREAD * SPREAD + 4 * SPREAD_UP * d)) / (2 * SPREAD_UP);
/** Crests along the edge of the wake, CSS px apart, and their dot size. */
const CREST_GAP = 8;
const CREST_R = 2;
/** When new bubbles leave its mouth, and how big each is. */
const BUBBLES = [
  [ACT + 40, 7],
  [ACT + 230, 10],
  [ACT + 430, 6],
  [ACT + 640, 12],
] as const;
const BUBBLE_MS = 560;

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

    // It's the drawing on the plate until it sets off, then its wiggle,
    // fins and tail fade in.
    const mt = (t: number) => Math.max(0, t - SWIM_FROM);
    const life = (t: number) => smootherstep(mt(t) / LIFE_MS);
    const cock = (t: number) => smootherstep(seg(t, COCK_FROM, DART));
    const darting = (t: number) => smootherstep(seg(t, DART, DART + 90));
    const dart = (t: number) => easeIn(seg(t, DART, DART + DART_MS), 2.1);
    let distance = 0;
    // A little way right, back a touch, then off left, faster and faster.
    const swim = (t: number) =>
      110 * smootherstep(seg(t, SWIM_FROM, SWIM_FROM + SWIM_MS)) +
      16 * cock(t) -
      distance * dart(t);
    // Fins beat faster once it goes.
    const beat = (t: number) => mt(t) + 2.4 * Math.max(0, t - DART);

    // What depends on the time alone, worked out once a frame rather than
    // for each of its thousands of dots.
    let at = NaN;
    let atDistance = NaN;
    const byTime = {
      swim: 0,
      tail: 0,
      sx: 1,
      sy: 1,
      wave: 0,
      bob: 0,
      phase: 0,
    };
    const atTime = (t: number) => {
      if (t === at && distance === atDistance) return;
      at = t;
      atDistance = distance;
      const lively = life(t);
      const fast = darting(t);
      // Squashed as it backs up, stretched as it shoots off.
      const squash = cock(t) * (1 - fast);
      byTime.swim = swim(t);
      // The tail fin beats in and out of the page.
      byTime.tail = 0.18 * lively * (1 - Math.cos(beat(t) * 0.021));
      byTime.sx = 1 - 0.07 * squash + 0.09 * fast;
      byTime.sy = 1 + 0.04 * squash - 0.03 * fast;
      byTime.wave = 3 * lively + 7 * fast;
      byTime.bob = 2.5 * lively * Math.sin(mt(t) * 0.007);
      byTime.phase = beat(t) * 0.012;
    };

    /** Where a dot of the fish is at time t. */
    function place(x: number, y: number, t: number, out: Float64Array) {
      atTime(t);
      const d = clamp01((x - TAIL) / (HEAD - TAIL));
      const turn = smootherstep((t - TURN_FROM - (1 - d) * TURN_LAG) / TURN_MS);
      const facing = Math.cos(Math.PI * turn);
      const across = Math.sin(Math.PI * turn);
      const fin =
        x < TAIL_ROOT ? TAIL_ROOT + (x - TAIL_ROOT) * (1 - byTime.tail) : x;
      // Side on, its dots spread through its body's thickness.
      const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const side =
        (hash - Math.floor(hash) - 0.5) *
        GIRTH *
        Math.pow(Math.sin(Math.PI * d), 0.6);
      out[0] =
        MID + byTime.swim + ((fin - MID) * facing + side * across) * byTime.sx;
      out[1] =
        330 +
        (y - 330) * (1 - 0.1 * across) * byTime.sy +
        byTime.bob +
        byTime.wave *
          Math.sin(((x - TAIL) / 300) * Math.PI * 2 - byTime.phase) *
          Math.pow(1 - d, 1.2);
      out[2] = 1;
    }

    let now = 0;
    const bend = (x: number, y: number, out: Float64Array) =>
      place(x, y, now, out);

    const follow = (t: number): Cam => {
      const base = ctx.lift(t);
      const k = lerp(1, 1.35, smootherstep(seg(t, SWIM_FROM, DART)));
      return { ...base, fx: base.fx + 0.35 * swim(t), s: base.s * k };
    };
    // Still once it darts: the fish swims out of the picture.
    const held = follow(DART);
    const cam = (t: number) => (t < DART ? follow(t) : held);

    const spot = new Float64Array(3);
    const onScreen = (x: number, y: number, t: number): [number, number] => {
      place(x, y, t, spot);
      return toScreen(held, spot[0], spot[1]);
    };

    // How far it has to dart to be gone: every dot off the left of the screen.
    const last = DART + DART_MS;
    distance = 0;
    const ends = new Float64Array(fish.n * 2);
    for (let i = 0; i < fish.n; i++)
      [ends[i * 2], ends[i * 2 + 1]] = onScreen(fish.x[i], fish.y[i], last);
    const pts = new Float64Array(fish.n * 2);
    distance =
      exitDistance(
        (k) => {
          for (let i = 0; i < fish.n; i++) {
            pts[i * 2] = ends[i * 2] - k * held.s;
            pts[i * 2 + 1] = ends[i * 2 + 1];
          }
          return pts;
        },
        w,
        h,
        40,
      ) + 10;

    const mouths = BUBBLES.map(([at]) => {
      place(MOUTH[0], MOUTH[1], at, spot);
      return [spot[0], spot[1]] as const;
    });

    // Ripples start from its tail as it darts off.
    const width = 0.42 * 120 * held.s;
    const sources: Array<{ t: number; x: number; y: number }> = [];
    for (let at = DART + RIPPLE_EVERY; at <= last; at += RIPPLE_EVERY) {
      const [x, y] = onScreen(TAIL_ROOT - 30, 345, at);
      sources.push({ t: at, x, y });
    }
    const grid = screenGrid(w, h, 12);
    const passing: Passing[] = sources.map((s) => ({
      t: s.t,
      discs: [s.x, s.y, width],
    }));
    const covered = lastOf(wakeTimes(grid, passing, rippleAge)) + 40;

    const ring = new Float32Array(sources.length * 3);
    const holes = new Float32Array(sources.length * 3);
    const which = new Int32Array(sources.length);
    const crest = { x: [] as number[], y: [] as number[], r: [] as number[] };

    const duration = Math.max(covered, last);
    return {
      duration,
      leave: LEAVE,
      depart: ACT,
      draw(t, p) {
        now = t;
        p.cam(cam(t));

        // The ripples: the page shows inside them, their crests in dots.
        let live = 0;
        for (const s of sources) {
          if (s.t >= t) break;
          ring[live * 3] = s.x;
          ring[live * 3 + 1] = s.y;
          ring[live * 3 + 2] =
            width * smootherstep((t - s.t) / 60) + ripple(t - s.t);
          live++;
        }
        // One wholly inside a bigger one opens nothing more, and its crest
        // is hidden: leaving it out spares the GPU most of the wake, which
        // ends up as dozens of circles the size of the screen.
        let open = 0;
        for (let i = 0; i < live; i++) {
          const x = ring[i * 3];
          const y = ring[i * 3 + 1];
          const r = ring[i * 3 + 2];
          let inner = false;
          for (let j = 0; j < live && !inner; j++) {
            const big = ring[j * 3 + 2];
            inner =
              big > r &&
              Math.hypot(x - ring[j * 3], y - ring[j * 3 + 1]) + r < big - 1;
          }
          if (inner) continue;
          holes[open * 3] = x;
          holes[open * 3 + 1] = y;
          holes[open * 3 + 2] = r;
          which[open++] = i;
        }
        if (open) {
          p.cut(holes, open);
          crest.x.length = crest.y.length = crest.r.length = 0;
          for (let o = 0; o < open; o++) {
            const i = which[o];
            const x0 = holes[o * 3];
            const y0 = holes[o * 3 + 1];
            const r = holes[o * 3 + 2];
            const age = t - sources[i].t;
            const size = CREST_R * (1 - smoothstep(age / 800));
            // Every other ripple's crest is plenty: they overlap.
            if (r < 3 || size < 0.3 || i % 2) continue;
            const n = Math.ceil((2 * Math.PI * r) / CREST_GAP);
            for (let k = 0; k < n; k++) {
              const a = ((k + 0.5 * (i % 2)) / n) * Math.PI * 2;
              const x = x0 + Math.cos(a) * r;
              const y = y0 + Math.sin(a) * r;
              if (x < -4 || y < -4 || x > p.w + 4 || y > p.h + 4) continue;
              let inside = false;
              for (let j = 0; j < open && !inside; j++)
                if (
                  j !== o &&
                  Math.hypot(x - holes[j * 3], y - holes[j * 3 + 1]) <
                    holes[j * 3 + 2] - 1
                )
                  inside = true;
              if (inside) continue;
              crest.x.push(x);
              crest.y.push(y);
              crest.r.push(size);
            }
          }
          if (crest.x.length)
            p.dots(makeDots(crest.x, crest.y, crest.r), undefined, {
              screen: true,
              alpha: 1 - smootherstep(seg(t, duration - 180, duration)),
            });
        }

        // The plate's bubbles drift up and away, getting going gently.
        const up = Math.max(0, t - ACT);
        const rise = 0.12 * (up - 160 * (1 - Math.exp(-up / 160)));
        p.part("bubbles", move(4 * Math.sin(up * 0.006), -rise), {
          alpha: 1 - smootherstep(seg(t, ACT + 250, ACT + 1000)),
        });
        // New ones leave its mouth, wherever it's got to.
        BUBBLES.forEach(([at], i) => {
          const age = t - at;
          if (age < 0 || age > BUBBLE_MS) return;
          const rise = 0.11 * age + 0.00004 * age * age;
          const [mx, my] = mouths[i];
          const k = lerp(0.6, 1.25, smootherstep(age / 400));
          p.dots(
            prep.rings[i],
            [k, 0, 0, k, mx + 5 * Math.sin(age * 0.008 + i), my - 12 - rise],
            {
              alpha:
                smootherstep(age / 80) *
                (1 - smootherstep((age - BUBBLE_MS + 260) / 260)),
            },
          );
        });

        p.part("rest", undefined, { warp: bend });
      },
    };
  },
});
