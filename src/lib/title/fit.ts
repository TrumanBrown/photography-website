/**
 * Fitting "Truman Brown" to the summit. The name sits in the sky with the
 * summit rising into the gap between the words, the way his raised hands came
 * over the name in the mocks. It's set in Jersey 25, a pixel face whose
 * capitals are 25 font pixels tall in a 41-pixel em, so sizes step on that
 * grid to keep its edges sharp.
 */
import { APEX, armSpans, type Run } from "./frame";

/** Where each word's ink starts and ends in Jersey 25 at 100 px. */
export interface Metrics {
  trumanInkR: number;
  brownAt: number;
  brownInkL: number;
  brownInkR: number;
  all: number;
}

/** Read from the font itself (the page measures again once it loads). */
export const JERSEY_100: Metrics = {
  trumanInkR: 285.46,
  brownAt: 312.19,
  brownInkL: 4,
  brownInkR: 246.44,
  all: 560.98,
};

/** Extra room between the words, in em. */
export const WORD_GAP = 0.12;
/**
 * How far the summit's flanks may cover the bottom corners of the "n" and the
 * "B" beside the gap (em, at the baseline), without hiding either letter.
 */
export const BITE = 0.1;
/** The deepest the summit rises into the name, as a share of the capitals. */
export const POKE = 0.5;
/** Capital height and the baseline's depth below the line box's top, in em. */
export const CAPH = 0.61;
export const BASE = 0.8;
/** On a desktop the name spans this much of the photo's width. */
export const NAME_OF_PHOTO = 0.62;
/** Font pixels in one em of Jersey 25. */
export const EM = 41;

export interface Shape {
  /** Where "Truman"'s ink ends and "Brown"'s starts, in em. */
  gapL: number;
  gapR: number;
  gapC: number;
  /** The whole name's advance and where its ink ends, in em. */
  nameW: number;
  inkR: number;
}

export function shapeOf(m: Metrics): Shape {
  const gapL = m.trumanInkR / 100;
  const gapR = (m.brownAt + m.brownInkL) / 100 + WORD_GAP;
  return {
    gapL,
    gapR,
    gapC: (gapL + gapR) / 2,
    nameW: m.all / 100 + WORD_GAP,
    inkR: (m.brownAt + m.brownInkR) / 100 + WORD_GAP,
  };
}

/** The widest the summit may be at the baseline: the gap plus the bites. */
export function gapWidth(shape: Shape, size: number): number {
  return (shape.gapR - shape.gapL) * size + 2 * BITE * size;
}

/**
 * The summit as it rises into the gap: all the land on a row within `G` of
 * the apex counts as one run, so a spire on its flank is part of it. Going
 * down from the apex in `step`s, it stops where the land seen so far gets
 * wider than `G`, and returns how deep that is and the land's middle there.
 */
export function rise(
  rows: (y: number) => Run[],
  y0: number,
  step: number,
  dMax: number,
  G: number,
  ax: number,
): { d: number; cx: number } {
  let lo = Infinity;
  let hi = -Infinity;
  let d = 0;
  let cx = ax;
  for (let t = step; t <= dMax; t += step) {
    let l = Infinity;
    let h = -Infinity;
    for (const r of rows(y0 + t)) {
      if (r[1] < ax - G || r[0] > ax + G) continue;
      l = Math.min(l, r[0]);
      h = Math.max(h, r[1]);
    }
    if (!(l < h)) break;
    const nl = Math.min(lo, l);
    const nh = Math.max(hi, h);
    if (nh - nl > G) break;
    lo = nl;
    hi = nh;
    d = t;
    cx = (lo + hi) / 2;
  }
  return { d, cx };
}

/**
 * The name's size for a frame and how deep the summit can rise into its gap,
 * in photo fractions from tarn.json (fitName does it again on the real
 * outline once the front layer decodes). `fw` is the whole photo's width on
 * screen, `h0` its height.
 */
export function planName(
  shape: Shape,
  fw: number,
  h0: number,
  room: number,
  maxSize = Infinity,
): { size: number; poke: number; cx: number } {
  const size = Math.min(
    (NAME_OF_PHOTO * fw) / shape.nameW,
    room / shape.nameW,
    maxSize,
  );
  const r = rise(
    armSpans,
    APEX.y,
    1 / h0,
    (POKE * CAPH * size) / h0,
    gapWidth(shape, size) / fw,
    APEX.x,
  );
  return { size, poke: r.d * h0, cx: r.cx };
}

/** The nearest size on the font's grid (half a font pixel per device pixel). */
export function snap(px: number, dpr: number): number {
  const step = EM / 2;
  return (Math.max(1, Math.round((px * dpr) / step)) * step) / dpr;
}
export function snapFloor(px: number, dpr: number): number {
  const step = EM / 2;
  return (Math.max(1, Math.floor((px * dpr) / step)) * step) / dpr;
}
/** One font pixel, in CSS px on whole device pixels (for the outline). */
export function fontPixel(size: number, dpr: number): number {
  return Math.max(2, Math.round((size / EM) * dpr)) / dpr;
}

export interface Fit {
  size: number;
  /** The baseline and the name's left edge, on screen. */
  base: number;
  left: number;
  /** How deep the summit rises into the name, in px. */
  poke: number;
}

/**
 * The name on the real outline: as large as planned, on the font's grid, its
 * gap centred on the summit, and its baseline as deep below the apex as the
 * gap allows. If any other land (the trees at either side) would cross a
 * letter, or the name would leave the window, it steps down a size.
 */
export function fitName(
  shape: Shape,
  o: {
    spans: (y: number) => Run[];
    apex: { x: number; y: number };
    vw: number;
    dpr: number;
    size: number;
    room: number;
  },
): Fit {
  const step = EM / 2 / o.dpr;
  let s = o.size;
  let out: Fit = { size: s, base: o.apex.y, left: 0, poke: 0 };
  for (let tries = 0; tries < 12; tries++) {
    const r = rise(
      o.spans,
      o.apex.y,
      1,
      POKE * CAPH * s,
      gapWidth(shape, s),
      o.apex.x,
    );
    const base = o.apex.y + r.d;
    const left = r.cx - shape.gapC * s;
    out = { size: s, base, left, poke: r.d };
    // Anything else of the land inside the letters' box, outside the gap?
    const bite = BITE * s + 2;
    const x0 = left + 0.04 * s;
    const x1 = left + shape.inkR * s;
    const gl = left + shape.gapL * s - bite;
    const gr = left + shape.gapR * s + bite;
    let hit =
      left < 6 || left + shape.nameW * s > o.vw - 6 || shape.nameW * s > o.room;
    for (let y = base - CAPH * s; y <= base && !hit; y += 2) {
      for (const q of o.spans(y)) {
        if (q[1] <= x0 || q[0] >= x1) continue;
        if (q[0] >= gl && q[1] <= gr) continue;
        hit = true;
        break;
      }
    }
    if (!hit || s - step < step * 2) return out;
    s = snapFloor(s - step * 0.5, o.dpr);
  }
  return out;
}
