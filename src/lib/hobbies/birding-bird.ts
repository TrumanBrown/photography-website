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
// Portrait renderer. Unlike a from-scratch mascot, this keeps the *person*:
// it crops the face out of the selfie, mildly pixelates it for a pixel-art
// look, and overlays light bird touches (a feather crest, a beak over the
// nose/mouth, cheek + brow tufts, and a feather collar) anchored to the facial
// landmarks. The result reads as "you, with a few feathers", not a cartoon
// bird. Browser-only (uses canvas/Image); not unit-tested.
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

/**
 * Render the selfie as a pixel-art portrait with bird touches into `canvas`
 * (a square of `sizePx`). Keeps the person recognizable.
 */
export function renderBirdPortrait(canvas: HTMLCanvasElement, input: PortraitInput, sizePx: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { source, landmarks, palette, params } = input;
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
  const headW = Math.max(eyeDist, dist2(cheekR, cheekL));
  const headH = Math.max(eyeDist * 1.8, dist2(headTop, chin));
  const headCx = (cheekR.x + cheekL.x) / 2;
  const headCy = eyeMid.y + headH * 0.12;
  const headRx = headW * 0.7;
  const headRy = headH * 0.7;

  const featherBase = mixHex(palette.body, '#171717', 0.15);
  const featherDark = shadeHex(featherBase, 0.72);
  const featherLight = mixHex(featherBase, '#f7f7f7', 0.16);

  // Clear out selfie-first look and rebuild as a bird-first portrait.
  o.clearRect(0, 0, OFF, OFF);

  // Backdrop
  o.fillStyle = bg;
  o.fillRect(0, 0, OFF, OFF);

  // Neck and body plumage
  o.fillStyle = featherDark;
  o.beginPath();
  o.moveTo(headCx - headRx * 0.45, headCy + headRy * 0.52);
  o.lineTo(headCx + headRx * 0.45, headCy + headRy * 0.52);
  o.lineTo(headCx + headRx * 0.85, OFF);
  o.lineTo(headCx - headRx * 0.85, OFF);
  o.closePath();
  o.fill();

  // Main bird head silhouette
  o.fillStyle = featherBase;
  o.beginPath();
  o.ellipse(headCx, headCy, headRx, headRy, 0, 0, Math.PI * 2);
  o.fill();

  // Lighter facial disk around eyes (owl-ish) so human eye features sit naturally.
  o.fillStyle = featherLight;
  o.beginPath();
  o.ellipse(headCx, eyeMid.y + eyeDist * 0.06, headRx * 0.73, headRy * 0.45, 0, 0, Math.PI * 2);
  o.fill();

  // Crown/crest feathers
  const crestSpread = headW * 0.75;
  const crestHeight = eyeDist * (0.65 + ((params.crestHeight - 4) / 18) * 1.2);
  const crestCount = 7;
  for (let i = 0; i < crestCount; i += 1) {
    const t = i / (crestCount - 1) - 0.5;
    const base: Pt = {
      x: headCx + t * crestSpread,
      y: headTop.y + headH * 0.12 + Math.abs(t) * eyeDist * 0.1,
    };
    const tip: Pt = {
      x: base.x + t * eyeDist * 0.35,
      y: base.y - crestHeight * (1 - Math.abs(t) * 0.45),
    };
    const col = mixHex(featherBase, palette.accent, 0.25 + ((i % 3) / 3) * 0.35);
    feather(o, base, tip, eyeDist * 0.11, col);
  }

  // Side feathers for a stronger bird-head silhouette.
  for (const [side, dir] of [
    [L.cheekR, -1],
    [L.cheekL, 1],
  ] as const) {
    const c = p(side);
    for (let k = 0; k < 3; k += 1) {
      const base: Pt = { x: c.x + dir * eyeDist * 0.05, y: c.y - eyeDist * 0.07 + k * eyeDist * 0.15 };
      const tip: Pt = { x: c.x + dir * eyeDist * (0.42 + k * 0.05), y: c.y + eyeDist * (0.02 + k * 0.18) };
      feather(o, base, tip, eyeDist * 0.08, mixHex(featherDark, featherBase, k * 0.2));
    }
  }

  // Preserve human identity in a narrow mask around eyes + brow ridge.
  const eyeMaskW = eyeDist * 2.15;
  const eyeMaskH = eyeDist * 1.15;
  o.save();
  o.beginPath();
  o.ellipse(eyeMid.x, eyeMid.y, eyeMaskW * 0.5, eyeMaskH * 0.52, 0, 0, Math.PI * 2);
  o.clip();
  o.drawImage(faceTex, 0, 0);
  o.restore();

  // Brow ridge accent around preserved human eye region.
  o.strokeStyle = mixHex(featherDark, '#000000', 0.35);
  o.lineWidth = Math.max(1.2, eyeDist * 0.07);
  o.beginPath();
  o.ellipse(eyeMid.x, eyeMid.y - eyeDist * 0.02, eyeMaskW * 0.52, eyeMaskH * 0.46, 0, Math.PI * 1.02, Math.PI * 1.98);
  o.stroke();

  // Bird eye rings around each eye to integrate human eyes into avian anatomy.
  for (const e of [eyeR, eyeL]) {
    o.strokeStyle = mixHex(featherDark, '#111111', 0.25);
    o.lineWidth = Math.max(1.2, eyeDist * 0.06);
    o.beginPath();
    o.ellipse(e.x, e.y, eyeDist * 0.22, eyeDist * 0.19, 0, 0, Math.PI * 2);
    o.stroke();
  }

  // Prominent bird beak (bird-first): larger and more curved than before.
  const mouthC = mid(p(L.mouthTop), p(L.mouthBot));
  const beakTopY = eyeMid.y + eyeDist * 0.45;
  const beakLen = eyeDist * (1.05 + ((params.beakLength - 7) / 9) * 0.38);
  const beakW = eyeDist * (0.95 + ((params.beakWidth - 7) / 8) * 0.35);
  const bx = headCx + (mouthC.x - headCx) * 0.35;
  const tipY = beakTopY + beakLen;

  // Upper mandible (hooked)
  o.fillStyle = palette.beak;
  o.beginPath();
  o.moveTo(bx - beakW * 0.52, beakTopY);
  o.quadraticCurveTo(bx, beakTopY - eyeDist * 0.09, bx + beakW * 0.52, beakTopY);
  o.quadraticCurveTo(bx + beakW * 0.25, beakTopY + beakLen * 0.48, bx, tipY);
  o.quadraticCurveTo(bx - beakW * 0.3, beakTopY + beakLen * 0.5, bx - beakW * 0.52, beakTopY);
  o.closePath();
  o.fill();
  o.strokeStyle = shadeHex(palette.beak, 0.62);
  o.lineWidth = Math.max(1, eyeDist * 0.04);
  o.stroke();

  // Lower mandible
  o.fillStyle = shadeHex(palette.beak, 0.85);
  o.beginPath();
  o.moveTo(bx - beakW * 0.32, beakTopY + beakLen * 0.38);
  o.quadraticCurveTo(bx, beakTopY + beakLen * 0.82, bx + beakW * 0.32, beakTopY + beakLen * 0.38);
  o.quadraticCurveTo(bx, beakTopY + beakLen * 0.72, bx - beakW * 0.32, beakTopY + beakLen * 0.38);
  o.closePath();
  o.fill();

  // Gape line + nostrils
  o.strokeStyle = shadeHex(palette.beak, 0.52);
  o.lineWidth = Math.max(0.9, eyeDist * 0.03);
  o.beginPath();
  o.moveTo(bx - beakW * 0.34, beakTopY + beakLen * 0.4);
  o.quadraticCurveTo(bx, beakTopY + beakLen * 0.57, bx + beakW * 0.34, beakTopY + beakLen * 0.4);
  o.stroke();
  o.fillStyle = shadeHex(palette.beak, 0.45);
  for (const s of [-1, 1]) {
    o.beginPath();
    o.ellipse(bx + s * beakW * 0.18, beakTopY + beakLen * 0.2, eyeDist * 0.035, eyeDist * 0.045, 0, 0, Math.PI * 2);
    o.fill();
  }

  // Feather chest/collar at the bottom.
  const chestTop = OFF * 0.86;
  const scallop = OFF / 8.5;
  const chest = mixHex(featherBase, '#ffffff', 0.1);
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
