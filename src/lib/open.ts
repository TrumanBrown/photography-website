import { loadBanner } from "./flight";
import { LANDING_KEY, type LandingNote } from "./landing";
import { prefersReducedMotion } from "./motion";

/**
 * Leaving a page from a card, the way the globe leaves for a session.
 *
 * - A session (a card on the home or places pages, or a row in the rail)
 *   grows its cover until it fills the screen while the session's banner
 *   photograph loads; then the session page opens on that photograph and
 *   settles it into its banner (src/lib/landing.ts).
 * - A hobby card dives into its stipple plate. The plate's own dots are read
 *   off the image and drawn as circles, so they stay crisp as they grow and
 *   stream past, until the screen is bare paper; the hobby page then opens
 *   through a halftone.
 *
 * Only plain clicks: a modified or middle click still opens a tab, and under
 * reduced motion a click just follows the link.
 */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smootherstep = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (6 * t - 15) + 10);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Leave for `href`, telling the page there how we're arriving. */
function leave(href: string, kind: LandingNote["kind"] | null): void {
  if (kind) {
    const note: LandingNote = {
      path: new URL(href, window.location.href).pathname,
      at: Date.now(),
      kind,
    };
    try {
      sessionStorage.setItem(LANDING_KEY, JSON.stringify(note));
    } catch {
      // Private mode can refuse storage; the page just loads normally.
    }
  }
  window.location.assign(href);
}

/** Put the page back if the browser brings it back from its cache. */
function onReturn(undo: () => void): void {
  const restore = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    window.removeEventListener("pageshow", restore);
    undo();
  };
  window.addEventListener("pageshow", restore);
}

let busy = false;

/* ------------------------------------------------------------- sessions */

const GROW_MS = 440;
const SWAP_MS = 170;
const BANNER_WAIT_MS = 1500;
/** How long a pointer rests on a session before its page is fetched. */
const WARM_AFTER_MS = 150;
const WARM_KEEP = 6;

interface Warm {
  ready: Promise<HTMLImageElement | null>;
  abort: AbortController;
  holder: HTMLElement;
}

/** Banner photographs fetched ahead of a click, newest last. */
const warmed = new Map<string, Warm>();

/**
 * Fetch a session page and decode its banner photograph out of sight, so a
 * click can go straight to it. Pointing at a session for a moment, or
 * pressing on it, starts this; the click picks up whatever has arrived.
 */
function warmSession(href: string): Warm {
  const known = warmed.get(href);
  if (known) return known;
  const holder = document.createElement("div");
  holder.hidden = true;
  document.body.append(holder);
  const abort = new AbortController();
  const ready = loadBanner(href, holder, null, abort.signal).catch(() => null);
  const warm = { ready, abort, holder };
  warmed.set(href, warm);
  if (warmed.size > WARM_KEEP) {
    const [oldest, stale] = warmed.entries().next().value!;
    stale.abort.abort();
    stale.holder.remove();
    warmed.delete(oldest);
  }
  return warm;
}

function openSession(link: HTMLAnchorElement): boolean {
  const href = link.href;
  // What it grows from: the photo showing on the card (a skimmed one if
  // you're thumbing through), or the rail's peek when it's out.
  const peek = document.querySelector<HTMLImageElement>("#rail-peek.on img");
  const cover =
    link.querySelector<HTMLImageElement>(".skim-frame:not([hidden])") ??
    link.querySelector<HTMLImageElement>(".shot-img") ??
    (link.matches("[data-rail-item]") && peek ? peek : null);
  const from = (cover ?? link).getBoundingClientRect();
  const src = cover?.currentSrc || cover?.src || link.dataset.peek || "";

  const layer = document.createElement("div");
  layer.className = "open-layer";
  layer.setAttribute("aria-hidden", "true");
  const paper = document.createElement("div");
  paper.className = "open-paper";
  const photo = document.createElement("img");
  photo.className = "open-photo";
  photo.alt = "";
  if (src) photo.src = src;
  layer.append(paper, photo);
  document.body.append(layer);

  const slug = new URL(href).pathname.split("/").filter(Boolean).pop();
  document.dispatchEvent(new CustomEvent("session:open", { detail: { slug } }));

  const warm = warmSession(href);
  let banner: HTMLImageElement | null = null;
  let failed = false;
  warm.ready.then(
    (img) => {
      if (!img) {
        failed = true;
        return;
      }
      // Over the cover, still unseen until the swap.
      layer.append(img.closest("picture") ?? img);
      banner = img;
    },
    () => {
      failed = true;
    },
  );

  const start = performance.now();
  let swapping = false;
  function frame(now: number) {
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    const k = clamp01((now - start) / GROW_MS);
    const e = smootherstep(k);
    photo.style.left = `${lerp(from.left, 0, e)}px`;
    photo.style.top = `${lerp(from.top, 0, e)}px`;
    photo.style.width = `${lerp(from.width, w, e)}px`;
    photo.style.height = `${lerp(from.height, h, e)}px`;
    paper.style.opacity = String(smootherstep(k / 0.6));
    if (k < 1 || swapping) {
      if (!swapping) requestAnimationFrame(frame);
      return;
    }
    if (banner) {
      // The banner photograph comes up over the cover, full screen: the
      // frame the session page opens on.
      swapping = true;
      const ready = banner;
      ready
        .animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: SWAP_MS,
          easing: "ease-out",
          fill: "forwards",
        })
        .finished.then(
          () => requestAnimationFrame(() => leave(href, "photo")),
          () => leave(href, "photo"),
        );
      return;
    }
    if (failed || now - start > GROW_MS + BANNER_WAIT_MS) {
      leave(href, null);
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  onReturn(() => {
    layer.remove();
    busy = false;
  });
  return true;
}

/* -------------------------------------------------------------- hobbies */

/** The dots of a stipple plate: centres and radii in image pixels. */
export interface DotField {
  x: Float32Array;
  y: Float32Array;
  r: Float32Array;
  n: number;
  /** Average ink colour, so the dots are drawn in the plate's own ink. */
  color: string;
}

/**
 * Find the dots in a plate's pixels (RGBA, row by row): every patch of
 * touching inked pixels is one dot, at its centre, as big as its area. Where
 * the shading is dense the dots touch and run together; a patch much bigger
 * than a typical dot is cut back into typical dots, a dot's width apart, so
 * it reads as stipple when it's blown up rather than one big blot.
 */
export function findDots(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaMin = 96,
): DotField {
  const size = width * height;
  const seen = new Uint8Array(size);
  const stack = new Int32Array(size);
  // Every inked pixel, patch by patch.
  const members = new Int32Array(size);
  const starts: number[] = [];
  const counts: number[] = [];
  let used = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let p = 0; p < size; p++) {
    if (seen[p] || data[p * 4 + 3] < alphaMin) continue;
    seen[p] = 1;
    let top = 0;
    stack[top++] = p;
    starts.push(used);
    while (top) {
      const q = stack[--top];
      members[used++] = q;
      red += data[q * 4];
      green += data[q * 4 + 1];
      blue += data[q * 4 + 2];
      const qx = q % width;
      const qy = (q - qx) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = qy + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx;
          if (nx < 0 || nx >= width) continue;
          const nq = ny * width + nx;
          if (seen[nq] || data[nq * 4 + 3] < alphaMin) continue;
          seen[nq] = 1;
          stack[top++] = nq;
        }
      }
    }
    counts.push(used - starts[starts.length - 1]);
  }

  const sorted = [...counts].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)] ?? 1;
  const typicalR = Math.sqrt(typical / Math.PI);
  const step = Math.max(2, 2 * typicalR);
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  for (let c = 0; c < counts.length; c++) {
    const from = starts[c];
    const count = counts[c];
    if (count <= typical * 2.5) {
      let sx = 0;
      let sy = 0;
      for (let i = from; i < from + count; i++) {
        const q = members[i];
        sx += q % width;
        sy += Math.floor(q / width);
      }
      xs.push(sx / count + 0.5);
      ys.push(sy / count + 0.5);
      rs.push(Math.sqrt(count / Math.PI));
      continue;
    }
    // A run of touching dots: one dot per step-wide cell of it.
    const cells = new Map<number, [number, number, number]>();
    for (let i = from; i < from + count; i++) {
      const q = members[i];
      const x = q % width;
      const y = Math.floor(q / width);
      const key = Math.floor(y / step) * 10000 + Math.floor(x / step);
      const cell = cells.get(key);
      if (cell) {
        cell[0] += x;
        cell[1] += y;
        cell[2]++;
      } else cells.set(key, [x, y, 1]);
    }
    for (const [key, [sx, sy, n]] of cells) {
      // A nudge off the grid, the same each time, so it reads as stipple.
      const h1 = Math.sin(key * 12.9898) * 43758.5453;
      const h2 = Math.sin(key * 78.233) * 43758.5453;
      xs.push(sx / n + 0.5 + (h1 - Math.floor(h1) - 0.5) * step * 0.4);
      ys.push(sy / n + 0.5 + (h2 - Math.floor(h2) - 0.5) * step * 0.4);
      rs.push(Math.min(typicalR, Math.sqrt(n / Math.PI) * 1.1));
    }
  }
  const avg = (v: number) => Math.round(v / Math.max(1, used));
  return {
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    r: Float32Array.from(rs),
    n: xs.length,
    color: `rgb(${avg(red)}, ${avg(green)}, ${avg(blue)})`,
  };
}

/**
 * A spot in among the dots, near the middle of the drawing, with as much
 * clear paper around it as possible. Diving in there leaves the screen bare
 * at the end rather than inside a dot.
 */
export function quietSpot(field: DotField): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < field.n; i++) {
    cx += field.x[i];
    cy += field.y[i];
  }
  cx /= Math.max(1, field.n);
  cy /= Math.max(1, field.n);
  const span = 40;
  let best = { x: cx, y: cy };
  let bestScore = -Infinity;
  for (let gy = -span; gy <= span; gy += 4) {
    for (let gx = -span; gx <= span; gx += 4) {
      const x = cx + gx;
      const y = cy + gy;
      let clear = Infinity;
      for (let i = 0; i < field.n; i++) {
        const dx = field.x[i] - x;
        const dy = field.y[i] - y;
        if (Math.abs(dx) > 30 || Math.abs(dy) > 30) continue;
        clear = Math.min(clear, Math.hypot(dx, dy) - field.r[i]);
      }
      // Clear paper counts most; staying near the middle breaks ties.
      const score = Math.min(clear, 30) - 0.02 * Math.hypot(gx, gy);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

function readDots(img: HTMLImageElement): DotField | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0);
    return findDots(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return null;
  }
}

const DIVE_MS = 820;
/** How far in the dive goes, as a multiple of the plate's size on the card. */
const DIVE_DEPTH = 90;
/** The dots fade out over the end of the dive, as they rush past. */
const FADE_FROM = 0.58;

function openHobby(link: HTMLAnchorElement): boolean {
  const plate = Array.from(
    link.querySelectorAll<HTMLImageElement>("img[data-ink]"),
  ).find((img) => img.offsetParent !== null && img.complete);
  if (!plate) return false;
  const field = readDots(plate);
  if (!field || field.n < 40) return false;
  const href = link.href;
  // Warm the page while the dive runs.
  fetch(href).catch(() => undefined);

  const box = plate.getBoundingClientRect();
  const k0 = box.width / plate.naturalWidth;
  const spot = quietSpot(field);
  const startX = box.left + spot.x * k0;
  const startY = box.top + spot.y * k0;
  const paperColor =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--paper")
      .trim() || "#fbfaf8";

  const canvas = document.createElement("canvas");
  canvas.className = "open-layer";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  document.body.append(canvas);
  plate.style.visibility = "hidden";

  const start = performance.now();
  function frame(now: number) {
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr))
      canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr))
      canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    const u = clamp01((now - start) / DIVE_MS);
    const glide = smootherstep(u / 0.55);
    const cx = lerp(startX, w / 2, glide);
    const cy = lerp(startY, h / 2, glide);
    // Speeding up all the way in, like a fall.
    const scale = k0 * Math.exp(Math.log(DIVE_DEPTH) * Math.pow(u, 2.4));
    ctx!.clearRect(0, 0, w, h);
    ctx!.globalAlpha = smootherstep(u / 0.3);
    ctx!.fillStyle = paperColor;
    ctx!.fillRect(0, 0, w, h);
    ctx!.globalAlpha = 1 - smootherstep((u - FADE_FROM) / (1 - FADE_FROM));
    ctx!.fillStyle = field!.color;
    ctx!.beginPath();
    for (let i = 0; i < field!.n; i++) {
      const r = field!.r[i] * scale;
      const x = cx + (field!.x[i] - spot.x) * scale;
      const y = cy + (field!.y[i] - spot.y) * scale;
      if (x < -r || y < -r || x > w + r || y > h + r) continue;
      ctx!.moveTo(x + r, y);
      ctx!.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx!.fill();
    ctx!.globalAlpha = 1;
    if (u < 1) requestAnimationFrame(frame);
    else requestAnimationFrame(() => leave(href, "dots"));
  }
  requestAnimationFrame(frame);

  onReturn(() => {
    canvas.remove();
    plate.style.visibility = "";
    busy = false;
  });
  return true;
}

/* --------------------------------------------------------------- wiring */

/** Take over plain clicks on `[data-open]` links. Call once per page. */
export function initOpeners(): void {
  // Warm a session a moment after the pointer settles on it, or on press.
  let hover = 0;
  const sessionLink = (target: EventTarget | null) =>
    (target as Element | null)?.closest?.<HTMLAnchorElement>(
      'a[data-open="session"]',
    ) ?? null;
  document.addEventListener("pointerover", (event) => {
    const link = sessionLink(event.target);
    window.clearTimeout(hover);
    if (!link || event.pointerType !== "mouse" || prefersReducedMotion())
      return;
    hover = window.setTimeout(() => warmSession(link.href), WARM_AFTER_MS);
  });
  document.addEventListener("pointerout", (event) => {
    if (sessionLink(event.target)) window.clearTimeout(hover);
  });
  document.addEventListener("pointerdown", (event) => {
    const link = sessionLink(event.target);
    if (link && event.button === 0 && !prefersReducedMotion())
      warmSession(link.href);
  });

  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      prefersReducedMotion()
    )
      return;
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
      "a[data-open]",
    );
    if (!link || link.target || link.origin !== window.location.origin) return;
    if (busy) {
      event.preventDefault();
      return;
    }
    const kind = link.dataset.open;
    const took =
      kind === "session"
        ? openSession(link)
        : kind === "hobby"
          ? openHobby(link)
          : false;
    if (!took) return;
    busy = true;
    event.preventDefault();
  });
}
