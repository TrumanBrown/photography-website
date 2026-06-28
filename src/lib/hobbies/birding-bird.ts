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
  ['#f3b81c', 'Golden'],
  ['#e0532a', 'Sunset'],
  ['#cf3b2c', 'Scarlet'],
  ['#5b5f66', 'Slate'],
  ['#26262c', 'Onyx'],
  ['#c79a44', 'Horn'],
];

/**
 * Decide the beak colour and feather tones for a face. Pure + deterministic.
 * The beak colour is seeded (variety); the feathers come from the person's hair.
 * `variant` lets the UI re-roll (the "shuffle" button) without a new selfie.
 */
export function makeHybridStyle(features: FaceFeatures, palette: FacePalette, variant = 0): HybridStyle {
  const seed = (birdStyleSeed(features, palette) ^ Math.imul(variant, 0x9e3779b1)) >>> 0;
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

  // Shade the warped beak for 3D form (no hard outline, so it stays part of the face).
  const axisX = noseTipO.x;
  const topY = T({ x: noseTipS.x, y: midp(eyeMidSrc, bridgeS).y }).y;
  const tipY = T(mouthCS).y + Q * 0.85;
  const halfWOut = faceWOut * 0.19;
  const beakLen = tipY - topY;

  // Ambient-occlusion: a soft dark contour just outside the beak sides to lift it
  // off the face (drawn before the fill so it reads as a cast/contact shadow).
  o.save();
  o.strokeStyle = 'rgba(0,0,0,0.3)';
  o.lineWidth = halfWOut * 0.22;
  o.lineCap = 'round';
  for (const s of [-1, 1]) {
    o.beginPath();
    o.moveTo(axisX + s * halfWOut * 0.5, topY + beakLen * 0.12);
    o.quadraticCurveTo(axisX + s * halfWOut * 0.62, topY + beakLen * 0.45, axisX, tipY);
    o.stroke();
  }
  o.restore();

  o.save();
  o.beginPath();
  o.ellipse(axisX, (topY + tipY) / 2, halfWOut * 0.96, beakLen / 2 * 1.04, 0, 0, Math.PI * 2);
  o.clip();
  // tint toward the bill colour while keeping skin texture
  o.globalCompositeOperation = 'soft-light';
  o.globalAlpha = 0.9;
  o.fillStyle = style.beak;
  o.fillRect(axisX - halfWOut, topY - beakLen * 0.1, halfWOut * 2, beakLen * 1.25);
  // a second, gentler colour pass for saturation
  o.globalCompositeOperation = 'overlay';
  o.globalAlpha = 0.28;
  o.fillRect(axisX - halfWOut, topY - beakLen * 0.1, halfWOut * 2, beakLen * 1.25);
  o.globalCompositeOperation = 'source-over';
  // a low-alpha solid pass so the bill reads as a solid surface, not see-through
  o.globalAlpha = 0.32;
  o.fillStyle = style.beak;
  o.fillRect(axisX - halfWOut, topY - beakLen * 0.1, halfWOut * 2, beakLen * 1.25);
  o.globalAlpha = 1;
  // side shading -> rounded cross-section
  const sg = o.createLinearGradient(axisX - halfWOut, 0, axisX + halfWOut, 0);
  sg.addColorStop(0, 'rgba(0,0,0,0.44)');
  sg.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  sg.addColorStop(1, 'rgba(0,0,0,0.44)');
  o.fillStyle = sg;
  o.fillRect(axisX - halfWOut, topY, halfWOut * 2, beakLen);
  // under-tip shadow
  const ug = o.createLinearGradient(0, (topY + tipY) / 2, 0, tipY);
  ug.addColorStop(0, 'rgba(0,0,0,0)');
  ug.addColorStop(1, 'rgba(0,0,0,0.5)');
  o.fillStyle = ug;
  o.fillRect(axisX - halfWOut, (topY + tipY) / 2, halfWOut * 2, beakLen / 2);
  // culmen highlight ridge
  o.strokeStyle = 'rgba(255,255,255,0.42)';
  o.lineWidth = halfWOut * 0.16;
  o.lineCap = 'round';
  o.beginPath();
  o.moveTo(axisX, topY + beakLen * 0.1);
  o.lineTo(axisX, topY + beakLen * 0.66);
  o.stroke();
  o.restore();

  // nostrils high on the bill
  o.fillStyle = 'rgba(0,0,0,0.5)';
  for (const s of [-1, 1]) {
    o.save();
    o.translate(axisX + s * halfWOut * 0.28, topY + beakLen * 0.16);
    o.rotate(s * 0.3);
    o.beginPath();
    o.ellipse(0, 0, halfWOut * 0.055, beakLen * 0.05, 0, 0, Math.PI * 2);
    o.fill();
    o.restore();
  }

  // --- Crest: a dense, scattered tuft of feathers blended into the hairline ---
  const crownY = Tfore.y - ery * 0.08;
  const halfSpan = erx * 1.02;
  const crestN = 44;
  for (let i = 0; i < crestN; i += 1) {
    const x = ecx + (rng() - 0.5) * halfSpan * 2;
    const norm = (x - ecx) / halfSpan;
    const arc = Math.max(0, 1 - norm * norm); // 1 in the middle, 0 at the temples
    const baseY = crownY - arc * ery * 0.16 + (rng() - 0.5) * ery * 0.22;
    const len = faceWOut * (0.1 + arc * 0.17) * (0.7 + rng() * 0.6);
    const lean = norm * 1.2 + (rng() - 0.5) * 0.5;
    const base = { x, y: baseY + faceWOut * 0.05 };
    const tip = { x: x + lean * faceWOut * 0.11, y: baseY - len };
    const pick = Math.floor(rng() * 3);
    const col = pick === 0 ? style.featherLight : pick === 1 ? style.feather : style.featherDark;
    o.globalAlpha = 0.88;
    shadedPlume(o, base, tip, faceWOut * (0.018 + arc * 0.01), col, shade(style.featherDark, 0.8));
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

  // --- Vignette for cohesion ---
  const vg = o.createRadialGradient(S / 2, S * 0.45, S * 0.25, S / 2, S * 0.5, S * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.32)');
  o.fillStyle = vg;
  o.fillRect(0, 0, S, S);
}

