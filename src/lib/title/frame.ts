/**
 * Where the tarn photo sits on screen for the title screen at `/`.
 *
 * The photo is DSC06033 from Cascades, Washington (photo 4 of 8): Truman on a
 * ridge above a still tarn, under a sharp peak. A local script kept with the
 * mocks (scripts-local/prep-welcome-r4.py) cut it into layers that move by
 * their own depth, and wrote tarn.json: the
 * summit, his box and nearness, the layers' sizes and the land's outline on
 * the rows near the top (`spans`), so the name can be fitted to the summit
 * before any layer decodes.
 *
 * Three frames: `land` is the whole photo, `tall` a crop around the summit for
 * phones, and `wide` the whole photo with its own edges carried on softly
 * beside it, for windows too wide for the photo to cover.
 */
import tarn from "./tarn.json";

export type Kind = "land" | "wide" | "tall";
export type Run = [number, number];
export type Box = [number, number, number, number];

export interface Frame {
  /** The crop of the photo, as fractions: x0, y0, x1, y1. */
  box: Box;
  aspect: number;
  /** The widths each layer was saved at. */
  sizes: number[];
}

export interface Geo {
  vw: number;
  vh: number;
  kind: Kind;
  fr: Frame;
  /** The most a frame may zoom in and still show the mountains' foot. */
  zMax: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The summit on screen. */
  apex: { x: number; y: number };
}

/** What the page asks for: where the frame's top-left goes, and a zoom. */
export interface Want {
  x: number;
  y: number;
  zoom?: number;
}

export const DIR: string = tarn.dir;
export const PHOTO = { w: tarn.photo[0], h: tarn.photo[1] };
export const APEX = { x: tarn.apex[0], y: tarn.apex[1] };
export const HIM = tarn.him as Box;
export const FRONT_TO: number = tarn.frontTo;
export const SIZES = tarn.sizes as unknown as Record<
  Kind,
  Record<string, [number, number]>
>;

/**
 * How near each layer is (0 the sky, 1 the shore). The land's depth map is
 * remapped so its farthest part is `near0` near and the name sits just in
 * front of the sky, so the summit slides across the gap in the name as you
 * move. A layer at nearness n moves (1 - n) as far as the sky. `near` is the
 * trees the eagle flies behind.
 */
export const NEAR = { sky: 0, name: 0.12, him: tarn.himNear, near: 0.48 };

/**
 * How much of the photo a window shows. Its top is never lower than TOP_MIN
 * (sky above the name), and its bottom reaches SHOW_TO (his reflection's head)
 * where it can. A wider window gives up sky first, its top coming down as far
 * as TOP_WIDE, and then the reflection, up to SHOW_MIN (just past the shore),
 * before the photo stops covering its width: a 21:9 monitor with the browser
 * open (3440 x 1230) still covers, a 32:9 one doesn't, and there the photo's
 * own edges carry on beside it (WIDE). TOP_AT is where a window's top sits
 * when there's room.
 */
export const TOP_AT = 0.1;
export const TOP_MIN = 0.135;
export const TOP_WIDE = 0.18;
export const SHOW_TO = 0.835;
export const SHOW_MIN = 0.7;
export const WIDE = { ext: 0.3, feather: 0.12 };
export const TALL_MQ = "(max-aspect-ratio: 4/5)";

const TALL_BOX = tarn.tall as Box;
export const FRAMES: Record<Kind, Frame> = {
  land: { box: [0, 0, 1, 1], aspect: 1.5, sizes: [1280, 1920, 2560, 3840] },
  wide: { box: [0, 0, 1, 1], aspect: 1.5, sizes: [1280, 1920, 2560, 3840] },
  tall: {
    box: TALL_BOX,
    aspect: ((TALL_BOX[2] - TALL_BOX[0]) * PHOTO.w) / PHOTO.h,
    sizes: [720, 1080, 1400, 1800],
  },
};

const SPANS = tarn.spans as unknown as [number, ...Run[]][];

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** A photo fraction folded back inside 0..1, the way the wide edges mirror it. */
export function mirror(u: number): number {
  if (u < 0) u = -u;
  if (u >= 1) u = 2 - u;
  return clamp(u, 0, 0.9999);
}

/** The land's runs on a row of the photo (fractions), from tarn.json. */
export function armSpans(fy: number): Run[] {
  let row = SPANS[0];
  for (const r of SPANS) {
    if (r[0] >= fy) {
      row = r;
      break;
    }
  }
  return row.slice(1) as Run[];
}

/** The first size in the list at least `need` wide, or the largest. */
export function pickSize(list: number[], need: number): number {
  for (const size of list) if (size >= need) return size;
  return list[list.length - 1];
}

/** A photo point (fractions) on screen. */
export function pt(g: Geo, fx: number, fy: number): { x: number; y: number } {
  const b = g.fr.box;
  return {
    x: g.x + ((fx - b[0]) / (b[2] - b[0])) * g.w,
    y: g.y + ((fy - b[1]) / (b[3] - b[1])) * g.h,
  };
}

/** A screen x or y as a photo fraction. */
export function fxOf(g: Geo, x: number): number {
  const b = g.fr.box;
  return b[0] + ((x - g.x) / g.w) * (b[2] - b[0]);
}
export function fyOf(g: Geo, y: number): number {
  const b = g.fr.box;
  return b[1] + ((y - g.y) / g.h) * (b[3] - b[1]);
}

/** Where the moving layers' image sits: the photo, plus its wide edges. */
export function boxOf(g: Geo): { x: number; w: number } {
  if (g.kind !== "wide") return { x: g.x, w: g.w };
  return { x: g.x - WIDE.ext * g.w, w: g.w * (1 + 2 * WIDE.ext) };
}

/** How far the farthest layer may move, in CSS px. */
export function ampOf(vw: number, vh: number): number {
  return Math.round(clamp(Math.min(vw, vh * 1.6) * 0.0125, 13, 20));
}

/**
 * The photo's place for a window: covering it with room to move (A on each
 * side, 0.6 A above and below), never zoomed past where the mountains' foot
 * shows, and on a window too wide even for that, the wide frame centred with
 * its edges carried on. `frame` is the page's own framing (the name and the
 * summit); this keeps whatever it asks for inside those limits.
 */
export function layoutFrame(
  vw: number,
  vh: number,
  tall: boolean,
  A: number,
  frame: (g: Geo, w0: number, h0: number) => Want,
): Geo {
  let kind: Kind = tall ? "tall" : "land";
  const g: Geo = {
    vw,
    vh,
    kind,
    fr: FRAMES[kind],
    zMax: 1.6,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    apex: { x: 0, y: 0 },
  };
  const minW = vw + 2 * A;
  const minH = vh + 1.2 * A;
  let w0 = Math.max(minW, minH * g.fr.aspect);
  if (kind !== "tall") {
    // The widest the photo may be and still show TOP_MIN to SHOW_TO: past it
    // nothing zooms in, and if even covering the window is wider than that
    // allows, the photo stops covering the width and its edges carry on.
    const wTo = (1.5 * vh) / (SHOW_TO - TOP_MIN);
    const wMin = (1.5 * vh) / (SHOW_MIN - TOP_WIDE);
    if (w0 > wMin) {
      kind = g.kind = "wide";
      g.fr = FRAMES.wide;
      w0 = Math.max(wMin, minW / (1 + 2 * WIDE.ext), minH * 1.5);
      g.zMax = 1;
    } else g.zMax = Math.max(1, wTo / w0);
  }
  const want = frame(g, w0, w0 / g.fr.aspect);
  const zoom = Math.min(want.zoom ?? 1, g.zMax);
  const w = w0 * zoom;
  const h = w / g.fr.aspect;
  let x = want.x;
  let y = want.y;
  if (kind === "wide") {
    const ew = WIDE.ext * w;
    x = clamp(x, vw + A - w - ew, ew - A);
  } else x = clamp(x, vw - w + A, -A);
  // From no lower than TOP_MIN, down to SHOW_TO where the window allows;
  // then covered, with room to move, which always wins. A wide window's top
  // comes down past TOP_MIN, as far as TOP_WIDE, only as far as its bottom
  // needs to reach SHOW_MIN.
  if (kind !== "tall") {
    const top = clamp(SHOW_MIN - vh / h, TOP_MIN, TOP_WIDE);
    y = clamp(y, -top * h, Math.max(-top * h, vh - SHOW_TO * h));
  }
  g.x = x;
  g.y = clamp(y, vh - h + 0.6 * A, -0.6 * A);
  g.w = w;
  g.h = h;
  g.apex = pt(g, APEX.x, APEX.y);
  return g;
}
