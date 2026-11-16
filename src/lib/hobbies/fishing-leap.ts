/**
 * A fish leaping out of its water on the fishing maps.
 *
 * Tapping a water sends its fish up out of the water on a short thrown arc:
 * nose up, over the top, nose down, and back in with a splash of pixel
 * droplets in the map's own water colours and a ring or two spreading on the
 * water. It goes in a little way from where it left and comes back up on its
 * own spot, so the map ends as it began. A mouse over a fish (or the arrow
 * keys landing on it) gets a rise instead: it lifts a touch and leaves one
 * ring.
 *
 * Everything but the layer at the bottom is a pure function of time, in CSS
 * px from where the fish left, with y down. The map converts to its own art
 * pixels when it draws, so the leap sits on the same grid as the map. The
 * arc is the aquarium's (jumpArc and heading in aquarium-jump.ts), timed by
 * the same pull, 1400 px/s².
 */
import { heading, jumpArc } from "./aquarium-jump";

export const GRAVITY = 1400;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => {
  const k = clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

export interface LeapPlan {
  /** Which way it goes, and faces while it's out: -1 left, 1 right. */
  dir: 1 | -1;
  /** How high the top of the arc is above the water, CSS px. */
  lift: number;
  /** From where it leaves the water to where it goes back in, CSS px. */
  dist: number;
  /** A little extra turn of the nose at the top, radians. */
  twist: number;
  /** Rolls over once on the way. */
  roll: boolean;
  /** Seconds from leaving the water to going back in. */
  air: number;
}

/** Seconds in the air for an arc whose top is `lift` px above both ends. */
export function airTime(lift: number): number {
  return 2 * Math.sqrt((2 * lift) / GRAVITY);
}

/**
 * A leap for a fish `len` CSS px long, facing `facing`. Most go the way the
 * fish faces and about one in four turns and goes back. Height, distance and
 * the turn at the top vary a little every time, and now and then it rolls
 * over once on the way. The top stays between 28 and 50 px, so the fish is
 * back in the water 0.4 to 0.53 s after it left.
 */
export function planLeap(
  len: number,
  facing: 1 | -1,
  rand: () => number = Math.random,
): LeapPlan {
  const lift = clamp(len * (1 + rand() * 0.6), 28, 50);
  const dir: 1 | -1 = rand() < 0.25 ? (-facing as 1 | -1) : facing;
  const dist = clamp(len * (0.45 + rand() * 0.6), 10, 42);
  const twist = (rand() - 0.5) * 0.6;
  const roll = rand() < 0.2;
  return { dir, lift, dist, twist, roll, air: airTime(lift) };
}

export interface Pose {
  /** Centre of the fish, CSS px from where it left the water. */
  x: number;
  y: number;
  /** Nose angle, radians, for a fish facing `dir`. */
  angle: number;
  /** Vertical scale, 1 upright to -1 belly up, for the roll. */
  flip: number;
}

/** The nose tips up over the first instant, so it doesn't snap from level. */
const TAKEOFF = 0.06;

/**
 * Where the fish is `t` s after it leaves. Past `air` it carries straight on
 * at the speed it went in, and the map hides whatever is under the water.
 */
export function leapAt(p: LeapPlan, t: number): Pose {
  const arc = jumpArc({ x: 0, y: 0 }, { x: p.dir * p.dist, y: 0 }, p.lift);
  // jumpArc keeps the aquarium's longer flights; this one is timed by the pull.
  const pace = arc.duration / p.air;
  const s = arc.at(clamp(t, 0, p.air) * pace);
  const vx = s.vx * pace;
  const vy = s.vy * pace;
  if (t <= p.air) {
    const k = clamp(t / p.air, 0, 1);
    const angle =
      (heading(vx, vy, p.dir) + p.twist * Math.sin(Math.PI * k)) *
      smooth(0, TAKEOFF, t);
    const flip = p.roll ? Math.cos(2 * Math.PI * smooth(0.15, 0.85, k)) : 1;
    return { x: s.x, y: s.y, angle, flip };
  }
  const dt = t - p.air;
  return {
    x: s.x + vx * dt,
    y: s.y + vy * dt,
    angle: heading(vx, vy, p.dir),
    flip: 1,
  };
}

/** Downward speed as it goes back in, px/s. */
export function entrySpeed(p: LeapPlan): number {
  return Math.sqrt(2 * GRAVITY * p.lift);
}

/**
 * Aim the leap so it comes down in water. `wet(dx)` says whether the spot
 * `dx` CSS px along from where it left is water. It tries the planned way
 * first, shorter and shorter, then the other way, and if nothing's wet (a
 * thin river) it makes a short hop the planned way.
 */
export function aimLeap(p: LeapPlan, wet: (dx: number) => boolean): LeapPlan {
  const steps = [1, 0.8, 0.6, 0.45, 0.3];
  for (const dir of [p.dir, -p.dir as 1 | -1]) {
    for (const s of steps) {
      if (wet(dir * p.dist * s)) return { ...p, dir, dist: p.dist * s };
    }
  }
  return { ...p, dist: p.dist * 0.3 };
}

/**
 * Seconds after going in until all of it is under: its centre has to sink
 * past the waterline `below` px under where it left, plus most of its length.
 */
export function plungeTime(p: LeapPlan, below: number, len: number): number {
  return (below + len * 0.62) / entrySpeed(p);
}

/** It stays under this long before it comes back up on its spot, s. */
export const UNDER = 0.16;
/** Coming back up through the surface, s. */
export const SURFACE = 0.26;

/** How far under it still is while it comes back up, 1 to 0. */
export function surfaceAt(t: number): number {
  if (t <= 0) return 1;
  if (t >= SURFACE) return 0;
  const k = t / SURFACE;
  return (1 - k) ** 3;
}

/** A rise: up a touch and back, s. */
export const RISE = 0.42;

/** How high a rising fish is, 0 to 1 of its rise. */
export function riseAt(t: number): number {
  if (t <= 0 || t >= RISE) return 0;
  const up = 0.11;
  if (t < up) return smooth(0, up, t);
  return 1 - smooth(up, RISE, t);
}

export interface Ring {
  /** Seconds after it was set off that it starts. */
  delay: number;
  /** Seconds it shows. */
  life: number;
  /** How wide it gets, half-width in art px. */
  reach: number;
}

/**
 * A ring `t` s after it was set off: its half-widths in art px, flattened
 * the way the fish's own shadow is, and how much of it still shows. It
 * fades by dropping pixels, 1 then every other one then every fourth.
 */
export function ringAt(
  r: Ring,
  t: number,
): { rx: number; ry: number; every: number } | null {
  const s = t - r.delay;
  if (s < 0 || s >= r.life) return null;
  const k = s / r.life;
  const rx = 1.5 + (r.reach - 1.5) * (1 - (1 - k) ** 2);
  return {
    rx,
    ry: Math.max(1, rx * 0.42),
    every: k < 0.5 ? 1 : k < 0.75 ? 2 : 4,
  };
}

/** The whole pixels round an ellipse, each once, in order round it. */
export function ringPixels(rx: number, ry: number): Array<[number, number]> {
  const n = Math.max(12, Math.ceil(2 * Math.PI * Math.max(rx, ry) * 1.5));
  const out: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(Math.cos(a) * rx);
    const y = Math.round(Math.sin(a) * ry);
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([x, y]);
  }
  return out;
}

export interface Drop {
  /** Thrown from, CSS px from the splash. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Gone after this long, s, or once it falls back past `floor`. */
  life: number;
  /** The water it falls back into, CSS px below the splash. */
  floor: number;
  /** 1 or 2 art px square. */
  size: 1 | 2;
  color: string;
}

/** Where a drop is `t` s after it was thrown, or null once it's back in. */
export function dropAt(d: Drop, t: number): { x: number; y: number } | null {
  if (t < 0 || t >= d.life) return null;
  const y = d.y + d.vy * t + 0.5 * GRAVITY * t * t;
  const falling = d.vy + GRAVITY * t > 0;
  if (falling && y > d.floor) return null;
  return { x: d.x + d.vx * t, y };
}

/**
 * The crown where it goes in, or a smaller one where it leaves: most of it
 * straight up, some thrown wide, leaning the way the fish was going.
 */
export function splashDrops(
  count: number,
  strength: number,
  lean: number,
  colors: string[],
  rand: () => number = Math.random,
): Drop[] {
  const out: Drop[] = [];
  for (let i = 0; i < count; i++) {
    const wide = rand() < 0.35;
    out.push({
      x: (rand() - 0.5) * 8,
      y: 0,
      vx: lean * 60 + (rand() - 0.5) * (wide ? 260 : 120),
      vy: -(120 + rand() * 230) * strength * (wide ? 0.7 : 1),
      life: 0.9,
      floor: rand() * 5,
      size: rand() < 0.7 ? 1 : 2,
      color: colors[i % colors.length],
    });
  }
  return out;
}

/**
 * The one fixed canvas the leaps are drawn on, over the page and under the
 * species panel, like the aquarium's .aq-air (its rule is .fish-air in
 * Fishing.astro). It only exists while something's in the air: `draw`
 * paints a frame and says whether anything is still moving, and when
 * nothing is the canvas goes.
 */
export function createAirLayer(
  draw: (c: CanvasRenderingContext2D, dpr: number, now: number) => boolean,
): { wake(): void } {
  let layer: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let raf = 0;

  function ensure(): CanvasRenderingContext2D | null {
    if (ctx && layer?.isConnected) return ctx;
    layer = document.createElement("canvas");
    layer.className = "fish-air";
    layer.setAttribute("aria-hidden", "true");
    document.body.append(layer);
    ctx = layer.getContext("2d");
    return ctx;
  }

  function teardown(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    layer?.remove();
    layer = null;
    ctx = null;
  }

  function frame(now: number): void {
    const c = ensure();
    if (!c || !layer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (layer.width !== Math.round(w * dpr)) layer.width = Math.round(w * dpr);
    if (layer.height !== Math.round(h * dpr))
      layer.height = Math.round(h * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, w, h);
    if (draw(c, dpr, now)) raf = requestAnimationFrame(frame);
    else teardown();
  }

  return {
    wake() {
      if (!raf) raf = requestAnimationFrame(frame);
    },
  };
}
