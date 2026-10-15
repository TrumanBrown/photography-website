/**
 * Landing in a page after a transition out of the last one.
 *
 * Two kinds, both started on the page you leave:
 * - `photo`: the globe's flight (src/lib/flight.ts) or a session card
 *   (src/lib/open.ts) ends with the session's banner photograph filling the
 *   screen. The session page opens on that same full-screen photograph, then
 *   settles it into the banner while the rest of the page appears around it.
 * - `dots`: a hobby card plays its scene (src/lib/scenes/) and ends zoomed
 *   into a few big ink dots. The hobby page opens on those same dots, and
 *   each one hollows into a ring and then a window onto the page, until the
 *   windows meet. (Without dots, from the plain plate dive, the page opens on
 *   bare paper through a halftone of holes instead.)
 *
 * Just before it navigates, the old page leaves a note in sessionStorage; the
 * new page reads it before its first paint. A page reached any other way
 * never sees the note.
 */

/** sessionStorage key the old page leaves for the page it lands on. */
export const LANDING_KEY = "globe-landing";

/**
 * Where a page opens from through its dots: a point on screen (fractions of
 * its width and height), or the direction a wave runs in.
 */
export type Reveal =
  | { from: readonly [number, number] }
  | { wave: readonly [number, number] };

/** What the old page leaves under LANDING_KEY. */
export interface LandingNote {
  /** Path of the page it's landing in, with a trailing slash. */
  path: string;
  /** Date.now() when it left. A stale note is ignored. */
  at: number;
  /** How it arrives; a photograph unless it says otherwise. */
  kind?: "photo" | "dots";
  /** The big dots the scene ended on: x, y, radius, CSS px, in a flat list. */
  dots?: number[];
  /** The viewport those were measured in. */
  w?: number;
  h?: number;
  /** Their ink. */
  ink?: string;
  /**
   * The frame it left on as a CSS background layer, for the first paint:
   * the big dots (dotsArt), or a scene's frame (src/lib/scenes/engine.ts).
   */
  art?: string;
  reveal?: Reveal;
  /** A scene that carries on over this page (src/lib/scenes/index.ts). */
  scene?: {
    /** Where it left off, ms into the scene. */
    t: number;
    seed: number;
    /** Where the card's plate was: left, top, width, height, CSS px. */
    rect: [number, number, number, number];
    /** The viewport it was laid out in. */
    w: number;
    h: number;
    /** The plate image it was drawn from. */
    plate: string;
    dark: boolean;
    /** 1, or faster if it was hurried along. */
    speed: number;
  };
}

declare global {
  interface Window {
    /** The note this page landed with, kept by the head script. */
    landingNote?: LandingNote;
  }
}

/**
 * Inline <head> script. Before the first paint, marks <html> with `landing`
 * (the banner photograph alone, full screen, until settleLanding() takes
 * over) or `landing-dots` (paper, and the scene's last dots if it sent them,
 * until settleDots() opens it) when this page is the one a transition is
 * landing in. If neither runs, the page shows itself after four seconds
 * anyway.
 *
 * Keep it free of backslashes and template placeholders: scripts/csp-hash.mjs
 * hashes this source text as written, and the hash has to match the string
 * the page ships.
 */
export const landingBootstrap = `
(function () {
  try {
    var raw = sessionStorage.getItem('globe-landing');
    if (!raw) return;
    sessionStorage.removeItem('globe-landing');
    var note = JSON.parse(raw);
    var here = location.pathname;
    if (here.slice(-1) !== '/') here += '/';
    if (!note || note.path !== here || Math.abs(Date.now() - note.at) > 10000) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var root = document.documentElement;
    var mark = note.kind === 'dots' ? 'landing-dots' : 'landing';
    if (typeof note.art === 'string') root.style.setProperty('--landing-dots', note.art);
    window.landingNote = note;
    root.classList.add(mark);
    setTimeout(function () { root.classList.remove(mark); }, 4000);
  } catch (_) {}
})();
`.trim();

/** How long the photograph takes to settle into the banner, ms. */
const SETTLE = 850;
/** Longest it waits for the photograph to decode before settling anyway. */
const DECODE_WAIT = 1500;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smootherstep = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (6 * t - 15) + 10);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the photograph is `k` of the way through settling (0 to 1). */
export function settleBox(from: Box, to: Box, k: number): Box {
  const e = smootherstep(k);
  return {
    left: lerp(from.left, to.left, e),
    top: lerp(from.top, to.top, e),
    width: lerp(from.width, to.width, e),
    height: lerp(from.height, to.height, e),
  };
}

const PINNED = [
  "position",
  "left",
  "top",
  "right",
  "bottom",
  "width",
  "height",
  "z-index",
] as const;

function pin(img: HTMLImageElement, box: Box) {
  const style = img.style;
  style.setProperty("position", "fixed");
  style.setProperty("left", `${box.left}px`);
  style.setProperty("top", `${box.top}px`);
  style.setProperty("right", "auto");
  style.setProperty("bottom", "auto");
  style.setProperty("width", `${box.width}px`);
  style.setProperty("height", `${box.height}px`);
  style.setProperty("z-index", "1000");
}

function unpin(img: HTMLImageElement) {
  // Only what pin() set: the banner's object-position is inline too.
  for (const property of PINNED) img.style.removeProperty(property);
}

/**
 * On a session page reached by a spin, settle the full-screen photograph into
 * the banner. Does nothing on any other visit.
 */
export function settleLanding(): void {
  const root = document.documentElement;
  if (!root.classList.contains("landing")) return;
  const img = document.querySelector<HTMLImageElement>(".banner .banner-img");
  const banner = img?.closest<HTMLElement>(".banner");
  if (!img || !banner) {
    root.classList.remove("landing");
    return;
  }

  const loaded = img.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      });
  const decoded = loaded.then(() => img.decode().catch(() => undefined));
  const timeout = new Promise((resolve) => setTimeout(resolve, DECODE_WAIT));
  Promise.race([decoded, timeout]).then(() =>
    requestAnimationFrame(() => settle(root, img, banner)),
  );
}

function settle(root: HTMLElement, img: HTMLImageElement, banner: HTMLElement) {
  // The four-second fallback already showed the page.
  if (!root.classList.contains("landing")) return;

  // The paper the page appears from: it starts out covering everything but
  // the photograph, and fades while the photograph settles.
  const veil = document.createElement("div");
  veil.className = "landing-veil";
  veil.setAttribute("aria-hidden", "true");
  document.body.append(veil);

  // Same box the landing CSS gives the photograph, so swapping the class for
  // inline styles changes nothing on screen.
  const from: Box = {
    left: 0,
    top: 0,
    width: root.clientWidth,
    height: root.clientHeight,
  };
  pin(img, from);
  root.classList.remove("landing");
  root.classList.add("landed");

  const start = performance.now();
  function step(now: number) {
    const k = clamp01((now - start) / SETTLE);
    // Read the banner each frame, in case the page scrolls mid-landing.
    const to = banner.getBoundingClientRect();
    pin(img, settleBox(from, to, k));
    veil.style.opacity = String(1 - smootherstep((k - 0.12) / 0.78));
    if (k < 1) {
      requestAnimationFrame(step);
      return;
    }
    unpin(img);
    veil.remove();
    // The title and the shade under it fade in now (see the landing CSS).
    root.classList.remove("landed");
  }
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------ dots */

/** How long the halftone takes to open, ms. */
export const DOTS_MS = 640;

/**
 * Radius of one hole in the halftone, `ms` into the reveal. Holes sit on a
 * square grid `step` apart; `reach` is how far the hole is from the middle of
 * the screen, 0 to 1. The middle opens first and the wave runs outward; each
 * hole grows until it overlaps its neighbours, so the paper is gone.
 */
export function holeRadius(reach: number, ms: number, step: number): number {
  const wave = 0.42 * DOTS_MS;
  const grow = DOTS_MS - wave;
  const k = clamp01((ms - reach * wave) / grow);
  return smootherstep(k) * step * 0.75;
}

/**
 * On a page a hobby card opened into, finish what the card started: play
 * the rest of its scene over the page, or open the page through the scene's
 * big dots, or, from the plain dive, through a halftone from the middle out.
 * Does nothing on any other visit.
 */
export function settleDots(): void {
  const root = document.documentElement;
  if (!root.classList.contains("landing-dots")) return;
  const note = window.landingNote;
  if (note?.scene) {
    carryOn(root, note);
    return;
  }
  if (note?.dots?.length && note.w && note.h) {
    revealDots(root, note);
    return;
  }
  const veil = document.createElement("canvas");
  veil.className = "landing-veil";
  veil.setAttribute("aria-hidden", "true");
  const ctx = veil.getContext("2d");
  if (!ctx) {
    root.classList.remove("landing-dots");
    return;
  }
  const paper =
    getComputedStyle(root).getPropertyValue("--paper").trim() || "#fbfaf8";

  requestAnimationFrame(() => {
    document.body.append(veil);
    const start = performance.now();
    let first = true;
    function frame(now: number) {
      const w = root.clientWidth;
      const h = root.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (veil.width !== Math.round(w * dpr)) veil.width = Math.round(w * dpr);
      if (veil.height !== Math.round(h * dpr))
        veil.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ms = now - start;
      const step = Math.max(14, Math.min(26, Math.min(w, h) / 34));
      const cx = w / 2;
      const cy = h / 2;
      const far = Math.hypot(cx, cy);
      ctx!.globalCompositeOperation = "source-over";
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = paper;
      ctx!.fillRect(0, 0, w, h);
      ctx!.globalCompositeOperation = "destination-out";
      ctx!.beginPath();
      for (let y = step / 2; y < h + step; y += step) {
        for (let x = step / 2; x < w + step; x += step) {
          const r = holeRadius(Math.hypot(x - cx, y - cy) / far, ms, step);
          if (r <= 0.2) continue;
          ctx!.moveTo(x + r, y);
          ctx!.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx!.fill();
      // The canvas is up and still solid paper: the class can go.
      if (first) {
        first = false;
        root.classList.remove("landing-dots");
      }
      if (ms < DOTS_MS) requestAnimationFrame(frame);
      else veil.remove();
    }
    requestAnimationFrame(frame);
  });
}

/* ------------------------------------------------------------ big dots */

/**
 * The scene's last dots as a CSS background layer, stretched to the screen:
 * what the page paints first.
 */
export function dotsArt(
  dots: readonly number[],
  w: number,
  h: number,
  ink: string,
): string {
  let svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'><g fill='${ink}'>`;
  for (let i = 0; i + 2 < dots.length; i += 3)
    svg += `<circle cx='${dots[i]}' cy='${dots[i + 1]}' r='${dots[i + 2]}'/>`;
  svg += "</g></svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 0 / 100% 100% no-repeat`;
}

/** How long a scene gets to pick up on this page before it just fades. */
const RESUME_WAIT = 2500;

/**
 * Carry a hobby card's scene on over this page. If it can't (the scenes
 * won't load, or take too long), the frame it left on fades away instead.
 */
function carryOn(root: HTMLElement, note: LandingNote) {
  let settled = false;
  const giveUp = () => {
    if (settled) return;
    settled = true;
    fadeVeil(root, note.art);
  };
  const timer = window.setTimeout(giveUp, RESUME_WAIT);
  import("./scenes")
    .then((scenes) =>
      scenes.resume(note, () => {
        if (settled || !root.classList.contains("landing-dots")) return false;
        settled = true;
        window.clearTimeout(timer);
        return true;
      }),
    )
    .catch(giveUp);
}

/**
 * The page is showing whatever it landed on by now: let go of the note and
 * the picture of it, which can be a couple of hundred KB.
 */
export function landed(root: HTMLElement): void {
  root.classList.remove("landing-dots");
  root.style.removeProperty("--landing-dots");
  window.landingNote = undefined;
}

/** Fade the frame the page opened on, and show the page. */
function fadeVeil(root: HTMLElement, art?: string) {
  if (!root.classList.contains("landing-dots")) return;
  const veil = document.createElement("div");
  veil.className = "landing-veil";
  veil.setAttribute("aria-hidden", "true");
  if (art) veil.style.background = `${art}, var(--paper)`;
  document.body.append(veil);
  landed(root);
  veil
    .animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 320,
      easing: "ease-out",
      fill: "forwards",
    })
    .finished.then(
      () => veil.remove(),
      () => veil.remove(),
    );
}

/** How long the wave of opening takes to cross the screen, ms. */
const WAVE_MS = 260;
/** How long each window takes to open, ms. */
const OPEN_MS = 540;
/** The whole reveal. */
export const REVEAL_MS = WAVE_MS + OPEN_MS;

/** One window the page shows through: an ink dot, or bare paper between them. */
export interface Opening {
  x: number;
  y: number;
  /** The ink dot's radius; 0 for a window in bare paper. */
  r: number;
  /** How wide it opens: enough to meet its neighbours. */
  cover: number;
  /** When it starts opening, ms. */
  delay: number;
}

/**
 * Plan the reveal: a window at every ink dot, more in any bare paper between
 * them, each opening wide enough that together they cover the screen, timed
 * by how far along the reveal reaches it.
 */
export function planReveal(
  dots: readonly number[],
  w: number,
  h: number,
  reveal: Reveal = { from: [0.5, 0.5] },
): Opening[] {
  const wins: Opening[] = [];
  for (let i = 0; i + 2 < dots.length; i += 3)
    wins.push({
      x: dots[i],
      y: dots[i + 1],
      r: dots[i + 2],
      cover: 0,
      delay: 0,
    });
  const radii = wins.map((v) => v.r).sort((a, b) => a - b);
  const typical = radii[Math.floor(radii.length / 2)] || Math.min(w, h) / 20;

  // Sample the screen; wherever it's far from every window, add one.
  const step = Math.max(6, typical * 0.6);
  const sx: number[] = [];
  const sy: number[] = [];
  for (let y = step / 2; y < h + step / 2; y += step)
    for (let x = step / 2; x < w + step / 2; x += step) {
      sx.push(Math.min(x, w));
      sy.push(Math.min(y, h));
    }
  const near = new Float64Array(sx.length).fill(Infinity);
  const owner = new Int32Array(sx.length).fill(-1);
  const claim = (j: number) => {
    const v = wins[j];
    for (let i = 0; i < sx.length; i++) {
      const d = Math.hypot(sx[i] - v.x, sy[i] - v.y);
      if (d < near[i]) {
        near[i] = d;
        owner[i] = j;
      }
    }
  };
  wins.forEach((_, j) => claim(j));
  const far = 2.2 * typical;
  for (let i = 0; i < sx.length; i++) {
    if (near[i] <= far) continue;
    wins.push({ x: sx[i], y: sy[i], r: 0, cover: 0, delay: 0 });
    claim(wins.length - 1);
  }
  for (let i = 0; i < sx.length; i++) {
    const v = wins[owner[i]];
    if (v) v.cover = Math.max(v.cover, near[i] + step * 0.75);
  }

  // Order: out from a point, or across the screen as a wave with a wobble.
  const order = wins.map((v) => {
    if ("wave" in reveal) {
      const [dx, dy] = reveal.wave;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const span = Math.abs(ux) * w + Math.abs(uy) * h;
      const start = Math.min(0, ux * w) + Math.min(0, uy * h);
      const along = (v.x * ux + v.y * uy - start) / span;
      const across = v.x * -uy + v.y * ux;
      return (
        along +
        0.08 * Math.sin((across / (0.55 * Math.max(w, h))) * Math.PI * 2)
      );
    }
    const [fx, fy] = reveal.from;
    return Math.hypot(v.x - fx * w, v.y - fy * h);
  });
  const lo = Math.min(...order);
  const hi = Math.max(...order);
  wins.forEach((v, j) => {
    v.cover = Math.max(v.cover, v.r);
    v.delay = WAVE_MS * ((order[j] - lo) / (hi - lo || 1));
  });
  return wins;
}

/**
 * A window `ms` into the reveal: the hole the page shows through, and the
 * ink ring left of its dot (none once the hole has passed it).
 */
export function windowAt(
  v: Opening,
  ms: number,
): { hole: number; ring: number } {
  const k = clamp01((ms - v.delay) / OPEN_MS);
  const hole = v.cover * smootherstep(k);
  const ring = v.r ? v.r * (1 + 0.3 * smootherstep(k / 0.7)) : 0;
  return { hole, ring: ring > hole ? ring : 0 };
}

function revealDots(root: HTMLElement, note: LandingNote) {
  const veil = document.createElement("canvas");
  veil.className = "landing-veil";
  veil.setAttribute("aria-hidden", "true");
  const ctx = veil.getContext("2d");
  if (!ctx) {
    root.classList.remove("landing-dots");
    return;
  }
  const style = getComputedStyle(root);
  const paper = style.getPropertyValue("--paper").trim() || "#fbfaf8";
  const ink = note.ink || style.getPropertyValue("--ink").trim() || "#16150f";
  const w = root.clientWidth;
  const h = root.clientHeight;
  // Same stretch the first paint gave the picture, if the window changed.
  const kx = w / note.w!;
  const ky = h / note.h!;
  const kr = Math.sqrt(kx * ky);
  const dots = note.dots!.map((v, i) =>
    i % 3 === 0 ? v * kx : i % 3 === 1 ? v * ky : v * kr,
  );
  const wins = planReveal(dots, w, h, note.reveal);

  document.body.append(veil);
  const start = performance.now();
  let first = true;
  function frame(now: number) {
    const ms = first ? 0 : now - start;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (veil.width !== Math.round(w * dpr)) veil.width = Math.round(w * dpr);
    if (veil.height !== Math.round(h * dpr)) veil.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.globalCompositeOperation = "source-over";
    ctx!.clearRect(0, 0, w, h);
    ctx!.fillStyle = paper;
    ctx!.fillRect(0, 0, w, h);
    ctx!.globalCompositeOperation = "destination-out";
    ctx!.beginPath();
    const rings: Array<[number, number, number, number]> = [];
    for (const v of wins) {
      const { hole, ring } = windowAt(v, ms);
      if (hole > 0.2) {
        ctx!.moveTo(v.x + hole, v.y);
        ctx!.arc(v.x, v.y, hole, 0, Math.PI * 2);
      }
      if (ring) rings.push([v.x, v.y, ring, hole]);
    }
    ctx!.fill();
    ctx!.globalCompositeOperation = "source-over";
    ctx!.fillStyle = ink;
    ctx!.beginPath();
    for (const [x, y, outer, inner] of rings) {
      ctx!.moveTo(x + outer, y);
      ctx!.arc(x, y, outer, 0, Math.PI * 2);
      if (inner > 0.2) {
        ctx!.moveTo(x + inner, y);
        ctx!.arc(x, y, inner, 0, Math.PI * 2, true);
      }
    }
    ctx!.fill();
    // The canvas now shows what the first paint did: the class can go.
    if (first) {
      first = false;
      landed(root);
    }
    if (ms < REVEAL_MS) requestAnimationFrame(frame);
    else veil.remove();
  }
  requestAnimationFrame(frame);
}
