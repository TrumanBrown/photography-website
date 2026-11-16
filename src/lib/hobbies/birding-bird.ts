/**
 * Birding hobby: the pure "you as a bird" mapping plus the bird renderer.
 *
 * Split from birding.ts (which owns the camera, the MediaPipe landmark model,
 * and the DOM) so the mapping part is dependency-free and unit-testable, the
 * same way stocking.ts is split out of the aquarium engine.
 *
 * Your own face, warped a little toward a bird (rounder eyes, a narrower jaw,
 * the nose and mouth drawn into a beak), with a real bird's bill and feathers:
 * the bill is cut from one of my photos and drawn head on with its real shape,
 * colours and shading, and the crown and neck feathers are textured with that
 * bird's own plumage from the same photo (bird-parts.json, made by the
 * stipple-plates skill's bird_parts.py). Your features set the bill's length
 * and the crest's height. Same selfie, same bird; Another bird steps through
 * the rest. Everything runs on the device.
 */

/** Normalized facial measurements, each already squashed to a 0..1 range by the
 *  extractor in birding.ts (smile is the one exception, -1..1). */
export interface FaceFeatures {
  /** Eye openness (vertical/horizontal eye aspect). Higher = rounder, wider eyes. */
  eyeOpenness: number;
  /** Inter-ocular distance over face width. Higher = more wide-set eyes. */
  eyeSpacing: number;
  /** Mouth width over face width. Higher = wider beak. */
  mouthWidth: number;
  /** Face width over height. Higher = rounder, chubbier body. */
  faceRoundness: number;
  /** Brow-to-eye distance. Higher = taller crest. */
  browRaise: number;
  /** Nose length over face height. Higher = longer beak. */
  noseLength: number;
  /** Mouth curvature, -1 (frown) .. 1 (smile). */
  smile: number;
}

/** Colors sampled from the selfie, already converted to #rrggbb hex. */
export interface FacePalette {
  /** Hair / dominant region — used to pick the matching species. */
  body: string;
  /** A lightened body tone. */
  belly: string;
  /** Lip / accent region. */
  accent: string;
  /** Warm-shifted skin tone. */
  beak: string;
  /** Iris colour sampled from the eye (optional; defaults to a dark brown). */
  eye?: string;
}

/** Concrete drawing slots in bird-space (logical 100x100 grid). */
export interface BirdParams {
  eyeRadius: number;
  eyeGap: number;
  eyeY: number;
  beakLength: number;
  beakWidth: number;
  bodyWidth: number;
  bodyHeight: number;
  crestHeight: number;
  blush: boolean;
  happy: boolean;
  body: string;
  belly: string;
  accent: string;
  beak: string;
}

/** Logical bird-space size. */
export const BIRD_SPACE = 100;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

/**
 * Map measured facial features + palette to concrete proportion slots.
 * Pure and deterministic: identical inputs always yield an identical object.
 */
export function featuresToBird(features: FaceFeatures, palette: FacePalette): BirdParams {
  const f = features;
  return {
    eyeRadius: lerp(5.5, 12, f.eyeOpenness),
    eyeGap: lerp(16, 34, f.eyeSpacing),
    eyeY: 44 - clamp(f.smile, -1, 1) * 1.5,
    beakLength: lerp(7, 16, f.noseLength),
    beakWidth: lerp(7, 15, f.mouthWidth),
    bodyWidth: lerp(46, 64, f.faceRoundness),
    bodyHeight: lerp(58, 46, f.faceRoundness),
    crestHeight: lerp(4, 22, f.browRaise),
    blush: f.smile > 0.15,
    happy: f.smile >= 0,
    body: palette.body,
    belly: palette.belly,
    accent: palette.accent,
    beak: palette.beak,
  };
}

/**
 * Build a stable 32-bit seed from the rounded feature + palette values, so the
 * same selfie produces the same bird.
 */
export function birdSeed(features: FaceFeatures, palette: FacePalette): number {
  const parts = [
    Math.round(features.eyeOpenness * 20),
    Math.round(features.eyeSpacing * 20),
    Math.round(features.mouthWidth * 20),
    Math.round(features.faceRoundness * 20),
    Math.round(features.browRaise * 20),
    Math.round(features.noseLength * 20),
    Math.round((features.smile + 1) * 10),
    palette.body,
    palette.accent,
    palette.beak,
  ].join('|');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < parts.length; i += 1) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Seed + species selection
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A seed sensitive enough that any meaningful selfie change yields a new bird. */
export function birdStyleSeed(features: FaceFeatures, palette: FacePalette): number {
  const parts = [
    Math.round(features.eyeOpenness * 50),
    Math.round(features.eyeSpacing * 50),
    Math.round(features.mouthWidth * 50),
    Math.round(features.faceRoundness * 50),
    Math.round(features.browRaise * 50),
    Math.round(features.noseLength * 50),
    Math.round((features.smile + 1) * 25),
    palette.body,
    palette.belly,
    palette.accent,
    palette.beak,
  ].join('|');
  return hashString(parts);
}

// ---------------------------------------------------------------------------
// The birds: each one's bill and plumage come from one of my photos.
// ---------------------------------------------------------------------------

export interface Species {
  id: string;
  common: string;
  sci: string;
  /** Where and when I took the photo its bill and feathers come from. */
  from: string;
  /** Bill length below the nose, in face heights, before your nose length adjusts it. */
  length: number;
  /** Bill half-width at its base, in face widths. */
  width: number;
}

export const SPECIES: Species[] = [
  {
    id: 'black-oystercatcher',
    common: 'Black oystercatcher',
    sci: 'Haematopus bachmani',
    from: 'Olympic coast, February 2026',
    length: 0.62,
    width: 0.15,
  },
  {
    id: 'keel-billed-toucan',
    common: 'Keel-billed toucan',
    sci: 'Ramphastos sulfuratus',
    from: 'El Zota, Costa Rica, September 2026',
    length: 0.7,
    width: 0.19,
  },
  {
    id: 'yellow-crowned-night-heron',
    common: 'Yellow-crowned night heron',
    sci: 'Nyctanassa violacea',
    from: 'Tortuguero, Costa Rica, August 2026',
    length: 0.6,
    width: 0.14,
  },
];

/**
 * Which bird a selfie gets: the same selfie always starts on the same bird,
 * and Another bird (variant + 1) steps through the rest in turn.
 */
export function pickSpecies(features: FaceFeatures, palette: FacePalette, variant = 0): Species {
  const start = birdStyleSeed(features, palette) % SPECIES.length;
  return SPECIES[(start + variant) % SPECIES.length];
}

/** A bill as cut from the photo: pointing right, base line where it meets the head. */
export interface PartGeometry {
  w: number;
  h: number;
  /** Top then bottom of the base. */
  base: [number, number][];
  tip: [number, number];
}

export interface PartPatch extends PartGeometry {
  /** RGBA, w x h. */
  data: Uint8ClampedArray;
}

/**
 * The bill's side outline, read from its cut-out: along the line from the
 * middle of its base to its tip, the top (culmen) and bottom of the bill at
 * each step, as signed distances across that line in patch pixels.
 */
export interface BillProfile {
  origin: Pt;
  /** Unit vector from the base toward the tip. */
  axis: Pt;
  /** Unit vector across the bill, pointing toward its underside. */
  across: Pt;
  length: number;
  top: Float32Array;
  bot: Float32Array;
}

export function billProfile(p: PartPatch, steps = 48): BillProfile {
  const origin = { x: (p.base[0][0] + p.base[1][0]) / 2, y: (p.base[0][1] + p.base[1][1]) / 2 };
  const length = Math.hypot(p.tip[0] - origin.x, p.tip[1] - origin.y) || 1;
  const axis = { x: (p.tip[0] - origin.x) / length, y: (p.tip[1] - origin.y) / length };
  let across = { x: -axis.y, y: axis.x };
  if ((p.base[1][0] - origin.x) * across.x + (p.base[1][1] - origin.y) * across.y < 0) {
    across = { x: -across.x, y: -across.y };
  }
  const solid = (x: number, y: number): boolean => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < p.w && yi < p.h && p.data[(yi * p.w + xi) * 4 + 3] > 128;
  };
  const top = new Float32Array(steps + 1);
  const bot = new Float32Array(steps + 1);
  const reach = Math.max(p.w, p.h);
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(i / steps, 0.99) * length;
    const cx = origin.x + axis.x * t;
    const cy = origin.y + axis.y * t;
    let lo = Infinity;
    let hi = -Infinity;
    for (let d = -reach; d <= reach; d += 0.5) {
      if (solid(cx + across.x * d, cy + across.y * d)) {
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    }
    if (!isFinite(lo)) {
      lo = i ? top[i - 1] : -1;
      hi = i ? bot[i - 1] : 1;
    }
    top[i] = lo;
    bot[i] = hi;
  }
  return { origin, axis, across, length, top, bot };
}

/**
 * How to light the bird's parts like the selfie: a gain toward the face's
 * brightness, held in a range so a dark selfie doesn't turn the bill black.
 */
export function lightGain(faceLum: number): number {
  return Math.min(1.12, Math.max(0.6, Math.pow(Math.max(0.05, faceLum) / 0.55, 0.6)));
}

// ---------------------------------------------------------------------------
// Renderer: composite bird features onto the real selfie (browser-only).
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };
export interface LandmarkXY {
  x: number;
  y: number;
}

export interface HybridInput {
  /** The selfie, already drawn into a canvas at its own pixel size. */
  source: HTMLCanvasElement;
  /** MediaPipe face landmarks (478), normalized to [0,1] over the source. */
  landmarks: LandmarkXY[];
  params: BirdParams;
  species: Species;
  /** The bird's bill (pixels and geometry) and its crown and neck plumage. */
  parts: { bill: PartPatch; crown: CanvasImageSource & { width: number; height: number }; neck: CanvasImageSource & { width: number; height: number } };
  /** Varies the feathers between selfies. */
  seed: number;
}

// FaceMesh indices used to anchor the bird features.
const M = {
  cheekR: 234, cheekL: 454, foreheadTop: 10, chin: 152,
  rEyeOuter: 33, rEyeInner: 133, lEyeInner: 362, lEyeOuter: 263,
  noseBridge: 168, noseTip: 1, mouthTop: 13, mouthBot: 14,
};

const dist2 = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const midp = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

type Texture = CanvasImageSource & { width: number; height: number };

/** A few colours read from a plumage patch, to draw its feathers in. */
function plumageColours(tex: Texture, rng: () => number): [number, number, number][] {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return [[40, 36, 32]];
  x.drawImage(tex, 0, 0, 32, 32);
  const d = x.getImageData(0, 0, 32, 32).data;
  const out: [number, number, number][] = [];
  for (let i = 0; i < 24; i += 1) {
    const q = Math.floor(rng() * 1024) * 4;
    out.push([d[q], d[q + 1], d[q + 2]]);
  }
  return out;
}

/**
 * One feather drawn the way a feather is built: a curved shaft with fine
 * barbs either side, swept toward the tip, darker and downy at the root,
 * in colours from the bird's own plumage.
 */
function drawPlume(
  o: CanvasRenderingContext2D,
  base: Pt,
  tip: Pt,
  halfW: number,
  bend: number,
  cols: [number, number, number][],
  rng: () => number,
): void {
  const len = dist2(base, tip);
  if (len < 2) return;
  const ux = (tip.x - base.x) / len;
  const uy = (tip.y - base.y) / len;
  const nx = -uy;
  const ny = ux;
  const ctrl = { x: (base.x + tip.x) / 2 + nx * bend * len, y: (base.y + tip.y) / 2 + ny * bend * len };
  const at = (s: number): Pt => {
    const a = (1 - s) * (1 - s);
    const b = 2 * (1 - s) * s;
    const c = s * s;
    return { x: a * base.x + b * ctrl.x + c * tip.x, y: a * base.y + b * ctrl.y + c * tip.y };
  };
  const barbs = Math.max(8, Math.round(len / 1.6));
  const lw = Math.max(0.6, halfW * 0.09);
  o.lineCap = 'round';
  for (let i = 0; i < barbs; i += 1) {
    const s = (i + rng() * 0.6) / barbs;
    const p = at(s);
    const q = at(Math.min(1, s + 0.01));
    const tx = q.x - p.x || ux * 0.01;
    const ty = q.y - p.y || uy * 0.01;
    const tl = Math.hypot(tx, ty) || 1;
    // Widest a little past the middle, rounded at the tip.
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.9 + 0.05)), 0.55) * (s > 0.85 ? Math.sqrt((1 - s) / 0.15) : 1);
    const col = cols[Math.floor(rng() * cols.length)];
    const dark = 0.55 + 0.45 * Math.min(1, s * 1.6);
    const down = s < 0.22;
    for (const side of [-1, 1]) {
      const w = halfW * env * (0.75 + rng() * 0.4) * (down ? 1.25 : 1);
      // Barbs leave the shaft at about 40 degrees, toward the tip.
      const sweep = down ? 0.9 : 0.62;
      const bx = (tx / tl) * Math.cos(sweep) + side * (-ty / tl) * Math.sin(sweep);
      const by = (ty / tl) * Math.cos(sweep) + side * (tx / tl) * Math.sin(sweep);
      const e = { x: p.x + bx * w * 1.3, y: p.y + by * w * 1.3 };
      const m = { x: p.x + bx * w * 0.6 + (tx / tl) * w * 0.1, y: p.y + by * w * 0.6 + (ty / tl) * w * 0.1 };
      const k = dark * (0.85 + rng() * 0.3);
      // Faded at the root, so the feather grows out of the head without an edge.
      const alpha = (down ? 0.5 : 0.82) * Math.min(1, 0.15 + s * 5);
      o.strokeStyle = `rgba(${Math.min(255, col[0] * k) | 0},${Math.min(255, col[1] * k) | 0},${Math.min(255, col[2] * k) | 0},${alpha.toFixed(3)})`;
      o.lineWidth = lw;
      o.beginPath();
      o.moveTo(p.x, p.y);
      o.quadraticCurveTo(m.x, m.y, e.x, e.y);
      o.stroke();
    }
  }
  // The shaft.
  const c0 = cols[0];
  o.strokeStyle = `rgba(${Math.min(255, c0[0] * 1.25 + 20) | 0},${Math.min(255, c0[1] * 1.25 + 20) | 0},${Math.min(255, c0[2] * 1.25 + 20) | 0},0.55)`;
  o.lineWidth = lw * 1.3;
  o.beginPath();
  o.moveTo(base.x, base.y);
  o.quadraticCurveTo(ctrl.x, ctrl.y, at(0.92).x, at(0.92).y);
  o.stroke();
}

/**
 * Draw one source-image triangle into a destination triangle (affine warp),
 * clipped to the destination. Used to morph the real photo into bird shapes.
 */
function warpTri(
  o: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s0: Pt, s1: Pt, s2: Pt,
  d0: Pt, d1: Pt, d2: Pt,
): void {
  const den = s0.x * (s1.y - s2.y) - s1.x * (s0.y - s2.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(den) < 1e-6) return;
  const a = (d0.x * (s1.y - s2.y) - d1.x * (s0.y - s2.y) + d2.x * (s0.y - s1.y)) / den;
  const c = (s0.x * (d1.x - d2.x) - s1.x * (d0.x - d2.x) + s2.x * (d0.x - d1.x)) / den;
  const e = (s0.x * (s1.y * d2.x - s2.y * d1.x) - s1.x * (s0.y * d2.x - s2.y * d0.x) + s2.x * (s0.y * d1.x - s1.y * d0.x)) / den;
  const b = (d0.y * (s1.y - s2.y) - d1.y * (s0.y - s2.y) + d2.y * (s0.y - s1.y)) / den;
  const d = (s0.x * (d1.y - d2.y) - s1.x * (d0.y - d2.y) + s2.x * (d0.y - d1.y)) / den;
  const f = (s0.x * (s1.y * d2.y - s2.y * d1.y) - s1.x * (s0.y * d2.y - s2.y * d0.y) + s2.x * (s0.y * d1.y - s1.y * d0.y)) / den;
  o.save();
  o.beginPath();
  // grow the clip triangle by a hair to avoid seam gaps between cells
  o.moveTo(d0.x, d0.y);
  o.lineTo(d1.x, d1.y);
  o.lineTo(d2.x, d2.y);
  o.closePath();
  o.clip();
  o.setTransform(a, b, c, d, e, f);
  o.drawImage(img, 0, 0);
  o.restore();
}

/** Bilinear sample of a part's colour at (x, y), un-premultiplied; [r, g, b, a] 0-255. */
function sampleColour(p: PartPatch, x: number, y: number, out: Float64Array): void {
  const xc = Math.min(p.w - 1, Math.max(0, x));
  const yc = Math.min(p.h - 1, Math.max(0, y));
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const x1 = Math.min(p.w - 1, x0 + 1);
  const y1 = Math.min(p.h - 1, y0 + 1);
  const fx = xc - x0;
  const fy = yc - y0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const tap = (xx: number, yy: number, w: number) => {
    const o = (yy * p.w + xx) * 4;
    const al = p.data[o + 3] * w;
    r += p.data[o] * al;
    g += p.data[o + 1] * al;
    b += p.data[o + 2] * al;
    a += al;
  };
  tap(x0, y0, (1 - fx) * (1 - fy));
  tap(x1, y0, fx * (1 - fy));
  tap(x0, y1, (1 - fx) * fy);
  tap(x1, y1, fx * fy);
  out[0] = a > 0 ? r / a : 0;
  out[1] = a > 0 ? g / a : 0;
  out[2] = a > 0 ? b / a : 0;
  out[3] = a;
}

/**
 * The bird's bill seen head on, pointing down from between the eyes: its
 * real taper (the depth of the bill in my side-on photo, along its length),
 * and its real colours wrapped round it, the ridge (culmen) down the middle
 * and the sides of the upper bill either side, so the nostril and colour
 * bands sit where they do on the bird. Shaded like a rounded surface lit from
 * above, faded in at the root so it grows out of the face. Returns a canvas
 * with the root at the top centre.
 */
export function renderBillHeadOn(p: PartPatch, length: number, halfWidth: number, gain: number): HTMLCanvasElement {
  const prof = billProfile(p);
  const n = prof.top.length - 1;
  const ref = prof.bot[Math.round(0.06 * n)] - prof.top[Math.round(0.06 * n)] || 1;
  // The bill's own colours at each step along it: the ridge, the side and
  // the edge, averaged across each band and lightly smoothed along the bill, so the
  // colour bands are the bird's and the photo's grain and glare are not.
  // Head on, you see the upper bill, so the bands stay in its half of the depth.
  const zones = [
    [0.03, 0.14],
    [0.18, 0.32],
    [0.36, 0.5],
  ];
  const band = zones.map(() => new Float32Array((n + 1) * 3));
  const col = new Float64Array(4);
  for (let i = 0; i <= n; i += 1) {
    const along = (Math.min(i, n - 1) / n) * prof.length;
    const ax = prof.origin.x + prof.axis.x * along;
    const ay = prof.origin.y + prof.axis.y * along;
    const depth = Math.max(1, prof.bot[i] - prof.top[i]);
    zones.forEach(([z0, z1], zi) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let w = 0;
      for (let k = 0; k <= 6; k += 1) {
        const acrossPx = prof.top[i] + (z0 + ((z1 - z0) * k) / 6) * depth;
        sampleColour(p, ax + prof.across.x * acrossPx, ay + prof.across.y * acrossPx, col);
        const a = col[3] / 255;
        r += col[0] * a;
        g += col[1] * a;
        b += col[2] * a;
        w += a;
      }
      const prev = i ? band[zi].subarray((i - 1) * 3, i * 3) : null;
      band[zi][i * 3] = w ? r / w : prev ? prev[0] : 0;
      band[zi][i * 3 + 1] = w ? g / w : prev ? prev[1] : 0;
      band[zi][i * 3 + 2] = w ? b / w : prev ? prev[2] : 0;
    });
  }
  const smooth = (a: Float32Array) => {
    const out = new Float32Array(a.length);
    for (let i = 0; i <= n; i += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        let sum = 0;
        let cnt = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(n, i + 2); j += 1) {
          sum += a[j * 3 + ch];
          cnt += 1;
        }
        out[i * 3 + ch] = sum / cnt;
      }
    }
    return out;
  };
  // Averaging and the photo's glare dull a bill, so give its colour back.
  const bands = band.map((bb) => {
    const sm = smooth(bb);
    for (let i = 0; i < sm.length; i += 3) {
      const l = 0.3 * sm[i] + 0.59 * sm[i + 1] + 0.11 * sm[i + 2];
      for (let ch = 0; ch < 3; ch += 1) sm[i + ch] = Math.max(0, Math.min(255, l + (sm[i + ch] - l) * 1.45));
    }
    return sm;
  });
  const Wc = Math.ceil(halfWidth * 2.2) + 4;
  const Hc = Math.ceil(length) + 2;
  const c = document.createElement('canvas');
  c.width = Wc;
  c.height = Hc;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(Wc, Hc);
  const d = img.data;
  const cx = Wc / 2;
  // Fine grain running along the bill, like keratin.
  const grain = new Float32Array(Wc);
  for (let x = 0; x < Wc; x += 1) grain[x] = Math.sin(x * 1.7) * 0.5 + Math.sin(x * 0.63 + 1.3) * 0.5;
  const k0 = Math.min(1, gain);
  const rgb = [0, 0, 0];
  for (let y = 0; y < Hc; y++) {
    const t = y / length;
    if (t > 1) break;
    const f = Math.min(n - 1, t * n);
    const i0 = Math.floor(f);
    const w = f - i0;
    const top = prof.top[i0] * (1 - w) + prof.top[i0 + 1] * w;
    const bot = prof.bot[i0] * (1 - w) + prof.bot[i0 + 1] * w;
    const depth = Math.max(0, bot - top);
    // The real bill's taper from my photo, broad and rounded where it meets
    // the face, narrowing to its tip.
    const root = t < 0.1 ? 0.75 + 0.25 * Math.sin((t / 0.1) * (Math.PI / 2)) : 1;
    const hw = halfWidth * Math.pow(Math.min(1.15, depth / ref), 0.6) * (1 - 0.4 * t) * root;
    if (hw < 0.3) continue;
    for (let x = 0; x < Wc; x++) {
      const sxy = (x + 0.5 - cx) / hw;
      const as = Math.abs(sxy);
      if (as > 1.02) continue;
      // Round cross-section: how far round the bill this point is, ridge to edge.
      const arc = Math.asin(Math.min(1, as)) / (Math.PI / 2);
      const zf = Math.min(1.999, arc * 2);
      const za = Math.floor(zf);
      const zw = zf - za;
      for (let ch = 0; ch < 3; ch += 1) {
        const A = bands[za][i0 * 3 + ch] * (1 - w) + bands[za][(i0 + 1) * 3 + ch] * w;
        const B = bands[za + 1][i0 * 3 + ch] * (1 - w) + bands[za + 1][(i0 + 1) * 3 + ch] * w;
        rgb[ch] = A * (1 - zw) + B * zw;
      }
      const nz = Math.sqrt(Math.max(0, 1 - as * as));
      // Lit from above and a little left, a soft highlight along the ridge.
      const lambert = 0.62 + 0.38 * Math.max(0, 0.85 * nz - 0.3 * sxy + 0.25 * (1 - t));
      const spec = Math.exp(-(((sxy + 0.16) / 0.14) ** 2)) * 0.16 * (1 - t * 0.5);
      const edge = as > 0.8 ? 1 - 0.4 * ((as - 0.8) / 0.22) : 1;
      // The nostrils: a slit each side near the root.
      const ny = (t - 0.14) / 0.04;
      const nx = (as - 0.42) / 0.08;
      const nostril = 1 - 0.7 * Math.exp(-(nx * nx + ny * ny));
      const kk = k0 * lambert * edge * nostril * (1 + 0.035 * grain[x]);
      const o = (y * Wc + x) * 4;
      d[o] = Math.min(255, rgb[0] * kk + 255 * spec);
      d[o + 1] = Math.min(255, rgb[1] * kk + 255 * spec);
      d[o + 2] = Math.min(255, rgb[2] * kk + 255 * spec);
      const aa = Math.min(1, Math.max(0, (1.02 - as) * hw));
      const fade = Math.min(1, t / 0.07);
      d[o + 3] = 255 * aa * fade * fade * (3 - 2 * fade);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Composite a bird beak + feathers onto the real selfie. Keeps the person's
 * actual face (real human features) and grafts on avian parts anchored to the
 * facial landmarks, the way the reference hybrid does.
 */
export function renderHybrid(canvas: HTMLCanvasElement, input: HybridInput, sizePx: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { source, landmarks, species, parts } = input;
  const W = source.width;
  const H = source.height;
  if (!W || !H || landmarks.length < 468) return;

  const S = sizePx;
  canvas.width = S;
  canvas.height = S;
  const o = ctx;
  o.imageSmoothingEnabled = true;
  o.clearRect(0, 0, S, S);
  const rng = mulberry32(input.seed);

  // Source-pixel landmark.
  const lp = (i: number): Pt => ({ x: landmarks[i].x * W, y: landmarks[i].y * H });

  const cheekR = lp(M.cheekR);
  const cheekL = lp(M.cheekL);
  const fore = lp(M.foreheadTop);
  const chin = lp(M.chin);
  const faceCx = (cheekR.x + cheekL.x) / 2;
  const eyeMidSrc = midp(midp(lp(M.rEyeOuter), lp(M.rEyeInner)), midp(lp(M.lEyeOuter), lp(M.lEyeInner)));
  const faceW = Math.max(1, dist2(cheekR, cheekL));

  // Frame the head: face width -> ~52% of the canvas, eye line at 42% height.
  const scale = (S * 0.52) / faceW;
  const offX = S / 2 - faceCx * scale;
  const offY = S * 0.42 - eyeMidSrc.y * scale;
  const T = (p: Pt): Pt => ({ x: p.x * scale + offX, y: p.y * scale + offY });

  // Where the photo doesn't reach, an out-of-focus copy of it fills the square.
  const tiny = document.createElement('canvas');
  tiny.width = 24;
  tiny.height = 24;
  tiny.getContext('2d')?.drawImage(source, 0, 0, 24, 24);
  o.drawImage(tiny, 0, 0, S, S);

  // The selfie itself (real human features).
  o.drawImage(source, offX, offY, W * scale, H * scale);

  // Face geometry in output space.
  const Tfore = T(fore);
  const Tchin = T(chin);
  const TcheekR = T(cheekR);
  const TcheekL = T(cheekL);
  const faceWOut = dist2(TcheekR, TcheekL);
  const ecx = (TcheekR.x + TcheekL.x) / 2;
  const ecy = (Tfore.y + Tchin.y) / 2;
  const erx = (faceWOut / 2) * 1.04;
  const ery = (Tchin.y - Tfore.y) / 2 * 1.06;

  // (Crest + jaw feathers are drawn after the warp below, so the warp doesn't
  // paint over them.)

  // --- Composite face-warp: enlarge eyes, narrow the lower face, and pull the
  //     nose/mouth into a beak — one seamless morph over a face-sized box. ---
  const bridgeS = lp(M.noseBridge);
  const noseTipS = lp(M.noseTip);
  const mouthCS = midp(lp(M.mouthTop), lp(M.mouthBot));
  const chinS = lp(M.chin);
  const faceHsrc = Math.max(1, dist2(lp(M.foreheadTop), chinS));

  // Box covers forehead → upper neck, a bit wider than the face (source px).
  const boxCxS = faceCx;
  const boxHalfS = faceW * 0.85;
  const boxTopS = lp(M.foreheadTop).y - faceHsrc * 0.2;
  const boxBotS = chinS.y + (chinS.y - mouthCS.y) * 0.6;

  const beakScale = lerp(0.9, 1.3, clamp01((input.params.beakLength - 7) / 9));
  const Q = faceWOut * 0.34 * beakScale; // beak protrusion (output px)
  const Pp = faceWOut * 0.5; // beak pinch

  // Output-space anchors for the displacement field.
  const eyeCO = [T(midp(lp(M.rEyeOuter), lp(M.rEyeInner))), T(midp(lp(M.lEyeOuter), lp(M.lEyeInner)))];
  const eyeWO = dist2(T(lp(M.rEyeOuter)), T(lp(M.rEyeInner)));
  const cxO = T({ x: boxCxS, y: chinS.y }).x;
  const noseTipO = T(noseTipS);
  const cheekYO = T({ x: boxCxS, y: (lp(M.cheekR).y + lp(M.cheekL).y) / 2 }).y;
  const chinYO = T(chinS).y;

  const cols = 18;
  const rows = 26;
  const gS: Pt[][] = [];
  const gD: Pt[][] = [];
  for (let r = 0; r <= rows; r += 1) {
    const v = r / rows;
    const rowS: Pt[] = [];
    const rowD: Pt[] = [];
    for (let c = 0; c <= cols; c += 1) {
      const u = (c / cols) * 2 - 1;
      const sx = boxCxS + u * boxHalfS;
      const sy = boxTopS + v * (boxBotS - boxTopS);
      const p0 = T({ x: sx, y: sy });
      let dx = 0;
      let dy = 0;

      // Eyes: push pixels radially outward from each eye centre (bigger, rounder).
      for (const ec of eyeCO) {
        const ex = p0.x - ec.x;
        const ey = p0.y - ec.y;
        const dd = Math.hypot(ex, ey);
        const R = eyeWO * 1.35;
        if (dd < R) {
          const f = (1 - dd / R) * 0.32;
          dx += ex * f;
          dy += ey * f;
        }
      }

      // Beak: nose/mouth region pulled down + pinched to a point.
      const bx = (p0.x - noseTipO.x) / (faceWOut * 0.2);
      const by = (p0.y - noseTipO.y) / Math.max(1, chinYO - noseTipO.y);
      if (by > -0.4 && by < 1.3) {
        const maskU = Math.max(0, 1 - bx * bx);
        const prot = Math.max(0, 1 - ((by - 0.4) / 0.7) ** 2);
        dy += Math.pow(maskU, 1.4) * prot * Q;
        dx += -Math.sign(bx) * Math.min(1, Math.abs(bx)) * maskU * prot * Pp;
      }

      // Jaw: narrow the lower face toward the centre (bird skull).
      if (p0.y > cheekYO) {
        const jf = Math.min(1, (p0.y - cheekYO) / Math.max(1, chinYO - cheekYO)) * 0.16;
        dx += (cxO - p0.x) * jf;
      }

      // Fade all displacement to zero at the box border -> seamless, no gaps.
      const em = (1 - u * u) * Math.sin(Math.PI * Math.min(1, Math.max(0, v)));
      rowS.push({ x: sx, y: sy });
      rowD.push({ x: p0.x + dx * em, y: p0.y + dy * em });
    }
    gS.push(rowS);
    gD.push(rowD);
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      warpTri(o, source, gS[r][c], gS[r][c + 1], gS[r + 1][c], gD[r][c], gD[r][c + 1], gD[r + 1][c]);
      warpTri(o, source, gS[r][c + 1], gS[r + 1][c + 1], gS[r + 1][c], gD[r][c + 1], gD[r + 1][c + 1], gD[r + 1][c]);
    }
  }

  // How bright the face is, so the bird's parts can be lit to match.
  let faceLum = 0.55;
  const sctx = source.getContext('2d', { willReadFrequently: true });
  if (sctx) {
    const px = sctx.getImageData(0, 0, W, H).data;
    let sum = 0;
    let n = 0;
    const r = faceW * 0.3;
    for (let y = Math.max(0, Math.round(noseTipS.y - r)); y < Math.min(H, noseTipS.y + r); y += 2) {
      for (let x = Math.max(0, Math.round(faceCx - r)); x < Math.min(W, faceCx + r); x += 2) {
        const q = (y * W + x) * 4;
        sum += (0.2126 * px[q] + 0.7152 * px[q + 1] + 0.0722 * px[q + 2]) / 255;
        n += 1;
      }
    }
    if (n) faceLum = sum / n;
  }
  const gain = lightGain(faceLum);
  const lit = (tex: Texture): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = tex.width;
    c.height = tex.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (x) {
      x.drawImage(tex, 0, 0);
      const im = x.getImageData(0, 0, c.width, c.height);
      for (let q = 0; q < im.data.length; q += 4) {
        im.data[q] = Math.min(255, im.data[q] * gain);
        im.data[q + 1] = Math.min(255, im.data[q + 1] * gain);
        im.data[q + 2] = Math.min(255, im.data[q + 2] * gain);
      }
      x.putImageData(im, 0, 0);
    }
    return c;
  };

  // --- Crest: a scattered tuft of the bird's feathers blended into the hairline ---
  const crownCols = plumageColours(lit(parts.crown), rng);
  const neckCols = plumageColours(lit(parts.neck), rng);
  const crest = lerp(0.85, 1.35, clamp01((input.params.crestHeight - 4) / 18));
  const crownY = Tfore.y - ery * 0.06;
  const halfSpan = erx * 0.95;
  o.save();
  o.shadowColor = 'rgba(0,0,0,0.25)';
  o.shadowBlur = faceWOut * 0.012;
  const crestN = 46;
  for (let i = 0; i < crestN; i += 1) {
    const norm = (rng() * 2 - 1) * Math.sqrt(rng() * 0.5 + 0.5);
    const x = ecx + norm * halfSpan;
    const arc = Math.max(0, 1 - norm * norm);
    const baseY = crownY - arc * ery * 0.14 + (rng() - 0.5) * ery * 0.16 + faceWOut * 0.04;
    const len = faceWOut * (0.1 + arc * 0.18) * (0.75 + rng() * 0.5) * crest;
    const lean = norm * 1.1 + (rng() - 0.5) * 0.45;
    const tip = { x: x + lean * len * 0.45, y: baseY - len };
    drawPlume(o, { x, y: baseY }, tip, faceWOut * (0.03 + arc * 0.012), (rng() - 0.5) * 0.25 - norm * 0.12, crownCols, rng);
  }

  // --- Jaw and neck: short feathers under the jaw, feathering the face into plumage ---
  const jawN = 110;
  for (let i = 0; i < jawN; i += 1) {
    const a = (22 + rng() * 136) * (Math.PI / 180);
    const ring = rng();
    const bx = ecx + Math.cos(a) * erx * (0.88 + ring * 0.2);
    const by = ecy + Math.sin(a) * ery * (0.95 + ring * 0.2);
    if (by < ecy + ery * 0.45) continue;
    const len = faceWOut * (0.055 + rng() * 0.05) * (1 + ring * 0.4);
    const tip = { x: bx + Math.cos(a) * len * 0.5, y: by + len * (0.6 + Math.sin(a) * 0.4) };
    drawPlume(o, { x: bx, y: by }, tip, faceWOut * 0.034, (rng() - 0.5) * 0.35, neckCols, rng);
  }
  o.restore();

  // --- The bill: the bird's real bill, head on, growing from between the eyes.
  //     Drawn last, so its tip lies over the neck feathers, never under them. ---
  const roll = Math.atan2(TcheekL.y - TcheekR.y, TcheekL.x - TcheekR.x);
  const topO = T(midp(eyeMidSrc, bridgeS));
  const billLen =
    dist2(topO, T(mouthCS)) * 0.4 +
    species.length * dist2(Tfore, Tchin) * lerp(0.9, 1.2, clamp01((input.params.beakLength - 7) / 9));
  const bill = renderBillHeadOn(parts.bill, billLen, species.width * faceWOut, gain);
  o.save();
  o.translate(topO.x, topO.y);
  o.rotate(roll);
  o.shadowColor = 'rgba(25, 14, 6, 0.4)';
  o.shadowBlur = faceWOut * 0.05;
  o.shadowOffsetX = faceWOut * 0.01;
  o.shadowOffsetY = faceWOut * 0.035;
  o.drawImage(bill, -bill.width / 2, 0);
  o.restore();

  // --- Vignette for cohesion ---
  const vg = o.createRadialGradient(S / 2, S * 0.45, S * 0.25, S / 2, S * 0.5, S * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.22)');
  o.fillStyle = vg;
  o.fillRect(0, 0, S, S);
}

