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
// Hybrid style (pure): picks the beak palette + feather tones from the seed.
// ---------------------------------------------------------------------------

export interface HybridStyle {
  seed: number;
  /** Playful label for the tag, e.g. "Ember-billed". */
  name: string;
  beak: string;
  beakLight: string;
  beakDark: string;
  feather: string;
  featherDark: string;
  featherLight: string;
  eyeColor: string;
}

const BEAKS: [string, string][] = [
  ['#ef8a1f', 'Ember'],
  ['#f3c01c', 'Golden'],
  ['#e0532a', 'Sunset'],
  ['#cf3b2c', 'Scarlet'],
  ['#6b6f78', 'Slate'],
  ['#26262c', 'Onyx'],
  ['#d9d2c4', 'Bone'],
];

/**
 * Decide the beak colour and feather tones for a face. Pure + deterministic.
 * The beak colour is seeded (variety); the feathers come from the person's hair.
 */
export function makeHybridStyle(features: FaceFeatures, palette: FacePalette): HybridStyle {
  const seed = birdStyleSeed(features, palette);
  const rng = mulberry32(seed);
  const [beak, beakName] = BEAKS[Math.floor(rng() * BEAKS.length) % BEAKS.length];
  const feather = /^#[0-9a-f]{6}$/i.test(palette.body) ? palette.body : '#3a2a1f';
  const eyeColor = palette.eye && /^#[0-9a-f]{6}$/i.test(palette.eye) ? palette.eye : '#3a2a1f';
  return {
    seed,
    name: `${beakName}-billed`,
    beak,
    beakLight: mix(beak, '#ffffff', 0.32),
    beakDark: shade(beak, 0.6),
    feather,
    featherDark: shade(feather, 0.66),
    featherLight: mix(feather, '#ffffff', 0.26),
    eyeColor,
  };
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
  palette: FacePalette;
  params: BirdParams;
  style: HybridStyle;
}

// FaceMesh indices used to anchor the bird features.
const M = {
  cheekR: 234, cheekL: 454, foreheadTop: 10, chin: 152,
  rEyeOuter: 33, rEyeInner: 133, lEyeInner: 362, lEyeOuter: 263,
  noseBridge: 168, noseTip: 1, mouthTop: 13, mouthBot: 14,
};

const dist2 = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const midp = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** A tapered feather with a length gradient + soft midrib, for crest/neck. */
function shadedPlume(o: CanvasRenderingContext2D, base: Pt, tip: Pt, halfW: number, col: string, colDark: string): void {
  const m = midp(base, tip);
  const ang = Math.atan2(tip.y - base.y, tip.x - base.x);
  const nx = Math.cos(ang + Math.PI / 2);
  const ny = Math.sin(ang + Math.PI / 2);
  const g = o.createLinearGradient(base.x, base.y, tip.x, tip.y);
  g.addColorStop(0, colDark);
  g.addColorStop(0.55, col);
  g.addColorStop(1, mix(col, '#ffffff', 0.2));
  o.fillStyle = g;
  o.beginPath();
  o.moveTo(base.x + nx * halfW, base.y + ny * halfW);
  o.quadraticCurveTo(m.x + nx * halfW * 0.9, m.y + ny * halfW * 0.9, tip.x, tip.y);
  o.quadraticCurveTo(m.x - nx * halfW * 0.9, m.y - ny * halfW * 0.9, base.x - nx * halfW, base.y - ny * halfW);
  o.closePath();
  o.fill();
  o.strokeStyle = colDark;
  o.lineWidth = Math.max(0.5, halfW * 0.16);
  o.globalAlpha = 0.5;
  o.beginPath();
  o.moveTo(base.x, base.y);
  o.lineTo(tip.x, tip.y);
  o.stroke();
  o.globalAlpha = 1;
}

/**
 * Composite a bird beak + feathers onto the real selfie. Keeps the person's
 * actual face (real human features) and grafts on avian parts anchored to the
 * facial landmarks, the way the reference hybrid does.
 */
export function renderHybrid(canvas: HTMLCanvasElement, input: HybridInput, sizePx: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { source, landmarks, style } = input;
  const W = source.width;
  const H = source.height;
  if (!W || !H || landmarks.length < 468) return;

  const S = sizePx;
  canvas.width = S;
  canvas.height = S;
  const o = ctx;
  o.imageSmoothingEnabled = true;
  o.clearRect(0, 0, S, S);
  const rng = mulberry32(style.seed);

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
  const P = (i: number): Pt => T(lp(i));

  // Background fill (so any uncovered edge is a soft backdrop, not transparent).
  const bgGrad = o.createLinearGradient(0, 0, 0, S);
  bgGrad.addColorStop(0, mix(style.featherDark, '#000000', 0.2));
  bgGrad.addColorStop(1, shade(style.featherDark, 0.5));
  o.fillStyle = bgGrad;
  o.fillRect(0, 0, S, S);

  // The selfie itself (real human features).
  o.drawImage(source, offX, offY, W * scale, H * scale);

  // Face geometry in output space.
  const Tfore = T(fore);
  const Tchin = T(chin);
  const TcheekR = T(cheekR);
  const TcheekL = T(cheekL);
  const eyeR = midp(P(M.rEyeOuter), P(M.rEyeInner));
  const eyeL = midp(P(M.lEyeOuter), P(M.lEyeInner));
  const eyeMid = midp(eyeR, eyeL);
  const faceWOut = dist2(TcheekR, TcheekL);
  const ecx = (TcheekR.x + TcheekL.x) / 2;
  const ecy = (Tfore.y + Tchin.y) / 2;
  const erx = (faceWOut / 2) * 1.04;
  const ery = (Tchin.y - Tfore.y) / 2 * 1.06;

  // --- Crest: a dense, scattered tuft of feathers blended into the hairline ---
  const crownY = Tfore.y - ery * 0.08;
  const halfSpan = erx * 1.02;
  const crestN = 44;
  for (let i = 0; i < crestN; i += 1) {
    const x = ecx + (rng() - 0.5) * halfSpan * 2;
    const norm = (x - ecx) / halfSpan;
    const arc = Math.max(0, 1 - norm * norm); // 1 in the middle, 0 at the temples
    const baseY = crownY - arc * ery * 0.16 + (rng() - 0.5) * ery * 0.14;
    const len = faceWOut * (0.1 + arc * 0.17) * (0.7 + rng() * 0.6);
    const lean = norm * 1.2 + (rng() - 0.5) * 0.5;
    const base = { x, y: baseY + faceWOut * 0.045 };
    const tip = { x: x + lean * faceWOut * 0.11, y: baseY - len };
    const pick = Math.floor(rng() * 3);
    const col = pick === 0 ? style.featherLight : pick === 1 ? style.feather : style.featherDark;
    o.globalAlpha = 0.88;
    shadedPlume(o, base, tip, faceWOut * (0.024 + arc * 0.012), col, shade(style.featherDark, 0.8));
  }
  o.globalAlpha = 1;

  // --- Jaw / neck feathers feathering the face into plumage (scattered rows) ---
  const jawN = 52;
  for (let i = 0; i < jawN; i += 1) {
    const tt = rng();
    const a = (15 + tt * 150) * (Math.PI / 180); // lower arc, left -> right
    const bx = ecx + Math.cos(a) * erx * (0.94 + rng() * 0.14);
    const by = ecy + Math.sin(a) * ery * (1.0 + rng() * 0.16);
    if (by < ecy + ery * 0.4) continue; // jaw + neck only
    const len = faceWOut * (0.05 + rng() * 0.06);
    const tip = { x: bx + Math.cos(a) * len * 0.3, y: by + len };
    const pick = Math.floor(rng() * 3);
    const col = pick === 0 ? style.featherDark : pick === 1 ? shade(style.feather, 0.82) : style.feather;
    o.globalAlpha = 0.86;
    shadedPlume(o, { x: bx, y: by }, tip, faceWOut * 0.02, col, shade(style.featherDark, 0.72));
  }
  o.globalAlpha = 1;

  // --- Beak: a believable front-on bill over the nose/mouth ---
  const noseTipP = P(M.noseTip);
  const mouthC = midp(P(M.mouthTop), P(M.mouthBot));
  const cxb = noseTipP.x;
  const topY = midp(eyeMid, P(M.noseBridge)).y;
  const tipY = mouthC.y + (Tchin.y - mouthC.y) * 0.28;
  const len = Math.max(faceWOut * 0.45, tipY - topY);
  const w = faceWOut * lerp(0.2, 0.27, clamp01((input.params.beakWidth - 7) / 8));
  const midY = topY + len * 0.3;

  const beakPath = (): void => {
    o.beginPath();
    o.moveTo(cxb, topY);
    o.quadraticCurveTo(cxb + w * 0.72, topY + len * 0.04, cxb + w * 0.5, midY);
    o.quadraticCurveTo(cxb + w * 0.4, midY + len * 0.36, cxb, tipY);
    o.quadraticCurveTo(cxb - w * 0.4, midY + len * 0.36, cxb - w * 0.5, midY);
    o.quadraticCurveTo(cxb - w * 0.72, topY + len * 0.04, cxb, topY);
    o.closePath();
  };

  // soft cast shadow grounding the bill on the face
  o.save();
  o.shadowColor = 'rgba(0,0,0,0.4)';
  o.shadowBlur = faceWOut * 0.1;
  o.shadowOffsetY = faceWOut * 0.025;
  o.fillStyle = style.beakDark;
  beakPath();
  o.fill();
  o.restore();

  // base colour: side-lit gradient
  const sideGrad = o.createLinearGradient(cxb - w * 0.5, 0, cxb + w * 0.5, 0);
  sideGrad.addColorStop(0, style.beakLight);
  sideGrad.addColorStop(0.5, style.beak);
  sideGrad.addColorStop(1, style.beakDark);
  o.fillStyle = sideGrad;
  beakPath();
  o.fill();

  // length + ridge shading, clipped to the bill
  o.save();
  beakPath();
  o.clip();
  const lenGrad = o.createLinearGradient(0, topY, 0, tipY);
  lenGrad.addColorStop(0, 'rgba(255,255,255,0.14)');
  lenGrad.addColorStop(0.4, 'rgba(255,255,255,0)');
  lenGrad.addColorStop(1, 'rgba(0,0,0,0.42)');
  o.fillStyle = lenGrad;
  o.fillRect(cxb - w, topY - w, w * 2, len + w * 2);
  // central culmen highlight ridge
  o.strokeStyle = 'rgba(255,255,255,0.42)';
  o.lineWidth = w * 0.1;
  o.lineCap = 'round';
  o.beginPath();
  o.moveTo(cxb, topY + len * 0.08);
  o.lineTo(cxb, midY + len * 0.1);
  o.stroke();
  // faint centre seam toward the tip (where the mandibles meet) — reads as a bill, not a mouth
  o.strokeStyle = 'rgba(0,0,0,0.28)';
  o.lineWidth = Math.max(1, w * 0.04);
  o.beginPath();
  o.moveTo(cxb, midY + len * 0.05);
  o.lineTo(cxb, tipY - len * 0.04);
  o.stroke();
  o.restore();

  // nostrils: thin slits high on the bill, near the centre
  o.fillStyle = 'rgba(0,0,0,0.5)';
  for (const s of [-1, 1]) {
    o.save();
    o.translate(cxb + s * w * 0.16, topY + len * 0.16);
    o.rotate(s * 0.25);
    o.beginPath();
    o.ellipse(0, 0, w * 0.03, len * 0.05, 0, 0, Math.PI * 2);
    o.fill();
    o.restore();
  }

  // crisp outline
  o.strokeStyle = style.beakDark;
  o.lineWidth = Math.max(1, S * 0.003);
  beakPath();
  o.stroke();

  // --- Vignette for cohesion ---
  const vg = o.createRadialGradient(S / 2, S * 0.45, S * 0.25, S / 2, S * 0.5, S * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.32)');
  o.fillStyle = vg;
  o.fillRect(0, 0, S, S);
}

