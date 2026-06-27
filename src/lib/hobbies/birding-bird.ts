/**
 * Birding hobby: the pure "you as a bird" mapping plus pixel renderer.
 *
 * Split from birding.ts (which owns the camera, the MediaPipe landmark model,
 * and the DOM) so this part is dependency-free and unit-testable, the same way
 * stocking.ts is split out of the aquarium engine.
 *
 * The bird is a fixed, front-facing, perched songbird: same pose, orientation,
 * and art style every time. Only its variable slots change (eye size, eye
 * spacing, beak shape, body roundness, crest height, and plumage colors), and
 * every slot is driven by a measured facial feature, so e.g. wide eyes give a
 * wide-eyed bird and wide-set eyes give a wide-set bird. Given the same features
 * and palette the output is identical (deterministic): same person, same bird.
 *
 * The feature → slot ranges are approximate and tuned by feel (like the aquarium
 * numbers), not derived from any dataset.
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
  /** Mouth curvature, -1 (frown) .. 1 (smile). Nudges the cheek blush + eye line. */
  smile: number;
}

/** Colors sampled from the selfie, already converted to #rrggbb hex. */
export interface FacePalette {
  /** Body plumage (sampled from hair / dominant region). */
  body: string;
  /** Belly patch (a lightened body tone). */
  belly: string;
  /** Crest + wing accent (sampled from lips / eye region). */
  accent: string;
  /** Beak (warm-shifted skin tone). */
  beak: string;
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

/** Logical bird-space size. Rendered small then scaled up with smoothing off. */
export const BIRD_SPACE = 100;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

/**
 * Map measured facial features + palette to concrete bird drawing slots.
 * Pure and deterministic: identical inputs always yield an identical object.
 */
export function featuresToBird(features: FaceFeatures, palette: FacePalette): BirdParams {
  const f = features;
  return {
    // Wide eyes -> bigger eyes. The single most legible mapping.
    eyeRadius: lerp(5.5, 12, f.eyeOpenness),
    // Wide-set eyes -> larger gap between the two eyes.
    eyeGap: lerp(16, 34, f.eyeSpacing),
    // A smile lifts the eyes a touch; a frown drops them.
    eyeY: 44 - clamp(f.smile, -1, 1) * 1.5,
    // Longer nose -> longer beak; wider mouth -> wider beak.
    beakLength: lerp(7, 16, f.noseLength),
    beakWidth: lerp(7, 15, f.mouthWidth),
    // Rounder face -> rounder (wider, shorter) body.
    bodyWidth: lerp(46, 64, f.faceRoundness),
    bodyHeight: lerp(58, 46, f.faceRoundness),
    // Raised brows -> taller crest.
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
 * same selfie produces the same bird. Quantizing first means two near-identical
 * photos of the same person still collapse to the same seed.
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
// Portrait renderer. Bird-first: it builds an avian head (silhouette, crest,
// beak, markings) whose *species* and colors are chosen by a seed derived from
// the selfie (makeBirdStyle), so each face yields a different bird. The person's
// own eyes/brow are preserved in a narrow mask, and their facial features still
// drive proportions (crest height, beak size), so it still looks like them.
// Browser-only (uses canvas/Image); not unit-tested (the pure style picker is).
// ---------------------------------------------------------------------------

/** Working resolution of the pixel-art buffer. The face is drawn at this size
 *  then scaled up with smoothing off, so a smaller value = chunkier pixels.
 *  Tuned so the person stays clearly recognizable. */
export const PIXEL_RES = 150;

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };

/** A normalized landmark (only x/y are used here). */
export interface LandmarkXY {
  x: number;
  y: number;
}

export interface PortraitInput {
  /** The selfie, already drawn into a canvas at its own pixel size. */
  source: HTMLCanvasElement;
  /** MediaPipe face landmarks, normalized to [0,1] over the source. */
  landmarks: LandmarkXY[];
  /** Colors sampled from the selfie. */
  palette: FacePalette;
  /** Feature-driven sizing (crest/beak), so your features still shape the bird. */
  params: BirdParams;
  /** Seed-driven species + style, so each selfie yields a different bird. */
  style: BirdStyle;
}

// FaceMesh canonical indices used for placing the bird parts.
const L = {
  rEyeOuter: 33,
  rEyeInner: 133,
  lEyeInner: 362,
  lEyeOuter: 263,
  foreheadTop: 10,
  chin: 152,
  cheekR: 234,
  cheekL: 454,
  noseTip: 1,
  noseBottom: 2,
  mouthTop: 13,
  mouthBot: 14,
  browR: 70,
  browL: 300,
};

const dist2 = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

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
const shadeHex = (hex: string, f: number): string => {
  const c = hexToRgb(hex);
  return rgbToHex({ r: c.r * f, g: c.g * f, b: c.b * f });
};
const mixHex = (a: string, b: string, t: number): string => {
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

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const pp = 2 * l - q;
  const hue = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return pp + (q - pp) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return pp + (q - pp) * (2 / 3 - t) * 6;
    return pp;
  };
  return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255 };
}

/** A feather color built from a hue + believable saturation/lightness range. */
function featherColor(hue: number, sat: number, light: number): string {
  return rgbToHex(hslToRgb(hue, clamp01(sat), clamp01(light)));
}

/** Small deterministic PRNG (mulberry32). Same seed -> same sequence. */
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

/** FNV-1a hash of a string -> 32-bit unsigned int. */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A richer seed than birdSeed(): sensitive enough that any meaningful change in
 * the selfie (features or sampled colors) yields a different bird, while the
 * exact same input always reproduces the same one.
 */
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

export type CrestStyle = 'none' | 'smooth' | 'spiky' | 'mohawk' | 'tall' | 'tufts';
export type BeakStyle = 'cone' | 'hook' | 'curved' | 'long' | 'flat';
export type MarkingStyle = 'none' | 'eyestripe' | 'cheek' | 'crown' | 'spots';

/** Everything the seed decides about which kind of bird you get. */
export interface BirdStyle {
  speciesName: string;
  headRxScale: number;
  headRyScale: number;
  facialDisk: number;
  crest: CrestStyle;
  beak: BeakStyle;
  beakScale: number;
  marking: MarkingStyle;
  /** Resolved feather palette (already hue-varied, still tied to the person). */
  feather: string;
  featherDark: string;
  featherLight: string;
  accent: string;
  beakColor: string;
  eyeRingColor: string;
  bg: string;
  chest: string;
}

interface SpeciesPreset {
  name: string;
  head: [number, number];
  disk: number;
  crest: CrestStyle;
  beak: BeakStyle;
  beakScale: number;
  marking: MarkingStyle;
}

/** The roster of bird archetypes the seed can land on. */
const SPECIES: SpeciesPreset[] = [
  { name: 'Songbird', head: [1.0, 1.0], disk: 0, crest: 'smooth', beak: 'cone', beakScale: 0.8, marking: 'none' },
  { name: 'Finch', head: [1.05, 0.95], disk: 0, crest: 'none', beak: 'cone', beakScale: 0.75, marking: 'cheek' },
  { name: 'Cardinal', head: [0.95, 1.05], disk: 0, crest: 'tall', beak: 'cone', beakScale: 0.85, marking: 'eyestripe' },
  { name: 'Jay', head: [1.0, 1.0], disk: 0, crest: 'spiky', beak: 'cone', beakScale: 0.9, marking: 'crown' },
  { name: 'Cockatiel', head: [1.05, 1.0], disk: 0, crest: 'tall', beak: 'curved', beakScale: 0.7, marking: 'cheek' },
  { name: 'Parrot', head: [1.1, 1.05], disk: 0, crest: 'mohawk', beak: 'curved', beakScale: 1.05, marking: 'cheek' },
  { name: 'Owl', head: [1.2, 1.05], disk: 0.9, crest: 'tufts', beak: 'hook', beakScale: 0.7, marking: 'none' },
  { name: 'Hawk', head: [1.0, 1.05], disk: 0, crest: 'none', beak: 'hook', beakScale: 0.95, marking: 'eyestripe' },
  { name: 'Eagle', head: [1.05, 1.1], disk: 0, crest: 'smooth', beak: 'hook', beakScale: 1.05, marking: 'none' },
  { name: 'Heron', head: [0.9, 1.0], disk: 0, crest: 'spiky', beak: 'long', beakScale: 1.15, marking: 'eyestripe' },
  { name: 'Duck', head: [1.1, 0.95], disk: 0, crest: 'none', beak: 'flat', beakScale: 1.0, marking: 'none' },
  { name: 'Toucan', head: [1.0, 1.0], disk: 0, crest: 'none', beak: 'long', beakScale: 1.3, marking: 'none' },
  { name: 'Kingfisher', head: [1.05, 1.0], disk: 0, crest: 'spiky', beak: 'long', beakScale: 1.1, marking: 'crown' },
  { name: 'Robin', head: [1.0, 1.0], disk: 0, crest: 'smooth', beak: 'cone', beakScale: 0.78, marking: 'eyestripe' },
];

/** Color-mood adjectives, chosen by the bird's dominant hue, for a fun name. */
function hueMood(hue: number): string {
  const moods: [number, string][] = [
    [20, 'Ember'],
    [50, 'Amber'],
    [80, 'Meadow'],
    [160, 'Jade'],
    [210, 'Azure'],
    [260, 'Indigo'],
    [320, 'Orchid'],
    [360, 'Crimson'],
  ];
  for (const [max, name] of moods) if (hue < max) return name;
  return 'Dusk';
}

/**
 * Decide which kind of bird a given face + palette produces. Pure and
 * deterministic. The species/colors come from the seed (so different people, and
 * even small selfie changes, get visibly different birds); the caller still
 * feeds facial features into the proportions for personal likeness.
 */
export function makeBirdStyle(features: FaceFeatures, palette: FacePalette): BirdStyle {
  const seed = birdStyleSeed(features, palette);
  const rng = mulberry32(seed);

  const species = SPECIES[Math.floor(rng() * SPECIES.length) % SPECIES.length];

  // Build feather colors from the person's dominant color, but rotate the hue by
  // a seeded amount so even similar-looking friends get different plumage, and
  // pin saturation/lightness into a believable feather range.
  const [baseHue] = rgbToHsl(hexToRgb(palette.body));
  const hueShift = (rng() - 0.5) * 220;
  const featherHue = ((baseHue + hueShift) % 360 + 360) % 360;
  const featherSat = 0.32 + rng() * 0.4;
  const featherLight = 0.34 + rng() * 0.16;
  const feather = featherColor(featherHue, featherSat, featherLight);
  const featherDark = featherColor(featherHue, featherSat * 1.05, featherLight * 0.62);
  const featherLightC = featherColor(featherHue, featherSat * 0.6, Math.min(0.9, featherLight + 0.34));

  // Accent: either complementary or analogous to the feather hue, seeded.
  const accentHue = featherHue + (rng() < 0.5 ? 180 : 40 + rng() * 60);
  const accent = featherColor(accentHue, 0.55 + rng() * 0.35, 0.5 + rng() * 0.12);

  // Beak color: a seeded warm/dark choice, nudged toward the sampled skin tone.
  const beakChoices = ['#f4a72b', '#f6c343', '#e8842a', '#d96b2b', '#2b2b2b', '#6b6256'];
  const beakColor = mixHex(beakChoices[Math.floor(rng() * beakChoices.length) % beakChoices.length], palette.beak, 0.2);

  const bg = featherColor(featherHue + 12, 0.18 + rng() * 0.12, 0.86);
  const chest = featherColor(featherHue, featherSat * 0.5, Math.min(0.92, featherLight + 0.42));
  const eyeRingColor = mixHex(featherDark, '#101010', 0.3);

  return {
    speciesName: `${hueMood(featherHue)} ${species.name}`,
    headRxScale: species.head[0],
    headRyScale: species.head[1],
    facialDisk: species.disk,
    crest: species.crest,
    beak: species.beak,
    beakScale: species.beakScale,
    marking: species.marking,
    feather,
    featherDark,
    featherLight: featherLightC,
    accent,
    beakColor,
    eyeRingColor,
    bg,
    chest,
  };
}

/** Draw a filled feather (teardrop) from base to tip with a soft midrib. */
function feather(o: Ctx, base: Pt, tip: Pt, halfW: number, color: string): void {
  const ang = Math.atan2(tip.y - base.y, tip.x - base.x);
  const nx = Math.cos(ang + Math.PI / 2);
  const ny = Math.sin(ang + Math.PI / 2);
  const m = mid(base, tip);
  o.fillStyle = color;
  o.beginPath();
  o.moveTo(base.x + nx * halfW, base.y + ny * halfW);
  o.quadraticCurveTo(m.x + nx * halfW * 0.7, m.y + ny * halfW * 0.7, tip.x, tip.y);
  o.quadraticCurveTo(m.x - nx * halfW * 0.7, m.y - ny * halfW * 0.7, base.x - nx * halfW, base.y - ny * halfW);
  o.closePath();
  o.fill();
  o.strokeStyle = shadeHex(color, 0.8);
  o.lineWidth = Math.max(0.6, halfW * 0.12);
  o.beginPath();
  o.moveTo(base.x, base.y);
  o.lineTo(tip.x, tip.y);
  o.stroke();
}

interface HeadGeo {
  headCx: number;
  headCy: number;
  headRx: number;
  headRy: number;
  headTopY: number;
  eyeDist: number;
  eyeMid: Pt;
  eyeR: Pt;
  eyeL: Pt;
  mouthC: Pt;
}

/** Draw the crown/crest in the style the seed chose. */
function drawCrest(o: Ctx, g: HeadGeo, style: BirdStyle, crestHeight: number): void {
  const { headCx, headTopY, eyeDist } = g;
  const accent = style.accent;
  const base = style.feather;
  if (style.crest === 'none' || crestHeight <= 0) return;

  if (style.crest === 'tufts') {
    // Owl-style ear tufts at the top corners.
    for (const dir of [-1, 1] as const) {
      const b: Pt = { x: headCx + dir * g.headRx * 0.62, y: headTopY + eyeDist * 0.2 };
      const tip: Pt = { x: b.x + dir * eyeDist * 0.3, y: b.y - crestHeight * 1.1 };
      feather(o, b, tip, eyeDist * 0.14, mixHex(base, accent, 0.3));
    }
    return;
  }
  if (style.crest === 'mohawk') {
    // A central fan of tall feathers (parrot/cockatoo).
    const count = 5;
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1) - 0.5;
      const b: Pt = { x: headCx + t * eyeDist * 0.5, y: headTopY + eyeDist * 0.1 };
      const tip: Pt = { x: headCx + t * eyeDist * 1.3, y: b.y - crestHeight * 1.25 * (1 - Math.abs(t) * 0.2) };
      feather(o, b, tip, eyeDist * 0.13, mixHex(base, accent, 0.2 + Math.abs(t)));
    }
    return;
  }
  if (style.crest === 'tall') {
    // Two or three tall curved plumes (cardinal/cockatiel).
    const count = 3;
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1) - 0.5;
      const b: Pt = { x: headCx + t * eyeDist * 0.4, y: headTopY + eyeDist * 0.12 };
      const tip: Pt = { x: headCx + t * eyeDist * 0.7 + eyeDist * 0.2, y: b.y - crestHeight * 1.4 };
      feather(o, b, tip, eyeDist * 0.12, mixHex(base, accent, 0.35 + i * 0.15));
    }
    return;
  }
  if (style.crest === 'spiky') {
    // A row of sharp feathers (jay/heron).
    const count = 6;
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1) - 0.5;
      const b: Pt = { x: headCx + t * g.headRx * 1.0, y: headTopY + eyeDist * 0.14 + Math.abs(t) * eyeDist * 0.1 };
      const tip: Pt = { x: b.x + t * eyeDist * 0.4, y: b.y - crestHeight * (1 - Math.abs(t) * 0.4) };
      feather(o, b, tip, eyeDist * 0.09, mixHex(base, accent, 0.25 + (i % 2) * 0.3));
    }
    return;
  }
  // 'smooth': a low rounded plumage hump.
  o.fillStyle = mixHex(base, accent, 0.25);
  o.beginPath();
  o.ellipse(headCx, headTopY + eyeDist * 0.05, g.headRx * 0.6, crestHeight * 0.9, 0, Math.PI, Math.PI * 2);
  o.fill();
}

/** Draw the beak in the style the seed chose, sized by the person's features. */
function drawBeak(o: Ctx, g: HeadGeo, style: BirdStyle, lenScale: number, widScale: number): void {
  const { eyeDist, eyeMid, headCx, mouthC } = g;
  const col = style.beakColor;
  const bx = headCx + (mouthC.x - headCx) * 0.3;
  const topY = eyeMid.y + eyeDist * 0.45;
  const len = eyeDist * style.beakScale * (1.0 + lenScale) ;
  const w = eyeDist * style.beakScale * (0.95 + widScale);

  o.fillStyle = col;
  o.strokeStyle = shadeHex(col, 0.6);
  o.lineWidth = Math.max(1, eyeDist * 0.04);

  if (style.beak === 'cone') {
    // Short triangular songbird beak.
    o.beginPath();
    o.moveTo(bx - w * 0.42, topY);
    o.lineTo(bx + w * 0.42, topY);
    o.lineTo(bx, topY + len * 0.85);
    o.closePath();
    o.fill();
    o.stroke();
  } else if (style.beak === 'curved') {
    // Parrot: short, deep, strongly hooked.
    o.beginPath();
    o.moveTo(bx - w * 0.5, topY);
    o.quadraticCurveTo(bx + w * 0.55, topY - eyeDist * 0.05, bx + w * 0.5, topY + len * 0.35);
    o.quadraticCurveTo(bx + w * 0.3, topY + len * 0.95, bx - w * 0.1, topY + len * 0.8);
    o.quadraticCurveTo(bx - w * 0.5, topY + len * 0.55, bx - w * 0.5, topY);
    o.closePath();
    o.fill();
    o.stroke();
  } else if (style.beak === 'long') {
    // Heron/toucan: long and pointed (toucan gets the big beakScale).
    o.beginPath();
    o.moveTo(bx - w * 0.34, topY);
    o.lineTo(bx + w * 0.34, topY);
    o.lineTo(bx + w * 0.05, topY + len * 1.7);
    o.lineTo(bx - w * 0.05, topY + len * 1.7);
    o.closePath();
    o.fill();
    o.stroke();
  } else if (style.beak === 'flat') {
    // Duck: wide rounded spatula.
    o.beginPath();
    o.moveTo(bx - w * 0.55, topY + len * 0.1);
    o.quadraticCurveTo(bx, topY - eyeDist * 0.04, bx + w * 0.55, topY + len * 0.1);
    o.quadraticCurveTo(bx + w * 0.62, topY + len * 0.8, bx, topY + len * 0.92);
    o.quadraticCurveTo(bx - w * 0.62, topY + len * 0.8, bx - w * 0.55, topY + len * 0.1);
    o.closePath();
    o.fill();
    o.stroke();
  } else {
    // 'hook' (raptor): upper mandible with a downturned tip + lower mandible.
    o.beginPath();
    o.moveTo(bx - w * 0.5, topY);
    o.quadraticCurveTo(bx, topY - eyeDist * 0.08, bx + w * 0.5, topY);
    o.quadraticCurveTo(bx + w * 0.22, topY + len * 0.55, bx, topY + len);
    o.quadraticCurveTo(bx - w * 0.28, topY + len * 0.5, bx - w * 0.5, topY);
    o.closePath();
    o.fill();
    o.stroke();
    o.fillStyle = shadeHex(col, 0.82);
    o.beginPath();
    o.moveTo(bx - w * 0.3, topY + len * 0.36);
    o.quadraticCurveTo(bx, topY + len * 0.78, bx + w * 0.3, topY + len * 0.36);
    o.quadraticCurveTo(bx, topY + len * 0.66, bx - w * 0.3, topY + len * 0.36);
    o.closePath();
    o.fill();
  }

  // nostrils near the top of the beak
  o.fillStyle = shadeHex(col, 0.5);
  for (const s of [-1, 1]) {
    o.beginPath();
    o.ellipse(bx + s * w * 0.16, topY + len * 0.16, eyeDist * 0.03, eyeDist * 0.04, 0, 0, Math.PI * 2);
    o.fill();
  }
}

/** Draw seed-chosen markings (eye stripe, cheek patches, crown patch, spots). */
function drawMarkings(o: Ctx, g: HeadGeo, style: BirdStyle): void {
  const { eyeDist, eyeMid, eyeR, eyeL, headCx, headTopY } = g;
  if (style.marking === 'eyestripe') {
    o.strokeStyle = mixHex(style.featherDark, '#000000', 0.4);
    o.lineWidth = Math.max(1.5, eyeDist * 0.22);
    o.beginPath();
    o.moveTo(eyeL.x + eyeDist * 0.4, eyeMid.y);
    o.lineTo(eyeR.x - eyeDist * 0.4, eyeMid.y);
    o.stroke();
  } else if (style.marking === 'cheek') {
    o.fillStyle = mixHex(style.accent, '#ffffff', 0.2);
    for (const e of [eyeR, eyeL]) {
      o.beginPath();
      o.ellipse(e.x, e.y + eyeDist * 0.42, eyeDist * 0.18, eyeDist * 0.16, 0, 0, Math.PI * 2);
      o.fill();
    }
  } else if (style.marking === 'crown') {
    o.fillStyle = mixHex(style.accent, style.featherDark, 0.3);
    o.beginPath();
    o.ellipse(headCx, headTopY + eyeDist * 0.25, eyeDist * 0.6, eyeDist * 0.3, 0, Math.PI, Math.PI * 2);
    o.fill();
  } else if (style.marking === 'spots') {
    o.fillStyle = mixHex(style.featherLight, '#ffffff', 0.2);
    for (let i = 0; i < 8; i += 1) {
      const ang = (i / 8) * Math.PI * 2;
      o.beginPath();
      o.ellipse(headCx + Math.cos(ang) * g.headRx * 0.55, g.headCy + Math.sin(ang) * g.headRy * 0.55, eyeDist * 0.05, eyeDist * 0.05, 0, 0, Math.PI * 2);
      o.fill();
    }
  }
}

/**
 * Render the selfie as a pixel-art portrait with bird touches into `canvas`
 * (a square of `sizePx`). Keeps the person recognizable.
 */
export function renderBirdPortrait(canvas: HTMLCanvasElement, input: PortraitInput, sizePx: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { source, landmarks, palette, params, style } = input;
  const W = source.width;
  const H = source.height;
  if (!W || !H || landmarks.length < 468) return;

  // Face bounding box (in source pixels) from all landmarks.
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const fx0 = minX * W;
  const fy0 = minY * H;
  const fw = (maxX - minX) * W;
  const fh = (maxY - minY) * H;

  // Expand: extra headroom on top for the crest, a little around the rest.
  const padTop = fh * 0.62;
  const padBot = fh * 0.3;
  const padX = fw * 0.22;
  let x0 = fx0 - padX;
  let y0 = fy0 - padTop;
  const x1 = fx0 + fw + padX;
  const y1 = fy0 + fh + padBot;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const side = Math.max(x1 - x0, y1 - y0);
  x0 = cx - side / 2;
  y0 = cy - side / 2;

  const bg = mixHex(palette.body, '#ffffff', 0.55);

  // Square padded crop (fills out-of-image areas with bg so the crest has a
  // clean backdrop and there are no stretched edges).
  const PAD = Math.max(1, Math.round(side));
  const pad = document.createElement('canvas');
  pad.width = PAD;
  pad.height = PAD;
  const pc = pad.getContext('2d');
  if (!pc) return;
  pc.fillStyle = bg;
  pc.fillRect(0, 0, PAD, PAD);
  pc.imageSmoothingEnabled = true;
  pc.drawImage(source, -x0, -y0);

  // Downscale the crop into the low-res buffer (this is what pixelates it).
  const OFF = PIXEL_RES;
  const off = document.createElement('canvas');
  off.width = OFF;
  off.height = OFF;
  const o = off.getContext('2d');
  if (!o) return;
  o.imageSmoothingEnabled = true;
  o.drawImage(pad, 0, 0, PAD, PAD, 0, 0, OFF, OFF);

  // Keep a copy of the pixelated selfie so we can reuse human traits (eyes/brow)
  // inside a bird-first head shape.
  const faceTex = document.createElement('canvas');
  faceTex.width = OFF;
  faceTex.height = OFF;
  const ft = faceTex.getContext('2d');
  if (!ft) return;
  ft.imageSmoothingEnabled = false;
  ft.drawImage(off, 0, 0);

  // Landmark -> low-res buffer coordinates.
  const p = (i: number): Pt => ({
    x: ((landmarks[i].x * W - x0) / side) * OFF,
    y: ((landmarks[i].y * H - y0) / side) * OFF,
  });

  const eyeR = mid(p(L.rEyeOuter), p(L.rEyeInner));
  const eyeL = mid(p(L.lEyeOuter), p(L.lEyeInner));
  const eyeMid = mid(eyeR, eyeL);
  const eyeDist = Math.max(6, dist2(eyeR, eyeL));
  const cheekR = p(L.cheekR);
  const cheekL = p(L.cheekL);
  const headTop = p(L.foreheadTop);
  const chin = p(L.chin);
  const mouthC = mid(p(L.mouthTop), p(L.mouthBot));
  const headW = Math.max(eyeDist, dist2(cheekR, cheekL));
  const headH = Math.max(eyeDist * 1.8, dist2(headTop, chin));
  const headCx = (cheekR.x + cheekL.x) / 2;
  const headCy = eyeMid.y + headH * 0.12;
  // Seed-driven head proportions, still nudged by the person's face roundness.
  const headRx = headW * 0.72 * style.headRxScale;
  const headRy = headH * 0.7 * style.headRyScale;
  const headTopY = headCy - headRy;

  const plumage = style.feather;
  const featherDark = style.featherDark;
  const featherLight = style.featherLight;

  const geo: HeadGeo = { headCx, headCy, headRx, headRy, headTopY, eyeDist, eyeMid, eyeR, eyeL, mouthC };

  // Clear out the selfie-first crop and rebuild as a bird-first portrait.
  o.clearRect(0, 0, OFF, OFF);
  o.fillStyle = style.bg;
  o.fillRect(0, 0, OFF, OFF);

  // Neck and body plumage
  o.fillStyle = featherDark;
  o.beginPath();
  o.moveTo(headCx - headRx * 0.45, headCy + headRy * 0.52);
  o.lineTo(headCx + headRx * 0.45, headCy + headRy * 0.52);
  o.lineTo(headCx + headRx * 0.9, OFF);
  o.lineTo(headCx - headRx * 0.9, OFF);
  o.closePath();
  o.fill();

  // Main bird head silhouette
  o.fillStyle = plumage;
  o.beginPath();
  o.ellipse(headCx, headCy, headRx, headRy, 0, 0, Math.PI * 2);
  o.fill();

  // Owl-style facial disk (only for species whose style.facialDisk > 0).
  if (style.facialDisk > 0) {
    o.fillStyle = featherLight;
    o.beginPath();
    o.ellipse(headCx, eyeMid.y + eyeDist * 0.08, headRx * 0.78, headRy * 0.5, 0, 0, Math.PI * 2);
    o.fill();
    o.strokeStyle = mixHex(featherDark, '#000000', 0.2);
    o.lineWidth = Math.max(1, eyeDist * 0.05);
    o.stroke();
  }

  // Side cheek feathers for a fuller bird-head silhouette.
  for (const [sideIdx, dir] of [
    [L.cheekR, -1],
    [L.cheekL, 1],
  ] as const) {
    const c = p(sideIdx);
    for (let k = 0; k < 3; k += 1) {
      const fbase: Pt = { x: c.x + dir * eyeDist * 0.05, y: c.y - eyeDist * 0.07 + k * eyeDist * 0.15 };
      const ftip: Pt = { x: c.x + dir * eyeDist * (0.42 + k * 0.05), y: c.y + eyeDist * (0.02 + k * 0.18) };
      feather(o, fbase, ftip, eyeDist * 0.08, mixHex(featherDark, plumage, k * 0.2));
    }
  }

  // Crest/crown in the seed's style; height still driven by the person's brows.
  const crestHeight = eyeDist * (0.6 + ((params.crestHeight - 4) / 18) * 1.2);
  drawCrest(o, geo, style, crestHeight);

  // Seed-chosen markings under the eye region.
  drawMarkings(o, geo, style);

  // Preserve human identity in a narrow mask around the eyes + brow ridge.
  const eyeMaskW = eyeDist * 2.15;
  const eyeMaskH = eyeDist * 1.15;
  o.save();
  o.beginPath();
  o.ellipse(eyeMid.x, eyeMid.y, eyeMaskW * 0.5, eyeMaskH * 0.52, 0, 0, Math.PI * 2);
  o.clip();
  o.drawImage(faceTex, 0, 0);
  o.restore();

  // Brow ridge accent framing the preserved human eye region.
  o.strokeStyle = mixHex(featherDark, '#000000', 0.35);
  o.lineWidth = Math.max(1.2, eyeDist * 0.07);
  o.beginPath();
  o.ellipse(eyeMid.x, eyeMid.y - eyeDist * 0.02, eyeMaskW * 0.52, eyeMaskH * 0.46, 0, Math.PI * 1.02, Math.PI * 1.98);
  o.stroke();

  // Bird eye rings tie the human eyes into the avian face.
  for (const e of [eyeR, eyeL]) {
    o.strokeStyle = style.eyeRingColor;
    o.lineWidth = Math.max(1.2, eyeDist * 0.06);
    o.beginPath();
    o.ellipse(e.x, e.y, eyeDist * 0.22, eyeDist * 0.19, 0, 0, Math.PI * 2);
    o.stroke();
  }

  // Beak in the seed's style, sized by the person's nose/mouth.
  const lenScale = ((params.beakLength - 7) / 9) * 0.38;
  const widScale = ((params.beakWidth - 7) / 8) * 0.35;
  drawBeak(o, geo, style, lenScale, widScale);

  // Feather chest/collar at the bottom.
  const chestTop = OFF * 0.86;
  const scallop = OFF / 8.5;
  const chest = style.chest;
  o.fillStyle = chest;
  o.fillRect(0, Math.round(chestTop + scallop * 0.45), OFF, OFF);
  for (let i = 0; i <= 9; i += 1) {
    o.fillStyle = i % 2 === 0 ? chest : shadeHex(chest, 0.86);
    o.beginPath();
    o.ellipse(i * scallop, chestTop + scallop * 0.45, scallop * 0.58, scallop * 0.64, 0, 0, Math.PI * 2);
    o.fill();
  }

  // Blit up nearest-neighbor for crisp pixels.
  canvas.width = sizePx;
  canvas.height = sizePx;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, sizePx, sizePx);
  ctx.drawImage(off, 0, 0, OFF, OFF, 0, 0, sizePx, sizePx);
}
