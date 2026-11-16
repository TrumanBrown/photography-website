/**
 * Trail moments dropping onto the trail.
 *
 * Pressing a moment sends it out of its button: the "+" grows into a small
 * pixel version of the moment, which arcs over to the spot on the route the
 * studio picked for it (the fish jump's arc, src/lib/hobbies/aquarium-jump.ts)
 * and lands in its own material. The ground eases into its new shape as it
 * lands, then the moment grows, pours or pitches into place: a lake splashes
 * in and fills its basin, a waterfall runs down to its pool, trees sprout
 * outward from where it hit, a tent pitches, a lookout rises out of the
 * ground, snow puffs up and settles. Every press is its own drop, and the
 * trail counts each one as it lands. An eleventh bounces off the trail and
 * falls out of the scene.
 *
 * The flight is drawn on a fixed canvas that only exists while something's in
 * the air. The landing is drawn in the scene itself, at the moment's own
 * depth, so whatever stands in front of it stays in front of it.
 *
 * The motion is pure functions of time (dropFlight, markerTurn, terrainGrow,
 * emerge, bitAt, ripple, revealScroll); the rest is the driver.
 */

import { heading, jumpArc, type Arc, type Point } from "./aquarium-jump";
import type { FeatureId, HikeState, PlacedFeature } from "./hiking-model";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const easeOut = (k: number) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
const smooth = (k: number) => {
  const c = clamp(k, 0, 1);
  return c * c * (3 - 2 * c);
};

export const GRAVITY = 1400;
/** The "+" growing into the marker, s. */
export const MORPH = 0.18;
/** The ground easing into its new shape after a landing, s. */
export const TERRAIN_S = 0.3;
/** How long a moment that didn't fit is seen falling away, s. */
const BOUNCE_LIFE = 1.4;

// ------------------------------------------------------------- markers

/**
 * The moments as 9 × 9 pixel markers, base on the bottom row. Letters are
 * colours from markerInk; dots are clear.
 */
export const MARKERS: Record<FeatureId, readonly string[]> = {
  forest: [
    "....d....",
    "...ddl...",
    "...ddd...",
    "..dddll..",
    "..ddddd..",
    ".ddddddl.",
    ".ddddddd.",
    "....t....",
    "....t....",
  ],
  meadow: [
    ".........",
    ".........",
    ".l.....l.",
    ".lg..l.g.",
    "..gl.lg..",
    "l.gglgg.l",
    "lggggggll",
    "ggggggggg",
    "ddddddddd",
  ],
  lake: [
    "....w....",
    "...www...",
    "..wwwww..",
    ".wwwwwww.",
    ".wlwwwww.",
    ".wlwwwwd.",
    ".wwwwwdd.",
    "..wwddd..",
    "...ddd...",
  ],
  waterfall: [
    ".rrrrrrr.",
    ".rrwwwrr.",
    "..rwfwr..",
    "...wwf...",
    "...fww...",
    "...wfw...",
    "...wwf...",
    "..fwfwf..",
    ".wwwwwww.",
  ],
  wildflowers: [
    ".r.....y.",
    "rcr...ycy",
    ".r..v..y.",
    ".s.vcv.s.",
    ".s..v..s.",
    "..s.s.s..",
    "..s.s.s..",
    "...sss...",
    "....s....",
  ],
  snowfield: [
    ".........",
    ".........",
    "....w....",
    "...www...",
    "..wwwww..",
    ".wwwwwss.",
    "wwwwwwsss",
    "wwwwwssss",
    "sssssssss",
  ],
  camp: [
    ".........",
    "....a....",
    "...aab...",
    "...aab...",
    "..aaabb..",
    "..aacbb..",
    ".aaccbbb.",
    ".accccbb.",
    "aacccbbbb",
  ],
  lookout: [
    "...rrr...",
    ".rrrrrrr.",
    "..bwbwb..",
    "..bbbbb..",
    ".lllllll.",
    "..l...l..",
    "..ll.ll..",
    "...l.l...",
    "..l...l..",
  ],
};

export interface MomentInk {
  water: string;
  tree: string;
  treeLight: string;
  ground: string;
  groundLight: string;
  accent: string;
  snow: string;
}

function hex(v: string): [number, number, number] {
  const h = v.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

export function mixHex(a: string, b: string, k: number): string {
  const x = hex(a);
  const y = hex(b);
  return `#${x
    .map((c, i) =>
      Math.round(c + (y[i] - c) * k)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** The marker's colours, from the scene's own palette. */
export function markerInk(
  type: FeatureId,
  ink: MomentInk,
): Record<string, string> {
  const dark = (c: string, k: number) => mixHex(c, "#000000", k);
  const light = (c: string, k: number) => mixHex(c, "#ffffff", k);
  switch (type) {
    case "forest":
      return { d: ink.tree, l: ink.treeLight, t: "#5b4330" };
    case "meadow":
      return {
        g: ink.groundLight,
        l: light(ink.treeLight, 0.25),
        d: dark(ink.ground, 0.1),
      };
    case "lake":
      return {
        w: ink.water,
        l: light(ink.water, 0.55),
        d: dark(ink.water, 0.25),
      };
    case "waterfall":
      return {
        r: dark(ink.ground, 0.28),
        w: ink.water,
        f: "#eef6f4",
      };
    case "wildflowers":
      return {
        s: ink.treeLight,
        y: "#f2c84b",
        r: "#d0533f",
        v: "#8a6fc2",
        c: "#fff4d6",
      };
    case "snowfield":
      return { w: ink.snow, s: "#b7c6cc" };
    case "camp":
      return {
        a: dark(ink.accent, 0.08),
        b: dark(ink.accent, 0.36),
        c: "#ffd78a",
      };
    case "lookout":
      return {
        r: dark(ink.ground, 0.3),
        b: dark(ink.accent, 0.22),
        w: "#f2c978",
        l: dark(ink.ground, 0.15),
      };
  }
}

// ------------------------------------------------------------- the flight

export interface Flight {
  arc: Arc;
  /** Turn at launch, radians; it unwinds so the marker lands upright. */
  spin: number;
}

/**
 * The thrown arc from the button to the landing spot, a little different
 * every press: how high it goes and how much it turns on the way.
 */
export function dropFlight(
  from: Point,
  to: Point,
  random: () => number = Math.random,
): Flight {
  const lift = 36 + random() * 60;
  const spin = (random() < 0.5 ? -1 : 1) * (0.35 + random() * 0.8);
  return { arc: jumpArc(from, to, lift), spin };
}

/** How the marker's turned `t` s into its flight: the launch spin unwinding,
 *  plus a little lean into the way it's going. Upright on landing. */
export function markerTurn(flight: Flight, t: number): number {
  const k = clamp(t / flight.arc.duration, 0, 1);
  const at = flight.arc.at(t);
  const lean = heading(at.vx, at.vy, at.vx < 0 ? -1 : 1) * 0.2 * (1 - k);
  return flight.spin * Math.pow(1 - k, 1.6) + lean;
}

/**
 * How far to scroll (negative is up) so a drop lands on screen: the whole
 * scene if the pressed button can stay in view too, and always the landing
 * spot with room above it for the arc. All in viewport pixels.
 */
export function revealScroll(
  canvas: { top: number; bottom: number },
  button: { top: number; bottom: number },
  landingY: number,
  viewport: number,
  headroom: number,
): number {
  const margin = 8;
  // Nothing to do while the landing and the arc over it are on screen.
  if (landingY - headroom >= margin && landingY + 24 <= viewport - margin)
    return 0;
  let delta = 0;
  if (canvas.top < margin) {
    // Bring the scene's top in, as far as the button allows.
    const room = viewport - margin - button.bottom;
    delta = Math.max(canvas.top - margin, -Math.max(0, room));
  } else if (canvas.bottom > viewport - margin) {
    const room = button.top - margin;
    delta = Math.min(canvas.bottom - (viewport - margin), Math.max(0, room));
  }
  // Whatever the button, the landing itself must be seen.
  const top = landingY - delta - headroom;
  if (top < margin) delta += top - margin;
  const bottom = landingY - delta + 24;
  if (bottom > viewport - margin) delta += bottom - (viewport - margin);
  return Math.round(delta);
}

// ------------------------------------------------------------- the landing

/** The ground's reshaping, 0 to 1, `t` s after the landing. */
export function terrainGrow(t: number): number {
  return smooth(t / TERRAIN_S);
}

/** A small overshoot for a flower popping open, once, no wobble. */
function pop(k: number): number {
  const c = clamp(k, 0, 1);
  const s = 1.3;
  return 1 + (s + 1) * Math.pow(c - 1, 3) + s * Math.pow(c - 1, 2);
}

/**
 * How far a moment's art has come in, `t` s after it landed, at `d` (0 where
 * it hit, 1 at its far edge). `jitter` (0 to 1) staggers neighbours a little.
 * Forest, meadow and wildflowers grow up from the ground outward; camp and
 * lookout come up whole; the lake fills from its floor, the waterfall runs
 * from its lip, snow settles in patches.
 */
export function emerge(type: FeatureId, t: number, d = 0, jitter = 0): number {
  switch (type) {
    case "forest":
      return easeOut((t - 0.05 - d * 0.26 - jitter * 0.05) / 0.22);
    case "meadow":
      return easeOut((t - 0.03 - d * 0.2 - jitter * 0.03) / 0.16);
    case "wildflowers":
      return pop((t - 0.05 - d * 0.22 - jitter * 0.08) / 0.18);
    case "camp":
      return easeOut((t - 0.06) / 0.26);
    case "lookout":
      return easeOut((t - 0.04) / 0.42);
    case "lake":
      return easeOut((t - 0.1) / 0.4);
    case "waterfall":
      return Math.pow(clamp((t - 0.06) / 0.42, 0, 1), 1.4);
    case "snowfield":
      // A patch is down or it isn't: they settle one by one.
      return (t - 0.05) / 0.38 >= d * 0.55 + jitter * 0.45 ? 1 : 0;
  }
}

/** When a landing has finished moving, s after it hit. */
export function landingLength(type: FeatureId): number {
  return {
    forest: 0.6,
    meadow: 0.42,
    wildflowers: 0.56,
    camp: 0.55,
    lookout: 0.62,
    lake: 1.0,
    waterfall: 1.15,
    snowfield: 0.9,
  }[type];
}

/** A ripple on the lake, `t` s after the landing: its half-width as a share
 *  of the lake's and how strongly it shows. Two rings, the second smaller. */
export function ripple(t: number): Array<{ spread: number; alpha: number }> {
  const rings: Array<{ spread: number; alpha: number }> = [];
  for (const [start, reach] of [
    [0.3, 0.9],
    [0.46, 0.6],
  ]) {
    const k = (t - start) / 0.5;
    if (k <= 0 || k >= 1) continue;
    rings.push({ spread: 0.08 + easeOut(k) * reach, alpha: 1 - k });
  }
  return rings;
}

/**
 * A thrown bit (water, dust, snow, mist) `t` s after it left, worked out
 * from its start so drawing a frame twice never moves it twice. Null once
 * it's gone: its time is up, or it fell back into the water.
 */
export interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  born: number;
  life: number;
  size: number;
  color: string;
  alpha: number;
  /** Water it falls back into and disappears. */
  surface?: number;
  /** Ground it comes to rest on, and stays a moment. */
  rest?: number;
}

export function bitAt(
  bit: Bit,
  t: number,
): { x: number; y: number; alpha: number } | null {
  if (t < 0 || t > bit.life) return null;
  let x = bit.x + bit.vx * t;
  let y = bit.y + bit.vy * t + 0.5 * bit.g * t * t;
  const falling = bit.vy + bit.g * t > 0;
  if (bit.surface != null && falling && y > bit.surface) return null;
  if (bit.rest != null && falling && y >= bit.rest) {
    // Settled: where and when it touched down.
    const a = 0.5 * bit.g;
    const c = bit.y - bit.rest;
    const disc = bit.vy * bit.vy - 4 * a * c;
    const ts = disc >= 0 && a > 0 ? (-bit.vy + Math.sqrt(disc)) / (2 * a) : t;
    x = bit.x + bit.vx * Math.min(t, ts);
    y = bit.rest;
  }
  const fade = clamp((bit.life - t) / Math.min(0.25, bit.life * 0.5), 0, 1);
  return { x, y, alpha: bit.alpha * fade };
}

// ------------------------------------------------------------- the driver

export interface DropsOptions {
  canvas: HTMLCanvasElement;
  /** The scene's size in CSS pixels and its device ratio, as last fitted. */
  view(): { width: number; height: number; dpr: number };
  state(): HikeState;
  /** Where the trail is at `x` (0 to 1) in `state`, canvas pixels. */
  ground(state: HikeState, x: number): Point;
  art(
    ctx: CanvasRenderingContext2D,
    state: HikeState,
    feature: PlacedFeature,
  ): void;
  ink(state: HikeState): MomentInk;
  lake(
    state: HikeState,
    feature: PlacedFeature,
  ): {
    y: number;
    left: number;
    right: number;
  };
  /** The moment reaches the trail: add it now. */
  onLand(drop: { type: FeatureId; x: number; id: string }): void;
  /** One that didn't fit bounced off. */
  onBounce(type: FeatureId): void;
}

interface Drop {
  type: FeatureId;
  x: number;
  id: string;
  flight: Flight;
  start: number;
  /** Page position it left from, the plus's colour, and where it aimed. */
  from: Point;
  plus: string;
  aim: Point;
  canvasAt: Point;
  overflow: boolean;
  pix: number;
}

interface Bouncer {
  type: FeatureId;
  pix: number;
  at: Point;
  v: Point;
  spin: number;
  born: number;
  /** Page position of the scene when it bounced. */
  canvasAt: Point;
}

interface Landing {
  type: FeatureId;
  id: string;
  start: number;
  lastFoam: number;
  misted: boolean;
}

export interface Drops {
  launch(spec: {
    type: FeatureId;
    x: number;
    id: string;
    button: HTMLElement;
    overflow?: boolean;
  }): void;
  /** Moments still in the air, so the studio can count them. */
  readonly inAir: ReadonlyArray<{ type: FeatureId; x: number; id: string }>;
  /** The state as it should be drawn now: landing moments' ground part way. */
  drawn(state: HikeState, now: number): HikeState;
  /** For the renderer: paint a landing moment in place of its art. */
  painter(
    drawn: HikeState,
    now: number,
  ): (
    feature: PlacedFeature,
  ) => ((ctx: CanvasRenderingContext2D) => void) | null;
  /** What the landings threw up, over the scene. */
  paintBits(ctx: CanvasRenderingContext2D, now: number): void;
  /** Anything in the scene still moving. */
  busy(now: number): boolean;
  /** Finish every landing where it is (a drag, an undo, a new landscape). */
  settle(): void;
  /** Drop everything, in the air and on the ground (Start over, Shuffle). */
  clear(): void;
}

const PIX_WIDE = 3;
const PIX_NARROW = 2;

export function createDrops(options: DropsOptions): Drops {
  const { canvas } = options;
  const drops: Drop[] = [];
  const bouncers: Bouncer[] = [];
  const landings = new Map<string, Landing>();
  const bits: Bit[] = [];
  let layer: HTMLCanvasElement | null = null;
  let actx: CanvasRenderingContext2D | null = null;
  let raf = 0;
  let scroll: { from: number; to: number; start: number } | null = null;
  const art = document.createElement("canvas");
  const artCtx = art.getContext("2d", { willReadFrequently: true });

  const pixFor = () => (options.view().width < 640 ? PIX_NARROW : PIX_WIDE);

  function canvasPage(): Point {
    const box = canvas.getBoundingClientRect();
    return { x: box.left + window.scrollX, y: box.top + window.scrollY };
  }

  /** The arc ends with the marker standing on the trail. */
  function aimFor(drop: { x: number }, pix: number): Point {
    const p = options.ground(options.state(), drop.x);
    return { x: p.x, y: p.y - (9 * pix) / 2 };
  }

  function ensureLayer(): CanvasRenderingContext2D | null {
    if (actx && layer?.isConnected) return actx;
    layer = document.createElement("canvas");
    layer.className = "hike-air";
    layer.setAttribute("aria-hidden", "true");
    document.body.append(layer);
    actx = layer.getContext("2d");
    return actx;
  }

  function teardown(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    layer?.remove();
    layer = null;
    actx = null;
  }

  function cancelScroll(): void {
    scroll = null;
  }
  window.addEventListener("wheel", cancelScroll, { passive: true });
  window.addEventListener("touchstart", cancelScroll, { passive: true });

  function launch(spec: {
    type: FeatureId;
    x: number;
    id: string;
    button: HTMLElement;
    overflow?: boolean;
  }): void {
    const now = performance.now();
    const pix = pixFor();
    const plusEl = spec.button.querySelector<HTMLElement>(".hike-plus");
    const box = (plusEl ?? spec.button).getBoundingClientRect();
    const from = {
      x: box.left + box.width / 2 + window.scrollX + (Math.random() - 0.5) * 4,
      y: box.top + box.height / 2 + window.scrollY,
    };
    const cAt = canvasPage();
    const local = aimFor(spec, pix);
    const aim = { x: cAt.x + local.x, y: cAt.y + local.y };
    const flight = dropFlight(from, aim);
    drops.push({
      type: spec.type,
      x: spec.x,
      id: spec.id,
      flight,
      start: now,
      from,
      plus: getComputedStyle(plusEl ?? spec.button).color,
      aim,
      canvasAt: cAt,
      overflow: !!spec.overflow,
      pix,
    });

    // On a phone the buttons sit under the scene: bring it into view.
    const cBox = canvas.getBoundingClientRect();
    const bBox = spec.button.getBoundingClientRect();
    const peak = Math.min(from.y, aim.y) - window.scrollY - 40;
    const delta = revealScroll(
      cBox,
      bBox,
      aim.y - window.scrollY,
      window.innerHeight,
      Math.max(60, aim.y - window.scrollY - peak),
    );
    if (Math.abs(delta) > 2) {
      const base = scroll ? scroll.to : window.scrollY;
      scroll = { from: window.scrollY, to: base + delta, start: now };
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  /** Where a drop is, page pixels: on its arc, following the scene if it
   *  has moved on the page or the ground under its spot has changed. */
  function where(drop: Drop, t: number): Point & { vx: number; vy: number } {
    const at = drop.flight.arc.at(t);
    const k = clamp(t / drop.flight.arc.duration, 0, 1);
    const cNow = canvasPage();
    const local = aimFor(drop, drop.pix);
    const dx = cNow.x + local.x - drop.aim.x;
    const dy = cNow.y + local.y - drop.aim.y;
    return { x: at.x + dx * k, y: at.y + dy * k, vx: at.vx, vy: at.vy };
  }

  function drawMarker(
    c: CanvasRenderingContext2D,
    type: FeatureId,
    pix: number,
    x: number,
    y: number,
    turn: number,
    scale: number,
    alpha: number,
    squash = 1,
  ): void {
    const grid = MARKERS[type];
    const ink = markerInk(type, options.ink(options.state()));
    const half = (grid.length * pix) / 2;
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y + half * (1 - squash));
    c.rotate(turn);
    c.scale(scale * (1 + (1 - squash) * 0.6), scale * squash);
    for (let r = 0; r < grid.length; r++) {
      for (let q = 0; q < grid[r].length; q++) {
        const key = grid[r][q];
        if (key === ".") continue;
        c.fillStyle = ink[key] ?? "#000";
        c.fillRect(-half + q * pix, -half + r * pix, pix, pix);
      }
    }
    c.restore();
  }

  function drawPlus(
    c: CanvasRenderingContext2D,
    color: string,
    pix: number,
    x: number,
    y: number,
    alpha: number,
  ): void {
    c.save();
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.fillRect(x - pix * 1.5, y - pix / 2, pix * 3, pix);
    c.fillRect(x - pix / 2, y - pix * 1.5, pix, pix * 3);
    c.restore();
  }

  function spawn(
    list: Array<Partial<Bit> & { x: number; y: number }>,
    now: number,
  ): void {
    for (const b of list)
      bits.push({
        vx: 0,
        vy: 0,
        g: GRAVITY,
        born: now,
        life: 0.5,
        size: pixFor(),
        color: "#ffffff",
        alpha: 1,
        ...b,
      });
  }

  /** Dust kicked up where something hit the ground, canvas pixels. */
  function dust(x: number, y: number, now: number, count: number, wide = 1) {
    const ink = options.ink(options.state());
    const colors = [
      mixHex(ink.groundLight, "#b39a73", 0.55),
      mixHex(ink.groundLight, "#8a7558", 0.5),
      mixHex(ink.ground, "#a8957a", 0.6),
    ];
    const pix = pixFor();
    spawn(
      Array.from({ length: count }, (_, i) => {
        const side = i % 2 ? 1 : -1;
        return {
          x: x + side * (2 + Math.random() * 6),
          y: y - 1,
          vx: side * (30 + Math.random() * 110) * wide,
          vy: -40 - Math.random() * 110,
          g: 520,
          life: 0.35 + Math.random() * 0.25,
          size: Math.random() < 0.7 ? pix : pix * 1.5,
          color: colors[i % colors.length],
          alpha: 0.85,
          rest: 0,
        };
      }).map((b) => {
        b.rest = groundUnder(b.x + b.vx * 0.3) + 1;
        return b;
      }),
      now,
    );
  }

  function land(drop: Drop, now: number): void {
    const state = options.state();
    const p = options.ground(state, drop.x);
    if (drop.overflow) {
      // No room: it bounces off the trail and falls out of the scene.
      const end = drop.flight.arc.at(drop.flight.arc.duration);
      const local = aimFor(drop, drop.pix);
      bouncers.push({
        type: drop.type,
        pix: drop.pix,
        at: { x: local.x, y: local.y },
        // A short hop off the trail, then down in front of the mountain
        // and out of the bottom of the scene.
        v: {
          x: end.vx * 0.45 + (end.vx < 0 ? -1 : 1) * (50 + Math.random() * 90),
          y: -clamp(Math.abs(end.vy) * 0.3, 170, 300),
        },
        spin: (end.vx < 0 ? -1 : 1) * (5 + Math.random() * 4),
        born: now,
        canvasAt: canvasPage(),
      });
      dust(p.x, p.y, now, 6);
      options.onBounce(drop.type);
      return;
    }
    landings.set(drop.id, {
      type: drop.type,
      id: drop.id,
      start: now,
      lastFoam: 0,
      misted: false,
    });
    options.onLand({ type: drop.type, x: drop.x, id: drop.id });
    // Thrown from where it hit, falling back onto the ground it's making.
    impact(drop, p, now);
  }

  /** What each moment throws up as it hits. */
  function impact(drop: Drop, p: Point, now: number): void {
    const { type } = drop;
    const state = options.state();
    const ink = options.ink(state);
    const pix = pixFor();
    if (type === "lake") {
      const feature = state.features.find((f) => f.id === drop.id);
      const water = feature ? options.lake(state, feature).y : p.y;
      const colors = [
        ink.water,
        mixHex(ink.water, "#ffffff", 0.45),
        mixHex(ink.water, "#ffffff", 0.75),
      ];
      // A crown: most of it straight up, a little thrown wide, falling back
      // into the basin. Smaller than the fish's: it's a far-off lake.
      spawn(
        Array.from({ length: 16 }, (_, i) => ({
          x: p.x + (Math.random() - 0.5) * 10,
          y: p.y - 2,
          vx: (Math.random() - 0.5) * 220,
          vy: -150 - Math.random() * 200,
          life: 0.8,
          size: Math.random() < 0.75 ? pix : pix / 2 + 0.5,
          color: colors[i % colors.length],
          surface: Math.max(p.y, water) + 1,
        })),
        now,
      );
    } else if (type === "snowfield") {
      const snow = [ink.snow, "#ffffff", "#d9e4e8"];
      spawn(
        Array.from({ length: 22 }, (_, i) => ({
          x: p.x + (Math.random() - 0.5) * 14,
          y: p.y - 2,
          vx: (Math.random() - 0.5) * 170,
          vy: -80 - Math.random() * 150,
          g: 640,
          life: 0.8 + Math.random() * 0.2,
          size: Math.random() < 0.6 ? pix : pix * 1.5,
          color: snow[i % snow.length],
          alpha: 0.95,
          rest: undefined as number | undefined,
        })).map((b) => ({
          ...b,
          // Each flake comes to rest on the ground under where it lands.
          rest: groundUnder(b.x + b.vx * 0.45) - 1,
        })),
        now,
      );
    } else if (type === "waterfall") {
      spawn(
        Array.from({ length: 6 }, () => ({
          x: p.x + (Math.random() - 0.5) * 6,
          y: p.y - 2,
          vx: (Math.random() - 0.5) * 120,
          vy: -80 - Math.random() * 90,
          life: 0.35,
          size: pix,
          color: mixHex(ink.water, "#ffffff", 0.6),
        })),
        now,
      );
    } else if (type === "lookout" || type === "camp") {
      dust(p.x, p.y, now, type === "camp" ? 10 : 8, type === "camp" ? 1.3 : 1);
    } else {
      dust(p.x, p.y, now, 6, 0.8);
    }
  }

  function groundUnder(cx: number): number {
    const { width } = options.view();
    return options.ground(options.state(), clamp(cx / width, 0.04, 0.96)).y;
  }

  function frame(now: number): void {
    const c = ensureLayer();
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

    if (scroll) {
      const k = clamp((now - scroll.start) / 380, 0, 1);
      const y = scroll.from + (scroll.to - scroll.from) * smooth(k);
      window.scrollTo(window.scrollX, y);
      if (k >= 1) scroll = null;
    }

    const box = canvas.getBoundingClientRect();
    const snapX = (v: number, pix: number) =>
      box.left + Math.round((v - box.left) / pix) * pix;
    const snapY = (v: number, pix: number) =>
      box.top + Math.round((v - box.top) / pix) * pix;

    for (let i = drops.length - 1; i >= 0; i--) {
      const drop = drops[i];
      const t = (now - drop.start) / 1000;
      if (t >= drop.flight.arc.duration) {
        drops.splice(i, 1);
        land(drop, now);
        continue;
      }
      const at = where(drop, t);
      const x = snapX(at.x - window.scrollX, drop.pix);
      const y = snapY(at.y - window.scrollY, drop.pix);
      const m = clamp(t / MORPH, 0, 1);
      if (m < 1) drawPlus(c, drop.plus, drop.pix, x, y, 1 - m);
      drawMarker(
        c,
        drop.type,
        drop.pix,
        x,
        y,
        markerTurn(drop.flight, t) * m,
        0.35 + 0.65 * m,
        m,
      );
    }

    // Ones that didn't fit, falling out of the bottom of the scene.
    for (let i = bouncers.length - 1; i >= 0; i--) {
      const b = bouncers[i];
      const t = (now - b.born) / 1000;
      const cNow = canvasPage();
      const lx = b.at.x + b.v.x * t;
      const ly = b.at.y + b.v.y * t + 0.5 * GRAVITY * t * t;
      if (t > BOUNCE_LIFE || ly > box.height + 9 * b.pix) {
        bouncers.splice(i, 1);
        continue;
      }
      c.save();
      c.beginPath();
      c.rect(box.left, box.top, box.width, box.height);
      c.clip();
      drawMarker(
        c,
        b.type,
        b.pix,
        snapX(cNow.x - window.scrollX + lx, b.pix),
        snapY(cNow.y - window.scrollY + ly, b.pix),
        b.spin * t,
        1,
        1,
      );
      c.restore();
    }

    if (drops.length || bouncers.length || scroll)
      raf = requestAnimationFrame(frame);
    else teardown();
  }

  // ------------------------------------------------ landing in the scene

  function landingT(l: Landing, now: number): number {
    return (now - l.start) / 1000;
  }

  /** The art's rows with anything in them, between x0 and x1 (CSS px). */
  function artRows(
    x0: number,
    x1: number,
    dpr: number,
    height: number,
  ): { top: number; bottom: number; data: ImageData } | null {
    if (!artCtx) return null;
    const sx = Math.max(0, Math.floor(x0 * dpr));
    const sw = Math.max(1, Math.min(art.width, Math.ceil(x1 * dpr)) - sx);
    const sh = Math.round(height * dpr);
    const data = artCtx.getImageData(sx, 0, sw, sh);
    const d = data.data;
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < sh && top < 0; y++)
      for (let x = 0; x < sw; x++)
        if (d[(y * sw + x) * 4 + 3] > 10) {
          top = y;
          break;
        }
    for (let y = sh - 1; y >= 0 && bottom < 0; y--)
      for (let x = 0; x < sw; x++)
        if (d[(y * sw + x) * 4 + 3] > 10) {
          bottom = y;
          break;
        }
    if (top < 0) return null;
    return { top: top / dpr, bottom: (bottom + 1) / dpr, data };
  }

  function paintLanding(
    ctx: CanvasRenderingContext2D,
    l: Landing,
    feature: PlacedFeature,
    drawn: HikeState,
    now: number,
  ): void {
    if (!artCtx) return;
    const { width, height, dpr } = options.view();
    const W = Math.round(width * dpr);
    const H = Math.round(height * dpr);
    if (art.width !== W) art.width = W;
    if (art.height !== H) art.height = H;
    artCtx.setTransform(1, 0, 0, 1, 0, 0);
    artCtx.clearRect(0, 0, W, H);
    artCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    artCtx.imageSmoothingEnabled = true;
    options.art(artCtx, drawn, feature);

    const t = landingT(l, now);
    const pix = pixFor();
    const fx = feature.x * width;
    const reach = width * 0.1 + 34;
    const x0 = Math.max(0, fx - reach);
    const x1 = Math.min(width, fx + reach);
    const groundAt = (cx: number) =>
      options.ground(drawn, clamp(cx / width, 0.04, 0.96)).y;
    const blit = (
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => {
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
      ctx.drawImage(
        art,
        sx * dpr,
        sy * dpr,
        sw * dpr,
        sh * dpr,
        dx,
        dy,
        dw,
        dh,
      );
    };

    const type = l.type;
    if (type === "forest" || type === "meadow" || type === "wildflowers") {
      // Column by column, each growing up out of the ground, outward from
      // where it hit.
      for (let sx = Math.floor(x0 / pix) * pix; sx < x1; sx += pix) {
        const mid = sx + pix / 2;
        const d = Math.abs(mid - fx) / reach;
        const jitter = hash(Math.round(sx / pix) + feature.x * 997);
        const p = emerge(type, t, d, jitter);
        if (p <= 0) continue;
        const g = groundAt(mid);
        const top = g - g * p;
        blit(sx, 0, pix, height, sx, Math.round(top), pix, height * p);
      }
      return;
    }

    if (type === "camp") {
      // Pitched: up from the ground at its centre, the sides pulled out.
      const p = emerge(type, t);
      if (p <= 0) return;
      const g = groundAt(fx);
      const sxs = 0.55 + 0.45 * p;
      blit(
        x0,
        0,
        x1 - x0,
        height,
        fx + (x0 - fx) * sxs,
        g - g * p,
        (x1 - x0) * sxs,
        height * p,
      );
      return;
    }

    if (type === "lookout") {
      // Up out of the ground, with dust at its feet while it rises.
      const rows = artRows(x0, x1, dpr, height);
      if (!rows) return;
      const p = emerge(type, t);
      const foot = groundAt(fx);
      const rise = (foot - rows.top + 6) * (1 - p);
      // It comes up through the ground at its foot; the legs that reach
      // down the slopes either side come clear as it tops out.
      const floor = foot + 5 + Math.max(0, rows.bottom - foot) * p * p;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, x1 - x0, floor);
      ctx.clip();
      blit(x0, 0, x1 - x0, height, x0, rise, x1 - x0, height);
      ctx.restore();
      if (p < 0.95 && now - l.lastFoam > 45) {
        l.lastFoam = now;
        dust(fx, groundAt(fx), now, 2, 0.6);
      }
      return;
    }

    if (type === "lake") {
      // The basin fills from its floor; then a ripple goes out across it.
      const rows = artRows(x0, x1, dpr, height);
      if (!rows) return;
      const p = emerge(type, t);
      const level = rows.bottom - (rows.bottom - rows.top) * p;
      blit(
        x0,
        level,
        x1 - x0,
        rows.bottom - level,
        x0,
        level,
        x1 - x0,
        rows.bottom - level,
      );
      return;
    }

    if (type === "waterfall") {
      // The water runs down from its lip to its pool, foam at the front.
      const rows = artRows(x0, x1, dpr, height);
      if (!rows) return;
      const p = emerge(type, t);
      const level = rows.top + (rows.bottom - rows.top) * p;
      blit(
        x0,
        rows.top,
        x1 - x0,
        level - rows.top,
        x0,
        rows.top,
        x1 - x0,
        level - rows.top,
      );
      const ink = options.ink(drawn);
      if (p < 1 && now - l.lastFoam > 40) {
        l.lastFoam = now;
        const row = Math.min(
          rows.data.height - 1,
          Math.max(0, Math.round(level * dpr)),
        );
        const xs: number[] = [];
        for (let q = 0; q < rows.data.width; q += 2)
          if (rows.data.data[(row * rows.data.width + q) * 4 + 3] > 40)
            xs.push(x0 + q / dpr);
        if (xs.length) {
          const mid = xs[Math.floor(xs.length / 2)];
          spawn(
            [0, 1].map(() => ({
              x: mid + (Math.random() - 0.5) * 6,
              y: level,
              vx: (Math.random() - 0.5) * 50,
              vy: -30 - Math.random() * 40,
              g: 300,
              life: 0.3,
              size: pix,
              color: "#f4faf8",
              alpha: 0.9,
            })),
            now,
          );
        }
      }
      if (p >= 1 && !l.misted) {
        l.misted = true;
        // Mist off the pool, rising and spreading, then gone.
        const row = Math.max(0, Math.round(rows.bottom * dpr) - 3);
        const xs: number[] = [];
        for (let q = 0; q < rows.data.width; q += 2)
          if (rows.data.data[(row * rows.data.width + q) * 4 + 3] > 40)
            xs.push(x0 + q / dpr);
        const pool = xs.length ? xs[Math.floor(xs.length / 2)] : fx;
        spawn(
          Array.from({ length: 12 }, () => ({
            x: pool + (Math.random() - 0.5) * 26,
            y: rows.bottom - 4 - Math.random() * 6,
            vx: (Math.random() - 0.5) * 60,
            vy: -18 - Math.random() * 26,
            g: -10,
            life: 0.6 + Math.random() * 0.3,
            size: Math.random() < 0.5 ? pix : pix * 2,
            color: mixHex(ink.water, "#ffffff", 0.8),
            alpha: 0.55,
          })),
          now,
        );
      }
      return;
    }

    if (type === "snowfield") {
      // Settles in patches, the middle first.
      const rows = artRows(x0, x1, dpr, height);
      if (!rows) return;
      const cell = pix * 2;
      for (
        let cy = Math.floor(rows.top / cell) * cell;
        cy < rows.bottom;
        cy += cell
      )
        for (let cx = Math.floor(x0 / cell) * cell; cx < x1; cx += cell) {
          const d = Math.abs(cx + cell / 2 - fx) / reach;
          const jitter = hash(cx * 7.13 + cy * 3.71);
          if (emerge(type, t, d, jitter) < 1) continue;
          blit(cx, cy, cell, cell, cx, cy, cell, cell);
        }
      return;
    }
  }

  function paintBits(ctx: CanvasRenderingContext2D, now: number): void {
    const { width, height } = options.view();
    const pix = pixFor();
    const snap = (v: number) => Math.round(v / pix) * pix;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      const at = bitAt(b, (now - b.born) / 1000);
      if (!at) {
        if ((now - b.born) / 1000 > 0) bits.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = at.alpha;
      ctx.fillStyle = b.color;
      ctx.fillRect(snap(at.x), snap(at.y), b.size, b.size);
    }
    // Ripples on landing lakes.
    const state = options.state();
    for (const l of landings.values()) {
      if (l.type !== "lake") continue;
      const feature = state.features.find((f) => f.id === l.id);
      if (!feature) continue;
      const lake = options.lake(state, feature);
      const half = (lake.right - lake.left) / 2;
      const cx = (lake.right + lake.left) / 2;
      const ink = options.ink(state);
      for (const ring of ripple((now - l.start) / 1000)) {
        const rx = Math.max(pix, half * ring.spread);
        const ry = Math.max(pix / 2, rx * 0.14);
        ctx.globalAlpha = ring.alpha * 0.9;
        ctx.fillStyle = mixHex(ink.water, "#ffffff", 0.7);
        const steps = Math.max(10, Math.round((rx * 2) / pix));
        for (let s = 0; s < steps; s++) {
          const a = (s / steps) * Math.PI * 2;
          ctx.fillRect(
            snap(cx + Math.cos(a) * rx),
            snap(lake.y + Math.sin(a) * ry),
            pix,
            Math.max(1, pix / 2),
          );
        }
      }
    }
    ctx.restore();
  }

  function hash(n: number): number {
    const s = Math.sin(n * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  }

  return {
    launch,
    get inAir() {
      return drops
        .filter((d) => !d.overflow)
        .map(({ type, x, id }) => ({ type, x, id }));
    },
    drawn(state, now) {
      if (!landings.size) return state;
      let changed = false;
      const features = state.features.map((f) => {
        const l = landings.get(f.id);
        if (!l) return f;
        const grow = terrainGrow(landingT(l, now));
        if (grow >= 1) return f;
        changed = true;
        return { ...f, grow };
      });
      return changed ? { ...state, features } : state;
    },
    painter(drawn, now) {
      // Landings that finished, or whose moment is gone, end here.
      for (const [id, l] of landings) {
        if (
          landingT(l, now) > landingLength(l.type) ||
          !drawn.features.some((f) => f.id === id)
        )
          landings.delete(id);
      }
      return (feature) => {
        const l = landings.get(feature.id);
        if (!l) return null;
        return (ctx) => paintLanding(ctx, l, feature, drawn, now);
      };
    },
    paintBits,
    busy(now) {
      if (bits.length) return true;
      for (const l of landings.values())
        if (landingT(l, now) <= landingLength(l.type)) return true;
      return false;
    },
    settle() {
      landings.clear();
    },
    clear() {
      drops.length = 0;
      bouncers.length = 0;
      bits.length = 0;
      landings.clear();
      scroll = null;
      teardown();
    },
  };
}
