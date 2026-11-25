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
 * says how to zoom instead of trapping it, unless `wheelZoom` says there's no
 * page to scroll. On touch, one finger scrolls the page at world view
 * (touch-action: pan-y) and pans once you're zoomed in (touch-action: none),
 * the same deal as the herp map.
 *
 * Country and state borders are vector lines from ./day-list-borders, drawn
 * over the terrain at whatever detail the zoom needs.
 *
 * The game draws on top through `drawOverlay`. A game with a look of its own
 * can give the map its own colours (`colours`), draw it coarser for pixel art
 * (`pixelScale`), and keep the world its own shape on a very wide canvas
 * (`maxAspect`), where the sea runs on past the world's edges.
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
/** The colours the map draws in, for one theme. */
export interface MapColours {
  /** Relief tile grey (0-255) to RGBA, 256 entries of four, as buildLut makes. */
  lut: Uint8ClampedArray;
  /** Open water, exactly the colour the lut gives grey 0. */
  water: string;
  /** Land for the coarse coastline drawn before the tiles arrive. */
  land: string;
  /** Country and state borders. */
  ink: string;
  grid: string;
  coast: string;
}

export interface Palette extends MapColours {
  key: string;
  ink2: string;
  paper: string;
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

/**
 * The world's width in CSS pixels at zoom 1 on a `width` by `height` canvas.
 * It fills the canvas, stretched a little if it must, unless the canvas is
 * wider than `maxAspect` to 1: then the world keeps that shape, centred, and
 * the sea runs on either side of it.
 */
export function worldBase(
  width: number,
  height: number,
  maxAspect = Infinity,
): number {
  return Math.min(width, maxAspect * height);
}

/**
 * Keep zoom in range and the view inside the world. `across` is the canvas's
 * width over the world's at zoom 1 (worldBase); while the world is narrower
 * than the canvas it stays in the middle.
 */
export function clampView(view: View, maxZoom = MAX_ZOOM, across = 1): View {
  const k = clamp(view.k, 1, maxZoom);
  const halfU = (0.5 * across) / k;
  const halfV = 0.5 / k;
  return {
    k,
    cu: halfU >= 0.5 ? 0.5 : clamp(view.cu, halfU, 1 - halfU),
    cv: clamp(view.cv, halfV, 1 - halfV),
  };
}

/**
 * Where a point lands on a `width` by `height` map showing `view`, with the
 * world `worldW` pixels across at zoom 1 (the whole width unless worldBase
 * says otherwise).
 */
export function projectAt(
  view: View,
  width: number,
  height: number,
  lon: number,
  lat: number,
  worldW = width,
): Point {
  return {
    x: ((lon + 180) / 360 - view.cu) * worldW * view.k + width / 2,
    y: ((90 - lat) / 180 - view.cv) * height * view.k + height / 2,
  };
}

/** CSS pixels to keep clear on a side, on top of the padding. */
export interface Inset {
  top?: number;
  right?: number;
  bottom?: number;
}

/**
 * The view that shows `box` with `pad` CSS pixels to spare on every side, and
 * `inset` more where something sits over the map (the buttons on the right,
 * the panels along the top and the bottom), no closer than `maxZoom`.
 * `worldW` is the world's width at zoom 1, as for projectAt.
 */
export function fitView(
  box: Box,
  width: number,
  height: number,
  pad: number,
  maxZoom = FIT_MAX_ZOOM,
  inset: Inset = {},
  worldW = width,
): View {
  const { top = 0, right = 0, bottom = 0 } = inset;
  const u0 = (box.w + 180) / 360;
  const u1 = (box.e + 180) / 360;
  const v0 = (90 - box.n) / 180;
  const v1 = (90 - box.s) / 180;
  const roomX = Math.max(0.1, 1 - (2 * pad + right) / width);
  const roomY = Math.max(0.1, 1 - (2 * pad + top + bottom) / height);
  // 1 / zoom: the share of the world's height the view shows, and of its
  // width when the world fills the canvas.
  const span = Math.max(
    ((u1 - u0) * worldW) / (roomX * width),
    (v1 - v0) / roomY,
    1 / maxZoom,
  );
  // Shift the centre by half of each inset, so the box sits in the room
  // that's left of the buttons and clear of the panels.
  const shiftU = (right / 2 / worldW) * span;
  const shiftV = ((top - bottom) / 2 / height) * span;
  return clampView(
    { k: 1 / span, cu: (u0 + u1) / 2 + shiftU, cv: (v0 + v1) / 2 - shiftV },
    maxZoom,
    width / worldW,
  );
}

/** The padding the reveal leaves round the pin and the place. */
export const answerPad = (width: number): number => (width < 480 ? 28 : 44);

/**
 * How the reveal frames the answer: room on every side, plus the width of the
 * zoom buttons on the right so the place never lands under them, plus any
 * `room` asked for, such as the panels over the map.
 */
export function answerView(
  box: Box,
  width: number,
  height: number,
  room: Inset = {},
  worldW = width,
): View {
  return fitView(
    box,
    width,
    height,
    answerPad(width),
    FIT_MAX_ZOOM,
    { right: 40, ...room },
    worldW,
  );
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
  /** A plain scroll zooms too, for a map that fills a page with no scroll. */
  wheelZoom?: boolean;
  /**
   * The map's colours in the dark theme or the light one, in place of the
   * page's tokens. Asked again whenever the theme changes.
   */
  colours?: (dark: boolean) => MapColours;
  /**
   * Canvas pixels per CSS pixel, asked on every resize. Under 1 draws a
   * coarser map to show with `image-rendering: pixelated` (a quarter makes
   * each map pixel 4 CSS pixels). Left out, it's the screen's own, up to 2.
   */
  pixelScale?: () => number;
  /** The widest the world is drawn, width over height (see worldBase). */
  maxAspect?: number;
  /**
   * How much of the canvas's width is on screen, centred, when the canvas
   * runs past both sides of the screen. The view keeps that part inside the
   * world rather than the whole canvas, and `fit` frames a box in it.
   */
  shownWidth?: () => number;
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
  /** Frame `box` the way the reveal does (answerView), `room` kept clear. */
  fit(
    box: Box,
    options?: { animate?: boolean; ms?: number; room?: Inset },
  ): Promise<void>;
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
  // The world's width at zoom 1 (worldBase): all of `width` unless the canvas
  // is wider than options.maxAspect allows.
  let baseW = 0;
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
    const root = document.documentElement;
    const css = getComputedStyle(root);
    const v = (name: string, fallback: string) =>
      css.getPropertyValue(name).trim() || fallback;
    const paper = v("--paper", "#fbfaf8");
    const ink = v("--ink", "#16150f");
    const ink2 = v("--ink-2", "#706c63");
    if (options.colours) {
      const dark = root.classList.contains("dark");
      return {
        ...options.colours(dark),
        key: `own|${dark}`,
        ink2,
        paper,
        dark,
      };
    }
    const sea = v("--stack-1", "#d8d2c4");
    const tones = mapTones(paper, ink, sea);
    return {
      key: `${paper}|${ink}|${sea}`,
      ink,
      ink2,
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

  /** The part of the canvas on screen, CSS px across (options.shownWidth). */
  const shown = () =>
    Math.min(width, Math.max(1, options.shownWidth?.() ?? width));
  /** The shown width over the world's, for clampView. */
  const across = () => (baseW ? shown() / baseW : 1);
  const clampHere = (next: View) => clampView(next, MAX_ZOOM, across());

  const project = (lon: number, lat: number): Point =>
    projectAt(view, width, height, lon, lat, baseW);
  const unproject = (x: number, y: number): LonLat => ({
    lon: ((x - width / 2) / (baseW * view.k) + view.cu) * 360 - 180,
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
    const worldW = baseW * view.k;
    const halfU = width / 2 / worldW;
    const halfV = 0.5 / view.k;
    const tx0 = Math.max(0, Math.floor(((view.cu - halfU) * lv.w) / T));
    const tx1 = Math.min(
      lv.cols - 1,
      Math.floor(((view.cu + halfU) * lv.w) / T),
    );
    const ty0 = Math.max(0, Math.floor(((view.cv - halfV) * lv.h) / T));
    const ty1 = Math.min(
      lv.rows - 1,
      Math.floor(((view.cv + halfV) * lv.h) / T),
    );
    let complete = true;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        // Snap edges to device pixels, overlapping by a hair, so no seams.
        const tw = Math.min(T, lv.w - tx * T);
        const th = Math.min(T, lv.h - ty * T);
        const x0 = ((tx * T) / lv.w - view.cu) * worldW + width / 2;
        const y0 = ((ty * T) / lv.h - view.cv) * height * view.k + height / 2;
        const x1 = x0 + (tw / lv.w) * worldW;
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
    const pxPerDeg = (baseW * view.k) / 360;
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

    const target = levelFor(baseW * view.k * dpr, widths);
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
      {
        width,
        height,
        k: view.k,
        cu: view.cu,
        cv: view.cv,
        worldW: baseW * view.k,
      },
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
    view = clampHere(next);
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
    const target = clampHere(to);
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
    const u = (at.x - width / 2) / (baseW * view.k) + view.cu;
    const v = (at.y - height / 2) / (height * view.k) + view.cv;
    const next = clamp(k, 1, MAX_ZOOM);
    setView({
      k: next,
      cu: u - (at.x - width / 2) / (baseW * next),
      cv: v - (at.y - height / 2) / (height * next),
    });
  }

  function zoomBy(factor: number, at?: Point): void {
    const p = at ?? { x: width / 2, y: height / 2 };
    const u = (p.x - width / 2) / (baseW * view.k) + view.cu;
    const v = (p.y - height / 2) / (height * view.k) + view.cv;
    const k = clamp(view.k * factor, 1, MAX_ZOOM);
    void animateTo(
      {
        k,
        cu: u - (p.x - width / 2) / (baseW * k),
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
        const du = (now.mid.x - pinch.mid.x) / (baseW * view.k);
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
        cu: view.cu - (p.x - prev.x) / (baseW * view.k),
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
      if (!e.ctrlKey && !e.metaKey && !options.wheelZoom) {
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
    const scale = options.pixelScale?.() ?? window.devicePixelRatio;
    dpr = Math.min(scale || 1, 2);
    width = rect.width;
    height = rect.height;
    baseW = worldBase(width, height, options.maxAspect);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    setView(view);
    render();
  }

  if (typeof ResizeObserver !== "undefined") {
    const watch = new ResizeObserver(resize);
    watch.observe(surface);
    // The canvas can be sized apart from its surface (running past a phone's
    // edges, say), so it's watched too.
    if (canvas !== surface) watch.observe(canvas);
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
      return baseW * view.k;
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
        cu: view.cu + dx / (baseW * view.k),
        cv: view.cv + dy / (height * view.k),
      });
    },
    reset: (animate = true) =>
      animateTo({ k: 1, cu: 0.5, cv: 0.5 }, animate ? 420 : 0),
    fit: (box, { animate = true, ms = 650, room } = {}) =>
      animateTo(
        answerView(
          box,
          width ? shown() : 600,
          height || 300,
          room,
          baseW || width || 600,
        ),
        animate ? ms : 0,
      ),
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
        cu: view.cu + dx / (baseW * view.k),
        cv: view.cv + dy / (height * view.k),
      });
    },
    kmPerPx() {
      const lat = unproject(width / 2, height / 2).lat;
      return (40075 * Math.cos((lat * Math.PI) / 180)) / (baseW * view.k);
    },
  };

  resize();
  return map;
}
