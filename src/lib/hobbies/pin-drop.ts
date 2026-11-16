/**
 * The guess pin on the Narrow nature map, dropping in.
 *
 * A tap drops the pin from 18 to 24 px above the spot, a little to one side,
 * under a brisk pull, so it lands in 128 to 148 ms. It squashes for a frame
 * as it hits, and the map answers with a 1px ink ring that spreads from the
 * pin's own circle and fades. Tapping somewhere else lifts the old pin out
 * where it stood while the new one drops: there's only ever one pin, but
 * every tap leaves its ring, so tapping around leaves a short trail of them.
 * Lock it in presses the pin into the map just as the camera settles, and the
 * line to the answer leaves as it comes back up.
 *
 * Arrow keys slide the pin without a drop: a held arrow repeats about thirty
 * times a second, and a drop on each would stutter behind the key. The press
 * that places the first pin (an arrow or Enter) drops it like a tap.
 *
 * Everything is drawn on the map's own canvas at the pin's place on the
 * globe, so a ring stays put while the map zooms or pans under it. The poses
 * are pure functions of time; createPinMotion is the thin driver, and the map
 * only keeps redrawing while one of them is still moving.
 *
 * dealFrames is the board's half: a species you pay to see slides into its
 * square from the square the next one sits in.
 */
import { prefersReducedMotion } from "../motion";
import type { LonLat, Point } from "./day-list-map";

/** Where the pin is drawn relative to its spot, and how. */
export interface PinPose {
  x: number;
  y: number;
  /** Horizontal and vertical scale of the cross and its circle. */
  sx: number;
  sy: number;
  alpha: number;
  /** Line weight against the usual 1.6 px. */
  weight: number;
}

export const REST: PinPose = { x: 0, y: 0, sx: 1, sy: 1, alpha: 1, weight: 1 };

/** px/s². Brisker than the fish's 1400: a dart, not a leap. */
export const GRAVITY = 2200;
export const LIFT_MIN = 18;
export const LIFT_MAX = 24;
/** How far to one side it can start, px. */
export const DRIFT = 3;
/** Squash held for a frame at 60 Hz, then let go over about one more. */
export const SQUASH_HOLD_MS = 18;
export const SQUASH_MS = 34;
export const RING_MS = 300;
/** The ring leaves from the pin's circle (r 6) and spreads this far. */
export const RING_FROM = 6;
export const RING_TO = 22;
export const LIFT_MS = 140;
/** How far an old pin rises as it fades, px. */
export const LIFT_RISE = 8;
/** Lock it in: down, then back up as the line leaves. */
export const PRESS_DOWN_MS = 80;
export const PRESS_MS = 210;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const easeOut = (k: number) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
const easeIn = (k: number) => Math.pow(clamp(k, 0, 1), 2);

export interface Drop {
  /** Height it falls from, px. */
  lift: number;
  /** Sideways start, px, closing to 0 as it lands. */
  dx: number;
  /** ms from the tap to touching down. */
  fall: number;
}

/** Each drop a little different, so a run of taps never looks pasted. */
export function planDrop(rand: () => number = Math.random): Drop {
  const lift = LIFT_MIN + rand() * (LIFT_MAX - LIFT_MIN);
  const dx = (rand() * 2 - 1) * DRIFT;
  return { lift, dx, fall: 1000 * Math.sqrt((2 * lift) / GRAVITY) };
}

/**
 * The falling pin `ms` after the tap: in from above under constant pull,
 * fading up over the first part of the fall, then one squashed frame.
 */
export function dropPose(d: Drop, ms: number): PinPose {
  if (ms >= d.fall + SQUASH_MS) return REST;
  if (ms >= d.fall) {
    const after = ms - d.fall;
    const s =
      after < SQUASH_HOLD_MS
        ? 1
        : 1 - (after - SQUASH_HOLD_MS) / (SQUASH_MS - SQUASH_HOLD_MS);
    return {
      ...REST,
      sx: 1 + 0.22 * s,
      sy: 1 - 0.24 * s,
      weight: 1 + 0.15 * s,
    };
  }
  const t = Math.max(0, ms) / 1000;
  const k = Math.max(0, ms) / d.fall;
  return {
    ...REST,
    x: d.dx * (1 - k),
    y: Math.min(0, -d.lift + 0.5 * GRAVITY * t * t),
    alpha: clamp(k / 0.4, 0, 1),
  };
}

/** An old pin lifting out from `from`, `ms` after the next tap. */
export function liftPose(from: PinPose, ms: number): PinPose | null {
  if (ms >= LIFT_MS) return null;
  const k = Math.max(0, ms) / LIFT_MS;
  const grow = 1 + 0.06 * k;
  return {
    x: from.x,
    y: from.y - LIFT_RISE * easeIn(k),
    sx: grow,
    sy: grow,
    alpha: from.alpha * (1 - easeOut(k)),
    weight: 1,
  };
}

/** The ring a landing leaves, `ms` after touchdown. */
export function ringPose(ms: number): { r: number; alpha: number } | null {
  if (ms < 0 || ms >= RING_MS) return null;
  const k = ms / RING_MS;
  return {
    r: RING_FROM + (RING_TO - RING_FROM) * easeOut(k),
    alpha: 0.7 * Math.pow(1 - k, 1.6),
  };
}

/** Lock it in: the pin pressed into the map, `ms` after the press starts. */
export function pressPose(ms: number): PinPose {
  if (ms <= 0 || ms >= PRESS_MS) return REST;
  const depth =
    ms < PRESS_DOWN_MS
      ? easeIn(ms / PRESS_DOWN_MS)
      : 1 - easeOut((ms - PRESS_DOWN_MS) / (PRESS_MS - PRESS_DOWN_MS));
  const s = 1 - 0.2 * depth;
  return { ...REST, sx: s, sy: s, weight: 1 + 0.45 * depth };
}

/** How long a species takes to be dealt into its square, ms. */
export const DEAL_MS = 230;

/**
 * A clue dealt into its square from the side the next one sits on: `dx`,
 * `dy` px away, turned `turn` degrees, sliding in and settling square.
 */
export function dealFrames(dx: number, dy: number, turn: number): Keyframe[] {
  const at = (k: number, r: number) =>
    `translate(${(dx * k).toFixed(2)}px, ${(dy * k).toFixed(2)}px) rotate(${r.toFixed(2)}deg)`;
  return [
    {
      offset: 0,
      opacity: 0,
      transform: at(1, turn),
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    },
    { offset: 0.3, opacity: 1 },
    {
      offset: 0.78,
      transform: at(-0.06, -turn * 0.15),
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    },
    { offset: 1, opacity: 1, transform: at(0, 0) },
  ];
}

/** The pin as the map has always drawn it, in a pose. */
export function drawPin(
  ctx: CanvasRenderingContext2D,
  p: Point,
  pose: PinPose,
  ink: string,
): void {
  if (pose.alpha <= 0) return;
  const x = p.x + pose.x;
  const y = p.y + pose.y;
  const { sx, sy } = pose;
  ctx.save();
  ctx.globalAlpha = pose.alpha;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6 * pose.weight;
  ctx.beginPath();
  if (sx === sy) ctx.arc(x, y, 6 * sx, 0, Math.PI * 2);
  else ctx.ellipse(x, y, 6 * sx, 6 * sy, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 11 * sx, y);
  ctx.lineTo(x - 3 * sx, y);
  ctx.moveTo(x + 3 * sx, y);
  ctx.lineTo(x + 11 * sx, y);
  ctx.moveTo(x, y - 11 * sy);
  ctx.lineTo(x, y - 3 * sy);
  ctx.moveTo(x, y + 3 * sy);
  ctx.lineTo(x, y + 11 * sy);
  ctx.stroke();
  ctx.restore();
}

/* ---------------------------------------------------------------- driver */

interface Ring {
  at: LonLat;
  /** Touchdown time; the ring waits until then. */
  t0: number;
}

interface Lifting {
  at: LonLat;
  t0: number;
  from: PinPose;
}

export interface PinMotion {
  /** A tap put the pin at `at`; `was` is where it stood, if anywhere. */
  drop(at: LonLat, was: LonLat | null): void;
  /** A tap so close to the pin that it only shifts: no lift, one ring. */
  tapNear(at: LonLat): void;
  /** An arrow key moved the pin: it slides, mid-fall or not. */
  slide(at: LonLat): void;
  /** Lock it in: press the pin into the map, starting `inMs` from now. */
  press(inMs: number): void;
  /** A new round: nothing left in the air. */
  clear(): void;
  /**
   * Draw the rings, any old pin lifting out, and the pin itself at `pin`.
   * True while anything is still moving, so the map draws another frame.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    project: (lon: number, lat: number) => Point,
    ink: string,
    pin: LonLat | null,
  ): boolean;
}

export function createPinMotion(
  now: () => number = () => performance.now(),
): PinMotion {
  let falling: { t0: number; drop: Drop; ring: Ring } | null = null;
  let pressAt = -Infinity;
  const lifting: Lifting[] = [];
  const rings: Ring[] = [];

  function pose(t: number): PinPose {
    if (falling) {
      const p = dropPose(falling.drop, t - falling.t0);
      if (p !== REST) return p;
      falling = null;
    }
    return pressPose(t - pressAt);
  }

  return {
    drop(at, was) {
      if (prefersReducedMotion()) return;
      const t = now();
      if (was) {
        // A pin re-aimed mid-fall still leaves its ring, from now: every tap
        // gets one. It lifts out from wherever it had got to.
        if (falling && falling.ring.t0 > t) falling.ring.t0 = t;
        lifting.push({ at: { ...was }, t0: t, from: pose(t) });
      }
      const drop = planDrop();
      const ring = { at: { ...at }, t0: t + drop.fall };
      rings.push(ring);
      falling = { t0: t, drop, ring };
    },
    tapNear(at) {
      if (prefersReducedMotion()) return;
      if (falling && falling.ring.t0 > now()) {
        falling.ring.at = { ...at };
        return;
      }
      rings.push({ at: { ...at }, t0: now() });
    },
    slide(at) {
      if (falling && falling.ring.t0 > now()) falling.ring.at = { ...at };
    },
    press(inMs) {
      if (prefersReducedMotion()) return;
      pressAt = now() + inMs;
    },
    clear() {
      falling = null;
      pressAt = -Infinity;
      lifting.length = 0;
      rings.length = 0;
    },
    draw(ctx, project, ink, pin) {
      const t = now();
      let busy = false;

      for (let i = rings.length - 1; i >= 0; i--) {
        const ms = t - rings[i].t0;
        if (ms >= RING_MS) {
          rings.splice(i, 1);
          continue;
        }
        busy = true;
        const r = ringPose(ms);
        if (!r) continue;
        const p = project(rings[i].at.lon, rings[i].at.lat);
        ctx.save();
        ctx.globalAlpha = r.alpha;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      for (let i = lifting.length - 1; i >= 0; i--) {
        const l = lifting[i];
        const p = liftPose(l.from, t - l.t0);
        if (!p) {
          lifting.splice(i, 1);
          continue;
        }
        busy = true;
        drawPin(ctx, project(l.at.lon, l.at.lat), p, ink);
      }

      if (pin) {
        const p = pose(t);
        if (falling || t - pressAt < PRESS_MS) busy = true;
        drawPin(ctx, project(pin.lon, pin.lat), p, ink);
      }
      return busy;
    },
  };
}
