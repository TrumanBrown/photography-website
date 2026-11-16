/**
 * Birding hobby island: "you as a bird".
 *
 * Owns everything the pure renderer (birding-bird.ts) can't: the camera and file
 * input, the MediaPipe FaceLandmarker model (WASM, vendored under /birding/), the
 * conversion from face landmarks to normalized features, and palette sampling.
 *
 * Privacy by construction: the selfie is read into a canvas and the landmark
 * model runs entirely in the browser. Nothing is ever uploaded, not the photo
 * and not the landmarks. There is no network call except fetching the
 * same-origin model + WASM the first time you generate a bird.
 *
 * Mounted by src/components/hobbies/Birding.astro via [data-bird-*] hooks. The
 * heavy MediaPipe bundle + model are dynamically imported on first use so the
 * rest of the site stays light.
 *
 * The feature-extraction ranges below are approximate and tuned by feel (the
 * same honesty as the aquarium numbers), not derived from any dataset.
 */
import type { FaceLandmarker as FaceLandmarkerT, NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  birdStyleSeed,
  featuresToBird,
  pickSpecies,
  renderHybrid,
  type FaceFeatures,
  type FacePalette,
  type PartGeometry,
  type PartPatch,
} from './birding-bird';
import { inkIn, type Inking } from './bird-ink';
import geometry from './bird-parts.json';
import oystercatcherBill from '../../assets/birding/black-oystercatcher-bill.webp?url';
import oystercatcherCrown from '../../assets/birding/black-oystercatcher-crown.webp?url';
import oystercatcherNeck from '../../assets/birding/black-oystercatcher-neck.webp?url';
import toucanBill from '../../assets/birding/keel-billed-toucan-bill.webp?url';
import toucanCrown from '../../assets/birding/keel-billed-toucan-crown.webp?url';
import toucanNeck from '../../assets/birding/keel-billed-toucan-neck.webp?url';
import nightHeronBill from '../../assets/birding/yellow-crowned-night-heron-bill.webp?url';
import nightHeronCrown from '../../assets/birding/yellow-crowned-night-heron-crown.webp?url';
import nightHeronNeck from '../../assets/birding/yellow-crowned-night-heron-neck.webp?url';

/** Longest side we downscale the selfie to before detection (speed vs accuracy). */
const MAX_SOURCE = 768;
/** Pixel size of the rendered bird canvas. */
const BIRD_PX = 768;

/** Each bird's bill and plumage, cut from my photo by bird_parts.py. */
const PART_URLS: Record<string, { bill: string; crown: string; neck: string }> = {
  'black-oystercatcher': { bill: oystercatcherBill, crown: oystercatcherCrown, neck: oystercatcherNeck },
  'keel-billed-toucan': { bill: toucanBill, crown: toucanCrown, neck: toucanNeck },
  'yellow-crowned-night-heron': { bill: nightHeronBill, crown: nightHeronCrown, neck: nightHeronNeck },
};
// The JSON reads base points as number[][]; bird_parts.py writes them as pairs.
const GEOMETRY = geometry as unknown as Record<string, { bill: PartGeometry }>;
type Parts = { bill: PartPatch; crown: HTMLImageElement; neck: HTMLImageElement };
const partsCache = new Map<string, Promise<Parts>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

/** A bird's bill as pixels plus its plumage, fetched once (same origin, so the canvas can read them). */
function loadParts(id: string): Promise<Parts> {
  let p = partsCache.get(id);
  if (!p) {
    const urls = PART_URLS[id];
    p = Promise.all([loadImage(urls.bill), loadImage(urls.crown), loadImage(urls.neck)]).then(([b, crown, neck]) => {
      const g = GEOMETRY[id].bill;
      const c = document.createElement('canvas');
      c.width = g.w;
      c.height = g.h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(b, 0, 0, g.w, g.h);
      return { bill: { ...g, data: ctx.getImageData(0, 0, g.w, g.h).data }, crown, neck };
    });
    p.catch(() => partsCache.delete(id));
    partsCache.set(id, p);
  }
  return p;
}

// MediaPipe FaceMesh canonical landmark indices.
const IDX = {
  rEyeOuter: 33, rEyeInner: 133, rEyeTop: 159, rEyeBot: 145,
  lEyeInner: 362, lEyeOuter: 263, lEyeTop: 386, lEyeBot: 374,
  cheekR: 234, cheekL: 454, foreheadTop: 10, chin: 152,
  mouthR: 61, mouthL: 291, mouthTop: 13, mouthBot: 14,
  noseBridge: 168, noseTip: 1, browR: 105, browL: 334,
  cheekSampleR: 50, cheekSampleL: 280,
  // Iris centres (present because the face_landmarker model outputs 478 points).
  rIris: 468, lIris: 473,
};

type Pt = { x: number; y: number };

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const norm = (v: number, lo: number, hi: number): number => clamp01((v - lo) / (hi - lo));
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Convert a normalized landmark to pixel space for the given canvas dims. */
function toPx(lm: NormalizedLandmark[], i: number, w: number, h: number): Pt {
  return { x: lm[i].x * w, y: lm[i].y * h };
}

/** Derive the seven normalized facial features from landmarks. */
function computeFeatures(lm: NormalizedLandmark[], w: number, h: number): FaceFeatures {
  const p = (i: number) => toPx(lm, i, w, h);

  const faceW = dist(p(IDX.cheekR), p(IDX.cheekL));
  const faceH = dist(p(IDX.foreheadTop), p(IDX.chin)) || 1;

  const rOpen = dist(p(IDX.rEyeTop), p(IDX.rEyeBot)) / (dist(p(IDX.rEyeOuter), p(IDX.rEyeInner)) || 1);
  const lOpen = dist(p(IDX.lEyeTop), p(IDX.lEyeBot)) / (dist(p(IDX.lEyeInner), p(IDX.lEyeOuter)) || 1);
  const openness = (rOpen + lOpen) / 2;

  const rEyeC = { x: (p(IDX.rEyeOuter).x + p(IDX.rEyeInner).x) / 2, y: (p(IDX.rEyeOuter).y + p(IDX.rEyeInner).y) / 2 };
  const lEyeC = { x: (p(IDX.lEyeInner).x + p(IDX.lEyeOuter).x) / 2, y: (p(IDX.lEyeInner).y + p(IDX.lEyeOuter).y) / 2 };
  const interocular = dist(rEyeC, lEyeC) / faceW;

  const mouthW = dist(p(IDX.mouthR), p(IDX.mouthL)) / faceW;
  const roundness = faceW / faceH;
  const noseLen = dist(p(IDX.noseBridge), p(IDX.noseTip)) / faceH;

  const browY = (p(IDX.browR).y + p(IDX.browL).y) / 2;
  const eyeY = (rEyeC.y + lEyeC.y) / 2;
  const browRaise = (eyeY - browY) / faceH;

  const mouthCenterY = (p(IDX.mouthTop).y + p(IDX.mouthBot).y) / 2;
  const cornerY = (p(IDX.mouthR).y + p(IDX.mouthL).y) / 2;
  const mouthWpx = dist(p(IDX.mouthR), p(IDX.mouthL)) || 1;
  const smileRaw = (mouthCenterY - cornerY) / mouthWpx; // corners above center => positive

  return {
    eyeOpenness: norm(openness, 0.18, 0.42),
    eyeSpacing: norm(interocular, 0.4, 0.54),
    mouthWidth: norm(mouthW, 0.36, 0.56),
    faceRoundness: norm(roundness, 0.6, 0.92),
    browRaise: norm(browRaise, 0.03, 0.09),
    noseLength: norm(noseLen, 0.12, 0.24),
    smile: Math.max(-1, Math.min(1, smileRaw * 6)),
  };
}

type RGB = { r: number; g: number; b: number };

/** Average color in a small box around (x,y) in the source ImageData. */
function sampleAvg(data: ImageData, x: number, y: number, rad: number): RGB {
  const { width, height, data: px } = data;
  let r = 0, g = 0, b = 0, n = 0;
  const x0 = Math.max(0, Math.round(x - rad));
  const x1 = Math.min(width - 1, Math.round(x + rad));
  const y0 = Math.max(0, Math.round(y - rad));
  const y1 = Math.min(height - 1, Math.round(y + rad));
  for (let yy = y0; yy <= y1; yy += 1) {
    for (let xx = x0; xx <= x1; xx += 1) {
      const o = (yy * width + xx) * 4;
      r += px[o]; g += px[o + 1]; b += px[o + 2]; n += 1;
    }
  }
  if (n === 0) return { r: 128, g: 128, b: 128 };
  return { r: r / n, g: g / n, b: b / n };
}

const hex = (c: RGB): string => {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
};
const lighten = (c: RGB, amt: number): RGB => ({
  r: c.r + (255 - c.r) * amt,
  g: c.g + (255 - c.g) * amt,
  b: c.b + (255 - c.b) * amt,
});

/** Sample a plausible bird palette from the selfie. */
function computePalette(lm: NormalizedLandmark[], data: ImageData): FacePalette {
  const w = data.width;
  const h = data.height;
  const p = (i: number) => toPx(lm, i, w, h);
  const faceH = dist(p(IDX.foreheadTop), p(IDX.chin)) || 1;
  const rad = Math.max(2, faceH * 0.04);

  // Hair / dominant: a band above the forehead (clamped onto the image).
  const fore = p(IDX.foreheadTop);
  const hairY = Math.max(rad, fore.y - faceH * 0.16);
  const body = sampleAvg(data, fore.x, hairY, rad);

  // Lips -> crest/wing accent.
  const lip = p(IDX.mouthTop);
  const accent = sampleAvg(data, lip.x, (lip.y + p(IDX.mouthBot).y) / 2, rad * 0.8);

  // Skin (cheeks) -> warm-shifted beak.
  const cheek = {
    r: (sampleAvg(data, p(IDX.cheekSampleR).x, p(IDX.cheekSampleR).y, rad).r +
        sampleAvg(data, p(IDX.cheekSampleL).x, p(IDX.cheekSampleL).y, rad).r) / 2,
    g: (sampleAvg(data, p(IDX.cheekSampleR).x, p(IDX.cheekSampleR).y, rad).g +
        sampleAvg(data, p(IDX.cheekSampleL).x, p(IDX.cheekSampleL).y, rad).g) / 2,
    b: (sampleAvg(data, p(IDX.cheekSampleR).x, p(IDX.cheekSampleR).y, rad).b +
        sampleAvg(data, p(IDX.cheekSampleL).x, p(IDX.cheekSampleL).y, rad).b) / 2,
  };
  const beak: RGB = { r: Math.min(255, cheek.r * 1.15 + 35), g: cheek.g * 0.92, b: cheek.b * 0.5 };

  // Iris colour: sample a tiny region at each iris centre (478-point model).
  const eye =
    lm.length > IDX.lIris
      ? {
          r: (sampleAvg(data, p(IDX.rIris).x, p(IDX.rIris).y, Math.max(1, rad * 0.4)).r +
              sampleAvg(data, p(IDX.lIris).x, p(IDX.lIris).y, Math.max(1, rad * 0.4)).r) / 2,
          g: (sampleAvg(data, p(IDX.rIris).x, p(IDX.rIris).y, Math.max(1, rad * 0.4)).g +
              sampleAvg(data, p(IDX.lIris).x, p(IDX.lIris).y, Math.max(1, rad * 0.4)).g) / 2,
          b: (sampleAvg(data, p(IDX.rIris).x, p(IDX.rIris).y, Math.max(1, rad * 0.4)).b +
              sampleAvg(data, p(IDX.lIris).x, p(IDX.lIris).y, Math.max(1, rad * 0.4)).b) / 2,
        }
      : { r: 58, g: 42, b: 31 };

  return {
    body: hex(body),
    belly: hex(lighten(body, 0.45)),
    accent: hex(accent),
    beak: hex(beak),
    eye: hex(eye),
  };
}

export function initBirding(root: HTMLElement): void {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
    root.querySelector<T>(sel);

  const views = {
    choose: $('[data-bird-choose]'),
    camera: $('[data-bird-camera-view]'),
    busy: $('[data-bird-busy]'),
    error: $('[data-bird-error]'),
    result: $('[data-bird-result]'),
  };
  const btnCamera = $<HTMLButtonElement>('[data-bird-camera]');
  const btnUpload = $<HTMLButtonElement>('[data-bird-upload]');
  const fileInput = $<HTMLInputElement>('[data-bird-file]');
  const captureInput = $<HTMLInputElement>('[data-bird-capture]');
  const video = $<HTMLVideoElement>('[data-bird-video]');
  const btnShoot = $<HTMLButtonElement>('[data-bird-shoot]');
  const btnCancel = $<HTMLButtonElement>('[data-bird-cancel]');
  const errorMsg = $('[data-bird-error-msg]');
  const btnRetry = $<HTMLButtonElement>('[data-bird-retry]');
  const birdCanvas = $<HTMLCanvasElement>('[data-bird-canvas]');
  const nameEl = $('[data-bird-name]');
  const sciEl = $('[data-bird-sci]');
  const fromEl = $('[data-bird-from]');
  const btnDownload = $<HTMLButtonElement>('[data-bird-download]');
  const btnAgain = $<HTMLButtonElement>('[data-bird-again]');
  const btnAnother = $<HTMLButtonElement>('[data-bird-another]');
  const photoLink = $<HTMLAnchorElement>('[data-bird-photo]');
  type BirdPhoto = { href: string; full: string; w: number; h: number; caption: string; exif: string; file: string };
  let photos: Record<string, BirdPhoto> = {};
  try {
    photos = JSON.parse(root.dataset.birdPhotos || '{}');
  } catch {
    // No photos: See the bird stays hidden.
  }

  const source = document.createElement('canvas');
  let landmarker: Promise<FaceLandmarkerT> | null = null;
  let stream: MediaStream | null = null;
  // Last successful detection, kept so "Another bird" works without a new selfie.
  let last: { lm: NormalizedLandmark[]; features: FaceFeatures; palette: FacePalette } | null = null;
  let variant = 0;
  // The bird being inked in, so a download or another bird can finish it first.
  let inking: Inking | null = null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function show(view: keyof typeof views): void {
    for (const [k, el] of Object.entries(views)) {
      if (el) el.hidden = k !== view;
    }
  }

  function fail(msg: string): void {
    stopCamera();
    if (errorMsg) errorMsg.textContent = msg;
    show('error');
  }

  /** The face model, loaded once; safe to call again while it's still loading. */
  function ensureLandmarker(): Promise<FaceLandmarkerT> {
    if (!landmarker) {
      landmarker = (async () => {
        const vision = await import('@mediapipe/tasks-vision');
        const fileset = await vision.FilesetResolver.forVisionTasks('/birding/wasm');
        return vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/birding/face_landmarker.task' },
          runningMode: 'IMAGE',
          numFaces: 1,
        });
      })();
      landmarker.catch(() => {
        landmarker = null;
      });
    }
    return landmarker;
  }

  /** Draw an image/video frame into the source canvas, capped at MAX_SOURCE. */
  function drawSource(img: HTMLImageElement | HTMLVideoElement, iw: number, ih: number): void {
    const scale = Math.min(1, MAX_SOURCE / Math.max(iw, ih));
    source.width = Math.max(1, Math.round(iw * scale));
    source.height = Math.max(1, Math.round(ih * scale));
    const sctx = source.getContext('2d');
    if (!sctx) return;
    sctx.drawImage(img, 0, 0, source.width, source.height);
  }

  /** Draw the bird for the current `last` detection and `variant` (Another bird). */
  async function renderResult(): Promise<void> {
    if (!last) return;
    const now = last;
    const species = pickSpecies(now.features, now.palette, variant);
    const parts = await loadParts(species.id);
    if (now !== last) return;
    if (birdCanvas) {
      inking?.finish();
      inking = null;
      renderHybrid(
        birdCanvas,
        {
          source,
          landmarks: now.lm,
          params: featuresToBird(now.features, now.palette),
          species,
          parts,
          seed: birdStyleSeed(now.features, now.palette),
        },
        BIRD_PX,
      );
      birdCanvas.setAttribute('aria-label', `Your selfie with a ${species.common.toLowerCase()}'s bill and feathers`);
      // Put back dot by dot, like the stipple plates on the hobby cards.
      if (!reduceMotion) {
        const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fbfaf8';
        inking = inkIn(birdCanvas, paper);
      }
    }
    if (nameEl) nameEl.textContent = species.common;
    if (sciEl) sciEl.textContent = species.sci;
    if (fromEl) fromEl.textContent = `Bill and feathers from my photo, ${species.from}`;
    // See the bird opens my photo of this bird in the lightbox.
    const photo = photos[species.id];
    if (photoLink) {
      photoLink.hidden = !photo;
      if (photo) {
        photoLink.href = photo.href;
        photoLink.dataset.pswpFull = photo.full;
        photoLink.dataset.pswpWidth = String(photo.w);
        photoLink.dataset.pswpHeight = String(photo.h);
        photoLink.dataset.pswpCaption = photo.caption;
        photoLink.dataset.pswpExif = photo.exif;
        photoLink.dataset.pswpFilename = photo.file;
      }
    }
    performance.mark('bird:drawn');
  }

  async function processSource(): Promise<void> {
    show('busy');
    try {
      const lmk = await ensureLandmarker();
      const result = lmk.detect(source);
      const faces = result.faceLandmarks;
      if (!faces || faces.length === 0) {
        fail('No face found in that photo. Try a clear, front-on selfie with good lighting.');
        return;
      }
      const lm = faces[0];
      const sctx = source.getContext('2d');
      if (!sctx) {
        fail("Couldn't read the image.");
        return;
      }
      const data = sctx.getImageData(0, 0, source.width, source.height);
      const features = computeFeatures(lm, source.width, source.height);
      const palette = computePalette(lm, data);
      last = { lm, features, palette };
      variant = 0;
      await renderResult();
      show('result');
    } catch (err) {
      console.error('[birding] generation failed', err);
      fail('Something went wrong generating your bird. Please try again.');
    }
  }

  function loadFile(file: File): void {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      drawSource(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      void processSource();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      fail("That file couldn't be read as an image.");
    };
    img.src = url;
  }

  function stopCamera(): void {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (video) video.srcObject = null;
  }

  async function startCamera(): Promise<void> {
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) {
      captureInput?.click(); // mobile native camera fallback
      return;
    }
    try {
      stream = await md.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      show('camera');
    } catch {
      // Permission denied or no camera: fall back to the native capture input.
      captureInput?.click();
    }
  }

  function shoot(): void {
    if (!video || !video.videoWidth) {
      fail("The camera wasn't ready. Please try again.");
      return;
    }
    drawSource(video, video.videoWidth, video.videoHeight);
    stopCamera();
    void processSource();
  }

  function reset(): void {
    stopCamera();
    if (fileInput) fileInput.value = '';
    if (captureInput) captureInput.value = '';
    show('choose');
  }

  // Load the face model and the birds' parts while the visitor frames or
  // picks a photo (about 15 MB the first time, cached after that).
  const warm = () => {
    ensureLandmarker().catch(() => {});
    for (const id of Object.keys(PART_URLS)) loadParts(id).catch(() => {});
  };
  btnCamera?.addEventListener('click', () => {
    warm();
    void startCamera();
  });
  btnUpload?.addEventListener('click', () => {
    warm();
    fileInput?.click();
  });
  fileInput?.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) loadFile(f);
  });
  captureInput?.addEventListener('change', () => {
    const f = captureInput.files?.[0];
    if (f) loadFile(f);
  });
  btnShoot?.addEventListener('click', shoot);
  btnCancel?.addEventListener('click', reset);
  btnRetry?.addEventListener('click', reset);
  btnAgain?.addEventListener('click', reset);
  btnAnother?.addEventListener('click', () => {
    if (!last) return;
    variant += 1;
    void renderResult();
  });
  btnDownload?.addEventListener('click', () => {
    if (!birdCanvas) return;
    inking?.finish();
    inking = null;
    const a = document.createElement('a');
    a.href = birdCanvas.toDataURL('image/png');
    a.download = 'my-bird.png';
    a.click();
  });

  window.addEventListener('pagehide', stopCamera);
  show('choose');
}
