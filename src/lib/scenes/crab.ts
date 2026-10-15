import { defineScene } from "./engine";
import {
  aim,
  apply,
  backOut,
  type Cam,
  camLerp,
  chain,
  dive,
  grow,
  lerp,
  type Mat,
  radiusNear,
  scale,
  seg,
  smootherstep,
  spring,
  turn,
} from "./stage";

/**
 * Tide pooling: the crab rears up bigger, reaches its right claw out with
 * the pincer wide open, and jabs it down to pinch the screen. The pinch pulls
 * the screen up toward you like a fold of cloth, swelling the dots under it
 * until they're big enough to open the page through.
 */

const DEG = Math.PI / 180;
/** Where the right claw meets the body, its hinge, and where its tips meet. */
const SHOULDER = [557, 232] as const;
const HINGE = [712, 194] as const;
const TIPS = [764, 174] as const;
const LEFT_SHOULDER = [262, 214] as const;
/** The crab stands on the sand here; it rears up about this point. */
const BASE = [390, 430] as const;

const REAR_FROM = 240;
const REAR_MS = 560;
const REACH_FROM = 620;
const REACH_MS = 480;
const JAB_FROM = REACH_FROM + REACH_MS;
const JAB_MS = 150;
const SNAP = JAB_FROM + JAB_MS - 30;
const SNAP_MS = 80;
const DIVE_FROM = SNAP + 60;
const DIVE_MS = 760;
/** How far the pinch swells the screen under it, at the end. */
const SWELL = 1.6;

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
    const claw = ctx.parts.claw;

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
    const clawAt = (t: number): Mat => {
      const k = lerp(1, 1.3, reach(t));
      const a = (-10 * rear(t) - 16 * reach(t) + 30 * jab(t)) * DEG;
      return chain(
        crab(t),
        turn(a, SHOULDER[0], SHOULDER[1]),
        scale(k, k, SHOULDER[0], SHOULDER[1]),
      );
    };
    const open = (t: number) =>
      -38 *
      DEG *
      backOut(seg(t, REACH_FROM + 80, REACH_FROM + REACH_MS), 1.6) *
      (1 - backOut(seg(t, SNAP, SNAP + SNAP_MS), 2.4));
    const dactylAt = (t: number): Mat =>
      chain(clawAt(t), turn(open(t), HINGE[0], HINGE[1]));

    // Where it pinches, and the spot among the tips the camera dives into.
    const pinch = apply(clawAt(DIVE_FROM), TIPS[0], TIPS[1]);
    const [ax, ay] = aim(claw, TIPS, 30, 12, 34);
    const [tx, ty] = apply(clawAt(DIVE_FROM), ax, ay);
    const rTip = radiusNear(claw, ax, ay, 14) * grow(clawAt(DIVE_FROM));

    // The camera leans in toward the claw as it reaches.
    const look = (t: number): Cam => {
      const base = ctx.lift(t);
      const near: Cam = {
        ax: w / 2,
        ay: h / 2,
        fx: pinch[0] - 60,
        fy: pinch[1] + 30,
        s: base.s * 1.55,
      };
      return camLerp(base, near, smootherstep(seg(t, REACH_FROM, SNAP + 40)));
    };
    const from = look(DIVE_FROM);
    const end = ctx.big(rTip * (1 + SWELL));

    // The snap shakes the screen.
    const shake = (t: number): [number, number] => {
      const k = seg(t, SNAP, SNAP + 240);
      if (k <= 0 || k >= 1) return [0, 0];
      const a = 8 * (1 - k) * (1 - k);
      return [a * Math.sin(t * 0.09), a * Math.cos(t * 0.11)];
    };

    // The swell: everything near the pinch grows, as if pulled up off the page.
    let swell = 0;
    let spread = 1;
    const pulled = (x: number, y: number, out: Float64Array) => {
      const dx = x - pinch[0];
      const dy = y - pinch[1];
      const m =
        1 + swell * Math.exp(-(dx * dx + dy * dy) / (2 * spread * spread));
      out[0] = pinch[0] + dx * m;
      out[1] = pinch[1] + dy * m;
      out[2] = m;
    };

    return {
      duration: DIVE_FROM + DIVE_MS,
      reveal: { from: [0.5, 0.5] },
      draw(t, p) {
        const u = seg(t, DIVE_FROM, DIVE_FROM + DIVE_MS);
        const c =
          t < DIVE_FROM ? look(t) : dive(from, tx, ty, end, u, w / 2, h / 2);
        const [sx, sy] = shake(t);
        p.cam({ ...c, ax: c.ax + sx, ay: c.ay + sy });

        swell = SWELL * smootherstep(seg(t, SNAP, DIVE_FROM + DIVE_MS * 0.7));
        // The swell spans about a third of the screen, whatever the zoom.
        spread = (0.3 * Math.min(w, h)) / c.s;
        const fade =
          1 - smootherstep(seg(t, DIVE_FROM + 60, DIVE_FROM + DIVE_MS * 0.6));
        const behind = { warp: pulled, alpha: fade };
        p.part("rest", undefined, behind);
        p.part(
          "left",
          chain(
            crab(t),
            turn(10 * DEG * rear(t), LEFT_SHOULDER[0], LEFT_SHOULDER[1]),
          ),
          behind,
        );
        p.part("body", crab(t), behind);
        const held = Math.min(t, DIVE_FROM);
        // Both halves of the claw lay their paper down before their ink.
        for (const pass of ["halo", "ink"] as const) {
          const front = { warp: pulled, target: true, halo: 1.4, pass };
          p.part("claw", clawAt(held), front);
          p.part("dactyl", dactylAt(held), front);
        }
      },
    };
  },
});
