import { drawGlobe, readPalette, type GlobePlace, type Plan } from "./globe";
import { LANDING_KEY, type LandingNote } from "./landing";

/**
 * The flight a spin takes into its session.
 *
 * While the rail's globe slows down, a full-screen copy of it lifts out of the
 * rail and grows to fill the screen, still turning in step. It stops with the
 * place in the middle, a ring draws in round it and its name appears under it.
 * Then the view dives in on the place, and the session's banner photograph
 * opens out of the ring until it fills the screen. Only then does the page
 * change, and the session page opens on that same full-screen photograph
 * before settling it into its banner (src/lib/landing.ts).
 *
 * The photograph is fetched while the globe is still spinning. If it isn't in
 * by the time the dive should start, the globe waits there, ringed, for up to
 * MAX_WAIT seconds, then lands without it.
 */

export interface FlightOptions {
  /** The rail's globe, which the flight lifts out of. */
  from: HTMLCanvasElement;
  /** The path the rail's globe is following, so both turn together. */
  plan: Plan;
  /** performance.now() when the rail's globe set off along `plan`. */
  begun: number;
  places: GlobePlace[];
  /** The session to land in. */
  href: string;
  /** Called when the flight is called off: Escape, a click, or the page
   *  coming back from the back/forward cache. */
  onCancel?: () => void;
}

export interface Flight {
  /** True from take-off until it's called off, landing included. */
  readonly busy: boolean;
  cancel(): void;
}

/* Timings, in seconds. The lift runs on the rail globe's clock; the rest is
   measured from `settle`, when the globe stops turning. */
const LIFT = 0.9; // the globe lifting out of the rail to fill the screen
const RING_IN = 0.22; // the landing ring drawing in
const HOLD = 0.25; // where it waits for the photograph if it has to: ringed
const DIVE: [number, number] = [HOLD, 1.3]; // zooming in on the place
const OPEN: [number, number] = [0.5, 1.35]; // the photograph opening out
const MAX_WAIT = 2.5; // longest it waits for the photograph
const CREEP = 0.08; // how fast it keeps zooming while it waits (log scale)
const DEPTH = Math.log(7); // how much closer the dive gets than the lifted globe
const RING = 12; // landing ring radius on the big globe, px

const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const progress = (t: number, a: number, b: number) =>
  b > a ? clamp((t - a) / (b - a), 0, 1) : t >= b ? 1 : 0;
/** Eases in and out with no jolt at either end (zero speed and acceleration). */
export const smootherstep = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * t * (t * (6 * t - 15) + 10);
};

export interface Timeline {
  /** When the globe starts lifting out of the rail. */
  liftStart: number;
  /** When it's done growing, centred on the screen. */
  liftEnd: number;
  /** When it has stopped turning, with the place in the middle. */
  settle: number;
  /** When the dive starts, unless it has to wait for the photograph. */
  dive: number;
  /** When the photograph fills the screen, with no waiting. */
  land: number;
}

/** When each part of a flight happens, for a spin lasting `spin` seconds. */
export function flightTimeline(spin: number): Timeline {
  const liftStart = clamp(0.32 * spin, 0.12, 0.85);
  const liftEnd = Math.max(liftStart + LIFT, spin - 0.3);
  const settle = Math.max(spin, liftEnd);
  return {
    liftStart,
    liftEnd,
    settle,
    dive: settle + HOLD,
    land: settle + OPEN[1],
  };
}

/** The rail's globe on screen: its centre and radius. */
export interface Rail {
  cx: number;
  cy: number;
  r: number;
}

/** One frame of the flight, short of the photograph. */
export interface Shot {
  cx: number;
  cy: number;
  radius: number;
  /** How opaque the paper over the page is, 0 to 1. */
  backdrop: number;
  /** Landing ring radius, px; 0 until the globe stops. */
  ring: number;
  /** Opacity of the place name under the ring. */
  label: number;
  dot: number;
  grids: { step: number; alpha: number }[];
}

/**
 * The camera `t` seconds after take-off, on a `w` × `h` screen. `waited` is how
 * long it has spent waiting for the photograph, which it spends creeping in.
 */
export function shotAt(
  t: number,
  timeline: Timeline,
  rail: Rail,
  w: number,
  h: number,
  waited = 0,
): Shot {
  const { liftStart, liftEnd, settle } = timeline;
  const lift = smootherstep(progress(t, liftStart, liftEnd));
  const mid = 0.4 * Math.min(w, h);
  const dive = smootherstep(progress(t, settle + DIVE[0], settle + DIVE[1]));
  const zoom = Math.log(mid / rail.r) * lift + CREEP * waited + DEPTH * dive;
  const radius = rail.r * Math.exp(zoom);
  const ringIn = progress(t, settle, settle + RING_IN);
  const close = radius / mid;
  return {
    cx: lerp(rail.cx, w / 2, lift),
    cy: lerp(rail.cy, h / 2, lift),
    radius,
    backdrop: smootherstep(
      progress(t, liftStart, liftStart + 0.55 * (liftEnd - liftStart)),
    ),
    ring: ringIn > 0 ? RING * (1 - (1 - ringIn) ** 3) : 0,
    label: smootherstep(progress(t, settle + 0.05, settle + 0.35)),
    dot: 2 * clamp((radius / rail.r) ** 0.2, 1, 1.5),
    grids: [
      { step: 10, alpha: 0.9 * smootherstep(progress(close, 1.4, 2.6)) },
      { step: 2, alpha: 0.8 * smootherstep(progress(close, 3, 6)) },
    ],
  };
}

/** The photograph opening out of the ring, `p` of the way (0 to 1). */
export interface Opening {
  /** Scale of the full-screen photograph, about the middle of the screen. */
  scale: number;
  /** The window it shows through, in unscaled screen pixels, centred. */
  width: number;
  height: number;
  /** Corner radius of that window: a circle at first, square at the end. */
  radius: number;
}

/**
 * Starts as a circle exactly filling the landing ring, grows (slowly, then
 * fast, then slowly again) and squares off into the whole screen, where it
 * stops at scale 1: the frame the session page opens on.
 */
export function openingAt(
  p: number,
  w: number,
  h: number,
  ring = RING,
): Opening {
  const short = Math.min(w, h);
  const first = Math.min(1, (2 * ring) / short);
  const scale = first ** (1 - smootherstep(p));
  const square = smootherstep(progress(p, 0.3, 0.85));
  return {
    scale,
    width: short + square * (w - short),
    height: short + square * (h - short),
    radius: ((1 - square) * short) / 2,
  };
}

/**
 * Fetch the session page and put a copy of its banner <picture> in `into`.
 * Same srcset and sizes as the real one, so the browser picks the same file,
 * and the session page finds it already cached. Resolves once it's decoded.
 */
export async function loadBanner(
  href: string,
  into: HTMLElement,
  before: Node | null,
  signal: AbortSignal,
): Promise<HTMLImageElement | null> {
  const response = await fetch(href, { signal });
  if (!response.ok) return null;
  const doc = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  const source = doc.querySelector<HTMLImageElement>(".banner-img");
  if (!source || signal.aborted) return null;
  const copy = document.importNode(source.closest("picture") ?? source, true);
  const img =
    copy instanceof HTMLImageElement ? copy : copy.querySelector("img");
  if (!img) return null;
  img.className = "flight-photo";
  img.alt = "";
  // decode() below has it ready before it shows. The opening redraws it at
  // every size, and those frames shouldn't wait on a decode the way the
  // session page's first frame does.
  img.decoding = "async";
  into.insertBefore(copy, before);
  await img.decode();
  return signal.aborted ? null : img;
}

function readPaper(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--paper")
      .trim() || "#fbfaf8"
  );
}

/**
 * Take off. The rail's globe must already be on its way along `plan`. Returns
 * null if there's no way to draw the flight; land the plain way then.
 */
export function fly(options: FlightOptions): Flight | null {
  const { from, plan, begun, places, href, onCancel } = options;
  const place = plan.place;
  const timeline = flightTimeline(plan.duration);

  const layer = document.createElement("div");
  layer.className = "flight";
  layer.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  const edge = document.createElement("div");
  edge.className = "flight-edge";
  const label = document.createElement("p");
  label.className = "flight-label u-label";
  label.textContent = place.name;
  layer.append(canvas, edge, label);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  document.body.append(layer);

  const palette = readPalette(from);
  const paper = readPaper();
  let state: "flying" | "landed" | "off" = "flying";
  let up = false;
  let photo: HTMLImageElement | null = null;
  let failed = false;
  let waited = 0;
  let frame = 0;
  const abort = new AbortController();

  loadBanner(href, layer, edge, abort.signal).then(
    (img) => {
      if (img && !failed) photo = img;
      else failed = true;
    },
    () => {
      failed = true;
    },
  );

  function render(t: number) {
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr))
      canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr))
      canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Read every frame: the rail's globe is where the lift starts from.
    const box = from.getBoundingClientRect();
    const rail: Rail = {
      cx: box.left + box.width / 2,
      cy: box.top + box.height / 2,
      r: Math.max(4, box.width / 2 - 2),
    };
    const shot = shotAt(t, timeline, rail, w, h, waited);
    const turning = Math.min(t, plan.duration);
    const lon = plan.lon.at(turning)[0];
    const lat = plan.lat.at(turning)[0];

    ctx!.clearRect(0, 0, w, h);
    ctx!.globalAlpha = shot.backdrop;
    ctx!.fillStyle = paper;
    ctx!.fillRect(0, 0, w, h);
    ctx!.globalAlpha = 1;
    drawGlobe(
      ctx!,
      { cx: shot.cx, cy: shot.cy, radius: shot.radius, lon, lat },
      palette,
      places,
      {
        active: shot.ring > 0 ? place : null,
        ring: shot.ring,
        dot: shot.dot,
        mark: 4,
        grids: shot.grids,
      },
    );

    const p = progress(t, timeline.settle + OPEN[0], timeline.land);
    let reach = shot.ring;
    if (photo && p > 0) {
      const open = openingAt(p, w, h);
      reach = (open.scale * open.height) / 2;
      if (p < 1) {
        photo.style.opacity = "1";
        photo.style.transform = `scale(${open.scale})`;
        photo.style.clipPath = `inset(${(h - open.height) / 2}px ${(w - open.width) / 2}px round ${open.radius}px)`;
      } else {
        // The exact frame the session page opens on.
        photo.style.opacity = "1";
        photo.style.transform = "none";
        photo.style.clipPath = "none";
      }
      edge.style.width = `${open.scale * open.width}px`;
      edge.style.height = `${open.scale * open.height}px`;
      edge.style.borderRadius = `${open.scale * open.radius}px`;
      edge.style.opacity = String(1 - smootherstep(progress(p, 0.5, 0.9)));
    } else if (failed && p > 0) {
      // No photograph: fade to paper, and the session page loads as usual.
      ctx!.globalAlpha = smootherstep(p);
      ctx!.fillStyle = paper;
      ctx!.fillRect(0, 0, w, h);
      ctx!.globalAlpha = 1;
    }

    const fade = 1 - smootherstep(progress(reach, 0.08 * h, 0.24 * h));
    label.style.opacity = String(shot.label * fade);
    label.style.transform = `translateY(${shot.cy + reach + 14}px)`;
  }

  function tick(now: number) {
    if (state !== "flying") return;
    const real = (now - begun) / 1000;
    let t = real - waited;
    if (t > timeline.dive && !photo && !failed) {
      // Hold at the start of the dive until the photograph is in.
      waited = real - timeline.dive;
      t = timeline.dive;
      if (waited > MAX_WAIT) failed = true;
    }
    if (!up && t >= timeline.liftStart) {
      up = true;
      layer.classList.add("is-up");
      from.style.visibility = "hidden";
    }
    if (up) render(t);
    // Leave on the next frame, so this one (the last) gets painted first.
    frame = requestAnimationFrame(t >= timeline.land ? land : tick);
  }

  function land() {
    if (state !== "flying") return;
    state = "landed";
    window.removeEventListener("keydown", onKey);
    if (photo && !failed) {
      const note: LandingNote = {
        path: new URL(href, window.location.href).pathname,
        at: Date.now(),
      };
      try {
        sessionStorage.setItem(LANDING_KEY, JSON.stringify(note));
      } catch {
        // Private mode can refuse storage; the page just loads normally.
      }
    }
    window.addEventListener("pageshow", onShow);
    window.location.assign(href);
  }

  function teardown() {
    cancelAnimationFrame(frame);
    abort.abort();
    window.removeEventListener("keydown", onKey);
    from.style.visibility = "";
  }

  function cancel() {
    if (state !== "flying") return;
    state = "off";
    teardown();
    if (up) {
      const remove = () => layer.remove();
      layer
        .animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 220,
          easing: "ease-out",
          fill: "forwards",
        })
        .finished.then(remove, remove);
    } else {
      layer.remove();
    }
    onCancel?.();
  }

  // Coming back to this page from the session restores it mid-landing.
  function onShow(event: PageTransitionEvent) {
    if (!event.persisted) return;
    window.removeEventListener("pageshow", onShow);
    state = "off";
    teardown();
    layer.remove();
    onCancel?.();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") cancel();
  }

  window.addEventListener("keydown", onKey);
  layer.addEventListener("click", cancel);
  frame = requestAnimationFrame(tick);

  return {
    get busy() {
      return state !== "off";
    },
    cancel,
  };
}
