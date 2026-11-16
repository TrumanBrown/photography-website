import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  featuresToBird,
  birdSeed,
  birdStyleSeed,
  pickSpecies,
  billProfile,
  lightGain,
  SPECIES,
  type FaceFeatures,
  type FacePalette,
  type PartPatch,
} from './birding-bird';
import geometry from './bird-parts.json';

const baseFeatures: FaceFeatures = {
  eyeOpenness: 0.5,
  eyeSpacing: 0.5,
  mouthWidth: 0.5,
  faceRoundness: 0.5,
  browRaise: 0.5,
  noseLength: 0.5,
  smile: 0,
};

const palette: FacePalette = {
  body: '#445566',
  belly: '#aabbcc',
  accent: '#cc3344',
  beak: '#e2a04a',
};

const withFeature = (k: keyof FaceFeatures, v: number): FaceFeatures => ({
  ...baseFeatures,
  [k]: v,
});

describe('featuresToBird', () => {
  it('is deterministic: identical inputs give an identical bird', () => {
    expect(featuresToBird(baseFeatures, palette)).toEqual(
      featuresToBird({ ...baseFeatures }, { ...palette }),
    );
  });

  it('passes the palette straight through to plumage slots', () => {
    const bird = featuresToBird(baseFeatures, palette);
    expect(bird.body).toBe(palette.body);
    expect(bird.belly).toBe(palette.belly);
    expect(bird.accent).toBe(palette.accent);
    expect(bird.beak).toBe(palette.beak);
  });

  it('maps wide eyes to a wide-eyed bird (bigger eyeRadius)', () => {
    const narrow = featuresToBird(withFeature('eyeOpenness', 0), palette);
    const wide = featuresToBird(withFeature('eyeOpenness', 1), palette);
    expect(wide.eyeRadius).toBeGreaterThan(narrow.eyeRadius);
  });

  it('maps wide-set eyes to a larger eye gap', () => {
    const close = featuresToBird(withFeature('eyeSpacing', 0), palette);
    const wide = featuresToBird(withFeature('eyeSpacing', 1), palette);
    expect(wide.eyeGap).toBeGreaterThan(close.eyeGap);
  });

  it('maps a wider mouth to a wider beak and a longer nose to a longer beak', () => {
    expect(featuresToBird(withFeature('mouthWidth', 1), palette).beakWidth).toBeGreaterThan(
      featuresToBird(withFeature('mouthWidth', 0), palette).beakWidth,
    );
    expect(featuresToBird(withFeature('noseLength', 1), palette).beakLength).toBeGreaterThan(
      featuresToBird(withFeature('noseLength', 0), palette).beakLength,
    );
  });

  it('maps a rounder face to a wider, shorter body', () => {
    const lean = featuresToBird(withFeature('faceRoundness', 0), palette);
    const round = featuresToBird(withFeature('faceRoundness', 1), palette);
    expect(round.bodyWidth).toBeGreaterThan(lean.bodyWidth);
    expect(round.bodyHeight).toBeLessThan(lean.bodyHeight);
  });

  it('maps raised brows to a taller crest', () => {
    expect(featuresToBird(withFeature('browRaise', 1), palette).crestHeight).toBeGreaterThan(
      featuresToBird(withFeature('browRaise', 0), palette).crestHeight,
    );
  });

  it('adds cheek blush only when clearly smiling', () => {
    expect(featuresToBird(withFeature('smile', 0.5), palette).blush).toBe(true);
    expect(featuresToBird(withFeature('smile', 0), palette).blush).toBe(false);
  });

  it('clamps out-of-range inputs instead of extrapolating', () => {
    const over = featuresToBird(withFeature('eyeOpenness', 5), palette);
    const max = featuresToBird(withFeature('eyeOpenness', 1), palette);
    expect(over.eyeRadius).toBe(max.eyeRadius);
  });
});

describe('birdSeed', () => {
  it('is stable for identical inputs', () => {
    expect(birdSeed(baseFeatures, palette)).toBe(birdSeed({ ...baseFeatures }, palette));
  });

  it('collapses tiny feature differences to the same seed (quantized)', () => {
    const a = withFeature('eyeOpenness', 0.5);
    const b = withFeature('eyeOpenness', 0.51); // within a quantization bucket
    expect(birdSeed(a, palette)).toBe(birdSeed(b, palette));
  });

  it('changes when a feature shifts by a whole bucket', () => {
    const a = withFeature('eyeOpenness', 0.1);
    const b = withFeature('eyeOpenness', 0.9);
    expect(birdSeed(a, palette)).not.toBe(birdSeed(b, palette));
  });
});

describe('birdStyleSeed', () => {
  it('changes when any feature shifts', () => {
    expect(birdStyleSeed(withFeature('eyeOpenness', 0.1), palette)).not.toBe(
      birdStyleSeed(withFeature('eyeOpenness', 0.9), palette),
    );
  });
});

describe('pickSpecies', () => {
  it('gives the same selfie the same bird', () => {
    expect(pickSpecies(baseFeatures, palette)).toBe(pickSpecies({ ...baseFeatures }, { ...palette }));
  });

  it('steps through every bird with Another bird, then wraps', () => {
    const seen = SPECIES.map((_, v) => pickSpecies(baseFeatures, palette, v).id);
    expect(new Set(seen).size).toBe(SPECIES.length);
    expect(pickSpecies(baseFeatures, palette, SPECIES.length)).toBe(pickSpecies(baseFeatures, palette, 0));
  });
});

describe('bird parts', () => {
  it('has a bill, crown and neck from my photos for every bird', () => {
    const geo = geometry as Record<string, unknown>;
    for (const sp of SPECIES) {
      expect(geo[sp.id]).toBeDefined();
      for (const part of ['bill', 'crown', 'neck']) {
        const url = new URL(`../../assets/birding/${sp.id}-${part}.webp`, import.meta.url);
        expect(existsSync(fileURLToPath(url)), `${sp.id}-${part}`).toBe(true);
      }
    }
  });
});

describe('billProfile', () => {
  // A wedge pointing right: 40 px deep at its base, coming to a point at the right edge.
  const w = 100;
  const h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (Math.abs(y + 0.5 - 20) < 20 * (1 - x / w)) data[(y * w + x) * 4 + 3] = 255;
    }
  }
  const wedge: PartPatch = { w, h, base: [[0, 0], [0, 40]], tip: [99, 20], data };

  it('reads the depth of the bill along its length, tapering to the tip', () => {
    const p = billProfile(wedge, 10);
    const depth = (i: number) => p.bot[i] - p.top[i];
    expect(depth(0)).toBeGreaterThan(35);
    expect(depth(5)).toBeLessThan(depth(1));
    expect(depth(9)).toBeLessThan(10);
    expect(p.axis.x).toBeCloseTo(1, 2);
  });
});

describe('lightGain', () => {
  it('darkens the parts for a dark selfie, within limits', () => {
    expect(lightGain(0.1)).toBeLessThan(lightGain(0.5));
    expect(lightGain(0)).toBeGreaterThanOrEqual(0.6);
    expect(lightGain(1)).toBeLessThanOrEqual(1.12);
  });
});
