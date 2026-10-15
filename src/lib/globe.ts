import { LAND } from "./geo";

export interface GlobePlace {
  /** Display name, also the key used by `goTo` and `mark`. */
  name: string;
  lat: number;
  lon: number;
  /** Used so a random spin visits each part of the world equally often. */
  region: string;
  /** Session slugs at this place; a spin opens one of them. */
  slugs: string[];
}

export interface GlobeOptions {
  canvas: HTMLCanvasElement;
  places: GlobePlace[];
  /** Place to face from the very first frame, so a page opens exactly where
   *  the spin that led to it came to rest. */
  start?: string;
  /** Fired once the globe comes to rest on a place, after a spin or a throw. */
  onArrive?: (place: GlobePlace) => void;
  /** Fired as a spin or throw sets off, with the whole path it will follow,
   *  so whatever happens on landing can start getting ready straight away. */
  onDepart?: (departure: Departure) => void;
}

export interface Departure {
  place: GlobePlace;
  plan: Plan;
  /** performance.now() when the globe set off along `plan`. */
  begun: number;
}

export interface GlobeHandle {
  spin(): void;
  goTo(name: string, opts?: { silent?: boolean }): void;
  mark(name: string | null): void;
  resize(): void;
  destroy(): void;
}

/** Where the globe faces and how fast it's turning (degrees, degrees/second). */
export interface GlobeState {
  lon: number;
  lat: number;
  lonVel: number;
  latVel: number;
}

/** One axis of a planned movement: position and speed `t` seconds in. */
export interface Track {
  at(t: number): [position: number, speed: number];
}

/** A whole movement, settled before it starts: the place it stops on and the
 *  path there. Following a plan to its end always leaves `place` centred and
 *  the globe still, so there's nothing left to correct once it stops. */
export interface Plan {
  place: GlobePlace;
  duration: number;
  lon: Track;
  lat: Track;
}

const RAD = Math.PI / 180;

/* Motion constants. Spins, throws and glides all follow a precomputed path
   that starts at the globe's current speed and ends at rest on a place. */
const PUSH = 0.18; // seconds for a spin to get up to speed
const SPIN_BASE = 1.7; // seconds per spin, plus SPIN_PER_TURN for each turn
const SPIN_PER_TURN = 0.5;
const FRICTION = 2.9; // how quickly a thrown globe would coast to a stop, per second
const THROW_MIN = 120; // degrees/second; slower than this is letting go, not a throw
const TILT_CARRY = 0.15; // seconds a drag's up-down speed carries on for
const TILT_HOLD = 0.35; // share of a spin spent before it tilts toward the place

const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));
/** Shortest signed turn equivalent to `deg`, in [-180, 180). */
const wrap = (deg: number) => (((deg % 360) + 540) % 360) - 180;
/** How far ahead `deg` is when only turning forward, in [0, 360). */
const ahead = (deg: number) => ((deg % 360) + 360) % 360;

/** Great-circle angle between two points, in degrees. */
function arc(lonA: number, latA: number, lonB: number, latB: number): number {
  const a = latA * RAD;
  const b = latB * RAD;
  const cos =
    Math.sin(a) * Math.sin(b) +
    Math.cos(a) * Math.cos(b) * Math.cos((lonB - lonA) * RAD);
  return Math.acos(clamp(cos, -1, 1)) / RAD;
}

function closest(places: GlobePlace[], lon: number, lat: number): GlobePlace {
  let best = places[0];
  let bestArc = Infinity;
  for (const place of places) {
    const d = arc(lon, lat, place.lon, place.lat);
    if (d < bestArc) {
      bestArc = d;
      best = place;
    }
  }
  return best;
}

/** From `x0` moving at `v0`, ease to a stop on `x1` (a cubic Hermite curve). */
function glide(x0: number, v0: number, x1: number, duration: number): Track {
  const d = x1 - x0;
  const m = v0 * duration;
  return {
    at(t) {
      const s = clamp(t / duration, 0, 1);
      const s2 = s * s;
      const s3 = s2 * s;
      return [
        x0 + m * (s3 - 2 * s2 + s) + d * (3 * s2 - 2 * s3),
        (m * (3 * s2 - 4 * s + 1) + d * (6 * s - 6 * s2)) / duration,
      ];
    },
  };
}

/**
 * A spin: from `x0` moving at `v0`, get up to speed over PUSH seconds, then
 * coast down and stop on `x1`. The coast is a cubic ease-out, so speed and
 * deceleration reach zero together and the moment it stops can't be seen.
 */
function flick(
  x0: number,
  v0: number,
  x1: number,
  duration: number,
): Track & { peak: number } {
  const dir = x1 >= x0 ? 1 : -1;
  const distance = Math.abs(x1 - x0);
  const u0 = v0 * dir;
  const coast = duration - PUSH;
  // The push covers PUSH·(u0 + peak)/2 and the coast covers peak·coast/3, so
  // this is the one top speed that ends exactly on x1.
  const peak = (distance - (PUSH * u0) / 2) / (PUSH / 2 + coast / 3);
  const pushed = (PUSH * (u0 + peak)) / 2;
  const rest = distance - pushed;
  return {
    peak,
    at(t) {
      t = clamp(t, 0, duration);
      let u: number;
      let speed: number;
      if (t < PUSH) {
        const k = t / PUSH;
        u = u0 * t + (peak - u0) * PUSH * (k * k * k - (k * k * k * k) / 2);
        speed = u0 + (peak - u0) * k * k * (3 - 2 * k);
      } else {
        const left = 1 - (t - PUSH) / coast;
        u = pushed + rest * (1 - left * left * left);
        speed = (3 * rest * left * left) / coast;
      }
      return [x0 + dir * u, dir * speed];
    },
  };
}

/**
 * Latitude: carry on briefly at `v0` (a drag's up-down speed), then tilt onto
 * `y1`. `hold` is the share of the time before the tilt starts, so a spin
 * doesn't give away where it's headed by leaning that way straight off.
 */
function tilt(
  y0: number,
  v0: number,
  y1: number,
  duration: number,
  hold = 0,
): Track {
  const span = (1 - hold) * duration;
  // Room left before the pole in the direction it's drifting; the carry eases
  // into that limit instead of running past it.
  const room = Math.max(1, v0 >= 0 ? 85 - y0 : y0 + 85);
  return {
    at(t) {
      t = clamp(t, 0, duration);
      const s = t / duration;
      const k = clamp((t - hold * duration) / span, 0, 1);
      const ease = k * k * k * (k * (6 * k - 15) + 10);
      const easeSpeed = (30 * k * k * (k - 1) * (k - 1)) / span;
      const decay = Math.exp(-t / TILT_CARRY);
      const bend = Math.tanh((v0 * TILT_CARRY * (1 - decay)) / room);
      const carry = room * bend;
      const carrySpeed = (1 - bend * bend) * v0 * decay;
      const fade = 1 - s * s * (3 - 2 * s);
      const fadeSpeed = (-6 * s * (1 - s)) / duration;
      return [
        clamp(y0 + (y1 - y0) * ease + carry * fade, -85, 85),
        (y1 - y0) * easeSpeed + carrySpeed * fade + carry * fadeSpeed,
      ];
    },
  };
}

/**
 * Pick where a spin lands: a random region, then a random place in it, so a
 * region with a dozen pins doesn't come up a dozen times as often. Never the
 * place the globe is already on.
 */
export function pickSpinTarget(
  places: GlobePlace[],
  current: GlobePlace | null,
  random: () => number = Math.random,
): GlobePlace {
  const pool = places.filter((place) => place.name !== current?.name);
  if (!pool.length) return places[0];
  const regions = [...new Set(pool.map((place) => place.region))];
  const region = regions[Math.floor(random() * regions.length)];
  const bucket = pool.filter((place) => place.region === region);
  return bucket[Math.floor(random() * bucket.length)];
}

/**
 * Plan a spin that lands on `place`. Which way it turns is a coin toss from a
 * standstill and kept if it's already turning, it always makes at least one
 * full turn, and its pace varies a little, so no two spins look alike even
 * though the landing was chosen up front.
 */
export function planSpin(
  from: GlobeState,
  place: GlobePlace,
  random: () => number = Math.random,
): Plan {
  const dir =
    Math.abs(from.lonVel) > 1
      ? Math.sign(from.lonVel)
      : random() < 0.5
        ? -1
        : 1;
  const offset = ahead(dir * (place.lon - from.lon));
  const pace = 0.92 + random() * 0.16;
  // From a standstill that's one to two turns. Pressed again mid-spin, it
  // adds turns until it can land without braking.
  let turns = 1;
  let duration: number;
  let lon: ReturnType<typeof flick>;
  do {
    const distance = offset + 360 * turns;
    duration = (SPIN_BASE + (SPIN_PER_TURN * distance) / 360) * pace;
    lon = flick(from.lon, from.lonVel, from.lon + dir * distance, duration);
    turns++;
  } while (lon.peak < dir * from.lonVel && turns <= 4);
  return {
    place,
    duration,
    lon,
    lat: tilt(from.lat, from.latVel, place.lat, duration, TILT_HOLD),
  };
}

/** Plan a short drift onto `place`, the shorter way round. */
export function planGlide(from: GlobeState, place: GlobePlace): Plan {
  const distance = arc(from.lon, from.lat, place.lon, place.lat);
  const duration = clamp(
    0.25 + distance / 200 + Math.abs(from.lonVel) / 1000,
    0.25,
    1.4,
  );
  return {
    place,
    duration,
    lon: glide(
      from.lon,
      from.lonVel,
      from.lon + wrap(place.lon - from.lon),
      duration,
    ),
    lat: tilt(from.lat, from.latVel, place.lat, duration),
  };
}

/**
 * Plan where a thrown globe settles: on the place nearest to where it would
 * have coasted to a stop by itself, slowing from the speed it was let go at.
 */
export function planThrow(from: GlobeState, places: GlobePlace[]): Plan {
  const stopLon = from.lon + from.lonVel / FRICTION;
  const stopLat = clamp(from.lat + from.latVel * TILT_CARRY, -80, 80);
  const place = closest(places, stopLon, stopLat);
  if (Math.abs(from.lonVel) < THROW_MIN) return planGlide(from, place);
  const x1 = stopLon + wrap(place.lon - stopLon);
  const distance = x1 - from.lon;
  // Coasting forward, an ease-out from the release speed takes 3·d/v seconds.
  // A place behind the release point gets a short glide back instead.
  const duration =
    distance * from.lonVel > 0
      ? clamp((3 * distance) / from.lonVel, 0.45, 2.6)
      : clamp(0.6 + Math.abs(distance) / 240, 0.6, 1.4);
  return {
    place,
    duration,
    lon: glide(from.lon, from.lonVel, x1, duration),
    lat: tilt(from.lat, from.latVel, place.lat, duration),
  };
}

/** Resolved from CSS custom properties so the globe follows the theme. */
export interface Palette {
  ink: string;
  dim: string;
  rule: string;
  grid: string;
  coast: string;
}

export function readPalette(el: Element): Palette {
  const style = getComputedStyle(el);
  const pick = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    ink: pick("--globe-ink", "#16150f"),
    dim: pick("--globe-dim", "#a9a397"),
    rule: pick("--globe-rule", "#ddd8cd"),
    grid: pick("--globe-grid", "#eeebe3"),
    coast: pick("--globe-coast", "#bab4a6"),
  };
}

/** Where a globe sits on its canvas, how big it is and which way it faces. */
export interface GlobeView {
  cx: number;
  cy: number;
  radius: number;
  lon: number;
  lat: number;
}

export interface GlobeMarks {
  /** The ringed place, if any. */
  active?: GlobePlace | null;
  /** Dot radius for every place, and for the ringed one. */
  dot?: number;
  mark?: number;
  /** Radius of the ring round the active place; 0 leaves it out. */
  ring?: number;
  /** Finer graticules for a close-up, each with its own opacity. */
  grids?: { step: number; alpha: number }[];
}

const MERIDIANS: number[][][] = [];
for (let l = -180; l < 180; l += 30) {
  const line: number[][] = [];
  for (let a = -90; a <= 90; a += 4) line.push([l, a]);
  MERIDIANS.push(line);
}
const PARALLELS: number[][][] = [];
for (let a = -60; a <= 60; a += 30) {
  const line: number[][] = [];
  for (let l = -180; l <= 180; l += 4) line.push([l, a]);
  PARALLELS.push(line);
}

/**
 * Lines kept as the sines and cosines of their points, worked out once. Turning
 * the globe is then a few multiplications a point, with nothing left over for
 * the garbage collector to stop a frame for.
 */
interface Lines {
  sinLat: Float64Array;
  cosLat: Float64Array;
  sinLon: Float64Array;
  cosLon: Float64Array;
  /** Where each line starts in the arrays above, and how many points it has. */
  start: number[];
  size: number[];
}

function flatten(lines: number[][][]): Lines {
  let total = 0;
  for (const line of lines) total += line.length;
  const out: Lines = {
    sinLat: new Float64Array(total),
    cosLat: new Float64Array(total),
    sinLon: new Float64Array(total),
    cosLon: new Float64Array(total),
    start: [],
    size: [],
  };
  let i = 0;
  for (const line of lines) {
    out.start.push(i);
    out.size.push(line.length);
    for (const [lon, lat] of line) {
      out.sinLat[i] = Math.sin(lat * RAD);
      out.cosLat[i] = Math.cos(lat * RAD);
      out.sinLon[i] = Math.sin(lon * RAD);
      out.cosLon[i] = Math.cos(lon * RAD);
      i++;
    }
  }
  return out;
}

let graticule: Lines | null = null;
let coastline: Lines | null = null;

/* The line being drawn, on screen: where each point lands, whether it faces
   us, and the runs of points that do. Shared by every line and every frame,
   and only ever grown. */
let xs = new Float64Array(512);
let ys = new Float64Array(512);
let facing = new Uint8Array(512);
let runFrom = new Int32Array(257);
let runSize = new Int32Array(257);

function room(n: number) {
  if (n <= xs.length) return;
  let size = xs.length;
  while (size < n) size *= 2;
  xs = new Float64Array(size);
  ys = new Float64Array(size);
  facing = new Uint8Array(size);
  runFrom = new Int32Array(size / 2 + 1);
  runSize = new Int32Array(size / 2 + 1);
}

/** The part of the canvas that shows, in the units drawing happens in. */
function frameOf(ctx: CanvasRenderingContext2D) {
  const { width, height } = ctx.canvas;
  const m = ctx.getTransform();
  const det = m.a * m.d - m.b * m.c;
  if (!det || !width || !height)
    return {
      left: -Infinity,
      top: -Infinity,
      right: Infinity,
      bottom: Infinity,
    };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let corner = 0; corner < 4; corner++) {
    const dx = (corner & 1 ? width : 0) - m.e;
    const dy = (corner & 2 ? height : 0) - m.f;
    const x = (m.d * dx - m.c * dy) / det;
    const y = (m.a * dy - m.b * dx) / det;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return { left, top, right, bottom };
}

/**
 * Half the width, in degrees of longitude, of the circle `span` degrees round
 * a point at latitude `lat`: all the way round if it takes in a pole.
 */
export function capWidth(lat: number, span: number): number {
  if (span >= 90 || Math.abs(lat) + span >= 90) return 180;
  return (
    Math.asin(Math.min(1, Math.sin(span * RAD) / Math.cos(lat * RAD))) / RAD
  );
}

/** How far off the canvas a line still counts as showing: half its width,
 *  its antialiasing, and some to spare. */
const EDGE = 2;

/**
 * Draw the globe: rim, graticule, coastlines and a dot per place. The rail's
 * little globe and the full-screen one a spin lifts into both draw through
 * here, so the hand-off between them can't show a seam.
 *
 * Close up, most of the coastline and grid on the near side is off the canvas.
 * Those pieces are left out of the path, and nothing is allocated per point,
 * so a dive into a place costs about what the whole globe does.
 */
export function drawGlobe(
  ctx: CanvasRenderingContext2D,
  view: GlobeView,
  palette: Palette,
  places: GlobePlace[],
  { active = null, dot = 2, mark = 3.4, ring = 8, grids = [] }: GlobeMarks = {},
) {
  const { cx, cy, radius } = view;
  const sinP0 = Math.sin(view.lat * RAD);
  const cosP0 = Math.cos(view.lat * RAD);
  const sinL0 = Math.sin(view.lon * RAD);
  const cosL0 = Math.cos(view.lon * RAD);
  graticule ??= flatten([...MERIDIANS, ...PARALLELS]);
  coastline ??= flatten(LAND);

  const frame = frameOf(ctx);
  const left = frame.left - EDGE;
  const right = frame.right + EDGE;
  const top = frame.top - EDGE;
  const bottom = frame.bottom + EDGE;

  /** Put a point on screen, as point `i` of the line being drawn. */
  function project(
    i: number,
    sinLat: number,
    cosLat: number,
    sinLon: number,
    cosLon: number,
  ) {
    const sinD = sinLon * cosL0 - cosLon * sinL0;
    const cosD = cosLon * cosL0 + sinLon * sinL0;
    facing[i] = sinP0 * sinLat + cosP0 * cosLat * cosD < 0 ? 0 : 1;
    xs[i] = cx + radius * cosLat * sinD;
    ys[i] = cy - radius * (cosP0 * sinLat - sinP0 * cosLat * cosD);
  }

  /* The pen. A piece of line wholly off the canvas only moves it; the next
     piece that shows starts a new stretch of path from where it got to. */
  let penX = 0;
  let penY = 0;
  let down = false;
  let drew = false;
  let skipped = false;

  function moveTo(x: number, y: number) {
    penX = x;
    penY = y;
    down = false;
  }

  /** A piece from the pen to (x, y), curving toward (qx, qy) unless straight. */
  function to(qx: number, qy: number, x: number, y: number, straight: boolean) {
    // The piece stays inside the triangle of its three points.
    const off =
      (penX < left && qx < left && x < left) ||
      (penX > right && qx > right && x > right) ||
      (penY < top && qy < top && y < top) ||
      (penY > bottom && qy > bottom && y > bottom);
    if (off) {
      down = false;
      skipped = true;
    } else {
      if (!down) ctx.moveTo(penX, penY);
      if (straight) ctx.lineTo(x, y);
      else ctx.quadraticCurveTo(qx, qy, x, y);
      down = drew = true;
    }
    penX = x;
    penY = y;
  }

  /* Through the midpoints of each segment, so a close-up shows coastlines
     and parallels as curves rather than the steps of the half-degree data.
     The run starts at point `from` of `n` and may wrap past the last one. */
  function curve(from: number, count: number, n: number, loop: boolean) {
    let i = from;
    moveTo(xs[i], ys[i]);
    if (count < 3) {
      for (let k = 1; k < count; k++) {
        i = i + 1 === n ? 0 : i + 1;
        to(xs[i], ys[i], xs[i], ys[i], true);
      }
      return;
    }
    if (loop) {
      moveTo((xs[n - 1] + xs[0]) / 2, (ys[n - 1] + ys[0]) / 2);
      skipped = false;
      for (let k = 0; k < n; k++) {
        const j = k + 1 === n ? 0 : k + 1;
        to(xs[k], ys[k], (xs[k] + xs[j]) / 2, (ys[k] + ys[j]) / 2, false);
      }
      // With a piece left out, closing would join the last stretch of path
      // back to where that stretch began.
      if (!skipped) ctx.closePath();
      return;
    }
    for (let k = 1; k < count - 1; k++) {
      i = i + 1 === n ? 0 : i + 1;
      const j = i + 1 === n ? 0 : i + 1;
      to(xs[i], ys[i], (xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2, false);
    }
    i = i + 1 === n ? 0 : i + 1;
    to(xs[i], ys[i], xs[i], ys[i], true);
  }

  /** Stroke the first `n` points put on screen as one line or ring. */
  function stroke(n: number, close: boolean) {
    // Split into the runs that face us; the rest is round the back.
    let runs = 0;
    for (let i = 0; i < n; ) {
      if (!facing[i]) {
        i++;
        continue;
      }
      runFrom[runs] = i;
      while (i < n && facing[i]) i++;
      runSize[runs] = i - runFrom[runs];
      runs++;
    }
    if (!runs) return;
    const whole = close && runs === 1 && runSize[0] === n;
    // A ring that starts mid-way along its visible stretch wraps round.
    if (close && runs > 1 && facing[0] && facing[n - 1]) {
      runs--;
      runFrom[0] = runFrom[runs];
      runSize[0] += runSize[runs];
    }
    drew = false;
    ctx.beginPath();
    for (let r = 0; r < runs; r++) curve(runFrom[r], runSize[r], n, whole);
    if (drew) ctx.stroke();
  }

  function strokeLines(lines: Lines, close: boolean) {
    const { sinLat, cosLat, sinLon, cosLon, start, size } = lines;
    for (let line = 0; line < start.length; line++) {
      const first = start[line];
      const n = size[line];
      room(n);
      for (let k = 0; k < n; k++) {
        const p = first + k;
        project(k, sinLat[p], cosLat[p], sinLon[p], cosLon[p]);
      }
      stroke(n, close);
    }
  }

  /** Grid lines `step` degrees apart round the middle of a close-up, as far as
   *  `span` degrees from it. Lines that a coarser grid already draws are left
   *  out. Points along a line are a fixed angle apart, so each is the last
   *  one turned a little further, without a call to sin or cos. */
  function strokeGrid(step: number, span: number) {
    const coarser = step < 10 ? 10 : 30;
    const spanLon = capWidth(view.lat, span);
    const lat0 = Math.max(-88, view.lat - span);
    const lat1 = Math.min(88, view.lat + span);
    const along = step / 4;
    const cosAlong = Math.cos(along * RAD);
    const sinAlong = Math.sin(along * RAD);

    const tall = Math.floor((lat1 - lat0 + 1e-9) / along) + 1;
    room(tall);
    for (
      let l = Math.ceil((view.lon - spanLon) / step) * step;
      l <= view.lon + spanLon;
      l += step
    ) {
      if (Math.round(l) % coarser === 0) continue;
      const sinLon = Math.sin(l * RAD);
      const cosLon = Math.cos(l * RAD);
      let sin = Math.sin(lat0 * RAD);
      let cos = Math.cos(lat0 * RAD);
      for (let k = 0; k < tall; k++) {
        project(k, sin, cos, sinLon, cosLon);
        const turned = sin * cosAlong + cos * sinAlong;
        cos = cos * cosAlong - sin * sinAlong;
        sin = turned;
      }
      stroke(tall, false);
    }

    const lon0 = view.lon - spanLon;
    const wide = Math.floor((2 * spanLon + 1e-9) / along) + 1;
    room(wide);
    for (let a = Math.ceil(lat0 / step) * step; a <= lat1; a += step) {
      if (Math.round(a) % coarser === 0) continue;
      const sinLat = Math.sin(a * RAD);
      const cosLat = Math.cos(a * RAD);
      let sin = Math.sin(lon0 * RAD);
      let cos = Math.cos(lon0 * RAD);
      for (let k = 0; k < wide; k++) {
        project(k, sinLat, cosLat, sin, cos);
        const turned = sin * cosAlong + cos * sinAlong;
        cos = cos * cosAlong - sin * sinAlong;
        sin = turned;
      }
      stroke(wide, false);
    }
  }

  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = palette.rule;
  ctx.stroke();

  ctx.strokeStyle = palette.grid;
  strokeLines(graticule, false);
  if (grids.length) {
    // The farthest a close-up can show from its middle: the canvas's
    // farthest corner.
    const reach = Math.hypot(
      Math.max(cx - frame.left, frame.right - cx),
      Math.max(cy - frame.top, frame.bottom - cy),
    );
    const span = Math.asin(Math.min(1, reach / radius)) / RAD + 2;
    for (const { step, alpha } of grids) {
      if (alpha <= 0) continue;
      ctx.globalAlpha = Math.min(1, alpha);
      strokeGrid(step, span);
    }
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = palette.coast;
  strokeLines(coastline, true);

  for (const place of places) {
    project(
      0,
      Math.sin(place.lat * RAD),
      Math.cos(place.lat * RAD),
      Math.sin(place.lon * RAD),
      Math.cos(place.lon * RAD),
    );
    if (!facing[0]) continue; // far side
    const x = xs[0];
    const y = ys[0];
    const here = place === active;
    ctx.beginPath();
    ctx.arc(x, y, here ? mark : dot, 0, Math.PI * 2);
    ctx.fillStyle = here ? palette.ink : palette.dim;
    ctx.fill();
    if (here && ring > 0) {
      ctx.beginPath();
      ctx.arc(x, y, ring, 0, Math.PI * 2);
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

export function createGlobe({
  canvas,
  places,
  start,
  onArrive,
  onDepart,
}: GlobeOptions): GlobeHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx || !places.length) {
    return { spin() {}, goTo() {}, mark() {}, resize() {}, destroy() {} };
  }

  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const first = places.find((place) => place.name === start) ?? places[0];
  let lon = first.lon;
  let lat = first.lat;
  let radius = 1;
  let cx = 0;
  let cy = 0;
  let palette = readPalette(canvas);

  let lonVel = 0;
  let latVel = 0;
  /** The place it last came to rest on; a spin always goes somewhere else. */
  let resting: GlobePlace = first;
  /** The ringed place. Empty while a spin or throw is under way, so the ring
   *  can't give the landing away before it happens. */
  let active: GlobePlace | null = first;
  let motion: {
    plan: Plan;
    begun: number;
    done: (() => void) | null;
  } | null = null;
  let running = false;
  let frame = 0;

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastMove = 0;

  /* ---------------------------------------------------------------- drawing */

  function draw() {
    const size = canvas.clientWidth;
    if (!size) return;
    ctx!.clearRect(0, 0, size, size);
    drawGlobe(ctx!, { cx, cy, radius, lon, lat }, palette, places, { active });
  }

  /* ----------------------------------------------------------------- motion */

  function kick() {
    if (running) return;
    running = true;
    frame = requestAnimationFrame(loop);
  }

  /** Where the globe is right now, partway through a movement or not. */
  function current(): GlobeState {
    if (motion) {
      const t = (performance.now() - motion.begun) / 1000;
      const [x, xv] = motion.plan.lon.at(t);
      const [y, yv] = motion.plan.lat.at(t);
      return { lon: x, lat: y, lonVel: xv, latVel: yv };
    }
    return { lon, lat, lonVel, latVel };
  }

  function land(place: GlobePlace) {
    lon = place.lon;
    lat = place.lat;
    lonVel = latVel = 0;
    resting = place;
    active = place;
    draw();
  }

  /** Follow a plan from here. Starting a new one drops the old one, landing
   *  and all, so only the newest spin gets to open a session. `depart` marks a
   *  spin or throw, which is announced before it sets off. */
  function begin(
    plan: Plan,
    done: (() => void) | null,
    ring: boolean,
    depart = false,
  ) {
    active = ring ? plan.place : null;
    const begun = performance.now();
    if (depart) onDepart?.({ place: plan.place, plan, begun });
    if (reduced) {
      motion = null;
      land(plan.place);
      done?.();
      return;
    }
    motion = { plan, begun, done };
    kick();
  }

  function loop(now: number) {
    if (motion && !dragging) {
      const t = (now - motion.begun) / 1000;
      if (t >= motion.plan.duration) {
        const { plan, done } = motion;
        motion = null;
        running = false;
        land(plan.place);
        done?.();
        return;
      }
      [lon, lonVel] = motion.plan.lon.at(t);
      [lat, latVel] = motion.plan.lat.at(t);
    } else if (!dragging) {
      running = false;
      return;
    }
    draw();
    frame = requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------ interaction */

  function onDown(event: PointerEvent) {
    // Catching the globe stops it where it is, and cancels where it was going.
    const now = current();
    motion = null;
    lon = now.lon;
    lat = now.lat;
    lonVel = latVel = 0;
    active = null;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    lastMove = performance.now();
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture(event.pointerId);
    kick();
  }

  function onMove(event: PointerEvent) {
    if (!dragging) return;
    const now = performance.now();
    const dt = Math.max(8, now - lastMove) / 1000;
    const dLon = -(event.clientX - lastX) * 0.42;
    const nextLat = clamp(lat + (event.clientY - lastY) * 0.38, -80, 80);
    // smooth the measured speed so a jittery pointer can't fling it wildly
    lonVel = lonVel * 0.6 + (dLon / dt) * 0.4;
    latVel = latVel * 0.6 + ((nextLat - lat) / dt) * 0.4;
    lon += dLon;
    lat = nextLat;
    lastX = event.clientX;
    lastY = event.clientY;
    lastMove = now;
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove("is-dragging");
    // A pointer that stopped before letting go shouldn't throw the globe.
    const still = performance.now() - lastMove > 90;
    lonVel = still ? 0 : clamp(lonVel, -900, 900);
    latVel = still ? 0 : clamp(latVel, -240, 240);
    const plan = planThrow({ lon, lat, lonVel, latVel }, places);
    begin(plan, () => onArrive?.(plan.place), false, true);
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  function resize() {
    const size = canvas.clientWidth;
    if (!size) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.height = `${size}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    radius = size / 2 - 2;
    cx = size / 2;
    cy = size / 2;
    draw();
  }

  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  // The theme toggle swaps a class on <html>; re-read the palette when it does.
  const themeWatcher = new MutationObserver(() => {
    palette = readPalette(canvas);
    draw();
  });
  themeWatcher.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  resize();

  return {
    spin() {
      if (dragging) return;
      // The landing is chosen first and the path is built to end there, so
      // pressing it again mid-spin just plans a fresh spin from the current
      // speed and direction.
      const target = pickSpinTarget(places, resting);
      const plan = planSpin(current(), target);
      begin(plan, () => onArrive?.(target), false, true);
    },
    goTo(name, opts) {
      const place = places.find((p) => p.name === name);
      if (!place || dragging) return;
      const plan = planGlide(current(), place);
      begin(plan, opts?.silent ? null : () => onArrive?.(place), true);
    },
    mark(name) {
      active = name ? (places.find((p) => p.name === name) ?? null) : null;
      if (!running) draw();
    },
    resize,
    destroy() {
      cancelAnimationFrame(frame);
      themeWatcher.disconnect();
      motion = null;
      running = false;
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    },
  };
}
