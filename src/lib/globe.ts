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
  /** Fired once the globe comes to rest somewhere, after a spin or a throw. */
  onArrive?: (place: GlobePlace) => void;
}

export interface GlobeHandle {
  spin(): void;
  goTo(name: string, opts?: { silent?: boolean }): void;
  mark(name: string | null): void;
  resize(): void;
  destroy(): void;
}

const RAD = Math.PI / 180;

/* Motion constants. One critically damped spring drives both axes, so a drag,
   a throw and the final settle are a single continuous movement rather than
   three separate animations stitched together. */
const K = 34; // spring stiffness
const C = 2 * Math.sqrt(K) * 1.02; // just past critical, so it never overshoots
const FRICTION = 2.9; // free-spin decay, per second
const REST_ANGLE = 0.7; // sub-pixel on a 150px globe
const REST_SPEED = 11;
const MAX_WIND = 430; // never wind up more than a turn and a bit

/** Resolved from CSS custom properties so the globe follows the theme. */
interface Palette {
  ink: string;
  dim: string;
  rule: string;
  grid: string;
  coast: string;
}

function readPalette(el: Element): Palette {
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

export function createGlobe({
  canvas,
  places,
  onArrive,
}: GlobeOptions): GlobeHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx || !places.length) {
    return { spin() {}, goTo() {}, mark() {}, resize() {}, destroy() {} };
  }

  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const byRegion = new Map<string, GlobePlace[]>();
  for (const place of places) {
    const bucket = byRegion.get(place.region) ?? [];
    bucket.push(place);
    byRegion.set(place.region, bucket);
  }
  const regions = [...byRegion.keys()];

  let lon = places[0].lon;
  let lat = places[0].lat;
  let radius = 1;
  let cx = 0;
  let cy = 0;
  let sinP0 = 0;
  let cosP0 = 1;
  let palette = readPalette(canvas);

  let lonVel = 0;
  let latVel = 0;
  let lonTarget: number | null = null;
  let latTarget = lat;
  let active: GlobePlace | null = places[0];
  let arrive: (() => void) | null = null;
  let running = false;
  let last = 0;
  let token = 0;
  let frame = 0;

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastMove = 0;

  /* ---------------------------------------------------------------- drawing */

  function project(pLon: number, pLat: number): [number, number] | null {
    const dl = (pLon - lon) * RAD;
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
    let started = false;
    ctx!.beginPath();
    for (const [pLon, pLat] of points) {
      const q = project(pLon, pLat);
      if (!q) {
        started = false;
        continue;
      }
      if (started) ctx!.lineTo(q[0], q[1]);
      else {
        ctx!.moveTo(q[0], q[1]);
        started = true;
      }
    }
    if (close) ctx!.closePath();
    ctx!.stroke();
  }

  const meridians: number[][][] = [];
  for (let l = -180; l < 180; l += 30) {
    const line: number[][] = [];
    for (let a = -90; a <= 90; a += 4) line.push([l, a]);
    meridians.push(line);
  }
  const parallels: number[][][] = [];
  for (let a = -60; a <= 60; a += 30) {
    const line: number[][] = [];
    for (let l = -180; l <= 180; l += 4) line.push([l, a]);
    parallels.push(line);
  }

  function draw() {
    const size = canvas.clientWidth;
    if (!size) return;
    sinP0 = Math.sin(lat * RAD);
    cosP0 = Math.cos(lat * RAD);
    ctx!.clearRect(0, 0, size, size);
    ctx!.lineWidth = 1;

    ctx!.beginPath();
    ctx!.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx!.strokeStyle = palette.rule;
    ctx!.stroke();

    ctx!.strokeStyle = palette.grid;
    for (const line of meridians) stroke(line, false);
    for (const line of parallels) stroke(line, false);

    ctx!.strokeStyle = palette.coast;
    for (const ring of LAND) stroke(ring, true);

    for (const place of places) {
      const q = project(place.lon, place.lat);
      if (!q) continue;
      const here = place === active;
      ctx!.beginPath();
      ctx!.arc(q[0], q[1], here ? 3.4 : 2, 0, Math.PI * 2);
      ctx!.fillStyle = here ? palette.ink : palette.dim;
      ctx!.fill();
      if (here) {
        ctx!.beginPath();
        ctx!.arc(q[0], q[1], 8, 0, Math.PI * 2);
        ctx!.strokeStyle = palette.ink;
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }
    }
  }

  /* ----------------------------------------------------------------- motion */

  function kick() {
    if (running) return;
    running = true;
    last = performance.now();
    frame = requestAnimationFrame(loop);
  }

  function nearest(): GlobePlace {
    let best = places[0];
    let bestDistance = Infinity;
    for (const place of places) {
      const dl = Math.abs(((place.lon - lon + 540) % 360) - 180);
      const da = place.lat - lat;
      const d = Math.sqrt(dl * dl + da * da);
      if (d < bestDistance) {
        bestDistance = d;
        best = place;
      }
    }
    return best;
  }

  /** Point the spring at a place. `carry` keeps the direction the globe is
   *  already turning, so re-aiming mid-flight never snaps it into reverse. */
  function aim(place: GlobePlace, carry: boolean, extraTurns = 0) {
    active = place;
    let delta = ((place.lon - lon + 540) % 360) - 180;
    if (carry && lonVel > 60 && delta < 0) delta += 360;
    if (carry && lonVel < -60 && delta > 0) delta -= 360;
    if (extraTurns) delta += (lonVel >= 0 ? 360 : -360) * extraTurns;
    delta = Math.max(-MAX_WIND, Math.min(MAX_WIND, delta));
    lonTarget = lon + delta;
    latTarget = place.lat;
    if (reduced) {
      lon = lonTarget;
      lat = latTarget;
      lonVel = latVel = 0;
      lonTarget = null;
      draw();
      const done = arrive;
      arrive = null;
      done?.();
      return;
    }
    kick();
  }

  function loop(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (dragging) {
      draw();
      frame = requestAnimationFrame(loop);
      return;
    }

    if (lonTarget === null) {
      lon += lonVel * dt;
      lonVel *= Math.exp(-FRICTION * dt);
      if (Math.abs(lonVel) < 150) aim(nearest(), true);
    } else {
      lonVel += (-K * (lon - lonTarget) - C * lonVel) * dt;
      lon += lonVel * dt;
      latVel += (-K * (lat - latTarget) - C * latVel) * dt;
      lat += latVel * dt;

      if (
        Math.abs(lon - lonTarget) < REST_ANGLE &&
        Math.abs(lonVel) < REST_SPEED &&
        Math.abs(lat - latTarget) < REST_ANGLE &&
        Math.abs(latVel) < REST_SPEED
      ) {
        lon = lonTarget;
        lat = latTarget;
        lonVel = latVel = 0;
        lonTarget = null;
        draw();
        running = false;
        const done = arrive;
        arrive = null;
        done?.();
        return;
      }
    }

    draw();
    frame = requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------ interaction */

  function onDown(event: PointerEvent) {
    dragging = true;
    lonTarget = null;
    arrive = null;
    lonVel = latVel = 0;
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
    lon += dLon;
    lat = Math.max(-80, Math.min(80, lat + (event.clientY - lastY) * 0.38));
    // smooth the measured speed so a jittery pointer can't fling it wildly
    lonVel = lonVel * 0.6 + (dLon / dt) * 0.4;
    lastX = event.clientX;
    lastY = event.clientY;
    lastMove = now;
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove("is-dragging");
    lonVel = Math.max(-900, Math.min(900, lonVel));
    const mine = ++token;
    arrive = () => {
      if (mine === token && active) onArrive?.(active);
    };
    if (Math.abs(lonVel) < 90) aim(nearest(), false);
    else kick(); // coast first, then settle wherever it ends up
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
      const moving = lonTarget !== null && Math.abs(lonVel) > 40;
      let target = active;
      for (let guard = 0; guard < 10 && target === active; guard++) {
        const bucket = byRegion.get(
          regions[Math.floor(Math.random() * regions.length)],
        )!;
        target = bucket[Math.floor(Math.random() * bucket.length)];
      }
      if (!target) return;
      const chosen = target;
      // Spamming re-aims the globe mid-flight rather than stacking another
      // revolution onto it, and only the newest spin gets to open a session.
      const mine = ++token;
      arrive = () => {
        if (mine === token) onArrive?.(chosen);
      };
      if (!moving) lonVel = (Math.random() < 0.5 ? -1 : 1) * 210;
      aim(chosen, true, moving ? 0 : 0.32);
    },
    goTo(name, opts) {
      const place = places.find((p) => p.name === name);
      if (!place) return;
      const mine = ++token;
      arrive = opts?.silent
        ? null
        : () => {
            if (mine === token) onArrive?.(place);
          };
      aim(place, false);
    },
    mark(name) {
      active = name ? (places.find((p) => p.name === name) ?? null) : null;
      if (!running) draw();
    },
    resize,
    destroy() {
      cancelAnimationFrame(frame);
      themeWatcher.disconnect();
      running = false;
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    },
  };
}
