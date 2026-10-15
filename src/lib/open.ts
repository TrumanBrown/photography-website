import { loadBanner } from "./flight";
import { dotsArt, LANDING_KEY, type LandingNote } from "./landing";
import { prefersReducedMotion } from "./motion";
import {
  CARD_W,
  cardUnits,
  type DotField,
  quietSpot,
  readDots,
} from "./plate-dots";

export { findDots, quietSpot, type DotField } from "./plate-dots";

/**
 * Leaving a page from a card, the way the globe leaves for a session.
 *
 * - A session (a card on the home or places pages, or a row in the rail)
 *   grows its cover until it fills the screen while the session's banner
 *   photograph loads; then the session page opens on that photograph and
 *   settles it into its banner (src/lib/landing.ts).
 * - A hobby card plays its hobby's scene (src/lib/scenes/): the plate's own
 *   dots, read off the image and drawn as circles, lift off the card and act
 *   out a little story, ending zoomed into a few big dots that the hobby page
 *   opens through. If the scenes can't load in time, the card just dives
 *   into its plate until the screen is bare paper, and the page opens
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
function leave(
  href: string,
  kind: LandingNote["kind"] | null,
  more: Partial<LandingNote> = {},
): void {
  if (kind) {
    const note: LandingNote = {
      ...more,
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

const DIVE_MS = 820;
/** How far in the dive goes, as a multiple of the plate's size on the card. */
const DIVE_DEPTH = 90;
/** The dots fade out over the end of the dive, as they rush past. */
const FADE_FROM = 0.58;

/** The plain dive into a plate, for when its scene isn't available. */
function diveHobby(plate: HTMLImageElement, href: string): boolean {
  const field = readDots(plate);
  if (!field || field.n < 40) return false;

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

/* --------------------------------------------------------------- scenes */

type Scenes = typeof import("./scenes");
let scenes: Promise<Scenes> | null = null;

/** The hobby scenes, fetched once, the first time anything wants them. */
function loadScenes(): Promise<Scenes> {
  scenes ??= import("./scenes").catch((error: unknown) => {
    scenes = null;
    throw error;
  });
  return scenes;
}

/** How long a click waits for the scenes before settling for the plain dive. */
const SCENE_WAIT_MS = 400;
/** How long a home-page card waits for its finer card plate. */
const CARD_WAIT_MS = 150;

const wait = (ms: number) =>
  new Promise<undefined>((resolve) => setTimeout(resolve, ms));
/** Safari has no requestIdleCallback. */
const idle = (fn: () => void) => {
  if (typeof window.requestIdleCallback === "function")
    window.requestIdleCallback(() => fn(), { timeout: 1500 });
  else setTimeout(fn, 600);
};
const isDark = () => document.documentElement.classList.contains("dark");
const slugOf = (href: string) =>
  new URL(href, window.location.href).pathname
    .split("/")
    .filter(Boolean)
    .pop() ?? "";

/** Card plates' dots by URL, in card units, read once each. */
const plateDots = new Map<string, Promise<DotField | null>>();
const plateDotsReady = new Map<string, DotField | null>();

function dotsOf(url: string): Promise<DotField | null> {
  let known = plateDots.get(url);
  if (!known) {
    const img = new Image();
    img.src = url;
    known = img.decode().then(
      () => {
        const field = cardUnits(readDots(img), img.naturalWidth);
        plateDotsReady.set(url, field);
        return field;
      },
      () => null,
    );
    plateDots.set(url, known);
  }
  return known;
}

/** The plate a hobby link is showing right now, if it has loaded. */
function shownPlate(link: HTMLAnchorElement): HTMLImageElement | null {
  return (
    Array.from(link.querySelectorAll<HTMLImageElement>("img[data-ink]")).find(
      (img) => img.offsetParent !== null && img.complete && img.naturalWidth,
    ) ?? null
  );
}

const warmedHobbies = new WeakMap<HTMLAnchorElement, Promise<void>>();

/**
 * Get a hobby's scene ready before it's clicked: the scenes, the card plate's
 * dots in this theme, and the scene's props. Pointing at a card, focusing it
 * or pressing it starts this at once; cards in view get it in turn when the
 * page is idle (see initOpeners).
 */
function warmHobby(link: HTMLAnchorElement): Promise<void> {
  const known = warmedHobbies.get(link);
  if (known) return known;
  const dark = isDark();
  const url = link.querySelector<HTMLImageElement>(
    `img[data-ink="${dark ? "dark" : "light"}"]`,
  )?.dataset.card;
  const warm = Promise.all([loadScenes(), url ? dotsOf(url) : null])
    .then(
      ([mod, field]) =>
        new Promise<void>((resolve) => {
          const scene = mod.SCENES[slugOf(link.href)];
          if (!scene || !field) return resolve();
          idle(() => {
            mod.ready(scene, field, dark);
            resolve();
          });
        }),
    )
    .catch(() => {
      warmedHobbies.delete(link);
    });
  warmedHobbies.set(link, warm);
  return warm;
}

function openHobby(link: HTMLAnchorElement): boolean {
  const img = shownPlate(link);
  if (!img) return false;
  const href = link.href;
  const slug = slugOf(href);
  const dark = isDark();
  // Warm the page while the scene plays.
  fetch(href).catch(() => undefined);
  const fallback = () => {
    if (!diveHobby(img, href)) leave(href, null);
  };

  void (async () => {
    const mod = await Promise.race([loadScenes(), wait(SCENE_WAIT_MS)]).catch(
      () => undefined,
    );
    const scene = mod?.SCENES[slug];
    if (!mod || !scene) return fallback();

    // The scene plays from the card plate, finer than a home-page card's
    // mini one, and the hobby page reads the same image to carry it on. If
    // the card plate isn't to hand in time, it plays from whatever the card
    // is showing.
    const url = img.dataset.card;
    let main: DotField | null = null;
    let plate = url ?? "";
    if (url)
      main =
        plateDotsReady.get(url) ??
        (await Promise.race([dotsOf(url), wait(CARD_WAIT_MS)])) ??
        null;
    const shown = () => cardUnits(readDots(img), img.naturalWidth);
    let from: DotField | null = null;
    if (!main) {
      main = shown();
      plate = img.currentSrc || img.src;
    } else if (img.naturalWidth < CARD_W * 0.9) {
      // A home-page card's mini plate fades into the card plate as it lifts.
      from = shown();
    }
    if (!main || main.n < 40) return fallback();

    const style = getComputedStyle(document.documentElement);
    const ink = main.color;
    const seed = Math.floor(Math.random() * 2 ** 31);
    try {
      const staged = mod.ready(scene, main, dark);
      const playing = mod.play({
        scene,
        prep: staged.prep,
        img,
        main: staged,
        from: from ? mod.ready(scene, from, dark, false) : undefined,
        colors: {
          ink,
          red: style.getPropertyValue("--stamp").trim() || "#b3301c",
          paper: style.getPropertyValue("--paper").trim() || "#fbfaf8",
        },
        font: getComputedStyle(document.body).fontFamily,
        dark,
        seed,
        done: (final) => {
          const target = import.meta.env.DEV
            ? href +
              (new URLSearchParams(location.search).has("scene-debug")
                ? "?scene-debug"
                : "")
            : href;
          if (final.kind === "dots")
            requestAnimationFrame(() =>
              leave(target, "dots", {
                dots: final.dots,
                w: final.w,
                h: final.h,
                ink,
                art: dotsArt(final.dots, final.w, final.h, ink),
                reveal: final.reveal,
              }),
            );
          else
            leave(target, "dots", {
              ink,
              art: final.art,
              scene: {
                t: final.t,
                seed,
                rect: final.rect,
                w: final.w,
                h: final.h,
                plate,
                dark,
                speed: final.speed,
              },
            });
          stayPut(playing);
        },
        cancelled: () => {
          busy = false;
        },
      });
      onReturn(() => {
        playing.dispose();
        busy = false;
      });
    } catch {
      fallback();
    }
  })();
  return true;
}

/**
 * The scene has handed over and the next page is loading. Escape still
 * calls it off; and if the page never changes (the browser stopped it),
 * put this one back.
 */
function stayPut(playing: { dispose(): void }) {
  const back = () => {
    window.removeEventListener("keydown", onKey, true);
    window.clearTimeout(timer);
    try {
      sessionStorage.removeItem(LANDING_KEY);
    } catch {
      // Nothing to clear.
    }
    playing.dispose();
    busy = false;
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    window.stop();
    back();
  };
  window.addEventListener("keydown", onKey, true);
  const timer = window.setTimeout(back, 10000);
  window.addEventListener(
    "pagehide",
    () => {
      window.removeEventListener("keydown", onKey, true);
      window.clearTimeout(timer);
    },
    { once: true },
  );
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

  // Hobby cards: the scenes come down when the page is idle, and a card's
  // plate and props get ready when it's pointed at, focused or pressed, or
  // once it's been in view a moment.
  const hobbies = document.querySelectorAll<HTMLAnchorElement>(
    'a[data-open="hobby"]',
  );
  if (hobbies.length && !prefersReducedMotion()) {
    idle(() => void loadScenes().catch(() => undefined));
    const hobbyLink = (target: EventTarget | null) =>
      (target as Element | null)?.closest?.<HTMLAnchorElement>(
        'a[data-open="hobby"]',
      ) ?? null;
    for (const type of ["pointerover", "pointerdown", "focusin"] as const)
      document.addEventListener(type, (event) => {
        const link = hobbyLink(event.target);
        if (link) void warmHobby(link);
      });
    // Cards that stay in view get ready one at a time, when the page is idle.
    // A home-page card fetches its card plate for this (unless the visitor
    // is saving data); a card on /hobbies/ already shows it.
    const saving = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection?.saveData;
    if ("IntersectionObserver" in window) {
      const queue: HTMLAnchorElement[] = [];
      let pumping = false;
      const pump = () => {
        const link = queue.shift();
        if (!link) {
          pumping = false;
          return;
        }
        void warmHobby(link).then(() => idle(pump));
      };
      const timers = new Map<Element, number>();
      const seen = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            window.clearTimeout(timers.get(entry.target));
            if (!entry.isIntersecting) continue;
            timers.set(
              entry.target,
              window.setTimeout(() => {
                seen.unobserve(entry.target);
                queue.push(entry.target as HTMLAnchorElement);
                if (!pumping) {
                  pumping = true;
                  idle(pump);
                }
              }, 600),
            );
          }
        },
        { threshold: 0.5 },
      );
      for (const link of hobbies) {
        const card =
          link.querySelector(".plate img")?.getAttribute("width") === "880";
        if (card || !saving) seen.observe(link);
      }
    }
  }

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
