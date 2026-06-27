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
// Renderer. Draws into a logical BIRD_SPACE grid; the caller scales the canvas
// up with imageSmoothingEnabled=false to get the chunky pixel look, matching
// the other islands. Only browser code calls this; it is not unit-tested.
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Render the bird to a canvas of `sizePx` (square). The canvas is drawn at
 * logical resolution then up-scaled with smoothing off for crisp pixels.
 */
export function renderBird(canvas: HTMLCanvasElement, p: BirdParams, sizePx: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Render into a small offscreen buffer, then blit it up nearest-neighbor.
  const off = document.createElement('canvas');
  off.width = BIRD_SPACE;
  off.height = BIRD_SPACE;
  const o = off.getContext('2d');
  if (!o) return;

  const cx = BIRD_SPACE / 2;
  o.clearRect(0, 0, BIRD_SPACE, BIRD_SPACE);

  // Perch
  o.fillStyle = '#8a5a2b';
  o.fillRect(18, 90, 64, 5);
  o.fillStyle = '#6f4420';
  o.fillRect(18, 95, 64, 3);

  const bodyCx = cx;
  const bodyCy = 56;
  const bw = p.bodyWidth / 2;
  const bh = p.bodyHeight / 2;

  // Tail
  o.fillStyle = p.accent;
  o.beginPath();
  o.moveTo(cx + bw - 6, bodyCy + bh - 10);
  o.lineTo(cx + bw + 14, bodyCy + bh + 6);
  o.lineTo(cx + bw - 4, bodyCy + bh + 2);
  o.closePath();
  o.fill();

  // Crest (behind the head, on top)
  if (p.crestHeight > 0) {
    o.fillStyle = p.accent;
    o.beginPath();
    o.moveTo(cx - 6, bodyCy - bh + 4);
    o.lineTo(cx, bodyCy - bh - p.crestHeight);
    o.lineTo(cx + 6, bodyCy - bh + 4);
    o.closePath();
    o.fill();
  }

  // Body
  ellipse(o, bodyCx, bodyCy, bw, bh, p.body);
  // Belly patch
  ellipse(o, bodyCx, bodyCy + bh * 0.28, bw * 0.62, bh * 0.6, p.belly);

  // Wings
  o.fillStyle = p.accent;
  o.beginPath();
  o.ellipse(bodyCx - bw * 0.74, bodyCy + 2, 8, bh * 0.55, -0.35, 0, Math.PI * 2);
  o.fill();
  o.beginPath();
  o.ellipse(bodyCx + bw * 0.74, bodyCy + 2, 8, bh * 0.55, 0.35, 0, Math.PI * 2);
  o.fill();

  // Feet
  o.strokeStyle = p.beak;
  o.lineWidth = 2;
  for (const fx of [cx - 8, cx + 8]) {
    o.beginPath();
    o.moveTo(fx, bodyCy + bh - 2);
    o.lineTo(fx, 90);
    o.stroke();
  }

  // Beak (centered, pointing down toward viewer)
  const beakTopY = p.eyeY + 6;
  o.fillStyle = p.beak;
  o.beginPath();
  o.moveTo(cx - p.beakWidth / 2, beakTopY);
  o.lineTo(cx + p.beakWidth / 2, beakTopY);
  o.lineTo(cx, beakTopY + p.beakLength);
  o.closePath();
  o.fill();

  // Eyes
  const half = p.eyeGap / 2;
  for (const ex of [cx - half, cx + half]) {
    ellipse(o, ex, p.eyeY, p.eyeRadius, p.eyeRadius, '#ffffff');
    o.strokeStyle = '#1a1a1a';
    o.lineWidth = 1;
    o.beginPath();
    o.ellipse(ex, p.eyeY, p.eyeRadius, p.eyeRadius, 0, 0, Math.PI * 2);
    o.stroke();
    // Pupil
    ellipse(o, ex, p.eyeY + 0.5, p.eyeRadius * 0.5, p.eyeRadius * 0.5, '#1a1a1a');
    // Catchlight
    ellipse(o, ex - p.eyeRadius * 0.22, p.eyeY - p.eyeRadius * 0.25, p.eyeRadius * 0.18, p.eyeRadius * 0.18, '#ffffff');
  }

  // Cheek blush for a smiling face
  if (p.blush) {
    o.fillStyle = 'rgba(244,114,182,0.55)';
    ellipse(o, cx - half - p.eyeRadius * 0.6, p.eyeY + p.eyeRadius + 2, 4, 2.5, 'rgba(244,114,182,0.55)');
    ellipse(o, cx + half + p.eyeRadius * 0.6, p.eyeY + p.eyeRadius + 2, 4, 2.5, 'rgba(244,114,182,0.55)');
  }

  // Blit up nearest-neighbor.
  canvas.width = sizePx;
  canvas.height = sizePx;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, sizePx, sizePx);
  ctx.drawImage(off, 0, 0, BIRD_SPACE, BIRD_SPACE, 0, 0, sizePx, sizePx);
}
