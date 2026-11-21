/**
 * The title screen at `/`: Truman's name in pixel letters in the sky of the
 * tarn photo, with the summit rising into the gap between "Truman" and
 * "Brown", glass keys for the three ways in (Photographs, Things to try,
 * Work) and four small ones (Resume (PDF), Write to me, LinkedIn, GitHub).
 *
 * The page under it is the front door that was here before (the rail, and
 * Weekends and Weekdays, index.astro). Work opens /#weekdays, the same page,
 * which every "About me" link and the resume PDF already point at; the title
 * screen steps aside for it and Back brings it back. Photographs and Things
 * to try leave for their pages with the site's page change. A press grows the
 * key's glass over the screen first, the way a door opens in a game menu.
 *
 * Built from the welcome mocks (round 4, C), approved 2026-11-20.
 */
import { ampOf, APEX, clamp, HIM, TOP_AT, type Geo, type Want } from "./frame";
import {
  BASE,
  fitName,
  fontPixel,
  JERSEY_100,
  planName,
  shapeOf,
  snap,
  snapFloor,
  WORD_GAP,
  type Fit,
  type Metrics,
  type Shape,
} from "./fit";
import { adapt, lens, prepareLum } from "./glass";
import { createMenu, follow } from "./menu";
import { initInfo } from "./info";
import { createEagle } from "./eagle";
import { createScene } from "./scene";

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const WEEKDAYS = "#weekdays";

/**
 * The key landing.ts reads its arrival note from (LANDING_KEY there; a test
 * keeps the two the same). Copied rather than imported: this script places
 * the photo, so it imports nothing from outside src/lib/title/ and starts
 * the moment it arrives, instead of after open.ts and the globe code.
 */
export const ARRIVAL_KEY = "globe-landing";

const prefersReducedMotion = (): boolean =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Leave for another page with the site's plain page change (open.ts): both
 * pages opt in to a cross-document view transition for this one navigation,
 * and the note tells the next page to fade and rise into place.
 */
function leaveForPage(href: string): void {
  const optIn = document.createElement("style");
  optIn.textContent = "@view-transition { navigation: auto; }";
  document.head.append(optIn);
  window.addEventListener("pagehide", () => optIn.remove(), { once: true });
  try {
    sessionStorage.setItem(
      ARRIVAL_KEY,
      JSON.stringify({
        path: new URL(href, location.href).pathname,
        at: Date.now(),
        kind: "page",
      }),
    );
  } catch {
    // Private mode can refuse storage; the page just loads normally.
  }
  window.location.assign(href);
}

export function initTitle(): void {
  const found = document.getElementById("title-screen");
  if (!found) return;
  const html = document.documentElement;
  html.classList.add("title-ready");
  if (location.hash !== WEEKDAYS) {
    boot(found);
    return;
  }
  // Opened on #weekdays (the resume's link): nothing of the title screen is
  // set up, or downloaded, until the visitor comes back to it.
  html.classList.remove("title-on");
  const wake = () => {
    if (location.hash === WEEKDAYS) return;
    window.removeEventListener("hashchange", wake);
    window.removeEventListener("popstate", wake);
    boot(found);
  };
  window.addEventListener("hashchange", wake);
  window.addEventListener("popstate", wake);
}

function boot(root: HTMLElement): void {
  const html = document.documentElement;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const nameEl = $<HTMLElement>(".t-name");
  const menu = $<HTMLElement>(".t-menu");
  const keysBox = $<HTMLElement>(".t-keys");
  const smallsBox = $<HTMLElement>(".t-smalls");
  const frameEl = $<HTMLElement>(".t-frame");
  const cursor = $<HTMLElement>(".t-cursor");
  const chips = $<HTMLElement>(".t-chips");
  const pauseBtn = $<HTMLButtonElement>(".t-pause");
  const tiltBtn = $<HTMLButtonElement>(".t-tilt");
  const ui = $<HTMLElement>(".t-ui");
  const items = [...root.querySelectorAll<HTMLElement>("[data-key]")];
  const mainKeys = items.filter((el) => el.classList.contains("t-key"));
  const drawer = document.getElementById("contact-drawer");
  const drawerOpen = () => Boolean(drawer?.classList.contains("on"));
  const reduced = prefersReducedMotion();

  let on = location.hash !== WEEKDAYS;
  html.classList.toggle("title-on", on);

  /* The photo and the land above the name have their sources in data-
     attributes; the inline script in TitleScreen.astro sets them while the
     page parses unless it opened on #weekdays. This catches that case. */
  function loadPictures(): void {
    for (const el of root.querySelectorAll<
      HTMLImageElement | HTMLSourceElement
    >("[data-srcset]")) {
      if (!el.getAttribute("srcset")) el.srcset = el.dataset.srcset ?? "";
      const src = el.dataset.src;
      if (src && el instanceof HTMLImageElement && !el.getAttribute("src"))
        el.src = src;
    }
  }
  if (on) loadPictures();

  /* ---------- The name in the sky, the summit in its gap ---------- */

  let metrics: Metrics = JERSEY_100;
  let shape: Shape = shapeOf(metrics);
  let edge = 24;
  let menuW = 400;
  let uiK = 1;
  let plan = { size: 164 };
  const dpr = () => window.devicePixelRatio || 1;

  function framePhoto(g: Geo, w0: number, h0: number): Want {
    const phone = g.vw < 700;
    root.classList.toggle("phone", phone);
    const A = ampOf(g.vw, g.vh);
    if (g.kind === "tall") {
      // One line across a phone, its gap over the summit: the photo slides
      // sideways to put the summit there. He stands clear above the menu: on
      // a short phone the photo zooms in a little and rises until his feet
      // are 16 px over the menu's top, but never so high that the name loses
      // its sky over the summit.
      const m = 14;
      const size = snapFloor((g.vw - 2 * m) / shape.nameW, dpr());
      const bw = g.fr.box[2] - g.fr.box[0];
      menu.style.setProperty("--k", "1");
      const menuTop = g.vh - (menu.offsetHeight || 260) - 16;
      const feet = HIM[3];
      const z = clamp(
        (g.vh + 0.6 * A - menuTop + 16) / ((1 - feet) * h0),
        1,
        1.4,
      );
      const h = z * h0;
      const w = z * w0;
      let y = Math.max(
        g.vh + 0.6 * A - h,
        Math.min(-0.6 * A, menuTop - 16 - feet * h),
      );
      y = Math.max(y, Math.min(-0.6 * A, 92 - APEX.y * h));
      const p = planName(shape, w / bw, h, g.vw - 2 * m);
      const left = (g.vw - shape.nameW * size) / 2;
      plan = { size };
      return {
        zoom: z,
        x: left + shape.gapC * size - ((p.cx - g.fr.box[0]) / bw) * w,
        y,
      };
    }
    edge = Math.round(clamp(g.vw * 0.05, 24, 96));
    // The menu grows on big screens, so it keeps its weight beside a big name.
    uiK = clamp(Math.min(g.vw / 1440, g.vh / 900), 1, 1.3);
    menu.style.setProperty("--k", uiK.toFixed(3));
    menuW = Math.min(400 * uiK, g.vw - 2 * edge);
    const pl = planName(shape, w0, h0, g.vw - 2 * edge, 0.185 * g.vh);
    plan = { size: pl.size };
    // Past about 2.9:1 the photo itself is centred, so its soft edges are
    // even, and the name follows the summit. Otherwise the name is centred.
    if (g.kind === "wide") return { x: (g.vw - w0) / 2, y: -TOP_AT * h0 };
    const want = g.vw / 2 - (shape.nameW / 2 - shape.gapC) * pl.size;
    return { x: want - pl.cx * w0, y: -TOP_AT * h0 };
  }

  const scene = createScene(
    {
      root,
      world: $(".t-world"),
      photo: $(".t-photo"),
      me: $(".t-front"),
      sky: $(".t-sky"),
      him: $(".t-him"),
      plane: $(".t-plane"),
      plate: $(".t-plate"),
      bird: $(".t-bird"),
    },
    { reduced, active: on, frame: framePhoto },
  );

  function measure(): void {
    const c = document.createElement("canvas").getContext("2d");
    if (!c) return;
    c.font = "400 100px 'Jersey 25'";
    const T = c.measureText("Truman");
    const B = c.measureText("Brown");
    const m: Metrics = {
      trumanInkR: T.actualBoundingBoxRight,
      brownAt: c.measureText("Truman ").width,
      brownInkL: -B.actualBoundingBoxLeft,
      brownInkR: B.actualBoundingBoxRight,
      all: c.measureText("Truman Brown").width,
    };
    // Only if the real font drew it (a fallback font is wider).
    if (Math.abs(m.all - 561) < 12) {
      metrics = m;
      shape = shapeOf(metrics);
    }
  }

  function setName(f: Fit): void {
    nameEl.style.fontSize = `${f.size}px`;
    nameEl.style.setProperty("--fp", `${fontPixel(f.size, dpr())}px`);
    nameEl.style.wordSpacing = `${WORD_GAP}em`;
    nameEl.style.left = `${f.left.toFixed(1)}px`;
    nameEl.style.top = `${(f.base - BASE * f.size).toFixed(1)}px`;
  }

  function layoutDesk(g: Geo): void {
    const f = fitName(shape, {
      spans: scene.spans,
      apex: g.apex,
      vw: g.vw,
      dpr: dpr(),
      size: snap(plan.size, dpr()),
      room: g.vw - 2 * edge,
    });
    setName(f);
    // The menu shares the name's left edge and sits 6% above the bottom,
    // unless that would cover him: then it moves toward the left edge, and
    // if even that's too close, its keys get a little smaller (never under
    // 0.82).
    const clearX = scene.pt(HIM[0], HIM[1]).x - 40;
    let left = Math.max(edge * 0.75, f.left);
    let k = uiK;
    let w = menuW;
    if (left + w > clearX) {
      left = Math.max(edge * 0.75, Math.min(left, clearX - w));
      if (left + w > clearX) {
        k = clamp((uiK * (clearX - left)) / w, 0.82, uiK);
        w = Math.min(w, (w * k) / uiK);
      }
    }
    menu.style.setProperty("--k", k.toFixed(3));
    menu.style.width = `${Math.round(w)}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.right = "";
    const mh = menu.offsetHeight;
    const top = Math.max(
      f.base + 56,
      g.vh - mh - Math.max(40, Math.round(g.vh * 0.06)),
    );
    menu.style.top = `${Math.round(top)}px`;
  }

  function layoutPhone(g: Geo): void {
    const m = 14;
    const f = fitName(shape, {
      spans: scene.spans,
      apex: g.apex,
      vw: g.vw,
      dpr: dpr(),
      size: plan.size,
      room: g.vw - 2 * m,
    });
    setName(f);
    // Across the bottom, on a phone or a tall tablet.
    menu.style.width = "auto";
    menu.style.left = "16px";
    menu.style.right = "16px";
    menu.style.top = `${Math.round(g.vh - menu.offsetHeight - 16)}px`;
  }

  let laid = false;
  function place(g: Geo): void {
    if (g.kind === "tall") layoutPhone(g);
    else layoutDesk(g);
    laid = true;
    // Over the grass and the tarn a phone's keys sit on busy ground: a little
    // more tint there (Apple suggests dimming glass over busy content).
    adapt(scene.photo, g, items, {
      min: g.kind === "tall" ? 0.3 : 0.14,
      max: 0.72,
    });
    // The bend at the glass's edges is a finishing touch: drawn once the page
    // is idle, so the name and the keys come in on a free main thread.
    const bend = () => {
      for (const el of items) lens(el, reduced);
    };
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(bend, { timeout: 1500 });
    else setTimeout(bend, 600);
    if (nav.sel >= 0) moveSel(nav.sel, true);
  }

  /* ---------- The frame and the cursor that spring between keys ---------- */

  const frameF = follow(frameEl, {
    k: 520,
    c: 38,
    stretch: 0.0011,
    reduced: prefersReducedMotion,
  });
  const curF = follow(cursor, {
    k: 600,
    c: 40,
    stretch: 0,
    reduced: prefersReducedMotion,
  });
  function rel(el: HTMLElement): {
    x: number;
    y: number;
    w: number;
    h: number;
  } {
    const m = menu.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - m.left, y: r.top - m.top, w: r.width, h: r.height };
  }
  function moveSel(i: number, instant: boolean): void {
    const el = items[i];
    const r = rel(el);
    frameF.to({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }, instant);
    if (mainKeys.includes(el)) {
      cursor.style.visibility = "";
      const k = root.classList.contains("phone")
        ? 1
        : parseFloat(menu.style.getPropertyValue("--k")) || uiK;
      curF.to(
        { x: r.x + 14 * k, y: r.y + r.h / 2 - 10 * k, w: 12 * k, h: 20 * k },
        instant,
      );
    } else cursor.style.visibility = "hidden";
  }

  /* ---------- Doors ---------- */

  interface Door {
    item: HTMLElement;
    anims: Animation[];
    sheet: HTMLElement | null;
    keys: boolean;
  }
  let opening = false;
  let door: Door | null = null;

  function sheetAt(r: DOMRect, radius: number): string {
    const vw = innerWidth;
    const vh = innerHeight;
    return `inset(${r.top.toFixed(1)}px ${(vw - r.right).toFixed(1)}px ${(vh - r.bottom).toFixed(1)}px ${r.left.toFixed(1)}px round ${radius}px)`;
  }
  function makeSheet(): HTMLElement {
    const sheet = document.createElement("div");
    sheet.className = "title-sheet";
    sheet.setAttribute("aria-hidden", "true");
    document.body.append(sheet);
    return sheet;
  }

  /**
   * The pressed key's glass grows to fill the screen while the scene pushes
   * in toward the summit and the keys fade, then `go` runs (about 300 ms to
   * cover). Rapid presses: one door at a time.
   */
  function openDoor(item: HTMLElement, keys: boolean, go: () => void): void {
    if (opening) return;
    if (reduced) {
      go();
      return;
    }
    opening = true;
    scene.freeze(true);
    const r = item.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(item).borderTopLeftRadius) || 0;
    const sheet = makeSheet();
    const anims = [
      sheet.animate(
        [
          { clipPath: sheetAt(r, radius) },
          { clipPath: "inset(0px 0px 0px 0px round 0px)" },
        ],
        { duration: 320, easing: EASE, fill: "forwards" },
      ),
      scene.world.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.07)" }],
        {
          duration: 420,
          easing: EASE,
          fill: "forwards",
        },
      ),
      ui.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 140,
        easing: "linear",
        fill: "forwards",
      }),
    ];
    door = { item, anims, sheet, keys };
    window.setTimeout(() => {
      opening = false;
      go();
    }, 280);
  }

  /** Back from a door: the glass shrinks back into its key and the scene settles. */
  function closeDoor(instant = false): void {
    const d = door;
    door = null;
    if (!d) return;
    const done = () => {
      for (const a of d.anims) a.cancel();
      d.sheet?.remove();
      scene.freeze(false);
      if (d.keys) d.item.focus({ preventScroll: true });
      nav.back();
    };
    if (instant || reduced) {
      done();
      return;
    }
    if (!d.sheet) {
      // Work's sheet faded once the page showed; bring a full one back.
      d.sheet = makeSheet();
      const r = d.item.getBoundingClientRect();
      const radius =
        parseFloat(getComputedStyle(d.item).borderTopLeftRadius) || 0;
      d.anims.push(
        d.sheet.animate(
          [
            { clipPath: sheetAt(r, radius) },
            { clipPath: "inset(0px 0px 0px 0px round 0px)" },
          ],
          { duration: 320, easing: EASE, fill: "forwards" },
        ),
      );
    }
    for (const a of d.anims) a.reverse();
    window.setTimeout(done, 340);
  }

  /** Into Weekdays, under the glass, which then fades to show it. */
  function goWork(): void {
    setOn(false);
    location.hash = WEEKDAYS;
    document.getElementById("main")?.focus({ preventScroll: true });
    const sheet = door?.sheet;
    if (!sheet || !door) return;
    door.sheet = null;
    const fade = sheet.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 200,
      easing: "linear",
      fill: "forwards",
    });
    fade.onfinish = () => sheet.remove();
  }

  function openPage(item: HTMLElement, href: string, keys: boolean): void {
    openDoor(item, keys, () => {
      if (reduced) window.location.assign(href);
      else leaveForPage(href);
    });
  }

  // Back from another page: the browser may bring this one back as it was,
  // glass and all.
  window.addEventListener("pageshow", (e: PageTransitionEvent) => {
    if (e.persisted) closeDoor();
  });

  /* ---------- The menu ---------- */

  let bobTimer = 0;
  const nav = createMenu({
    items,
    boxes: [keysBox, smallsBox],
    live: () => on && !drawerOpen(),
    busy: () => opening || door !== null || drawerOpen(),
    onSelect(i, prev, how) {
      menu.classList.add("has-sel");
      moveSel(i, prev < 0 || how === "init");
      if (!reduced && mainKeys.includes(items[i])) {
        cursor.classList.remove("bob");
        window.clearTimeout(bobTimer);
        bobTimer = window.setTimeout(() => cursor.classList.add("bob"), 260);
      }
    },
    onClear() {
      menu.classList.remove("has-sel");
      window.clearTimeout(bobTimer);
      cursor.classList.remove("bob");
    },
    onOpen(i, e) {
      const el = items[i];
      const key = el.dataset.key;
      // Resume, LinkedIn and GitHub open as links, Write to me as its drawer.
      if (key !== "photographs" && key !== "things" && key !== "work")
        return false;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
        return false;
      const keys = e.detail === 0;
      if (key === "work") openDoor(el, keys, goWork);
      else openPage(el, (el as HTMLAnchorElement).href, keys);
      return true;
    },
  });

  /* ---------- The "i": this photo in its session ---------- */

  const infoBtn = root.querySelector<HTMLButtonElement>(".t-info");
  const infoCard = root.querySelector<HTMLElement>(".t-info-card");
  const info =
    infoBtn && infoCard
      ? initInfo(infoBtn, infoCard, {
          reduced: prefersReducedMotion,
          onPlace: (card) =>
            adapt(scene.photo, scene.geo, [card], { min: 0.46, max: 0.82 }),
        })
      : null;
  const photoLink = infoCard?.querySelector<HTMLAnchorElement>("a");
  photoLink?.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
      return;
    e.preventDefault();
    const keys = e.detail === 0;
    info?.hide(true);
    openPage(infoBtn ?? photoLink, photoLink.href, keys);
  });

  /* ---------- The eagle, Pause and Tilt ---------- */

  const eagle = reduced
    ? null
    : createEagle(scene, {
        // Half a font pixel of the name, the step the name itself snaps to.
        unit: () =>
          Math.max(
            1.5,
            (parseFloat(nameEl.style.getPropertyValue("--fp")) || 6) / 2,
          ),
        name: nameEl,
        topControls: () =>
          [...chips.querySelectorAll<HTMLElement>("button")].filter(
            (el) => !el.hidden,
          ),
        first: 2600,
        every: 32000,
      });
  if (eagle) {
    pauseBtn.hidden = false;
    pauseBtn.addEventListener("click", () => {
      if (eagle.paused) {
        eagle.play();
        pauseBtn.textContent = "Pause";
      } else {
        eagle.pause();
        pauseBtn.textContent = "Play";
      }
    });
  }
  if (scene.tilt.ask) {
    tiltBtn.hidden = false;
    tiltBtn.addEventListener("click", () => {
      void scene.tilt.request().then((ok) => {
        if (ok) tiltBtn.hidden = true;
      });
    });
  }
  scene.onTilt = () => {
    tiltBtn.hidden = true;
  };

  /* ---------- On and off: the title screen, or the page under it ---------- */

  function setOn(next: boolean): void {
    if (next === on) return;
    on = next;
    html.classList.toggle("title-on", on);
    scene.setActive(on);
    if (on) {
      loadPictures();
      eagle?.wake();
      void start();
    } else {
      eagle?.rest();
      info?.hide(true);
      nav.clear();
    }
  }
  function sync(): void {
    const want = location.hash !== WEEKDAYS;
    if (want === on) return;
    setOn(want);
    if (want) closeDoor();
    else closeDoor(true);
  }
  window.addEventListener("hashchange", sync);
  window.addEventListener("popstate", sync);

  // Once "Write to me" closes, the key it came from rests unless the mouse is on it.
  if (drawer) {
    let wasOpen = false;
    new MutationObserver(() => {
      const open = drawerOpen();
      if (wasOpen && !open) requestAnimationFrame(() => nav.back());
      wasOpen = open;
    }).observe(drawer, { attributes: true, attributeFilter: ["class"] });
  }
  // The glass tint depends on the theme (the dusk grade dims the photo).
  let dark = html.classList.contains("dark");
  new MutationObserver(() => {
    const now = html.classList.contains("dark");
    if (now === dark) return;
    dark = now;
    if (on && laid) place(scene.geo);
  }).observe(html, { attributes: true, attributeFilter: ["class"] });

  /* ---------- The entrance: the name rises from behind the summit ---------- */

  function enter(): void {
    root.classList.remove("wait");
    // A slow line: past the stylesheet's own fallback, just show it.
    if (reduced || performance.now() > 3500) return;
    const spring =
      getComputedStyle(root).getPropertyValue("--spring").trim() || "ease-out";
    const rise = (
      el: HTMLElement,
      kf: Keyframe[],
      o: KeyframeAnimationOptions,
    ) => el.animate(kf, { fill: "backwards", ...o });
    // From half a letter lower, so it comes up from behind the summit and the
    // far ridges (the land is in front of it) as it fades in.
    rise(
      nameEl,
      [
        { transform: "translateY(0.5em)", opacity: 0 },
        { opacity: 1, offset: 0.4 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    mainKeys.forEach((el, j) =>
      rise(
        el,
        [
          { transform: "translateY(18px)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 460, delay: 160 + j * 45, easing: spring },
      ),
    );
    rise(smallsBox, [{ opacity: 0 }, { opacity: 1 }], {
      duration: 220,
      delay: 330,
      easing: "linear",
    });
    rise(chips, [{ opacity: 0 }, { opacity: 1 }], {
      duration: 200,
      delay: 500,
      easing: "linear",
    });
  }

  scene.onLayout(place);
  /* Once the photo, the land over the name and the pixel fonts are in, the
     name is measured and fitted and the entrance plays, the first time the
     title screen is up. Opened on #weekdays, none of it loads until then. */
  let fonts: Promise<unknown> | null = null;
  let started = false;
  async function start(): Promise<void> {
    fonts ??= Promise.all([
      document.fonts.load("100px 'Jersey 25'"),
      document.fonts.load("30px 'Jersey 15'"),
    ]).catch(() => undefined);
    await Promise.all([scene.ready, fonts]);
    await Promise.all([scene.prepare(), prepareLum(scene.photo, scene.geo)]);
    if (started || !on) return;
    started = true;
    measure();
    scene.layout();
    requestAnimationFrame(enter);
  }
  if (on) void start();
}
