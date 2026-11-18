/**
 * How a find's photograph arrives in the reveal card (SpecimenCard.astro),
 * shared by the tide pool and night drive toys. Three ways, picked with
 * `?reveal=lift|lens|print` while Truman chooses one:
 *
 * - lift: the animal comes up off the scene, its shadow dropping away, arcs
 *   into the card's frame and lands in the middle of it, like the aquarium's
 *   fish jump (site-motion). Only once it has landed does the photograph come
 *   up under it as it fades, so the photo never shows while it's in the air.
 * - lens: a hand lens slides over the animal and magnifies it, then opens out
 *   into the card's frame as the photograph comes up through it.
 * - print: the photograph drops onto the card like a print laid on paper, a
 *   touch large and turned, and settles flat.
 *
 * The card itself rises 8px and fades in over 200ms in all three. Under
 * reduced motion the photograph is simply there. Everything flies on one
 * fixed element that only exists while it moves, transform and opacity only
 * (clip-path for the lens opening).
 */

export type RevealStyle = "lift" | "lens" | "print";
export const REVEAL_STYLES: RevealStyle[] = ["lift", "lens", "print"];
const STORE = "specimen-reveal";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RevealSource {
  /** Where the animal is on screen, viewport px. */
  rect: Box;
  /** The animal as it looks in the scene, on a transparent canvas, centred.
   *  Drawn larger than on screen keeps the lift sharp as it grows. */
  sprite: HTMLCanvasElement;
  /** How much of the sprite's width the animal itself spans, 0 to 1. */
  fill?: number;
  /** The visible scene, and where it is on screen, for the lens to magnify. */
  scene?: { canvas: HTMLCanvasElement; rect: Box };
}

export interface RevealOptions {
  card: HTMLElement;
  pic: HTMLElement;
  img: HTMLImageElement;
  /** Resolves when the photo has loaded; rejects if it can't. */
  photo: Promise<void>;
  from: RevealSource | null;
  style: RevealStyle;
  reduced: boolean;
  hiddenClass?: string;
  /** Called if the photo fails, to paint a stand-in on the card. */
  onFail?: () => void;
}

/** The chosen style: the page's ?reveal=, else the last one picked, else lift. */
export function revealStyle(
  search = typeof location === "undefined" ? "" : location.search,
): RevealStyle {
  const q = new URLSearchParams(search).get("reveal");
  if (q && (REVEAL_STYLES as string[]).includes(q)) {
    try {
      localStorage.setItem(STORE, q);
    } catch {
      /* ignore */
    }
    return q as RevealStyle;
  }
  try {
    const s = localStorage.getItem(STORE);
    if (s && (REVEAL_STYLES as string[]).includes(s)) return s as RevealStyle;
  } catch {
    /* ignore */
  }
  return "lift";
}

/** A small switch between the three, shown only when the URL asks for one. */
export function mountRevealSwitch(
  host: HTMLElement | null,
  onChange?: (s: RevealStyle) => void,
): void {
  if (!host || !new URLSearchParams(location.search).has("reveal")) return;
  const draw = () => {
    const cur = revealStyle();
    host.innerHTML =
      '<span class="u-label">Reveal</span>' +
      REVEAL_STYLES.map(
        (s) =>
          `<button type="button" class="linkbtn" data-style="${s}" aria-pressed="${s === cur}"><span>${s[0].toUpperCase() + s.slice(1)}</span></button>`,
      ).join("");
  };
  draw();
  host.hidden = false;
  host.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-style]",
    );
    if (!b) return;
    const s = b.dataset.style as RevealStyle;
    const url = new URL(location.href);
    url.searchParams.set("reveal", s);
    history.replaceState(null, "", url);
    revealStyle(url.search);
    draw();
    onChange?.(s);
  });
}

// ------------------------------------------------------------ pure parts

/** A point along the lift's arc, `k` 0 to 1, from `a` to `b`, `lift` px up. */
export function arcPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  k: number,
  lift: number,
) {
  const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
  return {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e - lift * 4 * k * (1 - k),
  };
}

/** How big a lifted animal lands, as a share of the frame's shorter side:
 *  about the size its photograph shows it. */
export const LAND = 0.62;

/**
 * The lift's keyframes for the animal and its shadow, both on a layer that
 * sits where the animal lands (`to`, its centre, `s1` px across). It starts
 * over the animal in the scene (`from`, `s0` px across), comes up a little
 * larger first, then arcs over and shrinks or grows to land. The shadow is
 * placed in screen px, so it falls away as the animal rises and tucks back
 * under it as it comes down.
 */
export function liftFrames(
  from: { x: number; y: number },
  to: { x: number; y: number },
  s0: number,
  s1: number,
  steps = 16,
): { fly: Keyframe[]; shadow: Keyframe[] } {
  const lift = Math.min(160, 40 + Math.abs(from.y - to.y) * 0.25);
  const fly: Keyframe[] = [];
  const shadow: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const p = arcPoint(from, to, k, lift);
    const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
    // Up off the ground first: a little larger before it travels.
    const pop = 1 + 0.12 * Math.sin(Math.min(1, k / 0.35) * Math.PI) * (1 - k);
    const sc = ((s0 + (s1 - s0) * e) / s1) * pop;
    fly.push({
      offset: k,
      transform: `translate(${p.x - to.x}px, ${p.y - to.y}px) scale(${sc})`,
    });
    const up = Math.sin(k * Math.PI);
    const off = (3 + 22 * up) / sc;
    shadow.push({
      offset: k,
      opacity: 1 - 0.45 * up,
      transform: `translate(${off}px, ${off * 1.2}px) scale(${1 - 0.15 * up})`,
    });
  }
  return { fly, shadow };
}

/** The print's drop: keyframes for the photo. */
export function printFrames(): Keyframe[] {
  return [
    {
      offset: 0,
      opacity: 0,
      transform: "translateY(-14px) rotate(-1.4deg) scale(1.035)",
    },
    {
      offset: 0.5,
      opacity: 1,
      transform: "translateY(1px) rotate(0.2deg) scale(0.998)",
    },
    {
      offset: 0.78,
      opacity: 1,
      transform: "translateY(-0.5px) rotate(-0.05deg) scale(1.001)",
    },
    { offset: 1, opacity: 1, transform: "none" },
  ];
}

export const LIFT_MS = 600;
/** After a lift lands: the photo comes up as the animal fades. */
export const DEVELOP_MS = 260;
export const LENS_MS = 780;
export const PRINT_MS = 380;
const EASE = "cubic-bezier(0.2, 0, 0.2, 1)";

// ------------------------------------------------------------ the driver

let active: { stop: () => void } | null = null;

/** Stop any reveal in flight and show the card as it ends. */
export function stopReveal(): void {
  active?.stop();
  active = null;
}

function rectOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function layer(box: Box): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;z-index:60;pointer-events:none;transform-origin:0 0;will-change:transform,opacity;`;
  document.body.append(el);
  return el;
}

function fitted(
  src: CanvasImageSource,
  w: number,
  h: number,
  sw: number,
  sh: number,
  mode: "contain" | "cover",
  dpr: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  const x = c.getContext("2d")!;
  const s =
    mode === "contain"
      ? Math.min(c.width / sw, c.height / sh)
      : Math.max(c.width / sw, c.height / sh);
  x.drawImage(
    src,
    (c.width - sw * s) / 2,
    (c.height - sh * s) / 2,
    sw * s,
    sh * s,
  );
  return c;
}

/**
 * Bring the photo into an open card. The caller has already filled the card
 * and opened its scrim, set `img.src`, and hidden `img`.
 */
export function playReveal(o: RevealOptions): void {
  stopReveal();
  const hidden = o.hiddenClass ?? "is-hidden";
  // Stopping an older reveal shows its photo, and it's the same image.
  o.img.classList.add(hidden);
  const anims: Animation[] = [];
  const nodes: HTMLElement[] = [];
  let done = false;
  const showPhoto = () => {
    o.img.classList.remove(hidden);
  };
  const finish = () => {
    if (done) return;
    done = true;
    anims.forEach((a) => a.cancel());
    nodes.forEach((n) => n.remove());
    if (active === me) active = null;
  };
  const me = {
    stop: () => {
      finish();
      showPhoto();
    },
  };
  active = me;
  const failed = () => {
    finish();
    o.onFail?.();
  };

  if (o.reduced) {
    o.photo.then(() => {
      if (!done) {
        showPhoto();
        finish();
      }
    }, failed);
    return;
  }
  // Measured before the card starts its rise, or the flight would land 8px
  // low and jump when the photo takes over.
  const end = rectOf(o.pic);
  anims.push(
    o.card.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 220, easing: EASE },
    ),
  );

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const style = o.from ? o.style : "print";

  if (style === "print") {
    o.photo.then(() => {
      if (done) return;
      showPhoto();
      const a = o.img.animate(printFrames(), {
        duration: PRINT_MS,
        easing: EASE,
      });
      anims.push(a);
      a.onfinish = finish;
    }, failed);
    return;
  }

  const from = o.from!;

  if (style === "lift") {
    // The animal flies on its own and lands in the middle of the frame at
    // about the size its photo shows it. The photo stays hidden until then.
    const fill = Math.min(1, Math.max(0.1, from.fill ?? 1));
    const s1 = (Math.min(end.w, end.h) * LAND) / fill;
    const s0 = Math.max(from.rect.w, from.rect.h) / fill;
    const to = { x: end.x + end.w / 2, y: end.y + end.h / 2 };
    const fly = layer({ x: to.x - s1 / 2, y: to.y - s1 / 2, w: s1, h: s1 });
    fly.style.transformOrigin = "50% 50%";
    nodes.push(fly);
    const spr = fitted(
      from.sprite,
      s1,
      s1,
      from.sprite.width,
      from.sprite.height,
      "contain",
      dpr,
    );
    const shadow = document.createElement("div");
    const inset = ((1 - fill * 0.86) / 2) * 100;
    shadow.style.cssText = `position:absolute;inset:${inset}%;border-radius:50%;background:rgba(10,12,10,0.36);filter:blur(${Math.max(4, s1 * fill * 0.05)}px);`;
    fly.append(shadow, spr);
    const f = liftFrames(
      { x: from.rect.x + from.rect.w / 2, y: from.rect.y + from.rect.h / 2 },
      to,
      s0,
      s1,
    );
    const t = {
      duration: LIFT_MS,
      easing: "linear",
      fill: "forwards" as FillMode,
    };
    const flight = fly.animate(f.fly, t);
    anims.push(flight, shadow.animate(f.shadow, t));
    // Landed, and the photo is in: it comes up under the animal, settling
    // from a touch large, while the animal and its shadow fade off it.
    const develop = () => {
      if (done) return;
      showPhoto();
      const up = o.img.animate(
        [
          { opacity: 0, transform: "scale(1.02)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: DEVELOP_MS, easing: EASE },
      );
      anims.push(
        up,
        fly.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: DEVELOP_MS * 0.75,
          easing: "linear",
          fill: "forwards",
        }),
      );
      up.onfinish = finish;
    };
    whenLanded(flight, o.photo, () => {}, develop, develop, failed);
    return;
  }

  const fly = layer(end);
  nodes.push(fly);
  const photoLayer = document.createElement("img");
  photoLayer.alt = "";
  photoLayer.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;";
  photoLayer.src = o.img.src;

  // lens
  const scene = from.scene;
  const mag = 2.2;
  const cx = from.rect.x + from.rect.w / 2;
  const cy = from.rect.y + from.rect.h / 2;
  const view = document.createElement("canvas");
  view.width = Math.round(end.w * dpr);
  view.height = Math.round(end.h * dpr);
  view.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  {
    const x = view.getContext("2d")!;
    // What's under the lens, magnified, filling the frame.
    const srcW = end.w / mag;
    const srcH = end.h / mag;
    if (scene) {
      const kx = scene.canvas.width / scene.rect.w;
      const ky = scene.canvas.height / scene.rect.h;
      x.drawImage(
        scene.canvas,
        (cx - srcW / 2 - scene.rect.x) * kx,
        (cy - srcH / 2 - scene.rect.y) * ky,
        srcW * kx,
        srcH * ky,
        0,
        0,
        view.width,
        view.height,
      );
    } else {
      const sw = from.sprite.width;
      const sh = from.sprite.height;
      const s =
        (Math.max(from.rect.w, from.rect.h) / Math.max(sw, sh)) * mag * dpr;
      x.drawImage(
        from.sprite,
        (view.width - sw * s) / 2,
        (view.height - sh * s) / 2,
        sw * s,
        sh * s,
      );
    }
  }
  const ring = document.createElement("div");
  fly.append(view, photoLayer, ring);
  const r0 = Math.max(
    46,
    Math.min(90, Math.max(from.rect.w, from.rect.h) * 0.9),
  );
  const rEnd = Math.hypot(end.w, end.h) / 2 + 2;
  // The glass: a thin dark rim with a paler inner edge and a sheen.
  ring.style.cssText = `position:absolute;left:50%;top:50%;width:${r0 * 2}px;height:${r0 * 2}px;margin:${-r0}px 0 0 ${-r0}px;border-radius:50%;box-shadow:0 0 0 2px rgba(20,20,16,0.85),inset 0 0 0 1px rgba(255,255,255,0.55),inset 10px 12px 24px rgba(255,255,255,0.18),0 6px 18px rgba(0,0,0,0.35);`;
  const dx = cx - (end.x + end.w / 2);
  const dy = cy - (end.y + end.h / 2);
  const t1 = 280 / LENS_MS;
  const clip = (r: number) => `circle(${r}px at 50% 50%)`;
  anims.push(
    fly.animate(
      [
        {
          offset: 0,
          opacity: 0,
          transform: `translate(${dx + 26}px, ${dy + 34}px)`,
          clipPath: clip(r0 * 0.92),
        },
        {
          offset: t1 * 0.6,
          opacity: 1,
          transform: `translate(${dx + 4}px, ${dy + 5}px)`,
          clipPath: clip(r0),
        },
        {
          offset: t1,
          opacity: 1,
          transform: `translate(${dx}px, ${dy}px)`,
          clipPath: clip(r0),
          easing: EASE,
        },
        {
          offset: 1,
          opacity: 1,
          transform: "translate(0px, 0px)",
          clipPath: clip(rEnd),
        },
      ],
      { duration: LENS_MS, fill: "forwards" },
    ),
    ring.animate(
      [
        { offset: 0, opacity: 1, transform: "scale(1)" },
        { offset: t1, opacity: 1, transform: "scale(1)", easing: EASE },
        {
          offset: 0.75,
          opacity: 0.6,
          transform: `scale(${(rEnd / r0) * 0.75})`,
        },
        { offset: 1, opacity: 0, transform: `scale(${rEnd / r0})` },
      ],
      { duration: LENS_MS, fill: "forwards" },
    ),
  );
  const flight = anims[anims.length - 2];
  const fade = () =>
    photoLayer.animate(
      [
        { offset: 0, opacity: 0 },
        { offset: t1 + 0.1, opacity: 0 },
        { offset: 0.9, opacity: 1 },
        { offset: 1, opacity: 1 },
      ],
      { duration: LENS_MS, fill: "forwards" },
    );
  const land = () => {
    if (done) return;
    showPhoto();
    finish();
  };
  whenLanded(
    flight,
    o.photo,
    () => {
      const a = fade();
      a.currentTime = flight.currentTime;
      anims.push(a);
    },
    () => {
      anims.push(
        photoLayer.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 200,
          fill: "forwards",
        }),
      );
      window.setTimeout(land, 200);
    },
    land,
    failed,
  );
}

/**
 * Tie a flight to its photo: `during` when the photo arrives mid-flight,
 * `late` when it arrives after the flight has landed, `land` when the flight
 * lands with the photo in, `fail` if the photo can't load.
 */
function whenLanded(
  flight: Animation,
  photo: Promise<void>,
  during: () => void,
  late: () => void,
  land: () => void,
  fail: () => void,
): void {
  let state: "waiting" | "in" | "failed" = "waiting";
  let landed = false;
  photo.then(
    () => {
      if (landed) late();
      else {
        state = "in";
        during();
      }
    },
    () => {
      state = "failed";
      if (landed) fail();
    },
  );
  flight.onfinish = () => {
    landed = true;
    if (state === "in") land();
    else if (state === "failed") fail();
  };
}
