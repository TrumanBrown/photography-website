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

/** Grid lines `step` degrees apart around the middle of a close-up. Lines
 *  that a coarser grid already draws are left out. */
function closeGrid(step: number, view: GlobeView, span: number): number[][][] {
  const lines: number[][][] = [];
  const coarser = step < 10 ? 10 : 30;
  const spanLon = Math.min(
    180,
    span / Math.max(0.15, Math.cos(view.lat * RAD)),
  );
  const lat0 = Math.max(-88, view.lat - span);
  const lat1 = Math.min(88, view.lat + span);
  const along = step / 4;
  for (
    let l = Math.ceil((view.lon - spanLon) / step) * step;
    l <= view.lon + spanLon;
    l += step
  ) {
    if (Math.round(l) % coarser === 0) continue;
    const line: number[][] = [];
    for (let a = lat0; a <= lat1 + 1e-9; a += along) line.push([l, a]);
    lines.push(line);
  }
  for (let a = Math.ceil(lat0 / step) * step; a <= lat1; a += step) {
    if (Math.round(a) % coarser === 0) continue;
    const line: number[][] = [];
    for (let l = view.lon - spanLon; l <= view.lon + spanLon + 1e-9; l += along)
      line.push([l, a]);
    lines.push(line);
  }
  return lines;
}

/**
 * Draw the globe: rim, graticule, coastlines and a dot per place. The rail's
 * little globe and the full-screen one a spin lifts into both draw through
 * here, so the hand-off between them can't show a seam.
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

  function project(pLon: number, pLat: number): [number, number] | null {
    const dl = (pLon - view.lon) * RAD;
    const ph = pLat * RAD;
    const sp = Math.sin(ph);
    const cp = Math.cos(ph);
    const cd = Math.cos(dl);
    if (sinP0 * sp + cosP0 * cp * cd < 0) return null; // far side
    return [
      cx + radius * cp * Math.sin(dl),
      cy - radius * (cosP0 * sp - sinP0 * cp * cd),
    ];
  }

  function stroke(points: number[][], close: boolean) {
    // Split into the runs that face us; the rest is round the back.
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    for (const [pLon, pLat] of points) {
      const q = project(pLon, pLat);
      if (q) {
        run.push(q);
        continue;
      }
      if (run.length) runs.push(run);
      run = [];
    }
    if (run.length) runs.push(run);
    const whole =
      close && runs.length === 1 && runs[0].length === points.length;
    // A ring that starts mid-way along its visible stretch wraps round.
    if (
      close &&
      !whole &&
      runs.length > 1 &&
      project(points[0][0], points[0][1])
    ) {
      const tail = runs.pop()!;
      if (project(points.at(-1)![0], points.at(-1)![1]))
        runs[0] = tail.concat(runs[0]);
      else runs.push(tail);
    }
    ctx.beginPath();
    for (const pts of runs) curve(pts, whole);
    ctx.stroke();
  }

  /* Through the midpoints of each segment, so a close-up shows coastlines
     and parallels as curves rather than the steps of the half-degree data. */
  function curve(pts: [number, number][], loop: boolean) {
    const n = pts.length;
    if (n < 3) {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      return;
    }
    const mid = (a: [number, number], b: [number, number]) =>
      [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
    if (loop) {
      const start = mid(pts[n - 1], pts[0]);
      ctx.moveTo(start[0], start[1]);
      for (let i = 0; i < n; i++) {
        const m = mid(pts[i], pts[(i + 1) % n]);
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
      }
      ctx.closePath();
      return;
    }
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) {
      const m = mid(pts[i], pts[i + 1]);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }

  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = palette.rule;
  ctx.stroke();

  ctx.strokeStyle = palette.grid;
  for (const line of MERIDIANS) stroke(line, false);
  for (const line of PARALLELS) stroke(line, false);
  if (grids.length) {
    // The farthest a close-up can show from its middle: the screen diagonal.
    const reach = Math.hypot(ctx.canvas.clientWidth, ctx.canvas.clientHeight);
    const span = Math.asin(Math.min(1, reach / radius)) / RAD + 2;
    for (const { step, alpha } of grids) {
      if (alpha <= 0) continue;
      ctx.globalAlpha = Math.min(1, alpha);
      for (const line of closeGrid(step, view, span)) stroke(line, false);
    }
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = palette.coast;
  for (const ring of LAND) stroke(ring, true);

  for (const place of places) {
    const q = project(place.lon, place.lat);
    if (!q) continue;
    const here = place === active;
    ctx.beginPath();
    ctx.arc(q[0], q[1], here ? mark : dot, 0, Math.PI * 2);
    ctx.fillStyle = here ? palette.ink : palette.dim;
    ctx.fill();
    if (here && ring > 0) {
      ctx.beginPath();
      ctx.arc(q[0], q[1], ring, 0, Math.PI * 2);
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
