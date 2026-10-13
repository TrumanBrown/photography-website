/**
 * The Day list map: a zoomable world in plate carrée, the projection the
 * puzzle boundaries and the relief tiles share, drawn on one canvas.
 *
 * Terrain is Natural Earth's Gray Earth relief, cut into tiles by
 * scripts/build-day-list-relief.mjs. A tile is one grey channel (water 0, land
 * 48-255) that's mapped through the page palette here, so light and dark mode
 * share one set of tiles and follow the theme toggle. Until the first tiles
 * arrive the coarse coastline from ../geo stands in.
 *
 * Ways to zoom: pinch, Ctrl or Cmd + scroll (a trackpad pinch arrives as
 * Ctrl + scroll), double-click or double-tap, the + and - buttons, and the
 * + / - / 0 keys. A plain scroll wheel keeps scrolling the page, and the map
 * says how to zoom instead of trapping it. On touch, one finger scrolls the
 * page at world view (touch-action: pan-y) and pans once you're zoomed in
 * (touch-action: none), the same deal as the herp map.
 *
 * Country and state borders are vector lines from ./day-list-borders, drawn
 * over the terrain at whatever detail the zoom needs.
 *
 * The game draws its pin, line and boundary on top through `drawOverlay`.
 */
import { LAND } from "../geo";
import { prefersReducedMotion } from "../motion";
import { createBorders } from "./day-list-borders";
import relief from "./day-list-relief.json";

export interface LonLat {
  lon: number;
  lat: number;
}
export interface Box {
  w: number;
  e: number;
  s: number;
  n: number;
}
export interface Point {
  x: number;
  y: number;
}
/** Zoom and the view's centre, as fractions of the world (0-1 across, 0-1 down). */
export interface View {
  k: number;
  cu: number;
  cv: number;
}
export interface Palette {
  key: string;
  ink: string;
  ink2: string;
  paper: string;
  /** Open water, exactly the colour the tiles give it. */
  water: string;
  /** Land for the coarse coastline drawn before the tiles arrive. */
  land: string;
  grid: string;
  coast: string;
  lut: Uint8ClampedArray;
  /** Light ink on a dark page. */
  dark: boolean;
}

export const MAX_ZOOM = 64;
/** The reveal frames the pin and the place, but no tighter than this. */
export const FIT_MAX_ZOOM = 48;

interface Level {
  w: number;
  h: number;
  cols: number;
  rows: number;
  land: string;
}
const RELIEF = relief as {
  path: string;
  tile: number;
  levels: Level[];
};

/* ------------------------------------------------------------ pure maths */

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Keep zoom in range and the view inside the world. */
export function clampView(view: View, maxZoom = MAX_ZOOM): View {
  const k = clamp(view.k, 1, maxZoom);
  const half = 0.5 / k;
  return {
    k,
    cu: clamp(view.cu, half, 1 - half),
    cv: clamp(view.cv, half, 1 - half),
  };
}

/**
 * The view that shows `box` with `pad` CSS pixels to spare on every side, and
 * `right` more on the right where the map's buttons sit, no closer than
 * `maxZoom`. The map is 2:1 like the world, so one zoom fits both directions.
 */
export function fitView(
  box: Box,
  width: number,
  height: number,
  pad: number,
  maxZoom = FIT_MAX_ZOOM,
  right = 0,
): View {
  const u0 = (box.w + 180) / 360;
  const u1 = (box.e + 180) / 360;
  const v0 = (90 - box.n) / 180;
  const v1 = (90 - box.s) / 180;
  const roomX = Math.max(0.1, 1 - (2 * pad + right) / width);
  const roomY = Math.max(0.1, 1 - (2 * pad) / height);
  const span = Math.max((u1 - u0) / roomX, (v1 - v0) / roomY, 1 / maxZoom);
  // Shift the centre right by half the inset, so the box sits in the room
  // that's left of the buttons.
  const shift = (right / 2 / width) * span;
  return clampView(
    { k: 1 / span, cu: (u0 + u1) / 2 + shift, cv: (v0 + v1) / 2 },
    maxZoom,
  );
}

/**
 * How the reveal frames the answer: room on every side, plus the width of the
 * zoom buttons on the right so the place never lands under them.
 */
export function answerView(box: Box, width: number, height: number): View {
  const pad = width < 480 ? 28 : 44;
  return fitView(box, width, height, pad, FIT_MAX_ZOOM, 40);
}

/** The coarsest tile level with enough pixels for `need` device pixels across. */
export function levelFor(need: number, widths: number[]): number {
  for (let i = 0; i < widths.length; i++) {
    if (widths[i] >= need * 0.7) return i;
  }
  return widths.length - 1;
}

/** Degrees between graticule lines so they sit at least ~60px apart. */
export function graticuleStep(pxPerDegree: number): number {
  for (const step of [0.5, 1, 2, 5, 10, 15, 30]) {
    if (step * pxPerDegree >= 60) return step;
  }
  return 30;
}

/** A round scale-bar length (1, 2 or 5 times a power of ten) that fits `maxPx`. */
export function scaleBar(
  kmPerPx: number,
  maxPx = 90,
): { km: number; px: number } {
  const target = kmPerPx * maxPx;
  const power = 10 ** Math.floor(Math.log10(target));
  const km = [5, 2, 1].map((m) => m * power).find((d) => d <= target) ?? power;
  return { km, px: km / kmPerPx };
}

function parseColour(value: string, fallback: [number, number, number]) {
  const hex = value.trim().replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16)) as [
      number,
      number,
      number,
    ];
  }
  return fallback;
}

const mix = (a: number[], b: number[], t: number) =>
  a.map((v, i) => v + (b[i] - v) * t);
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const hexOf = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/**
 * The sea and the land's shadow and highlight for a theme. Light mode keeps
 * the archive's map: tan sea, paper land with relief shaded toward ink. Dark
 * mode turns it round, a sea darker than the page under land lit a few steps
 * toward ink, because relief shaded down from near-black has nowhere to go.
 */
export function mapTones(paper: string, ink: string, sea: string) {
  const p = parseColour(paper, [251, 250, 248]);
  const i = parseColour(ink, [22, 21, 15]);
  const s = parseColour(sea, [216, 210, 196]);
  if (lum(p) < lum(i)) {
    return {
      water: mix(p, [0, 0, 0], 0.25),
      shadow: mix(p, i, 0.05),
      light: mix(p, i, 0.3),
    };
  }
  return { water: s, shadow: mix(p, i, 0.32), light: p };
}

/**
 * Tile grey to page colour. 0-8 is open water. Land runs from the theme's
 * shadow to its highlight over 48-255, and 8-48 is the coastline's
 * antialiasing, blended between the two.
 */
export function buildLut(
  paper: string,
  ink: string,
  sea: string,
): Uint8ClampedArray {
  const { water, shadow, light } = mapTones(paper, ink, sea);
  const lut = new Uint8ClampedArray(256 * 4);
  for (let e = 0; e < 256; e++) {
    const s = Math.pow(clamp((e - 48) / 207, 0, 1), 0.6);
    const land = mix(shadow, light, s);
    const c = mix(water, land, clamp((e - 8) / 40, 0, 1));
    lut[e * 4] = c[0];
    lut[e * 4 + 1] = c[1];
    lut[e * 4 + 2] = c[2];
    lut[e * 4 + 3] = 255;
  }
  return lut;
}

/* --------------------------------------------------------------- the map */

export interface WorldMapOptions {
  canvas: HTMLCanvasElement;
  /** The focusable element that takes pointer and keyboard input. */
  surface: HTMLElement;
  /** A tap or click that wasn't a drag. */
  onTap?: (at: LonLat) => void;
  /** Where + and - zoom toward from the keyboard (the pin), if anywhere. */
  focusPoint?: () => LonLat | null;
  drawOverlay?: (ctx: CanvasRenderingContext2D, map: WorldMap) => void;
  /** After every change of zoom or centre. */
  onView?: (map: WorldMap) => void;
  /** A plain scroll over the map, which scrolls the page rather than zooming. */
  onWheelHint?: () => void;
}

export interface WorldMap {
  readonly width: number;
  readonly height: number;
  readonly view: View;
  /** Pixels across the whole world at the current zoom. */
  readonly worldWidth: number;
  readonly palette: Palette;
  project(lon: number, lat: number): Point;
  unproject(x: number, y: number): LonLat;
  redraw(): void;
  zoomBy(factor: number, at?: Point): void;
  /** Slide the view by a number of CSS pixels. */
  panBy(dx: number, dy: number): void;
  reset(animate?: boolean): Promise<void>;
  fit(box: Box, options?: { animate?: boolean; ms?: number }): Promise<void>;
  /** Pan just enough to bring a point into view. */
  show(at: LonLat): void;
  /** Kilometres per pixel across, at the latitude in the middle of the view. */
  kmPerPx(): number;
}

interface Tile {
  state: "loading" | "ready" | "failed";
  gray?: Uint8Array;
  w: number;
  h: number;
  painted?: HTMLCanvasElement;
  paintedFor?: string;
  used: number;
}

const TAP_SLOP = { mouse: 5, touch: 10 };
const DOUBLE_TAP_MS = 320;
/** Each decoded tile holds about 320 KB (grey plus a painted copy). */
const MAX_TILES = 100;

export function createWorldMap(options: WorldMapOptions): WorldMap | null {
  const { canvas, surface } = options;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let view: View = { k: 1, cu: 0.5, cv: 0.5 };
  let frame = 0;
  let tick = 0;
  let palette = readPalette();
  const tiles = new Map<string, Tile>();
  const widths = RELIEF.levels.map((l) => l.w);
  const borders = createBorders(() => redraw());

  let scratch: CanvasRenderingContext2D | null = null;

  function readPalette(): Palette {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) =>
      css.getPropertyValue(name).trim() || fallback;
    const paper = v("--paper", "#fbfaf8");
    const ink = v("--ink", "#16150f");
    const sea = v("--stack-1", "#d8d2c4");
    const tones = mapTones(paper, ink, sea);
    return {
      key: `${paper}|${ink}|${sea}`,
      ink,
      ink2: v("--ink-2", "#706c63"),
      paper,
      water: hexOf(tones.water),
      land: hexOf(mix(tones.shadow, tones.light, 0.75)),
      grid: v("--globe-grid", "#eeebe3"),
      coast: v("--globe-coast", "#bab4a6"),
      lut: buildLut(paper, ink, sea),
      dark:
        lum(parseColour(paper, [251, 250, 248])) <
        lum(parseColour(ink, [22, 21, 15])),
    };
  }

  const project = (lon: number, lat: number): Point => ({
    x: ((lon + 180) / 360 - view.cu) * width * view.k + width / 2,
    y: ((90 - lat) / 180 - view.cv) * height * view.k + height / 2,
  });
  const unproject = (x: number, y: number): LonLat => ({
    lon: ((x - width / 2) / (width * view.k) + view.cu) * 360 - 180,
    lat: 90 - ((y - height / 2) / (height * view.k) + view.cv) * 180,
  });

  /* ------------------------------------------------------------ tiles */

  function loadTile(level: number, x: number, y: number): Tile {
    const key = `${level}/${x}-${y}`;
    const known = tiles.get(key);
    if (known) {
      known.used = tick;
      return known;
    }
    const tile: Tile = { state: "loading", w: 0, h: 0, used: tick };
    tiles.set(key, tile);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!scratch) {
          scratch = document
            .createElement("canvas")
            .getContext("2d", { willReadFrequently: true });
        }
        if (!scratch) throw new Error("no canvas");
        scratch.canvas.width = w;
        scratch.canvas.height = h;
        scratch.drawImage(img, 0, 0);
        const rgba = scratch.getImageData(0, 0, w, h).data;
        const gray = new Uint8Array(w * h);
        for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4];
        tile.gray = gray;
        tile.w = w;
        tile.h = h;
        tile.state = "ready";
        redraw();
      } catch {
        tile.state = "failed";
      }
    };
    img.onerror = () => {
      tile.state = "failed";
    };
    img.src = `${RELIEF.path}/${level}/${x}-${y}.webp`;
    return tile;
  }

  /** The tile in this palette, recoloured only when the theme changes. */
  function paint(tile: Tile): HTMLCanvasElement | null {
    if (tile.state !== "ready" || !tile.gray) return null;
    if (tile.painted && tile.paintedFor === palette.key) return tile.painted;
    const out = tile.painted ?? document.createElement("canvas");
    out.width = tile.w;
    out.height = tile.h;
    const octx = out.getContext("2d");
    if (!octx) return null;
    const img = octx.createImageData(tile.w, tile.h);
    const lut = palette.lut;
    const gray = tile.gray;
    const data = img.data;
    for (let i = 0; i < gray.length; i++) {
      const o = gray[i] * 4;
      const j = i * 4;
      data[j] = lut[o];
      data[j + 1] = lut[o + 1];
      data[j + 2] = lut[o + 2];
      data[j + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    tile.painted = out;
    tile.paintedFor = palette.key;
    return out;
  }

  /** Draw one level's tiles that are ready; ask for missing ones if `fetch`. */
  function drawLevel(level: number, fetch: boolean): boolean {
    const lv = RELIEF.levels[level];
    const T = RELIEF.tile;
    const half = 0.5 / view.k;
    const tx0 = Math.max(0, Math.floor(((view.cu - half) * lv.w) / T));
    const tx1 = Math.min(
      lv.cols - 1,
      Math.floor(((view.cu + half) * lv.w) / T),
    );
    const ty0 = Math.max(0, Math.floor(((view.cv - half) * lv.h) / T));
    const ty1 = Math.min(
      lv.rows - 1,
      Math.floor(((view.cv + half) * lv.h) / T),
    );
    let complete = true;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        // Snap edges to device pixels, overlapping by a hair, so no seams.
        const tw = Math.min(T, lv.w - tx * T);
        const th = Math.min(T, lv.h - ty * T);
        const x0 = ((tx * T) / lv.w - view.cu) * width * view.k + width / 2;
        const y0 = ((ty * T) / lv.h - view.cv) * height * view.k + height / 2;
        const x1 = x0 + (tw / lv.w) * width * view.k;
        const y1 = y0 + (th / lv.h) * height * view.k;
        const sx0 = Math.floor(x0 * dpr) / dpr;
        const sy0 = Math.floor(y0 * dpr) / dpr;
        const sx1 = Math.ceil(x1 * dpr) / dpr;
        const sy1 = Math.ceil(y1 * dpr) / dpr;

        if (lv.land[ty * lv.cols + tx] !== "1") {
          // Open water at this level. Painting it keeps a coarser level's
          // softer coastline from showing through.
          if (level > 0) {
            ctx!.fillStyle = palette.water;
            ctx!.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
          }
          continue;
        }
        const key = `${level}/${tx}-${ty}`;
        const tile = fetch ? loadTile(level, tx, ty) : tiles.get(key);
        const img = tile ? paint(tile) : null;
        if (!tile || !img) {
          complete = false;
          continue;
        }
        tile.used = tick;
        ctx!.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0);
      }
    }
    return complete;
  }

  function evict(): void {
    if (tiles.size <= MAX_TILES) return;
    // Never what this frame drew or asked for: on a big view the cap gives way
    // rather than throwing out tiles that are on screen and fetching them
    // again on the next frame.
    const old = [...tiles.entries()]
      .filter(
        ([key, t]) =>
          t.state !== "loading" && t.used !== tick && !/^[01]\//.test(key),
      )
      .sort((a, b) => a[1].used - b[1].used);
    for (const [key] of old.slice(0, tiles.size - MAX_TILES)) tiles.delete(key);
  }

  /* ----------------------------------------------------------- drawing */

  function drawCoastFallback(): void {
    ctx!.fillStyle = palette.land;
    ctx!.strokeStyle = palette.coast;
    ctx!.lineWidth = 0.8;
    for (const ring of LAND) {
      ctx!.beginPath();
      ring.forEach(([lon, lat], i) => {
        const p = project(lon, lat);
        if (i === 0) ctx!.moveTo(p.x, p.y);
        else ctx!.lineTo(p.x, p.y);
      });
      ctx!.closePath();
      ctx!.fill();
      ctx!.stroke();
    }
  }

  function drawGraticule(): void {
    const pxPerDeg = (width * view.k) / 360;
    const step = graticuleStep(pxPerDeg);
    const west = unproject(0, 0).lon;
    const east = unproject(width, 0).lon;
    const north = unproject(0, 0).lat;
    const south = unproject(0, height).lat;
    ctx!.strokeStyle = palette.grid;
    ctx!.globalAlpha = 0.5;
    ctx!.lineWidth = 1;
    ctx!.beginPath();
    for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) {
      if (lon <= -180 || lon >= 180) continue;
      const x = Math.round(project(lon, 0).x) + 0.5;
      ctx!.moveTo(x, 0);
      ctx!.lineTo(x, height);
    }
    for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
      if (lat <= -90 || lat >= 90) continue;
      const y = Math.round(project(0, lat).y) + 0.5;
      ctx!.moveTo(0, y);
      ctx!.lineTo(width, y);
    }
    ctx!.stroke();
    ctx!.globalAlpha = 1;
  }

  function render(): void {
    frame = 0;
    if (!width || !height) return;
    tick++;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.imageSmoothingEnabled = true;
    ctx!.imageSmoothingQuality = "high";
    ctx!.fillStyle = palette.water;
    ctx!.fillRect(0, 0, width, height);

    const target = levelFor(width * view.k * dpr, widths);
    // The coarsest level loads first and sits under everything, so a zoom
    // never shows a blank; finer levels sharpen it as they arrive. The level
    // under the target loads too: a quarter as many tiles, so after a big
    // zoom it fills the view sooner.
    const base = drawLevel(0, true);
    if (!base) drawCoastFallback();
    for (let level = 1; level <= target; level++) {
      drawLevel(level, level >= target - 1);
    }
    drawGraticule();
    borders.draw(
      ctx!,
      { width, height, k: view.k, cu: view.cu, cv: view.cv },
      { ink: palette.ink, dark: palette.dark },
    );
    options.drawOverlay?.(ctx!, map);
    evict();
  }

  function redraw(): void {
    if (frame) return;
    frame = requestAnimationFrame(render);
  }

  /* ----------------------------------------------------------- the view */

  function setView(next: View): void {
    view = clampView(next);
    surface.classList.toggle("is-zoomed", view.k > 1.001);
    // One finger scrolls the page until there's something to pan.
    surface.style.touchAction = view.k > 1.001 ? "none" : "pan-y";
    redraw();
    options.onView?.(map);
  }

  let anim = 0;
  let settle: (() => void) | null = null;
  function stopAnimation(): void {
    if (anim) cancelAnimationFrame(anim);
    anim = 0;
    settle?.();
    settle = null;
  }

  /**
   * Glide to a view. The edges of the view move in straight lines, which keeps
   * anything on screen at both ends on screen the whole way.
   */
  function animateTo(to: View, ms: number): Promise<void> {
    stopAnimation();
    const target = clampView(to);
    if (ms <= 0 || prefersReducedMotion()) {
      setView(target);
      return Promise.resolve();
    }
    const from = { ...view };
    const start = performance.now();
    return new Promise((resolve) => {
      settle = resolve;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const span = 1 / from.k + (1 / target.k - 1 / from.k) * e;
        setView({
          k: 1 / span,
          cu: from.cu + (target.cu - from.cu) * e,
          cv: from.cv + (target.cv - from.cv) * e,
        });
        if (t < 1) {
          anim = requestAnimationFrame(step);
        } else {
          anim = 0;
          settle = null;
          resolve();
        }
      };
      anim = requestAnimationFrame(step);
    });
  }

  function zoomAt(k: number, at: Point): void {
    const u = (at.x - width / 2) / (width * view.k) + view.cu;
    const v = (at.y - height / 2) / (height * view.k) + view.cv;
    const next = clamp(k, 1, MAX_ZOOM);
    setView({
      k: next,
      cu: u - (at.x - width / 2) / (width * next),
      cv: v - (at.y - height / 2) / (height * next),
    });
  }

  function zoomBy(factor: number, at?: Point): void {
    const p = at ?? { x: width / 2, y: height / 2 };
    const u = (p.x - width / 2) / (width * view.k) + view.cu;
    const v = (p.y - height / 2) / (height * view.k) + view.cv;
    const k = clamp(view.k * factor, 1, MAX_ZOOM);
    void animateTo(
      {
        k,
        cu: u - (p.x - width / 2) / (width * k),
        cv: v - (p.y - height / 2) / (height * k),
      },
      260,
    );
  }

  /* ------------------------------------------------------------- input */

  const pointers = new Map<number, Point>();
  let down: (Point & { t: number }) | null = null;
  let moved = false;
  let pinch: { d: number; mid: Point } | null = null;
  let lastTap: (Point & { t: number }) | null = null;
  let lastMouseMove = 0;

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinchOf = () => {
    const [a, b] = [...pointers.values()];
    return {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  surface.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stopAnimation();
    const p = local(e);
    pointers.set(e.pointerId, p);
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    if (pointers.size === 1) {
      down = { ...p, t: performance.now() };
      moved = false;
    } else if (pointers.size === 2) {
      pinch = pinchOf();
      moved = true;
    }
  });

  surface.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") lastMouseMove = performance.now();
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.set(e.pointerId, p);

    if (pointers.size >= 2 && pinch) {
      const now = pinchOf();
      if (pinch.d > 0) {
        zoomAt(view.k * (now.d / pinch.d), now.mid);
        // Two fingers also pan, by however far their midpoint moved.
        const du = (now.mid.x - pinch.mid.x) / (width * view.k);
        const dv = (now.mid.y - pinch.mid.y) / (height * view.k);
        setView({ ...view, cu: view.cu - du, cv: view.cv - dv });
      }
      pinch = now;
      return;
    }

    if (!down) return;
    const slop = e.pointerType === "mouse" ? TAP_SLOP.mouse : TAP_SLOP.touch;
    if (!moved && Math.hypot(p.x - down.x, p.y - down.y) > slop) moved = true;
    if (moved && view.k > 1.001) {
      surface.classList.add("is-panning");
      setView({
        ...view,
        cu: view.cu - (p.x - prev.x) / (width * view.k),
        cv: view.cv - (p.y - prev.y) / (height * view.k),
      });
    }
  });

  function release(e: PointerEvent, tapped: boolean): void {
    const size = pointers.size;
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    surface.classList.remove("is-panning");

    if (tapped && size === 1 && p && down && !moved) {
      const now = performance.now();
      if (now - down.t < 600) {
        options.onTap?.(unproject(p.x, p.y));
        const twice =
          lastTap &&
          now - lastTap.t < DOUBLE_TAP_MS &&
          Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 24;
        if (twice) {
          lastTap = null;
          zoomBy(2, p);
        } else {
          lastTap = { ...p, t: now };
        }
      }
    }
    if (pointers.size === 1) {
      // One finger left after a pinch carries on panning, never taps.
      const rest = [...pointers.values()][0];
      down = { ...rest, t: performance.now() };
      moved = true;
    } else if (pointers.size === 0) {
      down = null;
    }
  }
  surface.addEventListener("pointerup", (e) => release(e, true));
  surface.addEventListener("pointercancel", (e) => release(e, false));

  surface.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) {
        // Only when the mouse was just moved onto the map. A page scroll with
        // the mouse resting still slides the map under it, and that's not
        // somebody trying to zoom.
        if (performance.now() - lastMouseMove < 1500) options.onWheelHint?.();
        return;
      }
      e.preventDefault();
      stopAnimation();
      const scale = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0025;
      zoomAt(view.k * Math.exp(-e.deltaY * scale), local(e));
    },
    { passive: false },
  );

  // Safari's trackpad pinch arrives as gesture events rather than Ctrl +
  // wheel. iOS sends them for two-finger touches too, which the pointer
  // pinch above already handles, so they're ignored while fingers are down.
  let gestureStart = 1;
  surface.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    if (pointers.size) return;
    stopAnimation();
    gestureStart = view.k;
  });
  surface.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    if (pointers.size) return;
    const g = e as unknown as {
      scale: number;
      clientX?: number;
      clientY?: number;
    };
    const at =
      typeof g.clientX === "number" && typeof g.clientY === "number"
        ? local({ clientX: g.clientX, clientY: g.clientY })
        : { x: width / 2, y: height / 2 };
    zoomAt(gestureStart * g.scale, at);
  });

  surface.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const focus = options.focusPoint?.();
    const at = focus ? project(focus.lon, focus.lat) : undefined;
    if (e.key === "+" || e.key === "=") zoomBy(2, at);
    else if (e.key === "-" || e.key === "_") zoomBy(0.5, at);
    else if (e.key === "0") void animateTo({ k: 1, cu: 0.5, cv: 0.5 }, 320);
    else return;
    e.preventDefault();
  });

  /* ------------------------------------------------------------- sizing */

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    setView(view);
    render();
  }

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(surface);
  } else {
    window.addEventListener("resize", resize);
  }

  // Follow the theme toggle: recolour the tiles from their grey.
  new MutationObserver(() => {
    const next = readPalette();
    if (next.key === palette.key) return;
    palette = next;
    redraw();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  const map: WorldMap = {
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get view() {
      return view;
    },
    get worldWidth() {
      return width * view.k;
    },
    get palette() {
      return palette;
    },
    project,
    unproject,
    redraw,
    zoomBy,
    panBy(dx, dy) {
      stopAnimation();
      setView({
        ...view,
        cu: view.cu + dx / (width * view.k),
        cv: view.cv + dy / (height * view.k),
      });
    },
    reset: (animate = true) =>
      animateTo({ k: 1, cu: 0.5, cv: 0.5 }, animate ? 420 : 0),
    fit: (box, { animate = true, ms = 650 } = {}) =>
      animateTo(answerView(box, width || 600, height || 300), animate ? ms : 0),
    show(at) {
      const p = project(at.lon, at.lat);
      const margin = 24;
      const dx =
        p.x < margin
          ? p.x - margin
          : p.x > width - margin
            ? p.x - (width - margin)
            : 0;
      const dy =
        p.y < margin
          ? p.y - margin
          : p.y > height - margin
            ? p.y - (height - margin)
            : 0;
      if (!dx && !dy) return;
      setView({
        ...view,
        cu: view.cu + dx / (width * view.k),
        cv: view.cv + dy / (height * view.k),
      });
    },
    kmPerPx() {
      const lat = unproject(width / 2, height / 2).lat;
      return (40075 * Math.cos((lat * Math.PI) / 180)) / (width * view.k);
    },
  };

  resize();
  return map;
}
