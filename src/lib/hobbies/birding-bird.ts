/**
 * Birding hobby: the pure "you as a bird" mapping plus the bird renderer.
 *
 * Split from birding.ts (which owns the camera, the MediaPipe landmark model,
 * and the DOM) so the mapping part is dependency-free and unit-testable, the
 * same way stocking.ts is split out of the aquarium engine.
 *
 * The result is a smoothly-shaded, species-accurate illustration of a real bird.
 * Your selfie picks WHICH species you are (so the bird's signature field marks
 * stay accurate and identifiable) and your facial features drive its proportions
 * (eye colour, eye size/spacing, crest height, beak size, head roundness). Same
 * selfie -> same bird (deterministic). Everything runs on-device.
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

/** Short, human-readable tags describing the detected features (shown for fun). */
export function describeFeatures(f: FaceFeatures): string[] {
  const tags: string[] = [];
  if (f.eyeOpenness >= 0.62) tags.push('wide eyes');
  else if (f.eyeOpenness <= 0.32) tags.push('sleepy eyes');
  if (f.eyeSpacing >= 0.62) tags.push('wide-set eyes');
  else if (f.eyeSpacing <= 0.34) tags.push('close-set eyes');
  if (f.faceRoundness >= 0.6) tags.push('round face');
  else if (f.faceRoundness <= 0.35) tags.push('long face');
  if (f.mouthWidth >= 0.62) tags.push('wide beak');
  if (f.noseLength >= 0.62) tags.push('long beak');
  if (f.browRaise >= 0.6) tags.push('tall crest');
  if (f.smile >= 0.2) tags.push('cheerful');
  return tags.length ? tags : ['one-of-a-kind'];
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

interface RGB {
  r: number;
  g: number;
  b: number;
}
function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return { r: 128, g: 128, b: 128 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
function rgbToHex(c: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
const shade = (hex: string, f: number): string => {
  const c = hexToRgb(hex);
  return rgbToHex({ r: c.r * f, g: c.g * f, b: c.b * f });
};
const mix = (a: string, b: string, t: number): string => {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
};
function rgbToHsl({ r, g, b }: RGB): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  return [h * 360, s, l];
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

export type BeakShape = 'cone' | 'thin' | 'hook' | 'curved' | 'long' | 'flat' | 'puffin';
export type CrestShape = 'none' | 'pointed' | 'recurved' | 'shaggy' | 'tufts';
type Colour = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'black' | 'white' | 'gray' | 'brown';

/** A real bird species described by its signature field marks, so the renderer
 *  can draw it identifiably. Colours are approximate but chosen to read true. */
export interface SpeciesSpec {
  id: string;
  name: string;
  /** Body / back / wings. */
  back: string;
  /** Top of the head. */
  crown: string;
  /** Cheek / face base. */
  face: string;
  /** Underparts. */
  belly: string;
  beak: string;
  beakShape: BeakShape;
  crest: CrestShape;
  /** Optional field marks. */
  mask?: string;
  brow?: string;
  throat?: string;
  cheekSpot?: string;
  collar?: string;
  wingBar?: string;
  /** Iris override (raptors etc.); otherwise the person's eye colour is used. */
  iris?: string;
  /** Which hair colours this species is a good match for. */
  match: Colour[];
}

export const SPECIES: SpeciesSpec[] = [
  {
    id: 'cardinal', name: 'Northern Cardinal',
    back: '#b51f2a', crown: '#c62633', face: '#c62633', belly: '#c0202a',
    beak: '#f2a33a', beakShape: 'cone', crest: 'pointed', mask: '#1a1417',
    match: ['red', 'orange'],
  },
  {
    id: 'macaw', name: 'Scarlet Macaw',
    back: '#d8202a', crown: '#d8202a', face: '#f3efe9', belly: '#d8202a',
    beak: '#e9e6df', beakShape: 'curved', crest: 'none', wingBar: '#f4c430',
    match: ['red'],
  },
  {
    id: 'robin', name: 'American Robin',
    back: '#54493d', crown: '#3c3833', face: '#3c3833', belly: '#c4632a',
    beak: '#e7b23a', beakShape: 'cone', crest: 'none', throat: '#e8e4dc',
    brow: '#d8d2c6', match: ['orange', 'brown'],
  },
  {
    id: 'eurobin', name: 'European Robin',
    back: '#6b5c3e', crown: '#6b5c3e', face: '#d96a2a', belly: '#e2d8c2',
    beak: '#3a322a', beakShape: 'thin', crest: 'none', throat: '#d96a2a',
    match: ['orange', 'brown'],
  },
  {
    id: 'oriole', name: 'Baltimore Oriole',
    back: '#1a1614', crown: '#1a1614', face: '#1a1614', belly: '#e8702a',
    beak: '#9a9aa0', beakShape: 'thin', crest: 'none', wingBar: '#f3efe9',
    match: ['orange', 'black'],
  },
  {
    id: 'goldfinch', name: 'American Goldfinch',
    back: '#1c1916', crown: '#1a1614', face: '#f3d018', belly: '#f4d524',
    beak: '#e89a5a', beakShape: 'cone', crest: 'none', wingBar: '#f3efe9',
    match: ['yellow'],
  },
  {
    id: 'cockatiel', name: 'Cockatiel',
    back: '#9a9a96', crown: '#f3dc66', face: '#f3dc66', belly: '#9a9a96',
    beak: '#8a8a84', beakShape: 'curved', crest: 'recurved', cheekSpot: '#e8743a',
    match: ['yellow', 'gray', 'white'],
  },
  {
    id: 'bluejay', name: 'Blue Jay',
    back: '#4f7fc4', crown: '#5a86c8', face: '#eef2f6', belly: '#eef2f6',
    beak: '#23262b', beakShape: 'cone', crest: 'pointed', collar: '#1a1d22',
    wingBar: '#f3f6fa', match: ['blue'],
  },
  {
    id: 'mallard', name: 'Mallard',
    back: '#9a948a', crown: '#1f7a4d', face: '#1f7a4d', belly: '#b9b6ac',
    beak: '#d9b53a', beakShape: 'flat', crest: 'none', collar: '#f0f0ec',
    throat: '#7a4a2c', match: ['green', 'gray'],
  },
  {
    id: 'eagle', name: 'Bald Eagle',
    back: '#3a2a1c', crown: '#f2f2ee', face: '#f2f2ee', belly: '#3a2a1c',
    beak: '#e8b53a', beakShape: 'hook', crest: 'none', iris: '#f2d24a',
    match: ['white', 'gray'],
  },
  {
    id: 'owl', name: 'Great Horned Owl',
    back: '#6a5237', crown: '#5a4630', face: '#b89970', belly: '#cdb89a',
    beak: '#2a2a2a', beakShape: 'hook', crest: 'tufts', iris: '#f2c83a',
    brow: '#efe7d6', match: ['brown'],
  },
  {
    id: 'sparrow', name: 'House Sparrow',
    back: '#8a6a44', crown: '#7a7066', face: '#cdb89a', belly: '#d8c4a4',
    beak: '#3a3228', beakShape: 'cone', crest: 'none', throat: '#2a2418',
    brow: '#7a4a2c', match: ['brown', 'gray'],
  },
  {
    id: 'crow', name: 'American Crow',
    back: '#23232a', crown: '#23232a', face: '#1c1c22', belly: '#26262e',
    beak: '#15151a', beakShape: 'cone', crest: 'none', iris: '#3a3340',
    match: ['black'],
  },
  {
    id: 'puffin', name: 'Atlantic Puffin',
    back: '#1c1c22', crown: '#1c1c22', face: '#f0f0ec', belly: '#f3f3ef',
    beak: '#e8702a', beakShape: 'puffin', crest: 'none',
    match: ['black', 'white'],
  },
];

/** Classify the dominant (hair) colour into a coarse bucket for species match. */
function hairColour(hex: string): Colour {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  if (l < 0.16) return 'black';
  if (l > 0.82 && s < 0.18) return 'white';
  if (s < 0.16) return 'gray';
  if (h < 18 || h >= 345) return s > 0.5 ? 'red' : 'brown';
  if (h < 45) return l < 0.5 ? 'brown' : 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 255) return 'blue';
  return 'brown';
}

export interface BirdStyle {
  speciesName: string;
  spec: SpeciesSpec;
  /** Iris colour to draw (the person's eye colour, or the species default). */
  eyeColor: string;
  seed: number;
  /** Kept for compatibility / tags. */
  feather: string;
  beakColor: string;
}

/**
 * Decide which real bird species a face becomes. The person's hair colour biases
 * the choice (so the bird's accurate colours resemble them) and the seed adds
 * variety among the matching species. Pure + deterministic.
 */
export function makeBirdStyle(features: FaceFeatures, palette: FacePalette): BirdStyle {
  const seed = birdStyleSeed(features, palette);
  const rng = mulberry32(seed);
  const cat = hairColour(palette.body);

  // Weight species that match the person's colouring, but let any species turn
  // up occasionally so it stays a surprise.
  const weighted: SpeciesSpec[] = [];
  for (const sp of SPECIES) {
    const w = sp.match.includes(cat) ? 6 : 1;
    for (let i = 0; i < w; i += 1) weighted.push(sp);
  }
  const spec = weighted[Math.floor(rng() * weighted.length) % weighted.length];

  const eyeColor = spec.iris ?? (palette.eye && /^#[0-9a-f]{6}$/i.test(palette.eye) ? palette.eye : '#3a2a1f');

  return {
    speciesName: spec.name,
    spec,
    eyeColor,
    seed,
    feather: spec.back,
    beakColor: spec.beak,
  };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };

export interface RenderInput {
  palette: FacePalette;
  params: BirdParams;
  style: BirdStyle;
}

/** A soft top-lit vertical gradient for a region. */
function vgrad(o: Ctx, x: number, y0: number, y1: number, top: string, bottom: string): CanvasGradient {
  const g = o.createLinearGradient(x, y0, x, y1);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

function ellipsePath(o: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  o.beginPath();
  o.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

/** Short feather strokes for texture, clipped to the current path region. */
function featherTexture(o: Ctx, rng: () => number, x0: number, y0: number, x1: number, y1: number, base: string, n: number): void {
  o.lineCap = 'round';
  for (let i = 0; i < n; i += 1) {
    const x = x0 + rng() * (x1 - x0);
    const y = y0 + rng() * (y1 - y0);
    const len = 3 + rng() * 5;
    const dark = rng() < 0.5;
    o.strokeStyle = dark ? shade(base, 0.82) : mix(base, '#ffffff', 0.16);
    o.globalAlpha = 0.35;
    o.lineWidth = 1.2;
    o.beginPath();
    o.moveTo(x, y - len * 0.4);
    o.quadraticCurveTo(x + 1.5, y, x, y + len * 0.6);
    o.stroke();
  }
  o.globalAlpha = 1;
}

/** A single tapered feather (for crests / tufts). */
function plume(o: Ctx, base: Pt, tip: Pt, halfW: number, color: string): void {
  const m = { x: (base.x + tip.x) / 2, y: (base.y + tip.y) / 2 };
  const ang = Math.atan2(tip.y - base.y, tip.x - base.x);
  const nx = Math.cos(ang + Math.PI / 2);
  const ny = Math.sin(ang + Math.PI / 2);
  o.fillStyle = color;
  o.beginPath();
  o.moveTo(base.x + nx * halfW, base.y + ny * halfW);
  o.quadraticCurveTo(m.x + nx * halfW, m.y + ny * halfW, tip.x, tip.y);
  o.quadraticCurveTo(m.x - nx * halfW, m.y - ny * halfW, base.x - nx * halfW, base.y - ny * halfW);
  o.closePath();
  o.fill();
}

interface Geo {
  S: number;
  cx: number;
  headCx: number;
  headCy: number;
  headRx: number;
  headRy: number;
  bodyCx: number;
  bodyCy: number;
  bodyRx: number;
  bodyRy: number;
  eyeY: number;
  eyeGap: number;
  eyeR: number;
}

function drawBeak(o: Ctx, g: Geo, spec: SpeciesSpec, lenScale: number, widScale: number): void {
  const { headCx, eyeY, eyeR } = g;
  const col = spec.beak;
  const topY = eyeY + eyeR * 1.7;
  const baseLen = eyeR * 2.0 * lenScale;
  const baseW = eyeR * 1.5 * widScale;
  const bx = headCx;

  o.lineJoin = 'round';
  o.strokeStyle = shade(col, 0.6);
  o.lineWidth = Math.max(1, g.S * 0.004);

  if (spec.beakShape === 'cone' || spec.beakShape === 'thin') {
    const w = spec.beakShape === 'thin' ? baseW * 0.55 : baseW;
    const len = spec.beakShape === 'thin' ? baseLen * 1.3 : baseLen;
    o.fillStyle = vgrad(o, bx, topY, topY + len, mix(col, '#ffffff', 0.18), shade(col, 0.78));
    o.beginPath();
    o.moveTo(bx - w * 0.5, topY);
    o.lineTo(bx + w * 0.5, topY);
    o.lineTo(bx, topY + len);
    o.closePath();
    o.fill();
    o.stroke();
    // culmen + gape
    o.strokeStyle = shade(col, 0.55);
    o.beginPath();
    o.moveTo(bx, topY);
    o.lineTo(bx, topY + len * 0.92);
    o.moveTo(bx - w * 0.5, topY);
    o.lineTo(bx + w * 0.5, topY);
    o.stroke();
  } else if (spec.beakShape === 'hook') {
    const w = baseW * 1.05;
    const len = baseLen * 1.15;
    o.fillStyle = vgrad(o, bx, topY, topY + len, mix(col, '#ffffff', 0.18), shade(col, 0.74));
    o.beginPath();
    o.moveTo(bx - w * 0.5, topY);
    o.quadraticCurveTo(bx + w * 0.55, topY - eyeR * 0.2, bx + w * 0.5, topY + len * 0.4);
    o.quadraticCurveTo(bx + w * 0.32, topY + len * 1.05, bx - w * 0.05, topY + len * 0.86);
    o.quadraticCurveTo(bx - w * 0.55, topY + len * 0.55, bx - w * 0.5, topY);
    o.closePath();
    o.fill();
    o.stroke();
    o.fillStyle = shade(col, 0.5);
    o.beginPath();
    o.ellipse(bx - w * 0.18, topY + len * 0.18, eyeR * 0.1, eyeR * 0.14, 0, 0, Math.PI * 2);
    o.fill();
  } else if (spec.beakShape === 'curved') {
    const w = baseW * 1.15;
    const len = baseLen * 1.1;
    o.fillStyle = vgrad(o, bx, topY - len * 0.3, topY + len, mix(col, '#ffffff', 0.2), shade(col, 0.7));
    o.beginPath();
    o.moveTo(bx - w * 0.5, topY - len * 0.15);
    o.quadraticCurveTo(bx + w * 0.6, topY - len * 0.35, bx + w * 0.45, topY + len * 0.35);
    o.quadraticCurveTo(bx + w * 0.2, topY + len * 1.05, bx - w * 0.18, topY + len * 0.8);
    o.quadraticCurveTo(bx - w * 0.55, topY + len * 0.4, bx - w * 0.5, topY - len * 0.15);
    o.closePath();
    o.fill();
    o.stroke();
    // lower mandible
    o.fillStyle = shade(col, 0.7);
    o.beginPath();
    o.moveTo(bx - w * 0.32, topY + len * 0.45);
    o.quadraticCurveTo(bx, topY + len * 0.9, bx + w * 0.28, topY + len * 0.5);
    o.quadraticCurveTo(bx, topY + len * 0.75, bx - w * 0.32, topY + len * 0.45);
    o.closePath();
    o.fill();
  } else if (spec.beakShape === 'long') {
    const w = baseW * 0.7;
    const len = baseLen * 2.0;
    o.fillStyle = vgrad(o, bx, topY, topY + len, mix(col, '#ffffff', 0.16), shade(col, 0.72));
    o.beginPath();
    o.moveTo(bx - w * 0.5, topY);
    o.lineTo(bx + w * 0.5, topY);
    o.lineTo(bx + w * 0.08, topY + len);
    o.lineTo(bx - w * 0.08, topY + len);
    o.closePath();
    o.fill();
    o.stroke();
  } else if (spec.beakShape === 'flat') {
    const w = baseW * 1.2;
    const len = baseLen * 1.2;
    o.fillStyle = vgrad(o, bx, topY, topY + len, mix(col, '#ffffff', 0.18), shade(col, 0.76));
    o.beginPath();
    o.moveTo(bx - w * 0.55, topY + len * 0.1);
    o.quadraticCurveTo(bx, topY - eyeR * 0.1, bx + w * 0.55, topY + len * 0.1);
    o.quadraticCurveTo(bx + w * 0.62, topY + len * 0.85, bx, topY + len);
    o.quadraticCurveTo(bx - w * 0.62, topY + len * 0.85, bx - w * 0.55, topY + len * 0.1);
    o.closePath();
    o.fill();
    o.stroke();
  } else {
    // puffin: tall triangular, three colour bands
    const w = baseW * 1.5;
    const len = baseLen * 1.7;
    const bands = ['#9aa6ae', '#f3c33a', '#e8702a'];
    for (let i = 0; i < 3; i += 1) {
      o.fillStyle = bands[i];
      const t0 = i / 3;
      const t1 = (i + 1) / 3;
      o.beginPath();
      o.moveTo(bx - (w * 0.5) * (1 - t0), topY + len * t0);
      o.lineTo(bx + (w * 0.5) * (1 - t0), topY + len * t0);
      o.lineTo(bx + (w * 0.5) * (1 - t1), topY + len * t1);
      o.lineTo(bx - (w * 0.5) * (1 - t1), topY + len * t1);
      o.closePath();
      o.fill();
    }
    o.strokeStyle = shade('#e8702a', 0.6);
    o.beginPath();
    o.moveTo(bx - w * 0.5, topY);
    o.lineTo(bx, topY + len);
    o.lineTo(bx + w * 0.5, topY);
    o.stroke();
  }
}

function drawCrest(o: Ctx, g: Geo, spec: SpeciesSpec, height: number): void {
  const { headCx, headCy, headRx, headRy, eyeR } = g;
  const topY = headCy - headRy;
  const col = spec.crown;
  if (spec.crest === 'none' || height <= 0) return;

  if (spec.crest === 'tufts') {
    for (const dir of [-1, 1] as const) {
      const b: Pt = { x: headCx + dir * headRx * 0.62, y: topY + eyeR * 0.6 };
      const tip: Pt = { x: b.x + dir * eyeR * 1.2, y: b.y - height * 1.1 };
      plume(o, b, tip, eyeR * 0.7, mix(col, '#000000', 0.1));
      plume(o, { x: b.x, y: b.y }, { x: b.x + dir * eyeR * 0.4, y: b.y - height * 0.8 }, eyeR * 0.45, mix(col, '#ffffff', 0.12));
    }
    return;
  }
  if (spec.crest === 'pointed') {
    // A single swept-back peak (cardinal / jay).
    o.fillStyle = col;
    o.beginPath();
    o.moveTo(headCx - headRx * 0.5, topY + eyeR * 0.4);
    o.quadraticCurveTo(headCx - eyeR * 0.4, topY - height, headCx + headRx * 0.18, topY - height * 0.55);
    o.quadraticCurveTo(headCx + headRx * 0.2, topY + eyeR * 0.1, headCx + headRx * 0.3, topY + eyeR * 0.4);
    o.closePath();
    o.fill();
    return;
  }
  if (spec.crest === 'recurved') {
    // Cockatiel: tall forward-curving plumes.
    const count = 3;
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1) - 0.5;
      const b: Pt = { x: headCx + t * eyeR * 1.0, y: topY + eyeR * 0.3 };
      const tip: Pt = { x: headCx - eyeR * 0.6 + t * eyeR * 0.6, y: b.y - height * 1.5 };
      plume(o, b, tip, eyeR * 0.5, i === 1 ? spec.cheekSpot ?? col : col);
    }
    return;
  }
  // shaggy
  const count = 5;
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1) - 0.5;
    const b: Pt = { x: headCx + t * headRx * 0.9, y: topY + eyeR * 0.3 };
    const tip: Pt = { x: b.x + t * eyeR * 0.6, y: b.y - height * (1 - Math.abs(t) * 0.4) };
    plume(o, b, tip, eyeR * 0.4, mix(col, '#000000', (i % 2) * 0.12));
  }
}

function drawEye(o: Ctx, cx: number, cy: number, r: number, iris: string, ring: string): void {
  // socket / eye-ring
  o.fillStyle = ring;
  ellipsePath(o, cx, cy, r * 1.32, r * 1.32);
  o.fill();
  // iris
  const g = o.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.2, cx, cy, r);
  g.addColorStop(0, mix(iris, '#ffffff', 0.35));
  g.addColorStop(0.7, iris);
  g.addColorStop(1, shade(iris, 0.6));
  o.fillStyle = g;
  ellipsePath(o, cx, cy, r, r);
  o.fill();
  // pupil
  o.fillStyle = '#0a0a0a';
  ellipsePath(o, cx, cy, r * 0.5, r * 0.5);
  o.fill();
  // catchlight
  o.fillStyle = '#ffffff';
  ellipsePath(o, cx - r * 0.28, cy - r * 0.3, r * 0.16, r * 0.16);
  o.fill();
}

/**
 * Render a smoothly-shaded, species-accurate bird into `canvas` (square of
 * `sizePx`). The species + colours come from `style`; the proportions come from
 * the person's features in `params`.
 */
export function renderBird(canvas: HTMLCanvasElement, input: RenderInput, sizePx: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { params, style } = input;
  const spec = style.spec;
  const S = sizePx;
  canvas.width = S;
  canvas.height = S;
  const o = ctx;
  o.imageSmoothingEnabled = true;
  o.clearRect(0, 0, S, S);

  const rng = mulberry32(style.seed);

  // Proportions from the person's features (params are in a ~100 grid).
  const roundness = (params.bodyWidth - 46) / 18; // 0..1
  const eyeR = S * lerp(0.05, 0.075, (params.eyeRadius - 5.5) / 6.5);
  const eyeGap = S * lerp(0.16, 0.26, (params.eyeGap - 16) / 18);
  const crestH = S * lerp(0.06, 0.2, (params.crestHeight - 4) / 18);
  const beakLenScale = lerp(0.85, 1.3, (params.beakLength - 7) / 9);
  const beakWidScale = lerp(0.85, 1.25, (params.beakWidth - 7) / 8);

  const cx = S / 2;
  const headCx = cx;
  const headCy = S * 0.4;
  const headRx = S * lerp(0.2, 0.24, roundness);
  const headRy = S * lerp(0.22, 0.2, roundness);
  const bodyCx = cx;
  const bodyCy = S * 0.74;
  const bodyRx = S * lerp(0.27, 0.32, roundness);
  const bodyRy = S * 0.26;
  const eyeY = headCy - headRy * 0.12;

  const g: Geo = { S, cx, headCx, headCy, headRx, headRy, bodyCx, bodyCy, bodyRx, bodyRy, eyeY, eyeGap, eyeR };

  // --- Background: soft radial vignette tinted by the species ---
  const bgTint = mix(spec.back, '#ffffff', 0.78);
  const bgGrad = o.createRadialGradient(cx, S * 0.42, S * 0.1, cx, S * 0.5, S * 0.72);
  bgGrad.addColorStop(0, mix(bgTint, '#ffffff', 0.4));
  bgGrad.addColorStop(1, shade(bgTint, 0.9));
  o.fillStyle = bgGrad;
  o.fillRect(0, 0, S, S);

  // --- Body ---
  o.save();
  ellipsePath(o, bodyCx, bodyCy, bodyRx, bodyRy);
  o.fillStyle = vgrad(o, bodyCx, bodyCy - bodyRy, bodyCy + bodyRy, mix(spec.back, '#ffffff', 0.16), shade(spec.back, 0.82));
  o.fill();
  o.clip();
  featherTexture(o, rng, bodyCx - bodyRx, bodyCy - bodyRy, bodyCx + bodyRx, bodyCy + bodyRy, spec.back, 70);
  // belly (front underpart)
  o.fillStyle = vgrad(o, bodyCx, bodyCy - bodyRy * 0.2, bodyCy + bodyRy, mix(spec.belly, '#ffffff', 0.12), shade(spec.belly, 0.9));
  o.globalAlpha = 0.96;
  ellipsePath(o, bodyCx, bodyCy + bodyRy * 0.18, bodyRx * 0.66, bodyRy * 0.86);
  o.fill();
  o.globalAlpha = 1;
  // throat patch
  if (spec.throat) {
    o.fillStyle = spec.throat;
    ellipsePath(o, bodyCx, bodyCy - bodyRy * 0.5, bodyRx * 0.5, bodyRy * 0.5);
    o.fill();
  }
  // collar (mallard white ring)
  if (spec.collar) {
    o.strokeStyle = spec.collar;
    o.lineWidth = S * 0.03;
    o.beginPath();
    o.ellipse(bodyCx, bodyCy - bodyRy * 0.78, bodyRx * 0.62, bodyRy * 0.3, 0, Math.PI * 0.1, Math.PI * 0.9);
    o.stroke();
  }
  // wing bar accent
  if (spec.wingBar) {
    o.fillStyle = spec.wingBar;
    for (const dir of [-1, 1] as const) {
      ellipsePath(o, bodyCx + dir * bodyRx * 0.6, bodyCy + bodyRy * 0.1, bodyRx * 0.16, bodyRy * 0.4);
      o.fill();
    }
  }
  o.restore();

  // --- Crest behind the head ---
  drawCrest(o, g, spec, crestH);

  // --- Head ---
  o.save();
  ellipsePath(o, headCx, headCy, headRx, headRy);
  o.fillStyle = vgrad(o, headCx, headCy - headRy, headCy + headRy, mix(spec.face, '#ffffff', 0.16), shade(spec.face, 0.85));
  o.fill();
  o.clip();
  // crown cap (top of head) if different from face
  if (spec.crown !== spec.face) {
    o.fillStyle = vgrad(o, headCx, headCy - headRy, headCy, mix(spec.crown, '#ffffff', 0.14), spec.crown);
    o.beginPath();
    o.ellipse(headCx, headCy - headRy * 0.18, headRx * 1.02, headRy * 0.82, 0, Math.PI, Math.PI * 2);
    o.lineTo(headCx + headRx, headCy - headRy * 0.18);
    o.fill();
  }
  featherTexture(o, rng, headCx - headRx, headCy - headRy, headCx + headRx, headCy + headRy, spec.face, 36);
  // eye mask stripe
  if (spec.mask) {
    o.fillStyle = spec.mask;
    o.beginPath();
    o.moveTo(headCx - headRx, eyeY - eyeR * 0.2);
    o.quadraticCurveTo(headCx, eyeY + eyeR * 1.3, headCx + headRx, eyeY - eyeR * 0.2);
    o.lineTo(headCx + headRx, eyeY + eyeR * 1.6);
    o.quadraticCurveTo(headCx, eyeY + eyeR * 2.6, headCx - headRx, eyeY + eyeR * 1.6);
    o.closePath();
    o.fill();
  }
  // supercilium / brow stripe
  if (spec.brow) {
    o.strokeStyle = spec.brow;
    o.lineWidth = eyeR * 0.5;
    o.lineCap = 'round';
    for (const dir of [-1, 1] as const) {
      o.beginPath();
      o.moveTo(headCx + dir * eyeGap * 0.2, eyeY - eyeR * 1.1);
      o.quadraticCurveTo(headCx + dir * eyeGap * 0.7, eyeY - eyeR * 1.5, headCx + dir * headRx * 0.92, eyeY - eyeR * 0.9);
      o.stroke();
    }
  }
  // cheek spot (cockatiel)
  if (spec.cheekSpot) {
    o.fillStyle = spec.cheekSpot;
    for (const dir of [-1, 1] as const) {
      ellipsePath(o, headCx + dir * eyeGap * 0.62, eyeY + eyeR * 0.9, eyeR * 0.7, eyeR * 0.7);
      o.fill();
    }
  }
  o.restore();

  // subtle head outline for separation from the background
  o.strokeStyle = shade(spec.face, 0.7);
  o.lineWidth = Math.max(1, S * 0.004);
  ellipsePath(o, headCx, headCy, headRx, headRy);
  o.stroke();

  // --- Beak ---
  drawBeak(o, g, spec, beakLenScale, beakWidScale);

  // --- Eyes (iris = the person's eye colour) ---
  const ring = mix(spec.face, '#000000', 0.5);
  drawEye(o, headCx - eyeGap / 2, eyeY, eyeR, style.eyeColor, ring);
  drawEye(o, headCx + eyeGap / 2, eyeY, eyeR, style.eyeColor, ring);
}
