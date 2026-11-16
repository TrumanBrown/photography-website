/**
 * Motion for the tide pool beach, as pure functions of time. The engine
 * (tidepool.ts) only samples these and draws.
 *
 * - raisePose / lowerPose: a heavy rock strains for a moment, comes up on an
 *   ease-out with a slight over-tilt that settles, and drops back a bit faster
 *   than it rose, squashing for a frame as it lands.
 * - critterReact: what the animal under it does when the light hits it.
 * - tideAt: a wave washing in over the beach from the water's side, foam
 *   leading, then drawing back and leaving wet sand that dries.
 *
 * A first find's hop into the journal is shared with the night drive, in
 * journal-hop.ts. Tested in tidepool-motion.test.ts.
 */
import type { TidepoolCategory } from "./tidepool-species";

export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const easeOutCubic = (k: number) => 1 - (1 - k) ** 3;
const easeOutQuad = (k: number) => 1 - (1 - k) ** 2;
const easeInQuad = (k: number) => k * k;
const easeInOut = (k: number) =>
  k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
/** Ease-out that runs about 18% past the end and comes back. */
function backOut(k: number, c1 = 2.4): number {
  const u = k - 1;
  return 1 + (c1 + 1) * u * u * u + c1 * u * u;
}

// ------------------------------------------------------------- the rocks

/** How far a flipped stone leans back, radians. Today's `lift * -0.5`. */
export const TILT = -0.5;

export interface Pose {
  /** 0 resting, 1 all the way up (today's `lift`). */
  lift: number;
  tilt: number;
  /** Sideways shudder while it strains, px. */
  dx: number;
  /** 1 on the frames it lands, else 0. */
  squash: number;
}

export const REST: Pose = { lift: 0, tilt: 0, dx: 0, squash: 0 };
export const UP: Pose = { lift: 1, tilt: TILT, dx: 0, squash: 0 };

/** 0 for the smallest rock, 1 for the biggest, from its drawn size. */
export function heaviness(w: number, h: number): number {
  return clamp((w * h - 800) / 4800, 0, 1);
}

export interface RaiseTiming {
  strain: number;
  rise: number;
  settle: number;
}

/**
 * Seconds for each part of a lift. A stone that's already partway up (caught
 * as it fell) skips the strain and has less far to go.
 */
export function raiseTiming(heavy: number, from = 0): RaiseTiming {
  return {
    strain: from > 0.02 ? 0 : 0.09 + 0.03 * heavy,
    rise: (0.21 + 0.02 * heavy) * (1 - 0.6 * from),
    settle: 0.16,
  };
}

/** When the stone is all the way up, s: the card opens then. 0.30 to 0.35. */
export function upAt(heavy: number, from = 0): number {
  const t = raiseTiming(heavy, from);
  return t.strain + t.rise;
}

/** When a lift has settled completely, s. */
export function raiseEnd(heavy: number, from = 0): number {
  const t = raiseTiming(heavy, from);
  return t.strain + t.rise + t.settle;
}

/** A stone `t` seconds after it was tapped to come up. */
export function raisePose(t: number, heavy: number, from = 0): Pose {
  const { strain, rise, settle } = raiseTiming(heavy, from);
  if (t < strain) {
    // A shudder, two px either way and back, twice: it's heavy.
    const k = t / strain;
    return {
      lift: from,
      tilt: TILT * from,
      dx: Math.round(Math.sin(k * Math.PI * 4)) * 2,
      squash: 0,
    };
  }
  const k = clamp((t - strain) / rise, 0, 1);
  const kt = clamp((t - strain) / (rise + settle), 0, 1);
  return {
    lift: from + (1 - from) * easeOutCubic(k),
    tilt: TILT * (from + (1 - from) * backOut(kt)),
    dx: 0,
    squash: 0,
  };
}

/** Fall time from all the way up, s. It rose in 0.21 to 0.23. */
export const DROP = 0.15;
/** How long it sits squashed on landing, s: a frame or two. */
export const SQUASH = 0.035;

export function dropTime(from: number): number {
  return DROP * Math.sqrt(clamp(from, 0, 1));
}

/** A stone `t` seconds after it was tapped to go back down from `from`. */
export function lowerPose(t: number, from: number): Pose {
  const drop = dropTime(from);
  if (t < drop) {
    const lift = from * (1 - easeInQuad(t / drop));
    return { lift, tilt: TILT * lift, dx: 0, squash: 0 };
  }
  return { ...REST, squash: from > 0.2 && t < drop + SQUASH ? 1 : 0 };
}

export function lowerEnd(from: number): number {
  return dropTime(from) + SQUASH;
}

// ----------------------------------------------------------- the critters

export type Reaction = "scuttle" | "dart" | "flick" | "clench" | "still";

export function reactionFor(category: TidepoolCategory): Reaction {
  switch (category) {
    case "crab":
    case "hermit":
      return "scuttle";
    case "sculpin":
    case "eel":
    case "octopus":
      return "dart";
    case "shrimp":
      return "flick";
    case "anemone":
      return "clench";
    default:
      // Snails, chitons, limpets, barnacles, mussels, stars, urchins,
      // nudibranchs and cucumbers stay put.
      return "still";
  }
}

/** How far it goes, px: a crab further than a hermit in its shell. */
export function reactionReach(category: TidepoolCategory): number {
  switch (category) {
    case "crab":
      return 12;
    case "hermit":
      return 8;
    case "shrimp":
      return 14;
    case "eel":
      return 20;
    default:
      return 16;
  }
}

export interface React {
  dx: number;
  dy: number;
  /** For an anemone: 1 open, 0 shut. */
  open: number;
}

const STILL: React = { dx: 0, dy: 0, open: 1 };

/** How long a reaction runs, s. */
export function reactionLength(kind: Reaction): number {
  return { scuttle: 0.32, dart: 0.48, flick: 0.42, clench: 1.3, still: 0 }[
    kind
  ];
}

/**
 * The animal `t` seconds after the light reaches it, facing `dir`. Every
 * reaction ends where it started, so the beach ends as it does today.
 */
export function critterReact(
  kind: Reaction,
  t: number,
  dir: 1 | -1,
  reach: number,
): React {
  if (t <= 0 || t >= reactionLength(kind)) return STILL;
  switch (kind) {
    case "scuttle": {
      // Out sideways, a beat, and back under cover.
      const out =
        t < 0.08
          ? easeOutQuad(t / 0.08)
          : t < 0.15
            ? 1
            : 1 - easeInOut((t - 0.15) / 0.17);
      return { dx: dir * reach * out, dy: 0, open: 1 };
    }
    case "dart": {
      const out =
        t < 0.06 ? easeOutCubic(t / 0.06) : 1 - easeInOut((t - 0.06) / 0.42);
      return { dx: dir * reach * out, dy: 0, open: 1 };
    }
    case "flick": {
      // A shrimp snaps its tail and shoots backwards, a little up.
      const out =
        t < 0.05 ? easeOutCubic(t / 0.05) : 1 - easeInOut((t - 0.05) / 0.37);
      return { dx: -dir * reach * out, dy: -4 * out, open: 1 };
    }
    case "clench": {
      // Shuts fast, holds, and opens again slowly.
      const open =
        t < 0.07
          ? 1 - easeOutQuad(t / 0.07)
          : t < 0.4
            ? 0
            : easeInOut((t - 0.4) / 0.9);
      return { dx: 0, dy: 0, open };
    }
    default:
      return STILL;
  }
}

// --------------------------------------------------------------- the tide

export interface Tide {
  /** performance.now() when it was sent, ms. */
  start: number;
  /** Seconds washing in, drawing back, and for the wet sand to dry. */
  up: number;
  back: number;
  dry: number;
  /** Where the foam starts (the shorebreak) and how far it runs, px. */
  top: number;
  bottom: number;
  /** The wavy, slightly angled shape of its leading edge. */
  amp: number;
  slant: number;
  mid: number;
  p1: number;
  p2: number;
  l1: number;
  l2: number;
  seed: number;
}

/**
 * A wave for a beach `w` by `h`. It starts at the shorebreak (30% down, where
 * bakeBackground draws the water) and runs past the bottom, so every rock is
 * washed. Its shape, angle and speed vary a little each time.
 */
export function makeTide(
  w: number,
  h: number,
  start: number,
  rand: () => number = Math.random,
): Tide {
  const amp = 5 + rand() * 7;
  const slant = (rand() - 0.5) * 0.09;
  return {
    start,
    up: 0.52 + rand() * 0.12,
    back: 0.46 + rand() * 0.1,
    dry: 1,
    top: h * 0.3,
    bottom: h + 16 + amp * 2 + Math.abs(slant) * w * 0.5,
    amp,
    slant,
    mid: w / 2,
    p1: rand() * Math.PI * 2,
    p2: rand() * Math.PI * 2,
    l1: 38 + rand() * 30,
    l2: 12 + rand() * 8,
    seed: Math.floor(rand() * 1e9),
  };
}

/** The leading edge's offset at x, px. */
function edge(tide: Tide, x: number): number {
  return (
    tide.amp *
      (0.65 * Math.sin(x / tide.l1 + tide.p1) +
        0.35 * Math.sin(x / tide.l2 + tide.p2)) +
    tide.slant * (x - tide.mid)
  );
}

/** Where the water's edge is at x, `t` s after it was sent, px from the top. */
export function tideFront(tide: Tide, t: number, x: number): number {
  const run = tide.bottom - tide.top;
  if (t <= 0) return tide.top;
  if (t < tide.up)
    return tide.top + run * easeOutQuad(t / tide.up) + edge(tide, x);
  const k = clamp((t - tide.up) / tide.back, 0, 1);
  return tide.bottom - run * easeInQuad(k) + edge(tide, x);
}

/** The furthest the water has reached at x so far. It never comes back up. */
export function tideReach(tide: Tide, t: number, x: number): number {
  return tideFront(tide, Math.min(t, tide.up), x);
}

/** Washing in: the beach under it is still changing. */
export function tideWashing(tide: Tide, t: number): boolean {
  return t < tide.up;
}

export function tideDone(tide: Tide, t: number): boolean {
  return t >= tide.up + tide.back + tide.dry;
}

/**
 * How far the water has washed over a stone whose top and bottom are at `y0`
 * and `y1`: 0 before the foam reaches its top, 1 once it's past its bottom.
 * The old stone fades out and the new one in under the foam with it.
 */
export function tideOver(
  tide: Tide,
  t: number,
  x: number,
  y0: number,
  y1: number,
): number {
  return clamp((tideReach(tide, t, x) - y0) / (y1 - y0 + 12), 0, 1);
}

/** Cheap repeatable noise for foam gaps, 0 to 1. */
function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export interface TideCell {
  /** Water over the beach: 0 none, up to about 0.8 in the churned water just
   *  behind the foam. `churn` 0 to 1 says how sandy and pale it is. */
  water: number;
  churn: number;
  /** Foam, 0 or its alpha. */
  foam: number;
  /** Wet sand left behind, 1 soaked to 0 dry. */
  wet: number;
}

/**
 * One cell of the beach `t` s after the wave was sent: `y` the cell's centre,
 * `col` its column on the pixel grid, and `front` and `reach` the wave's
 * tideFront and tideReach for that column (worked out once per column, since
 * they cost two sines). Writes into `out` so a frame doesn't allocate.
 */
export function tideCell(
  tide: Tide,
  t: number,
  y: number,
  front: number,
  reach: number,
  col: number,
  pix: number,
  out: TideCell,
): TideCell {
  out.water = out.churn = out.foam = out.wet = 0;
  if (t <= 0 || y < tide.top || tideDone(tide, t)) return out;
  const backing = t >= tide.up;
  const kb = backing ? clamp((t - tide.up) / tide.back, 0, 1) : 0;
  if (y < front) {
    const d = front - y;
    const near = clamp(1 - d / 40, 0, 1);
    out.churn = backing ? near * 0.3 * (1 - kb) : near;
    // The foam line leads: solid with a few gaps, then broken bubbles
    // trailing behind it. It thins and breaks up as the water draws back.
    const row = Math.floor(d / pix);
    const thin = backing ? 1 - kb : 1;
    if (row === 0 && hash(col, tide.seed) < 0.9 * thin + 0.05) out.foam = 0.92;
    else if (row < 3 && hash(col * 7 + row, tide.seed) < 0.38 * thin)
      out.foam = 0.85;
    else if (row < 10 && hash(col * 13 + row, tide.seed + 1) < 0.07 * thin)
      out.foam = 0.7;
    // About half over the sand, so it reads as the same blue as the water
    // offshore rather than going grey-green.
    out.water = (0.52 + 0.26 * out.churn) * (backing ? 1 - 0.75 * kb : 1);
    return out;
  }
  if (!backing || y >= reach) return out;
  // Uncovered as the water drew back past this row: it dries from then on.
  // reach - bottom is the edge's offset in this column.
  const run = tide.bottom - tide.top;
  const k = Math.sqrt(clamp((reach - y) / run, 0, 1));
  const left = tide.up + tide.back * k;
  out.wet = 1 - clamp((t - left) / tide.dry, 0, 1);
  return out;
}

/** tideCell for one point, working out its column itself. */
export function tideAt(
  tide: Tide,
  t: number,
  x: number,
  y: number,
  col: number,
  pix: number,
): TideCell {
  const out = { water: 0, churn: 0, foam: 0, wet: 0 };
  return tideCell(
    tide,
    t,
    y,
    tideFront(tide, t, x),
    tideReach(tide, t, x),
    col,
    pix,
    out,
  );
}
