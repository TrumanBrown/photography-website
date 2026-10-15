import { ACT, defineScene, LEAVE } from "./engine";
import {
  apply,
  backOut,
  type Cam,
  camLerp,
  chain,
  easeOut,
  lerp,
  type Mat,
  scale,
  seg,
  seeded,
  smootherstep,
  spring,
  toScreen,
  turn,
} from "./stage";

/**
 * Tide pooling: the crab rears up bigger and raises its right claw with the
 * pincer wide open, draws it back a touch and jabs, snapping it shut on the
 * screen, which shakes and puckers toward the pinch. Then a shockwave rings
 * out from it: the crab's own dots are swept outward on its front, and the
 * hobby page shows behind it. Reach, wind-up and jab run into each other.
 *
 * It all plays over the hobby page, after the hold (see engine.ts).
 */

const DEG = Math.PI / 180;
/** Where the right claw meets the body, its hinge, and where its tips meet. */
const SHOULDER = [557, 232] as const;
const HINGE = [712, 194] as const;
const TIPS = [764, 174] as const;
const LEFT_SHOULDER = [262, 214] as const;
/** The crab stands on the sand here; it rears up about this point. */
const BASE = [390, 430] as const;

const REAR_FROM = ACT;
const REAR_MS = 520;
const REACH_FROM = ACT + 240;
const REACH_MS = 480;
/** Drawn back a touch, opening wider, as the reach comes to its end... */
const WIND_FROM = REACH_FROM + REACH_MS - 120;
const WIND_MS = 170;
/** ...and straight into the jab. */
const JAB_FROM = WIND_FROM + WIND_MS;
const JAB_MS = 140;
const SNAP = JAB_FROM + JAB_MS - 30;
const SNAP_MS = 80;
/** The pinch pulls the screen in toward it, briefly. */
const PUCKER = 0.2;
const PUCKER_MS = 170;
/** Then the shockwave: from the pinch to past the corners. */
const SHOCK_FROM = SNAP + 70;
const SHOCK_MS = 560;
/** A dot the front has passed rides along just behind it, shrinking away. */
const RIDE = 0.955;
/** Dots on the shockwave's front, CSS px apart. */
const RING_GAP = 8;

export default defineScene({
  parts: [
    [
      "dactyl",
      [
        [
          [704, 203],
          [704, 160],
          [712, 146],
          [784, 136],
          [784, 158],
          [712, 200],
        ],
      ],
    ],
    [
      "claw",
      [
        [
          [556, 198],
          [610, 178],
          [712, 146],
          [795, 132],
          [795, 222],
          [740, 236],
          [640, 262],
          [553, 262],
        ],
      ],
    ],
    [
      "left",
      [
        [
          [95, 110],
          [262, 110],
          [262, 240],
          [95, 240],
        ],
      ],
    ],
    [
      "body",
      [
        [
          [255, 72],
          [566, 72],
          [566, 200],
          [553, 262],
          [592, 300],
          [596, 470],
          [430, 492],
          [268, 478],
          [178, 426],
          [184, 330],
          [214, 280],
          [262, 240],
        ],
      ],
    ],
  ],

  start(ctx) {
    const { w, h } = ctx;

    // The crab rears up a little bigger, claws raised.
    const rear = (t: number) =>
      spring(seg(t, REAR_FROM, REAR_FROM + REAR_MS), 1.5, 0.3);
    const crab = (t: number): Mat => {
      const k = lerp(1, 1.18, rear(t));
      return scale(k, k, BASE[0], BASE[1]);
    };
    // The right claw reaches up and out, opening, then jabs down.
    const reach = (t: number) =>
      backOut(seg(t, REACH_FROM, REACH_FROM + REACH_MS), 1.3);
    const jab = (t: number) => backOut(seg(t, JAB_FROM, JAB_FROM + JAB_MS), 2);
    // The wind-up eases in as the reach settles and gives way to the jab.
    const wind = (t: number) =>
      smootherstep(seg(t, WIND_FROM, JAB_FROM)) *
      (1 - smootherstep(seg(t, JAB_FROM, JAB_FROM + JAB_MS * 0.6)));
    const clawAt = (t: number): Mat => {
      const k = lerp(1, 1.3, reach(t));
      const a =
        (-10 * rear(t) - 16 * reach(t) - 7 * wind(t) + 30 * jab(t)) * DEG;
      return chain(
        crab(t),
        turn(a, SHOULDER[0], SHOULDER[1]),
        scale(k, k, SHOULDER[0], SHOULDER[1]),
      );
    };
    const open = (t: number) =>
      -DEG *
      (38 * backOut(seg(t, REACH_FROM + 80, REACH_FROM + REACH_MS), 1.6) +
        8 * wind(t)) *
      (1 - backOut(seg(t, SNAP, SNAP + SNAP_MS), 2.4));
    const dactylAt = (t: number): Mat =>
      chain(clawAt(t), turn(open(t), HINGE[0], HINGE[1]));

    // Where it pinches, once the jab is home.
    const struck = JAB_FROM + JAB_MS;
    const pinch = apply(clawAt(struck), TIPS[0], TIPS[1]);

    // The camera leans in toward the claw as it reaches, and holds there.
    const near: Cam = {
      ax: w / 2,
      ay: h / 2,
      fx: pinch[0] - 60,
      fy: pinch[1] + 30,
      s: ctx.stage.s * 1.55,
    };
    const look = (t: number): Cam =>
      camLerp(ctx.lift(t), near, smootherstep(seg(t, REACH_FROM, JAB_FROM)));
    const held = look(JAB_FROM);

    // The snap shakes the screen.
    const shake = (t: number): [number, number] => {
      const k = seg(t, SNAP, SNAP + 260);
      if (k <= 0 || k >= 1) return [0, 0];
      const a = 9 * (1 - k) * (1 - k);
      return [a * Math.sin(t * 0.09), a * Math.cos(t * 0.11)];
    };

    // The shockwave, in CSS px from the pinch: out past the farthest corner.
    const [px, py] = toScreen(held, pinch[0], pinch[1]);
    const farthest = Math.max(
      Math.hypot(px, py),
      Math.hypot(w - px, py),
      Math.hypot(px, h - py),
      Math.hypot(w - px, h - py),
    );
    const most = (farthest + 90) / RIDE;
    const front = (t: number) =>
      most * easeOut(seg(t, SHOCK_FROM, SHOCK_FROM + SHOCK_MS), 2.4);

    // Every dot: pulled in by the pucker, then swept out by the front.
    let pull = 0;
    let shock = 0;
    let sigma = 1;
    const blast = (x: number, y: number, out: Float64Array) => {
      const dx = x - pinch[0];
      const dy = y - pinch[1];
      const d = Math.hypot(dx, dy) || 1e-6;
      let r = d * (1 - pull * Math.exp(-(d * d) / (2 * sigma * sigma)));
      let size = 1;
      if (shock > r) {
        const behind = shock - r;
        r += behind * RIDE;
        size = Math.max(0, 1 - behind / (0.6 * shock + 1e-6));
      } else if (shock > 0) {
        // A little bow wave just ahead of it.
        r += (14 / held.s) * Math.exp(-(r - shock) / (40 / held.s));
      }
      out[0] = pinch[0] + (dx / d) * r;
      out[1] = pinch[1] + (dy / d) * r;
      out[2] = size;
    };

    const hole = new Float32Array(3);
    // The front's dots: as many as fit RING_GAP apart, each nudged a little
    // off the circle, the same way every frame.
    const ringMost = Math.ceil((2 * Math.PI * most) / RING_GAP) + 1;
    const ringDots = {
      x: new Float32Array(ringMost),
      y: new Float32Array(ringMost),
      r: new Float32Array(ringMost),
      n: 0,
    };
    const rand = seeded(17);
    const jitter = Float32Array.from({ length: ringMost }, () => rand() - 0.5);

    return {
      duration: SHOCK_FROM + SHOCK_MS,
      leave: LEAVE,
      depart: ACT,
      draw(t, p) {
        const c = t < JAB_FROM ? look(t) : held;
        const [sx, sy] = shake(t);
        p.cam({ ...c, ax: c.ax + sx, ay: c.ay + sy });

        pull = PUCKER * Math.sin(Math.PI * seg(t, SNAP, SNAP + PUCKER_MS));
        sigma = (0.3 * Math.min(w, h)) / held.s;
        const R = front(t);
        shock = R / held.s;
        if (R > 0) {
          // The page shows inside the shockwave.
          const [cx, cy] = p.screen(pinch[0], pinch[1]);
          hole[0] = cx;
          hole[1] = cy;
          hole[2] = R;
          p.cut(hole);
          // Its front, a ring of dots thinning as it goes.
          const u = seg(t, SHOCK_FROM, SHOCK_FROM + SHOCK_MS);
          const size = lerp(2.4, 0.8, u);
          const n = Math.min(ringMost, Math.ceil((2 * Math.PI * R) / RING_GAP));
          for (let i = 0; i < n; i++) {
            const a = ((i + 0.3 * jitter[i]) / n) * Math.PI * 2;
            const r = R + 2.5 * jitter[(i * 7) % ringMost];
            ringDots.x[i] = cx + Math.cos(a) * r;
            ringDots.y[i] = cy + Math.sin(a) * r;
            ringDots.r[i] = size;
          }
          ringDots.n = n;
          p.dots(ringDots, undefined, {
            screen: true,
            alpha: 1 - smootherstep(u / 0.9),
          });
        }

        const bits = { warp: blast };
        p.part("rest", undefined, bits);
        p.part(
          "left",
          chain(
            crab(t),
            turn(10 * DEG * rear(t), LEFT_SHOULDER[0], LEFT_SHOULDER[1]),
          ),
          bits,
        );
        p.part("body", crab(t), bits);
        // Both halves of the claw lay their paper down before their ink,
        // until the shockwave takes them.
        const halo = 1.4 * (1 - seg(t, SHOCK_FROM, SHOCK_FROM + 80));
        for (const pass of ["halo", "ink"] as const) {
          const front = { warp: blast, halo, pass };
          p.part("claw", clawAt(t), front);
          p.part("dactyl", dactylAt(t), front);
        }
      },
    };
  },
});
