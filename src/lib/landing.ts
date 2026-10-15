/**
 * Landing in a page after a transition out of the last one.
 *
 * Two kinds, both started on the page you leave:
 * - `photo`: the globe's flight (src/lib/flight.ts) or a session card
 *   (src/lib/open.ts) ends with the session's banner photograph filling the
 *   screen. The session page opens on that same full-screen photograph, then
 *   settles it into the banner while the rest of the page appears around it.
 * - `dots`: a hobby card dives into its stipple plate until the screen is
 *   bare paper. The hobby page opens on bare paper too, then shows through a
 *   halftone of holes that open from the middle out.
 *
 * Just before it navigates, the old page leaves a note in sessionStorage; the
 * new page reads it before its first paint. A page reached any other way
 * never sees the note.
 */

/** sessionStorage key the old page leaves for the page it lands on. */
export const LANDING_KEY = "globe-landing";

/** What the old page leaves under LANDING_KEY. */
export interface LandingNote {
  /** Path of the page it's landing in, with a trailing slash. */
  path: string;
  /** Date.now() when it left. A stale note is ignored. */
  at: number;
  /** How it arrives; a photograph unless it says otherwise. */
  kind?: "photo" | "dots";
}

/**
 * Inline <head> script. Before the first paint, marks <html> with `landing`
 * (the banner photograph alone, full screen, until settleLanding() takes
 * over) or `landing-dots` (bare paper until settleDots() opens it) when this
 * page is the one a transition is landing in. If neither runs, the page shows
 * itself after four seconds anyway.
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
 * On a page a hobby card dived into, open the bare paper it starts on as a
 * halftone, from the middle out. Does nothing on any other visit.
 */
export function settleDots(): void {
  const root = document.documentElement;
  if (!root.classList.contains("landing-dots")) return;
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
