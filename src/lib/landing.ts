/**
 * Landing in a session from the globe.
 *
 * A spin ends with the session's banner photograph filling the screen (see
 * src/lib/flight.ts). Just before it navigates it leaves a note in
 * sessionStorage; the session page reads the note before its first paint and
 * opens on that same full-screen photograph, then settles it into the banner
 * while the rest of the page appears around it. Nothing else changes: a page
 * reached any other way never sees the note.
 */

/** sessionStorage key the flight leaves for the page it lands on. */
export const LANDING_KEY = "globe-landing";

/** What the flight leaves under LANDING_KEY. */
export interface LandingNote {
  /** Path of the session it's landing in, with a trailing slash. */
  path: string;
  /** Date.now() when it left. A stale note is ignored. */
  at: number;
}

/**
 * Inline <head> script. Marks <html> with `landing` before the first paint
 * when this page is the one a spin is landing in. The page CSS then shows the
 * banner photograph alone, full screen, until settleLanding() takes over. If
 * that never runs, the page shows itself after four seconds anyway.
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
    root.classList.add('landing');
    setTimeout(function () { root.classList.remove('landing'); }, 4000);
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
