/**
 * Narrow nature's ring colours, picked from the species' own photos.
 *
 * Six saturated pixel colours spread round the wheel, that read on the day
 * map and the night one: none of them the sea's blue or the land's green, the
 * pin's amber or the finder's red. Each species takes the one nearest the
 * colours of its own photo that no other species has, so a list's six rings
 * never share a colour, and its card wears the same one. (A seventh, magenta,
 * sat too close to rose: two red birds in one list came out pink and pinker.)
 *
 * Everything here is pure: the page reads a photo into a small canvas and
 * hands its pixels over (day-list.ts). A photo that can't be read keeps its
 * slot's colour in the set.
 */

export const RING_SET = [
  "#ff4f7b",
  "#ff8a2a",
  "#ffd84a",
  "#3fe6b4",
  "#3cd2ff",
  "#a77bff",
] as const;

export type RGB = [number, number, number];

export interface Tint {
  hex: string;
  rgb: RGB;
  /** Hue in OKLab, degrees. */
  h: number;
}

/** A strong colour in a photo: its hue and how much of the photo is it. */
export interface Peak {
  h: number;
  score: number;
}

const RAD = Math.PI / 180;

export const hexRgb = (hex: string): RGB =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

/** sRGB (0-255) to OKLab: lightness, then the a and b axes. */
export function oklab(r: number, g: number, b: number): RGB {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function hueOf(rgb: RGB): number {
  const [, a, b] = oklab(rgb[0], rgb[1], rgb[2]);
  const h = Math.atan2(b, a) / RAD;
  return h < 0 ? h + 360 : h;
}

/** Degrees between two hues, the short way round. */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export const RINGS: Tint[] = RING_SET.map((hex) => {
  const rgb = hexRgb(hex);
  return { hex, rgb, h: hueOf(rgb) };
});

/** The set's colour for a slot, when its photo can't be read. */
export const ringFor = (i: number): Tint => RINGS[i % RINGS.length];

const BINS = 36;

/**
 * The strong colours in a square photo, `n` pixels across as RGBA, strongest
 * first. Greys, near-blacks and near-whites don't count, and the middle of
 * the frame, where the animal usually is, counts for more than the edges.
 */
export function photoHues(data: ArrayLike<number>, n: number): Peak[] {
  const w = new Float64Array(BINS);
  const A = new Float64Array(BINS);
  const B = new Float64Array(BINS);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 4;
      const [L, a, b] = oklab(data[o], data[o + 1], data[o + 2]);
      const C = Math.hypot(a, b);
      if (C < 0.045 || L < 0.24 || L > 0.95) continue;
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const middle = Math.exp(-(dx * dx + dy * dy) / (2 * 0.2 * 0.2));
      const wt = C * C * (0.25 + middle);
      let h = Math.atan2(b, a) / RAD;
      if (h < 0) h += 360;
      const k = Math.floor(h / (360 / BINS)) % BINS;
      w[k] += wt;
      A[k] += a * wt;
      B[k] += b * wt;
    }
  }
  const smooth = new Float64Array(BINS);
  for (let k = 0; k < BINS; k++) {
    smooth[k] = w[k] + 0.6 * (w[(k + 1) % BINS] + w[(k + BINS - 1) % BINS]);
  }
  const peaks: Peak[] = [];
  for (let k = 0; k < BINS; k++) {
    const left = smooth[(k + BINS - 1) % BINS];
    const right = smooth[(k + 1) % BINS];
    if (!(smooth[k] > 0 && smooth[k] >= left && smooth[k] > right)) continue;
    let ta = 0;
    let tb = 0;
    for (const j of [k - 1, k, k + 1]) {
      const q = (j + BINS) % BINS;
      ta += A[q];
      tb += B[q];
    }
    let h = Math.atan2(tb, ta) / RAD;
    if (h < 0) h += 360;
    peaks.push({ h, score: smooth[k] });
  }
  peaks.sort((p, q) => q.score - p.score);
  return peaks.slice(0, 4);
}

/**
 * The best match of each photo's colours to the set, every colour used once:
 * the one ring colour per species that keeps the six, taken together,
 * closest to their photos. A photo with no strong colour (or none read)
 * takes whatever's left over, in slot order.
 */
export function assignTints(hues: Peak[][]): Tint[] {
  const cost = hues.map((peaks) =>
    RINGS.map((ring, k) => {
      if (!peaks.length) return 70 + k;
      const top = peaks[0].score;
      let best = Infinity;
      for (const p of peaks) {
        if (p.score < top * 0.12) continue;
        best = Math.min(
          best,
          hueGap(p.h, ring.h) * (1 + 1.2 * (1 - p.score / top)),
        );
      }
      return best;
    }),
  );
  let best: number[] | null = null;
  let bestCost = Infinity;
  const pick: number[] = [];
  const used = new Array<boolean>(RINGS.length).fill(false);
  const walk = (i: number, total: number) => {
    if (total >= bestCost) return;
    if (i === cost.length) {
      bestCost = total;
      best = pick.slice();
      return;
    }
    for (let k = 0; k < RINGS.length; k++) {
      if (used[k]) continue;
      used[k] = true;
      pick.push(k);
      walk(i + 1, total + cost[i][k]);
      pick.pop();
      used[k] = false;
    }
  };
  walk(0, 0);
  const chosen: number[] = best ?? hues.map((_, i) => i % RINGS.length);
  return chosen.map((k) => RINGS[k]);
}

/**
 * A photo's pixels punched up for a token a dozen pixels across: more colour
 * and contrast, so the animal still reads at that size. Changes `px` in
 * place and returns it.
 */
export function punch(px: Uint8ClampedArray): Uint8ClampedArray {
  for (let o = 0; o < px.length; o += 4) {
    const l = 0.3 * px[o] + 0.59 * px[o + 1] + 0.11 * px[o + 2];
    for (let k = 0; k < 3; k++) {
      px[o + k] = (l + (px[o + k] - l) * 1.45 - 128) * 1.18 + 128;
    }
  }
  return px;
}
