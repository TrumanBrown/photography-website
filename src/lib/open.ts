import { loadBanner } from "./flight";
import { dotsArt, LANDING_KEY, type LandingNote } from "./landing";
import { CARRY_KEY, leaveData } from "./scenes/carry";
import {
  canPlayInWorker,
  type Player,
  scenePlayer,
  usablePlayer,
} from "./scenes/player";
import { prefersReducedMotion } from "./motion";
import {
  CARD_W,
  cardUnits,
  type DotField,
  loadPlate,
  quietSpot,
  readDots,
} from "./plate-dots";

export { findDots, quietSpot, type DotField } from "./plate-dots";

/**
 * Leaving a page from a card, the way the globe leaves for a session.
 *
 * - A session (a card on the home or places pages, or a row in the rail)
 *   simply opens. The page you're on fades into the session's where the
 *   browser can (a cross-document view transition), and the session rises
 *   into place (src/lib/landing.ts). Nothing grows out of the card: its cover
 *   is rarely the session's banner photograph, and one photograph cutting to
 *   another reads as a glitch.
 * - A hobby card plays its hobby's scene (src/lib/scenes/): the plate's own
 *   dots, read off the image and drawn as circles, lift off the card and act
 *   out a little story, ending zoomed into a few big dots that the hobby page
 *   opens through. If the scene can't start within a moment of the click
 *   (its plate or the scene worker still on the way), the card dives into
 *   its plate until the screen is bare paper, or, where its dots can't be
 *   read on the page, the plate itself sinks into the paper; either way the
 *   page opens through a halftone.
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

/** Tell the page at `href` how we're arriving. */
function noteArrival(
  href: string,
  kind: NonNullable<LandingNote["kind"]>,
  more: Partial<LandingNote> = {},
): void {
  const note: LandingNote = {
    ...more,
    path: new URL(href, window.location.href).pathname,
    at: more.at ?? Date.now(),
    kind,
  };
  try {
    sessionStorage.setItem(LANDING_KEY, JSON.stringify(note));
  } catch {
    // Private mode can refuse storage; the page just loads normally.
  }
}

/** Leave for `href`, telling the page there how we're arriving. */
function leave(
  href: string,
  kind: LandingNote["kind"] | null,
  more: Partial<LandingNote> = {},
): void {
  if (kind) noteArrival(href, kind, more);
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

/** How long a pointer rests on a session before its page is fetched. */
const WARM_AFTER_MS = 150;
const WARM_KEEP = 6;

interface Warm {
  abort: AbortController;
  holder: HTMLElement;
}

/** Banner photographs fetched ahead of a click, newest last. */
const warmed = new Map<string, Warm>();

/**
 * Fetch a session page and decode its banner photograph out of sight, so the
 * page opens from the cache with its photograph ready for the first paint.
 * Pointing at a session for a moment, or pressing on it, starts this.
 */
function warmSession(href: string): Warm {
  const known = warmed.get(href);
  if (known) return known;
  const holder = document.createElement("div");
  holder.hidden = true;
  document.body.append(holder);
  const abort = new AbortController();
  loadBanner(href, holder, null, abort.signal).catch(() => null);
  const warm = { abort, holder };
  warmed.set(href, warm);
  if (warmed.size > WARM_KEEP) {
    const [oldest, stale] = warmed.entries().next().value!;
    stale.abort.abort();
    stale.holder.remove();
    warmed.delete(oldest);
  }
  return warm;
}

/**
 * Open a session. The link navigates as usual; this only sets up how the page
 * changes: both pages opt in to a view transition for this one navigation
 * (the session page from the note left for it), and the session page rises
 * into place whether or not the browser can fade between them.
 */
function openSession(link: HTMLAnchorElement): void {
  const slug = new URL(link.href).pathname.split("/").filter(Boolean).pop();
  // The globe in the rail turns to the session's place on the way.
  document.dispatchEvent(new CustomEvent("session:open", { detail: { slug } }));
  const optIn = document.createElement("style");
  optIn.textContent = "@view-transition { navigation: auto; }";
  document.head.append(optIn);
  // Only this navigation: the page Back returns to doesn't fade into anything.
  window.addEventListener("pagehide", () => optIn.remove(), { once: true });
  noteArrival(link.href, "page");
}

/* -------------------------------------------------------------- hobbies */

const DIVE_MS = 820;
/** How far in the dive goes, as a multiple of the plate's size on the card. */
const DIVE_DEPTH = 90;
/** The dots fade out over the end of the dive, as they rush past. */
const FADE_FROM = 0.58;

/**
 * The plain dive into a plate, for when its scene isn't available: from the
 * dots already read (card units), or read off the card itself.
 */
function diveHobby(
  plate: HTMLImageElement,
  href: string,
  known: DotField | null = null,
): boolean {
  const field = known ?? readDots(plate);
  if (!field || field.n < 40) return false;

  const box = plate.getBoundingClientRect();
  const k0 = box.width / (known ? CARD_W : plate.naturalWidth);
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

/** How long a plate takes to sink into the paper when it can't dive. */
const SINK_MS = 480;

/**
 * For when a card's scene can't start in time and its dots can't be read
 * here (a plate from another origin, read only by the scene worker): the
 * plate itself drifts toward the middle of the screen, growing as it sinks
 * into paper, and the page opens through a halftone. All it needs is the
 * picture on the card, so it always runs.
 */
function sinkHobby(plate: HTMLImageElement, href: string): void {
  const box = plate.getBoundingClientRect();
  const look = getComputedStyle(plate);
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  const layer = document.createElement("div");
  layer.className = "open-layer";
  layer.setAttribute("aria-hidden", "true");
  const paper = document.createElement("div");
  paper.className = "open-paper";
  const copy = document.createElement("img");
  copy.className = "open-photo";
  copy.alt = "";
  copy.src = plate.currentSrc || plate.src;
  Object.assign(copy.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    objectFit: look.objectFit,
    objectPosition: look.objectPosition,
  });
  layer.append(paper, copy);
  document.body.append(layer);
  plate.style.visibility = "hidden";

  const dx = 0.35 * (w / 2 - (box.left + box.width / 2));
  const dy = 0.35 * (h / 2 - (box.top + box.height / 2));
  const gone = `translate(${dx}px, ${dy}px) scale(1.6)`;
  paper.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: SINK_MS * 0.6,
    easing: "ease-out",
    fill: "forwards",
  });
  const go = () => requestAnimationFrame(() => leave(href, "dots"));
  copy
    .animate(
      [
        { transform: "none", opacity: 1 },
        { opacity: 1, offset: 0.3 },
        { transform: gone, opacity: 0 },
      ],
      {
        duration: SINK_MS,
        // Speeding up as it goes, like the dive.
        easing: "cubic-bezier(0.5, 0, 0.75, 0)",
        fill: "forwards",
      },
    )
    .finished.then(go, go);

  onReturn(() => {
    layer.remove();
    plate.style.visibility = "";
    busy = false;
  });
}

/** The dive into a plate if its dots can be had here, or else its sinking. */
function plainHobby(
  plate: HTMLImageElement,
  href: string,
  field: DotField | null = null,
): void {
  if (!diveHobby(plate, href, field)) sinkHobby(plate, href);
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

/**
 * How long a click waits for the scenes and its plate's dots, when they
 * aren't ready from pointing at the card already.
 */
const SCENE_WAIT_MS = 600;
/** Leeway for a busy worker's word to come back, past SCENE_WAIT_MS. */
const WORD_MS = 150;
/** How long a scene that has its plate gets to set itself up. */
const SETUP_MS = 1500;

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
    known = loadPlate(url).then(
      (img) => {
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

/** The still a mini plate shows when it isn't boiling: the first of its frames. */
function miniStill(img: HTMLImageElement): string | null {
  if (img.naturalWidth >= CARD_W * 0.9) return null;
  try {
    return (JSON.parse(img.dataset.frames ?? "[]") as string[])[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * The plate a hobby link is showing. It may be partway through swapping
 * inkings (the hover boil) or still loading: the scene reads the card plate
 * it names, not the image itself.
 */
function shownPlate(link: HTMLAnchorElement): HTMLImageElement | null {
  return (
    Array.from(link.querySelectorAll<HTMLImageElement>("img[data-ink]")).find(
      (img) => img.offsetParent !== null && (img.dataset.card || img.complete),
    ) ?? null
  );
}

/** Whether an image has something to read off. */
const loaded = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

const prefetched = new Set<string>();

/** Whether the visitor has asked to save data: then nothing's fetched ahead of a click. */
const savingData = () =>
  Boolean(
    (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData,
  );

/**
 * Fetch a hobby page and the scripts and styles it uses, so that when a
 * scene changes to it, it comes up as fast as it can: the scene waits in its
 * hold until the page is ready to carry it on. Ahead of a click (`early`),
 * not when the visitor is saving data.
 */
function prefetchPage(href: string, early = false): void {
  if (prefetched.has(href) || (early && savingData())) return;
  prefetched.add(href);
  fetch(href)
    .then((response) => (response.ok ? response.text() : ""))
    .then((html) => {
      const assets = [
        ...html.matchAll(/<script type="module" src="([^"]+)"/g),
        ...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g),
      ].map((match) => match[1]);
      for (const url of new Set(assets))
        fetch(url, { priority: "low" } as RequestInit).catch(() => undefined);
    })
    .catch(() => prefetched.delete(href));
}

const warmedHobbies = new WeakMap<HTMLAnchorElement, Promise<void>>();

/** Cards whose scene the worker has been asked to set up beforehand. */
const rehearsed = new WeakSet<HTMLAnchorElement>();

/**
 * Get a hobby's scene ready before it's clicked: the scenes, the card plate's
 * dots in this theme, and the scene's props. Pointing at a card, focusing it
 * or pressing it starts this at once, and as a click is `likely` then, the
 * scene worker sets the scene up once beforehand too; cards in view get the
 * rest in turn when the page is idle (see initOpeners).
 */
function warmHobby(link: HTMLAnchorElement, likely = false): Promise<void> {
  const known = warmedHobbies.get(link);
  if (known && !(likely && !rehearsed.has(link) && usablePlayer()))
    return known;
  const dark = isDark();
  const shown = link.querySelector<HTMLImageElement>(
    `img[data-ink="${dark ? "dark" : "light"}"]`,
  );
  const url = shown?.dataset.card;
  // A home-page card's mini plate too: the scene starts from it.
  const mini = shown && shown.complete ? miniStill(shown) : null;
  // In the scene worker, where it's running: none of it on the page.
  const player = usablePlayer();
  if (player && url) {
    let rect: [number, number, number, number] | undefined;
    if (likely && shown && !rehearsed.has(link)) {
      rehearsed.add(link);
      const box = shown.getBoundingClientRect();
      rect = [box.left, box.top, box.width, box.height];
    }
    player.warm(slugOf(link.href), url, mini ?? undefined, dark, rect);
    const done = Promise.resolve();
    warmedHobbies.set(link, done);
    return done;
  }
  if (mini) void dotsOf(mini);
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
  // The card keeps still while its scene plays, and lets go if it's put back.
  link.dispatchEvent(new Event("plate:hold"));
  const free = () => link.dispatchEvent(new Event("plate:free"));
  // Warm the page while the scene plays.
  prefetchPage(href);
  const player = usablePlayer();
  if (player) return playInWorker(link, img, player, free);
  // The scene plays from the card plate, finer than a home-page card's mini
  // one, and the hobby page reads the same image to carry it on. Both are
  // usually read already (warmHobby); if not, they start loading now.
  const url = img.dataset.card;
  const mini = miniStill(img);
  const cardDots = url ? dotsOf(url) : Promise.resolve(null);
  const miniDots = mini ? dotsOf(mini) : Promise.resolve(null);
  const deadline = wait(SCENE_WAIT_MS);
  const fallback = (field: DotField | null) => plainHobby(img, href, field);
  onReturn(free);

  void (async () => {
    const [mod, cardField, miniField] = await Promise.all([
      Promise.race([loadScenes(), deadline]).catch(() => undefined),
      Promise.race([cardDots, deadline]),
      Promise.race([miniDots, deadline]),
    ]);
    // Read straight off the card as a last resort: that works wherever the
    // plates are served from the site itself.
    const shown = () =>
      loaded(img) ? cardUnits(readDots(img), img.naturalWidth) : null;
    let main = cardField ?? null;
    let plate = url ?? "";
    if (!main) {
      main = miniField ?? shown();
      plate = mini ?? img.currentSrc ?? img.src;
    }
    const scene = mod?.SCENES[slug];
    if (!mod || !scene || !main || main.n < 40) return fallback(main);
    // A home-page card's mini plate fades into the card plate as it lifts.
    const from = cardField && mini ? (miniField ?? shown()) : null;

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
          // On the dev server the scene's own testing switches go along.
          const target = import.meta.env.DEV ? withSceneFlags(href) : href;
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
          else {
            // The plate's dots and the props go too, so the hobby page can
            // pick the scene up without reading and drawing them again.
            const at = final.at;
            leaveData({
              path: new URL(href).pathname,
              at,
              dots: main,
              prep: staged.prep,
            });
            leave(target, "dots", {
              at,
              ink,
              frame: final.frame,
              scene: {
                t: final.t,
                seed,
                rect: final.rect,
                w: final.w,
                h: final.h,
                plate,
                dark,
                speed: final.speed,
                hold: final.hold,
                zoom: final.zoom,
                module: mod.moduleUrl,
                paper: style.getPropertyValue("--paper").trim() || "#fbfaf8",
              },
            });
          }
          stayPut(playing);
        },
        cancelled: () => {
          busy = false;
          free();
        },
        // The GPU dropped its canvas before the page changed: dive instead.
        failed: () => {
          playing.dispose();
          plainHobby(img, href, main);
        },
      });
      onReturn(() => {
        playing.dispose();
        busy = false;
      });
    } catch {
      fallback(main);
    }
  })();
  return true;
}

/**
 * A card's scene, played in the scene worker (scenes/player.ts): the page
 * only puts the canvas up, passes on input and changes page when it's told.
 */
function playInWorker(
  link: HTMLAnchorElement,
  img: HTMLImageElement,
  player: Player,
  free: () => void,
): boolean {
  const href = link.href;
  const dark = isDark();
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const box = img.getBoundingClientRect();
  const seed = Math.floor(Math.random() * 2 ** 31);
  const red = style.getPropertyValue("--stamp").trim() || "#b3301c";
  const paper = style.getPropertyValue("--paper").trim() || "#fbfaf8";
  const target = import.meta.env.DEV ? withSceneFlags(href) : href;
  const putBack = () => {
    window.clearTimeout(late);
    img.style.visibility = "";
    busy = false;
    free();
  };
  // Without its scene, the card dives or sinks into the page instead; but
  // once it has handed over, the page is changing anyway.
  let handed = false;
  const instead = () => {
    window.clearTimeout(late);
    if (handed) return;
    img.style.visibility = "";
    plainHobby(img, href, plateDotsReady.get(img.dataset.card ?? "") ?? null);
  };
  const playing = player.play(
    {
      slug: slugOf(href),
      card: img.dataset.card || img.currentSrc || img.src,
      mini: miniStill(img) ?? undefined,
      path: new URL(href).pathname,
      rect: [box.left, box.top, box.width, box.height],
      w: root.clientWidth,
      h: root.clientHeight,
      red,
      paper,
      dark,
      seed,
      until: Date.now() + SCENE_WAIT_MS,
    },
    {
      setting: () => {
        window.clearTimeout(late);
        late = window.setTimeout(giveUp, SETUP_MS);
      },
      // Its dots are over the card now: the card can go.
      started: () => {
        window.clearTimeout(late);
        img.style.visibility = "hidden";
      },
      leave: (m) => {
        handed = true;
        try {
          sessionStorage.setItem(CARRY_KEY, m.carry);
        } catch {
          // No room: the hobby page reads the plate again.
        }
        leave(target, "dots", {
          at: m.at,
          ink: m.ink,
          frame: m.frame,
          scene: {
            t: m.t,
            seed,
            rect: m.rect,
            w: m.w,
            h: m.h,
            plate: m.plate,
            dark,
            speed: m.speed,
            hold: m.hold,
            zoom: m.zoom,
            // The hobby page starts the same worker before anything else.
            worker: player.workerUrl ?? undefined,
            red,
            paper,
          },
        });
        stayPut({
          dispose: () => {
            playing.stop();
            putBack();
          },
        });
      },
      final: (m) => {
        handed = true;
        requestAnimationFrame(() =>
          leave(target, "dots", {
            dots: m.dots,
            w: m.w,
            h: m.h,
            ink: m.ink,
            art: dotsArt(m.dots, m.w, m.h, m.ink),
            reveal: m.reveal,
          }),
        );
      },
      // It couldn't play (no plate in time, say).
      failed: instead,
      cancelled: putBack,
    },
  );
  // Nor does the click wait on a worker that's still starting up: without
  // word that it has the plate by the time the plates were due (and a moment
  // for the word to come), it goes on without the scene. The stop reaches
  // the worker ahead of the play it's still holding, which then never
  // starts. Once it has the plate, setting the scene up gets longer, in case
  // the worker stops answering altogether.
  const giveUp = () => {
    playing.stop();
    instead();
  };
  let late = window.setTimeout(giveUp, SCENE_WAIT_MS + WORD_MS);
  onReturn(() => {
    playing.stop();
    putBack();
  });
  return true;
}

/** `href` with whichever of the dev server's scene switches this page has. */
function withSceneFlags(href: string): string {
  const here = new URLSearchParams(location.search);
  const url = new URL(href, location.href);
  for (const flag of ["scene-debug", "scene-gl", "scene-2d"])
    if (here.has(flag)) url.searchParams.set(flag, "");
  return url.href;
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
      sessionStorage.removeItem(CARRY_KEY);
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
    // The scenes are what these cards are for: fetch them as soon as the
    // page has loaded, rather than when it first goes idle.
    // In the scene worker where the browser can, set up as the page loads;
    // otherwise on the page, with the scenes fetched and WebGL warmed up.
    const onPage = () =>
      void loadScenes().then(
        (mod) => idle(() => mod.warmRenderer()),
        () => undefined,
      );
    const fetchScenes = () =>
      window.setTimeout(() => {
        const player = canPlayInWorker() ? scenePlayer() : null;
        if (player)
          void player.ready.then((ok) => {
            if (!ok) onPage();
          });
        else onPage();
      }, 0);
    if (document.readyState === "complete") fetchScenes();
    else window.addEventListener("load", fetchScenes, { once: true });
    const hobbyLink = (target: EventTarget | null) =>
      (target as Element | null)?.closest?.<HTMLAnchorElement>(
        'a[data-open="hobby"]',
      ) ?? null;
    for (const type of ["pointerover", "pointerdown", "focusin"] as const)
      document.addEventListener(type, (event) => {
        const link = hobbyLink(event.target);
        if (!link) return;
        void warmHobby(link, true);
        prefetchPage(link.href, true);
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
        // Not while a scene is playing: it gets the page to itself.
        if (busy) {
          window.setTimeout(() => idle(pump), 1000);
          return;
        }
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
              }, 300),
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
    if (kind === "session") {
      openSession(link);
      return;
    }
    const took = kind === "hobby" ? openHobby(link) : false;
    if (!took) return;
    busy = true;
    event.preventDefault();
  });
}
