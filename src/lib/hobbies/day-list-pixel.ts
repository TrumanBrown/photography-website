/**
 * Narrow nature's pixel world: the map recoloured into a day palette or a
 * night one at a quarter of its resolution, and the game drawn into the same
 * pixels (rings of reach, the pin, tokens, the line and the finder box).
 *
 * The map (./day-list-map) draws its relief tiles as plain grey and borders
 * in pure blue, with no graticule (`ENCODED`), so one pass over the frame can
 * pull the two apart and paint each map pixel again: sea, a shallow edge
 * round every coast, a sand-coloured coastline, five steps of land from
 * lowland to snow, borders, and a dotted graticule over the sea, placed from
 * the map's own lines of longitude and latitude.
 *
 * Everything here works on a `Frame`, the canvas's own RGBA pixels, so it can
 * all happen between one getImageData and one putImageData (day-list.ts).
 */
import type { LonLat, MapColours } from "./day-list-map";
import { hexRgb, type RGB } from "./day-list-tints";

export interface PixelPalette {
  sea: RGB;
  dots: RGB;
  shallow: RGB;
  coast: RGB;
  /** Lowland to snow. */
  land: RGB[];
  border: RGB;
  borderHigh: RGB;
  /** The outline round everything drawn on the map. */
  ink: RGB;
  pin: RGB;
  pinHi: RGB;
  pinLo: RGB;
  /** What a pin's landing ring and the lens's cross are drawn in. */
  ring: RGB;
  line: RGB;
  box: RGB;
  bound: RGB;
}

export const PALETTES: { day: PixelPalette; night: PixelPalette } = {
  day: {
    sea: hexRgb("#3f7fcf"),
    dots: hexRgb("#5893dc"),
    shallow: hexRgb("#7fade2"),
    coast: hexRgb("#f2e4a6"),
    land: ["#2f6a3a", "#4c9a44", "#7cc350", "#cfd98a", "#f5f8fc"].map(hexRgb),
    border: hexRgb("#3a7f3c"),
    borderHigh: hexRgb("#9aa85c"),
    ink: hexRgb("#122a5b"),
    pin: hexRgb("#ffb000"),
    pinHi: hexRgb("#ffe08a"),
    pinLo: hexRgb("#c77f00"),
    ring: hexRgb("#f5f8fc"),
    line: hexRgb("#ffb000"),
    box: hexRgb("#e8412c"),
    bound: hexRgb("#f5f8fc"),
  },
  night: {
    sea: hexRgb("#10224a"),
    dots: hexRgb("#17305f"),
    shallow: hexRgb("#1f3d77"),
    coast: hexRgb("#3b5f95"),
    land: ["#0f2b25", "#174230", "#245b3d", "#4f7656", "#c3d1e6"].map(hexRgb),
    border: hexRgb("#0f3324"),
    borderHigh: hexRgb("#3c5f45"),
    ink: hexRgb("#050c1f"),
    pin: hexRgb("#ffb000"),
    pinHi: hexRgb("#ffe08a"),
    pinLo: hexRgb("#b06f00"),
    ring: hexRgb("#ffd35c"),
    line: hexRgb("#ffb000"),
    box: hexRgb("#ff5a40"),
    bound: hexRgb("#e9eff8"),
  },
};

/** The relief as plain grey: open water 0, land 48 to 255. */
const GREY = (() => {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let e = 0; e < 256; e++) {
    lut[e * 4] = lut[e * 4 + 1] = lut[e * 4 + 2] = e;
    lut[e * 4 + 3] = 255;
  }
  return lut;
})();

/**
 * What the map draws in for `recolour` to read back, the same in both
 * themes: the relief grey and borders in pure blue. The graticule is left
 * out: drawn faintly over snow it read as stray columns of a lower step, so
 * `recolour` puts it back over the sea alone.
 */
export const ENCODED: MapColours = {
  lut: GREY,
  water: "#000000",
  land: "#aaaaaa",
  ink: "#0000ff",
  grid: "rgba(0, 0, 0, 0)",
  coast: "#aaaaaa",
};

/** Below this grey a map pixel is sea. */
const LAND_AT = 52;
/** Where each land step starts, by grey. */
const STEPS = [128, 160, 192, 206];
const stepOf = (g: number) =>
  g < STEPS[0] ? 0 : g < STEPS[1] ? 1 : g < STEPS[2] ? 2 : g < STEPS[3] ? 3 : 4;

/** A map frame's pixels and the palette they're painted in. */
export interface Frame {
  d: Uint8ClampedArray;
  W: number;
  H: number;
  P: PixelPalette;
}

/** The frame's columns and rows a graticule line runs along (1 for a line). */
export interface Grid {
  cols: Uint8Array;
  rows: Uint8Array;
}

/**
 * Pull the map's frame apart and paint it in the palette, in place. Each map
 * pixel is sea or one of five land steps; a sea pixel touching land is the
 * shallow edge, a land pixel touching sea is coastline, a border over land
 * is drawn darker (or lighter on high ground), and the `grid` shows over the
 * sea as every other pixel. `classes` is scratch, reused between frames.
 *
 * `south` is where the world's southern edge falls, in frame rows. The tiles'
 * last row of Antarctica is smudged by the scaling, and read as land and sea
 * by turns it left a fringe of stray pixels along the bottom of the world,
 * so that row takes the row above's ground, and anything past the edge is
 * sea.
 */
export function recolour(
  f: Frame,
  classes: Uint8Array,
  south = Infinity,
  grid: Grid | null = null,
): void {
  const { d, W, H, P } = f;
  const n = W * H;
  const cls = classes;
  for (let i = 0; i < n; i++) {
    const G = d[i * 4 + 1];
    const B = d[i * 4 + 2];
    const ab = B > G ? (B - G) / 255 : 0;
    const g = G / Math.max(0.2, 1 - ab);
    let k = g < LAND_AT ? 0 : 1 + stepOf(g);
    if (ab > 0.045) k |= 8;
    cls[i] = k;
  }
  const last = Math.ceil(south) - 1;
  if (last < H && last > 0) {
    for (let y = Math.max(0, last); y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        cls[i] = y === last ? cls[i - W] & 7 : 0;
      }
    }
  }
  if (grid) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid.rows[y] || grid.cols[x]) cls[y * W + x] |= 16;
      }
    }
  }
  const put = (i: number, col: RGB) => {
    d[i * 4] = col[0];
    d[i * 4 + 1] = col[1];
    d[i * 4 + 2] = col[2];
    d[i * 4 + 3] = 255;
  };
  const isLand = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && (cls[y * W + x] & 7) > 0;
  const isSea = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && (cls[y * W + x] & 7) === 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = cls[i];
      const step = k & 7;
      if (!step) {
        if (
          isLand(x - 1, y) ||
          isLand(x + 1, y) ||
          isLand(x, y - 1) ||
          isLand(x, y + 1)
        ) {
          put(i, P.shallow);
        } else if (k & 16 && (x + y) % 2 === 0) put(i, P.dots);
        else put(i, P.sea);
      } else if (
        isSea(x - 1, y) ||
        isSea(x + 1, y) ||
        isSea(x, y - 1) ||
        isSea(x, y + 1)
      ) {
        put(i, step === 5 ? P.land[4] : P.coast);
      } else if (k & 8) {
        put(i, step >= 4 ? P.borderHigh : P.border);
      } else {
        put(i, P.land[step - 1]);
      }
    }
  }
}

/* --------------------------------------------------------- drawing pixels */

/** One whole pixel. Off the frame, nothing. */
export function px(f: Frame, x: number, y: number, col: RGB): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= f.W || y >= f.H) return;
  const i = (y * f.W + x) * 4;
  f.d[i] = col[0];
  f.d[i + 1] = col[1];
  f.d[i + 2] = col[2];
  f.d[i + 3] = 255;
}

/** Darken a pixel by `k`, for the pin's shadow. */
export function shade(f: Frame, x: number, y: number, k: number): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= f.W || y >= f.H) return;
  const i = (y * f.W + x) * 4;
  f.d[i] *= k;
  f.d[i + 1] *= k;
  f.d[i + 2] *= k;
}

/** Paint `pts` (pairs of whole pixels) in `col`, with an ink pixel round them. */
export function outlined(f: Frame, pts: [number, number][], col: RGB): void {
  const key = new Set<number>();
  for (const [x, y] of pts) key.add(y * 8192 + x);
  for (const [x, y] of pts) {
    for (const [dx, dy] of NEIGHBOURS) {
      if (!key.has((y + dy) * 8192 + x + dx)) px(f, x + dx, y + dy, f.P.ink);
    }
  }
  for (const [x, y] of pts) px(f, x, y, col);
}

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** A sprite: rows of characters, each a colour from `key`, "." clear. */
export function sprite(
  f: Frame,
  rows: string[],
  ax: number,
  ay: number,
  x: number,
  y: number,
  key: Record<string, RGB>,
): void {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let q = 0; q < row.length; q++) {
      const col = key[row[q]];
      if (col) px(f, x - ax + q, y - ay + r, col);
    }
  }
}

/** A circle `r` pixels round, every other pixel when `dotted`. */
export function circle(
  f: Frame,
  cx: number,
  cy: number,
  r: number,
  col: RGB,
  dotted = false,
): void {
  let x = r;
  let y = 0;
  let err = 1 - r;
  let n = 0;
  while (x >= y) {
    const pts = [
      [x, y],
      [y, x],
      [-y, x],
      [-x, y],
      [-x, -y],
      [-y, -x],
      [y, -x],
      [x, -y],
    ];
    for (const [a, b] of pts) {
      if (!dotted || n % 2 === 0) px(f, cx + a, cy + b, col);
    }
    n++;
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}

/** The whole pixels on a straight line between two, both ends included. */
export function line(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number][] {
  const pts: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 8000; guard++) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
}

const discs = new Map<number, boolean[][]>();
/** A disc `n` pixels across, as rows of inside-or-not. */
export function disc(n: number): boolean[][] {
  let m = discs.get(n);
  if (!m) {
    m = [];
    const c = (n - 1) / 2;
    const r2 = (n / 2) * (n / 2) - 0.35 * n * 0.25;
    for (let y = 0; y < n; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < n; x++) {
        row.push((x - c) * (x - c) + (y - c) * (y - c) <= r2);
      }
      m.push(row);
    }
    discs.set(n, m);
  }
  return m;
}

/**
 * A photo as a round token: `pix` (`tok` pixels square) inside a disc of the
 * ring's colour `col`, with an ink pixel round it, `grow` pixels bigger as
 * it lands.
 */
export function drawToken(
  f: Frame,
  cx: number,
  cy: number,
  tok: number,
  col: RGB,
  pix: Uint8ClampedArray | null,
  grow = 0,
): void {
  const n = tok + 2 + grow * 2;
  const outer = disc(n);
  const inner = disc(tok);
  const x0 = Math.round(cx) - (n - 1) / 2;
  const y0 = Math.round(cy) - (n - 1) / 2;
  const ins = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < n && y < n && outer[y][x];
  for (let y = -1; y <= n; y++) {
    for (let x = -1; x <= n; x++) {
      if (ins(x, y)) continue;
      if (ins(x - 1, y) || ins(x + 1, y) || ins(x, y - 1) || ins(x, y + 1)) {
        px(f, x0 + x, y0 + y, f.P.ink);
      }
    }
  }
  const off = 1 + grow;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!outer[y][x]) continue;
      const ix = x - off;
      const iy = y - off;
      if (pix && ix >= 0 && iy >= 0 && ix < tok && iy < tok && inner[iy][ix]) {
        const o = (iy * tok + ix) * 4;
        px(f, x0 + x, y0 + y, [pix[o], pix[o + 1], pix[o + 2]]);
      } else px(f, x0 + x, y0 + y, col);
    }
  }
}

/* ------------------------------------------------------------ the pin */

export const PIN = [
  "..ooo..",
  ".oaaao.",
  "oahaaao",
  "oahaado",
  "oaaaado",
  ".oaado.",
  "..oao..",
  "...o...",
];
/** One frame as it hits. */
export const PIN_SQUASH = [
  "..ooooo..",
  ".oahaaao.",
  "oahaaaado",
  ".ooaaado.",
  "...oao...",
  "....o....",
];
/** Pressed into the map on Lock it in. */
export const PIN_PRESS = [
  "..ooo..",
  ".oahao.",
  "oaaaado",
  ".oaado.",
  "..oao..",
  "...o...",
];

/* ------------------------------------------------------- the geodesy */

const R_EARTH = 6371;
const RAD = Math.PI / 180;

/** The point `km` from `lat, lon` on bearing `brg` (degrees from north). */
export function destination(
  lat: number,
  lon: number,
  brg: number,
  km: number,
): LonLat {
  const d = km / R_EARTH;
  const b = brg * RAD;
  const p1 = lat * RAD;
  const sin2 =
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b);
  const p2 = Math.asin(Math.min(1, Math.max(-1, sin2)));
  const l2 =
    lon * RAD +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  let lo = l2 / RAD;
  while (lo > 180) lo -= 360;
  while (lo < -180) lo += 360;
  return { lat: p2 / RAD, lon: lo };
}

/** Each column's longitude and each row's latitude on a frame. */
export interface Geo {
  W: number;
  H: number;
  lon: Float64Array;
  lat: Float64Array;
  sl: Float64Array;
  cl: Float64Array;
  cdl: Float64Array;
  mask: Uint8Array;
  list: Int32Array;
  dlon: number;
  dlat: number;
}

/**
 * Where every column and row of a `W` by `H` frame sits on the globe, through
 * the map's `unproject` (CSS pixels, `s` frame pixels to one). Reuses `geo`'s
 * arrays when the frame is the same size.
 */
export function computeGeo(
  geo: Geo | null,
  W: number,
  H: number,
  s: number,
  unproject: (x: number, y: number) => LonLat,
): Geo {
  const g: Geo =
    geo && geo.W === W && geo.H === H
      ? geo
      : {
          W,
          H,
          lon: new Float64Array(W),
          lat: new Float64Array(H),
          sl: new Float64Array(H),
          cl: new Float64Array(H),
          cdl: new Float64Array(W),
          mask: new Uint8Array(W * H),
          list: new Int32Array(W * H),
          dlon: 1,
          dlat: -1,
        };
  for (let x = 0; x < W; x++) g.lon[x] = unproject((x + 0.5) / s, 0).lon;
  for (let y = 0; y < H; y++) {
    const lat = unproject(0, (y + 0.5) / s).lat;
    g.lat[y] = lat;
    g.sl[y] = Math.sin(lat * RAD);
    g.cl[y] = Math.cos(lat * RAD);
  }
  g.dlon = W > 1 ? g.lon[1] - g.lon[0] : 1;
  g.dlat = H > 1 ? g.lat[1] - g.lat[0] : -1;
  return g;
}

/**
 * One ring, true to the map: every pixel in its band is tested for being
 * within `km` of `c` on the globe, and the ring is the inside's edge, one
 * pixel wide (two for `thick`), with an ink pixel either side. `tintK` washes
 * what it holds with its colour, like a lens.
 *
 * A world narrower than its canvas has sea either side of it. There `once`
 * draws the ring a single time round its own middle, carrying on past the
 * world's edge, rather than once more a world away in the empty sea.
 */
export function rasterRing(
  f: Frame,
  g: Geo,
  c: LonLat,
  km: number,
  thick: number,
  col: RGB,
  tintK: number,
  once = false,
): void {
  const { W, H, d, P } = f;
  const M = g.mask;
  const cosR = Math.cos(km / R_EARTH);
  const sp = Math.sin(c.lat * RAD);
  const cp = Math.cos(c.lat * RAD);
  const rdeg = km / R_EARTH / RAD;
  const lat0 = g.lat[0];
  const dl = g.dlat;
  let y0 = c.lat + rdeg >= 90 ? 0 : Math.floor((c.lat + rdeg - lat0) / dl) - 3;
  let y1 =
    c.lat - rdeg <= -90 ? H - 1 : Math.ceil((c.lat - rdeg - lat0) / dl) + 3;
  y0 = Math.max(0, y0);
  y1 = Math.min(H - 1, y1);
  if (y0 > y1) return;
  for (let x = 0; x < W; x++) {
    const dlon = g.lon[x] - c.lon;
    g.cdl[x] = once && Math.abs(dlon) > 180 ? -2 : Math.cos(dlon * RAD);
  }
  for (let y = y0; y <= y1; y++) {
    const a = sp * g.sl[y];
    const b = cp * g.cl[y];
    const row = y * W;
    for (let x = 0; x < W; x++) M[row + x] = a + b * g.cdl[x] >= cosR ? 1 : 0;
  }
  // 1 inside, 0 outside; past the frame's edge counts as the same.
  const out = (x: number, y: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    if (y < y0 || y > y1) return true;
    return M[y * W + x] === 0;
  };
  const L = g.list;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (M[row + x] !== 1) continue;
      if (out(x - 1, y) || out(x + 1, y) || out(x, y - 1) || out(x, y + 1)) {
        L[n++] = row + x;
      }
    }
  }
  for (let k = 0; k < n; k++) M[L[k]] = 2;
  if (thick > 1) {
    const n1 = n;
    for (let k = 0; k < n1; k++) {
      const i = L[k];
      const x = i % W;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (j < 0 || j >= W * H || M[j] !== 1) continue;
        if (Math.abs((j % W) - x) > 1) continue;
        M[j] = 3;
        L[n++] = j;
      }
    }
  }
  if (tintK > 0) {
    for (let y = y0; y <= y1; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (M[row + x] !== 1) continue;
        const o = (row + x) * 4;
        d[o] += (col[0] - d[o]) * tintK;
        d[o + 1] += (col[1] - d[o + 1]) * tintK;
        d[o + 2] += (col[2] - d[o + 2]) * tintK;
      }
    }
  }
  const ink = P.ink;
  for (let k = 0; k < n; k++) {
    const i = L[k];
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of NEIGHBOURS) {
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const j = Y * W + X;
      if (Y >= y0 && Y <= y1 && M[j] >= 2) continue;
      const o = j * 4;
      d[o] = ink[0];
      d[o + 1] = ink[1];
      d[o + 2] = ink[2];
    }
  }
  for (let k = 0; k < n; k++) {
    const o = L[k] * 4;
    d[o] = col[0];
    d[o + 1] = col[1];
    d[o + 2] = col[2];
  }
}
