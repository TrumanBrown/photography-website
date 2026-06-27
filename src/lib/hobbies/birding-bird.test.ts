import { describe, it, expect } from 'vitest';
import {
  featuresToBird,
  birdSeed,
  describeFeatures,
  type FaceFeatures,
  type FacePalette,
} from './birding-bird';

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

describe('describeFeatures', () => {
  it('labels wide and wide-set eyes', () => {
    const tags = describeFeatures({ ...baseFeatures, eyeOpenness: 0.8, eyeSpacing: 0.8 });
    expect(tags).toContain('wide eyes');
    expect(tags).toContain('wide-set eyes');
  });

  it('always returns at least one tag', () => {
    expect(describeFeatures(baseFeatures).length).toBeGreaterThan(0);
  });
});
