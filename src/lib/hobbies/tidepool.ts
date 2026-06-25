/**
 * "Flip a rock" tide-pooling game — the interactive for the Tide Pooling hobby.
 *
 * A pixel beach with rocks and driftwood logs. Tap one with the hand cursor and
 * it flips up to reveal a Pacific Northwest critter (drawn as a pixel sprite by
 * category) plus a real fun fact in a popup card. A "field journal" tracks how
 * many of the ~40 species you've discovered, persisted in localStorage so it
 * accumulates across visits.
 *
 * Self-contained: no dependencies, no network, no image assets (sprites are all
 * canvas fillRect). Pauses offscreen / when hidden; honors prefers-reduced-motion.
 * Photos per species can be layered in later (the card reserves a slot).
 *
 * Mounted by src/components/hobbies/TidePool.astro via [data-tp-*] hooks.
 */
import { SPECIES, type TidepoolSpecies, type TidepoolCategory } from './tidepool-species';
import photoData from './tidepool-photos.json';

/** Optional real photos per species id (CC-licensed). See tidepool-photos.json. */
const PHOTOS = (photoData.species ?? {}) as Record<string, { photo?: string; credit?: string }>;

const PIX = 4;
const STORE_KEY = 'tidepool-discovered-v1';
const RARITY_WEIGHT: Record<TidepoolSpecies['rarity'], number> = { common: 6, uncommon: 3, rare: 1 };

function snap(v: number): number {
  return Math.round(v / PIX) * PIX;
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const mix = (c: number) => Math.round((t - c) * p + c);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// ----------------------------------------------------- stone decoration
// Per-stone color palettes + precomputed flecks so rocks/logs each look a bit
// different and weathered the way real PNW tide-pool rocks do (moss, barnacles,
// wood grain). Computed once per scene so they don't jitter frame to frame.
const ROCK_BASES = ['#7a7066', '#6e6a64', '#867b6b', '#6a6258', '#827c72', '#726a60'];
const LOG_BASES = ['#5a4023', '#6b4e2d', '#746555', '#4f3a20', '#7d6e58'];
const MOSS = ['rgba(92,118,62,0.92)', 'rgba(74,104,54,0.92)', 'rgba(110,130,70,0.88)'];
const MOSS_HI = 'rgba(150,176,104,0.9)';

interface Detail {
  x: number;
  y: number;
  w: number;
  h: number;
  c: string;
}

/** Half-width of the rounded-boulder silhouette at a given local y. */
function rockHalfWAt(w: number, h: number, ly: number): number {
  const t = (ly + h / 2) / (h * 0.92);
  if (t <= 0) return w * 0.2;
  if (t >= 1) return w * 0.25;
  return (w / 2) * Math.sqrt(Math.max(0.16, 1 - (1 - t) * (1 - t)));
}

/** Precompute per-stone color + decorative flecks (moss, barnacles, grain). */
function decorateStone(s: Stone, r: () => number): void {
  const d: Detail[] = [];
  if (s.kind === 'rock') {
    s.base = ROCK_BASES[Math.floor(r() * ROCK_BASES.length)];
    // dark pocks for texture
    const pocks = 3 + Math.floor(r() * 4);
    for (let i = 0; i < pocks; i++) {
      const ly = -s.h / 2 + r() * s.h * 0.8;
      const hw = rockHalfWAt(s.w, s.h, ly) - PIX;
      if (hw <= PIX) continue;
      d.push({ x: snap((r() - 0.5) * 2 * hw), y: snap(ly), w: PIX, h: PIX, c: shade(s.base, -0.3) });
    }
    // a barnacle cluster on one shoulder
    if (r() < 0.85) {
      const n = 3 + Math.floor(r() * 4);
      const cy = -s.h / 2 + s.h * (0.16 + r() * 0.3);
      const hw = Math.max(PIX, rockHalfWAt(s.w, s.h, cy) - PIX);
      const cx = (r() - 0.5) * 1.1 * hw;
      for (let i = 0; i < n; i++) {
        const bx = cx + (r() - 0.5) * hw * 0.9;
        const by = cy + (r() - 0.5) * s.h * 0.18;
        d.push({ x: snap(bx), y: snap(by), w: PIX, h: PIX, c: r() < 0.4 ? '#ece6d6' : '#cbc4b4' });
      }
    }
    // moss on the crown + shoulders (the signature PNW look)
    if (r() < 0.9) {
      const moss = MOSS[Math.floor(r() * MOSS.length)];
      const clumps = 2 + Math.floor(r() * 3);
      for (let i = 0; i < clumps; i++) {
        const ly = -s.h / 2 + PIX + r() * s.h * 0.3;
        const hw = rockHalfWAt(s.w, s.h, Math.max(ly, -s.h / 2 + PIX));
        const lx = (r() - 0.5) * 1.3 * hw;
        d.push({ x: snap(lx - PIX), y: snap(ly + PIX), w: PIX * 3, h: PIX, c: moss });
        d.push({ x: snap(lx), y: snap(ly), w: PIX * 2, h: PIX, c: moss });
        d.push({ x: snap(lx), y: snap(ly - PIX), w: PIX, h: PIX, c: MOSS_HI });
      }
    }
  } else {
    s.base = LOG_BASES[Math.floor(r() * LOG_BASES.length)];
    const hw = s.w / 2;
    const hh = s.h / 2;
    // grain lines running the length
    const lines = 2 + Math.floor(r() * 3);
    for (let i = 0; i < lines; i++) {
      const ly = -hh + ((i + 1) * s.h) / (lines + 1);
      d.push({ x: snap(-hw + PIX * 2), y: snap(ly), w: snap(s.w - PIX * 4), h: PIX, c: shade(s.base, -0.22) });
    }
    // the odd knot
    const knots = Math.floor(r() * 3);
    for (let i = 0; i < knots; i++) {
      const kx = (r() - 0.55) * s.w * 0.7;
      const ky = (r() - 0.5) * s.h * 0.4;
      d.push({ x: snap(kx - PIX), y: snap(ky - PIX), w: PIX * 3, h: PIX * 3, c: shade(s.base, -0.16) });
      d.push({ x: snap(kx), y: snap(ky), w: PIX, h: PIX, c: shade(s.base, -0.4) });
    }
    // a mossy run along the top edge with gaps
    if (r() < 0.85) {
      const moss = MOSS[Math.floor(r() * MOSS.length)];
      for (let x = -hw + PIX; x < hw - PIX; x += PIX) {
        if (r() < 0.5) d.push({ x: snap(x), y: snap(-hh - PIX), w: PIX, h: PIX, c: moss });
      }
    }
  }
  s.detail = d;
}

// ----------------------------------------------------------- critter sprites
// Each draws centered at the current origin. `u` is the pixel-block size; `R`
// fills a block rect in block units (so shapes read as chunky pixels).
type Ctx = CanvasRenderingContext2D;
type Sprite = (c: Ctx, u: number, color: string, accent: string, sp: TidepoolSpecies) => void;

function rect(c: Ctx, u: number, x: number, y: number, w: number, h: number, fill: string): void {
  c.fillStyle = fill;
  c.fillRect(snap(x * u), snap(y * u), Math.max(u, snap(w * u)), Math.max(u, snap(h * u)));
}

const crab: Sprite = (c, u, col, acc) => {
  const dk = shade(col, -0.25);
  for (let i = 0; i < 3; i++) {
    rect(c, u, -5, 0 + i, 2, 1, dk);
    rect(c, u, 3, 0 + i, 2, 1, dk);
  }
  rect(c, u, -4, -2, 8, 4, col);
  rect(c, u, -3, -3, 6, 1, col);
  rect(c, u, -3, 2, 6, 1, dk);
  rect(c, u, -6, -2, 2, 2, col);
  rect(c, u, 4, -2, 2, 2, col);
  rect(c, u, -7, -2, 1, 1, acc);
  rect(c, u, 6, -2, 1, 1, acc);
  rect(c, u, -2, -2, 1, 1, '#0b0b0b');
  rect(c, u, 1, -2, 1, 1, '#0b0b0b');
};

const hermit: Sprite = (c, u, col, acc) => {
  // borrowed snail shell
  rect(c, u, 0, -4, 5, 8, '#caa46a');
  rect(c, u, 1, -2, 3, 4, shade('#caa46a', -0.25));
  rect(c, u, 2, -1, 1, 2, '#7a5a32');
  // crab poking out
  rect(c, u, -4, 0, 4, 3, col);
  rect(c, u, -6, 1, 2, 1, col);
  rect(c, u, -7, 1, 1, 1, acc);
  for (let i = 0; i < 2; i++) rect(c, u, -3, 3 + i * 0, -1 + i, 1, shade(col, -0.2));
  rect(c, u, -3, -1, 1, 1, '#0b0b0b');
};

const star: Sprite = (c, u, col, acc, sp) => {
  const arms = sp.arms ?? 5;
  const len = 6;
  for (let a = 0; a < arms; a++) {
    const ang = (a / arms) * Math.PI * 2 - Math.PI / 2;
    for (let r = 0; r <= len; r++) {
      const w = 1 + (1 - r / len) * 2;
      rect(c, u, Math.cos(ang) * r - w / 2, Math.sin(ang) * r - w / 2, w, w, r > len * 0.6 ? acc : col);
    }
  }
  rect(c, u, -2, -2, 4, 4, shade(col, 0.15));
};

const anemone: Sprite = (c, u, col, acc) => {
  rect(c, u, -3, 0, 6, 5, shade(col, -0.1));
  rect(c, u, -3, 4, 6, 1, shade(col, -0.3));
  for (let i = -4; i <= 4; i++) {
    const h = 2 + ((i + 4) % 3);
    rect(c, u, i, -h, 1, h + 1, i % 2 ? col : acc);
  }
};

const nudibranch: Sprite = (c, u, col, acc) => {
  rect(c, u, -5, 0, 10, 3, col);
  rect(c, u, -4, 2, 8, 1, shade(col, -0.2));
  for (let i = -4; i <= 3; i += 2) {
    rect(c, u, i, -2, 1, 2, acc);
    rect(c, u, i, -3, 1, 1, shade(acc, 0.2));
  }
  rect(c, u, 4, -2, 1, 2, acc);
  rect(c, u, 5, 0, 1, 1, '#0b0b0b');
};

const chiton: Sprite = (c, u, col, acc) => {
  rect(c, u, -5, -3, 10, 6, shade(col, -0.2));
  for (let i = 0; i < 8; i++) rect(c, u, -4 + i, -2, 1, 4, i % 2 ? col : acc);
};

const snail: Sprite = (c, u, col, acc) => {
  for (let r = 4; r >= 1; r--) {
    rect(c, u, -r, -r, r * 2, r * 2, r % 2 ? col : acc);
  }
  rect(c, u, -6, 2, 4, 2, shade(col, 0.1));
  rect(c, u, -6, 0, 1, 2, shade(col, 0.1));
  rect(c, u, -6, -1, 1, 1, '#0b0b0b');
};

const limpet: Sprite = (c, u, col, acc) => {
  for (let i = 0; i < 4; i++) rect(c, u, -4 + i, -i, 8 - i * 2, 1, i === 0 ? acc : col);
  rect(c, u, -5, 1, 10, 1, shade(col, -0.3));
};

const urchin: Sprite = (c, u, col, acc) => {
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2;
    for (let r = 3; r <= 6; r++) rect(c, u, Math.cos(ang) * r, Math.sin(ang) * r, 1, 1, acc);
  }
  for (let yy = -3; yy <= 3; yy++) {
    const w = Math.round(Math.sqrt(9 - yy * yy));
    rect(c, u, -w, yy, w * 2, 1, col);
  }
};

const barnacle: Sprite = (c, u, col, acc) => {
  for (const dx of [-3, 1]) {
    rect(c, u, dx, -2, 4, 5, col);
    rect(c, u, dx + 1, -3, 2, 1, col);
    rect(c, u, dx + 1, -2, 2, 2, acc);
  }
};

const mussel: Sprite = (c, u, col, acc) => {
  for (const dx of [-4, 0]) {
    for (let i = 0; i < 5; i++) rect(c, u, dx + (i < 3 ? i : 4 - i), -3 + i, 3, 1, i % 2 ? col : shade(col, -0.2));
  }
  rect(c, u, -1, 1, 2, 3, acc);
};

const sculpin: Sprite = (c, u, col, acc) => {
  rect(c, u, -5, -2, 7, 4, col);
  rect(c, u, -5, -3, 4, 1, col);
  rect(c, u, 2, -2, 3, 4, col);
  rect(c, u, 5, -3, 2, 6, col);
  rect(c, u, -2, 0, 6, 1, acc);
  rect(c, u, -3, 1, 2, 1, acc);
  rect(c, u, -3, -1, 1, 1, '#fff');
  rect(c, u, -3, -1, 1, 1, '#0b0b0b');
  rect(c, u, -4, -2, 1, 1, '#0b0b0b');
};

const eel: Sprite = (c, u, col, acc) => {
  for (let i = -7; i <= 7; i++) {
    const y = Math.round(Math.sin(i * 0.5) * 2);
    rect(c, u, i, y - 1, 1, 3, col);
    if (i % 2 === 0) rect(c, u, i, y - 2, 1, 1, acc);
  }
  rect(c, u, 7, Math.round(Math.sin(7 * 0.5) * 2) - 1, 1, 1, '#0b0b0b');
};

const shrimp: Sprite = (c, u, col, acc) => {
  for (let i = 0; i < 7; i++) {
    const y = Math.round((i - 3) * (i - 3) * 0.18) - 1;
    rect(c, u, i - 4, y, 1, 2, i % 2 ? col : shade(col, -0.15));
  }
  rect(c, u, 3, -2, 2, 1, acc);
  rect(c, u, 3, 1, 2, 1, acc);
  rect(c, u, -5, -1, 1, 2, col);
  rect(c, u, 3, -2, 1, 1, '#0b0b0b');
};

const cucumber: Sprite = (c, u, col, acc) => {
  rect(c, u, -6, -2, 12, 4, col);
  rect(c, u, -6, -1, 1, 2, shade(col, -0.2));
  rect(c, u, 5, -1, 1, 2, shade(col, -0.2));
  for (let i = -5; i <= 5; i += 2) rect(c, u, i, -3, 1, 1, acc);
};

const octopus: Sprite = (c, u, col, acc) => {
  rect(c, u, -4, -5, 8, 6, col);
  rect(c, u, -3, -6, 6, 1, col);
  rect(c, u, -2, -3, 2, 2, '#fff');
  rect(c, u, 0, -3, 2, 2, '#fff');
  rect(c, u, -1, -3, 1, 1, '#0b0b0b');
  rect(c, u, 1, -3, 1, 1, '#0b0b0b');
  for (let i = 0; i < 4; i++) {
    const x = -4 + i * 2.4;
    rect(c, u, x, 1, 1, 4 - (i % 2), acc);
  }
};

const SPRITES: Record<TidepoolCategory, Sprite> = {
  crab, hermit, star, anemone, nudibranch, chiton, snail, limpet, urchin,
  barnacle, mussel, sculpin, eel, shrimp, cucumber, octopus,
};

function drawCritter(c: Ctx, sp: TidepoolSpecies, cx: number, cy: number, unit: number): void {
  c.save();
  c.translate(snap(cx), snap(cy));
  SPRITES[sp.category](c, unit * sp.size, sp.color, sp.accent, sp);
  c.restore();
}

// --------------------------------------------------------------- the game
interface Stone {
  kind: 'rock' | 'log';
  x: number;
  y: number;
  w: number;
  h: number;
  lift: number; // 0 = resting, 1 = fully flipped
  open: boolean; // toggled by clicking: flipped up vs. lowered back down
  species: TidepoolSpecies | null;
  base: string; // per-stone color
  detail: Detail[]; // precomputed moss/barnacle/grain flecks (local coords)
}

function loadDiscovered(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set();
}
function saveDiscovered(set: Set<string>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export function initTidepool(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-tp-canvas]');
  const card = root.querySelector<HTMLElement>('[data-tp-card]');
  const revealCanvas = root.querySelector<HTMLCanvasElement>('[data-tp-reveal]');
  const nameEl = root.querySelector<HTMLElement>('[data-tp-name]');
  const sciEl = root.querySelector<HTMLElement>('[data-tp-sci]');
  const factEl = root.querySelector<HTMLElement>('[data-tp-fact]');
  const badgeEl = root.querySelector<HTMLElement>('[data-tp-badge]');
  const closeBtn = root.querySelector<HTMLButtonElement>('[data-tp-close]');
  const progressEl = root.querySelector<HTMLElement>('[data-tp-progress]');
  const barEl = root.querySelector<HTMLElement>('[data-tp-bar]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-tp-reset]');
  const photoEl = root.querySelector<HTMLImageElement>('[data-tp-photo]');
  const creditEl = root.querySelector<HTMLElement>('[data-tp-credit]');

  if (!canvas || !card || !revealCanvas || !nameEl || !sciEl || !factEl || !badgeEl || !closeBtn || !progressEl || !barEl) {
    return;
  }
  const ctx = canvas.getContext('2d');
  const rctx = revealCanvas.getContext('2d');
  if (!ctx || !rctx) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrap: Element = canvas.parentElement ?? canvas;
  const total = SPECIES.length;
  const discovered = loadDiscovered();

  let W = 0;
  let H = 0;
  let dpr = 1;
  let stones: Stone[] = [];
  let sceneSalt = 0; // bumped by "New beach" so the layout reshuffles (but stays stable across resizes)
  let hand = { x: -100, y: -100, show: false };
  let onscreen = true;
  let running = false;
  let raf = 0;
  let last = 0;

  function rng(seed: number): () => number {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  function pickSpecies(exclude?: string): TidepoolSpecies {
    let totalW = 0;
    for (const s of SPECIES) totalW += RARITY_WEIGHT[s.rarity];
    for (let tries = 0; tries < 6; tries++) {
      let r = Math.random() * totalW;
      for (const s of SPECIES) {
        r -= RARITY_WEIGHT[s.rarity];
        if (r <= 0) {
          if (s.id !== exclude || SPECIES.length === 1) return s;
          break;
        }
      }
    }
    return SPECIES[0];
  }

  function buildScene(): void {
    const r = rng(Math.round(W) * 13 + 7 + sceneSalt * 101);
    stones = [];
    const sub = H * 0.4; // pools/sand start below this
    const count = Math.max(9, Math.round(W / 80));
    // fixed rock:log ratio so every beach is reliably rocky, then shuffle the
    // kinds across x (avoids the occasional sparse, log-heavy random seed).
    const kinds: Stone['kind'][] = [];
    for (let i = 0; i < count; i++) kinds.push(i < Math.round(count * 0.78) ? 'rock' : 'log');
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    for (let i = 0; i < count; i++) {
      const kind = kinds[i];
      const big = kind === 'rock' && r() < 0.4;
      const w = kind === 'log' ? 58 + r() * 54 : big ? 60 + r() * 40 : 32 + r() * 24;
      const h = kind === 'log' ? 20 + r() * 6 : big ? 40 + r() * 16 : 24 + r() * 12;
      const x = ((i + 0.5) / count) * W + (r() - 0.5) * 50;
      const y = sub + r() * (H - sub - 50) + 24;
      stones.push({ kind, x, y, w, h, lift: 0, open: false, species: null, base: '', detail: [] });
    }
    stones.sort((a, b) => a.y - b.y);
    for (const s of stones) decorateStone(s, r);
    bakeBackground();
  }

  function fit(): void {
    const cssW = canvas!.clientWidth || (wrap as HTMLElement).clientWidth || 640;
    const cssH = Math.max(300, Math.min(520, Math.round(cssW * 0.62)));
    canvas!.style.height = `${cssH}px`;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas!.width = Math.round(cssW * dpr);
    canvas!.height = Math.round(cssH * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.imageSmoothingEnabled = false;
    W = cssW;
    H = cssH;
    buildScene();
  }

  // ------------------------------------------------------------ rendering
  // The static beach (sand zones, ripples, pebbles, weed, tide pools) is baked
  // once per scene into an offscreen canvas; the loop just blits it and draws
  // the stones on top. Keeps the detail rich without paying for it every frame.
  let bg: HTMLCanvasElement | null = null;

  // a soft pixel "blob" (ellipse of chunky rows) used for sand patches + pools
  function softBlob(b: Ctx, px: number, py: number, pw: number, ph: number, fill: string): void {
    b.fillStyle = fill;
    const rows = Math.max(2, Math.round(ph / (PIX * 2)));
    for (let i = -rows; i <= rows; i++) {
      const f = 1 - (i / (rows + 0.5)) ** 2;
      if (f <= 0) continue;
      const ww = Math.round(Math.sqrt(f) * pw);
      b.fillRect(snap(px - ww / 2), snap(py + i * PIX * 2), ww, PIX * 2);
    }
  }

  function bakeBackground(): void {
    const c = document.createElement('canvas');
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const b = c.getContext('2d');
    if (!b) return;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.imageSmoothingEnabled = false;
    const r = rng(Math.round(W) * 31 + 17 + sceneSalt * 101);
    const sandTop = H * 0.4;

    // sky-to-sand gradient
    const g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#bfe0e6');
    g.addColorStop(0.3, '#a9d4dc');
    g.addColorStop(0.4, '#c4b48f');
    g.addColorStop(0.62, '#b29a72');
    g.addColorStop(1, '#9c855f');
    b.fillStyle = g;
    b.fillRect(0, 0, W, H);

    // distant water + a paler shorebreak band
    b.fillStyle = '#7bb8c4';
    b.fillRect(0, snap(H * 0.27), W, snap(H * 0.03));
    b.fillStyle = '#93c6ce';
    b.fillRect(0, snap(H * 0.305), W, PIX);

    // foam line where water meets sand
    b.fillStyle = 'rgba(255,255,255,0.55)';
    for (let x = 0; x < W; x += PIX) {
      const y = sandTop - PIX + Math.sin(x / 38) * PIX;
      if (r() < 0.55) b.fillRect(snap(x), snap(y), PIX, PIX);
    }

    // base wet-sand speckle
    b.fillStyle = 'rgba(108,86,54,0.22)';
    for (let y = snap(sandTop); y < H; y += PIX * 2) {
      for (let x = (y * 7) % (PIX * 6); x < W; x += PIX * 6) b.fillRect(x, y, PIX, PIX);
    }

    // lighter dry-sand blotches + darker wet blotches
    for (let i = 0; i < 11; i++) softBlob(b, r() * W, sandTop + r() * (H - sandTop), 24 + r() * 70, 12 + r() * 26, 'rgba(214,194,154,0.18)');
    for (let i = 0; i < 9; i++) softBlob(b, r() * W, sandTop + r() * (H - sandTop), 20 + r() * 56, 10 + r() * 20, 'rgba(66,50,30,0.16)');

    // sand ripples in the lower wet zone
    b.fillStyle = 'rgba(86,68,42,0.2)';
    for (let y = snap(H * 0.6); y < H - PIX; y += PIX * 5) {
      for (let x = 0; x < W; x += PIX) {
        const yy = y + Math.round(Math.sin(x / 26 + y * 0.3) * PIX);
        b.fillRect(snap(x), snap(yy), PIX, PIX);
      }
    }

    // tide pools with a wet rim + a little sky reflection
    for (let i = 0; i < 3; i++) {
      const px = (0.18 + 0.3 * i) * W + (r() - 0.5) * 60;
      const py = H * (0.56 + 0.1 * r());
      const pw = 64 + r() * 70;
      softBlob(b, px, py, pw + PIX * 3, 22 + r() * 10, 'rgba(60,46,28,0.2)');
      softBlob(b, px, py, pw, 20 + r() * 8, 'rgba(86,158,178,0.55)');
      softBlob(b, px, py - PIX * 2, pw * 0.5, 6, 'rgba(190,222,228,0.4)');
    }

    // scattered pebbles / cobbles
    const greys = ['#8a8074', '#9a8e7c', '#776c60', '#a59a86', '#6f655a', '#837560'];
    for (let i = 0; i < 46; i++) {
      const px = r() * W;
      const py = sandTop + r() * (H - sandTop);
      const sz = PIX * (1 + Math.floor(r() * 2));
      b.fillStyle = greys[Math.floor(r() * greys.length)];
      b.fillRect(snap(px), snap(py), sz, sz);
      b.fillStyle = 'rgba(255,255,255,0.18)';
      b.fillRect(snap(px), snap(py), sz, PIX);
    }

    // tiny shells
    for (let i = 0; i < 16; i++) {
      b.fillStyle = r() < 0.5 ? '#e8e1d3' : '#e6c7c0';
      b.fillRect(snap(r() * W), snap(sandTop + r() * (H - sandTop)), PIX, PIX);
    }

    // rockweed / eelgrass tufts
    for (let i = 0; i < 7; i++) {
      const px = r() * W;
      const py = H * 0.58 + r() * (H * 0.36);
      b.fillStyle = r() < 0.5 ? '#566a30' : '#6e7a38';
      const len = 3 + Math.floor(r() * 4);
      for (let k = 0; k < len; k++) {
        b.fillRect(snap(px + Math.sin(k) * PIX), snap(py - k * PIX), PIX, PIX);
        b.fillRect(snap(px + PIX * 2 + Math.sin(k + 1) * PIX), snap(py - k * PIX), PIX, PIX);
      }
    }

    bg = c;
  }

  function drawBeach(now: number): void {
    if (bg) ctx!.drawImage(bg, 0, 0, W, H);
    for (const s of stones) drawStone(s, now);
    if (hand.show && !reduceMotion) drawHand(hand.x, hand.y);
  }

  function drawStone(s: Stone, now: number): void {
    const base = s.base || (s.kind === 'rock' ? '#7a7066' : '#5a4023');
    const lift = s.lift;

    // soft contact shadow on the sand
    if (lift < 0.95) {
      ctx!.fillStyle = 'rgba(40,30,18,0.16)';
      const sw = s.w * (1 - lift * 0.5);
      for (let yy = -1; yy <= 1; yy++) {
        const ww = Math.round(Math.sqrt(Math.max(0, 1 - (yy / 1.6) ** 2)) * sw);
        ctx!.fillRect(snap(s.x - ww / 2), snap(s.y + s.h / 2 + yy * PIX), ww, PIX);
      }
    }

    // wet patch + the critter revealed underneath, once lifting
    if (lift > 0.1) {
      ctx!.fillStyle = 'rgba(40,30,20,0.28)';
      ctx!.fillRect(snap(s.x - s.w / 2), snap(s.y - 4), snap(s.w), snap(8));
      if (s.species) {
        const wob = reduceMotion ? 0 : Math.sin(now / 360 + s.x) * PIX;
        drawCritter(ctx!, s.species, s.x + wob, s.y, PIX);
      }
    }

    // the stone itself, lifted up + tilted as it flips
    ctx!.save();
    ctx!.translate(snap(s.x), snap(s.y - lift * (s.h + 14)));
    ctx!.rotate(lift * -0.5);
    if (s.kind === 'rock') {
      const rows = 6;
      for (let i = 0; i < rows; i++) {
        const t = i / (rows - 1);
        const ww = s.w * Math.sqrt(Math.max(0.16, 1 - (1 - t) * (1 - t)));
        ctx!.fillStyle = i < 2 ? shade(base, 0.16) : i >= rows - 2 ? shade(base, -0.22) : base;
        ctx!.fillRect(snap(-ww / 2), snap(-s.h / 2 + t * (s.h * 0.92)), snap(ww), snap(s.h / rows + 1));
      }
    } else {
      const hw = s.w / 2;
      const hh = s.h / 2;
      // billet with clipped corners so the ends read as rounded
      ctx!.fillStyle = base;
      ctx!.fillRect(snap(-hw), snap(-hh + PIX), snap(s.w), snap(s.h - PIX * 2));
      ctx!.fillRect(snap(-hw + PIX), snap(-hh), snap(s.w - PIX * 2), snap(s.h));
      // top highlight + underside shade
      ctx!.fillStyle = shade(base, 0.16);
      ctx!.fillRect(snap(-hw + PIX), snap(-hh), snap(s.w - PIX * 2), PIX);
      ctx!.fillStyle = shade(base, -0.26);
      ctx!.fillRect(snap(-hw + PIX), snap(hh - PIX), snap(s.w - PIX * 2), PIX);
      // end-grain rings on the left cap
      const rings = [shade(base, -0.32), shade(base, 0.06), shade(base, -0.18)];
      for (let k = 0; k < 3; k++) {
        const rr = hh - PIX - k * PIX;
        if (rr <= 0) break;
        ctx!.fillStyle = rings[k % rings.length];
        ctx!.fillRect(snap(-hw - PIX), snap(-rr), PIX, snap(rr * 2));
      }
    }
    // precomputed decoration: moss, barnacles, grain, knots
    for (const dd of s.detail) {
      ctx!.fillStyle = dd.c;
      ctx!.fillRect(dd.x, dd.y, dd.w, dd.h);
    }
    ctx!.restore();
  }

  function drawHand(x: number, y: number): void {
    const u = PIX;
    ctx!.fillStyle = '#f0c9a0';
    ctx!.fillRect(snap(x), snap(y), u * 3, u * 4);
    ctx!.fillRect(snap(x - u), snap(y + u), u, u * 3);
    ctx!.fillStyle = '#d8a878';
    ctx!.fillRect(snap(x), snap(y - u), u, u * 2);
    ctx!.fillRect(snap(x + u), snap(y - u), u, u * 2);
    ctx!.fillRect(snap(x + u * 2), snap(y - u), u, u * 2);
  }

  // ------------------------------------------------------------- the loop
  function update(dt: number): void {
    for (const s of stones) {
      const target = s.open ? 1 : 0;
      if (s.lift < target) s.lift = Math.min(target, s.lift + dt * 4);
      else if (s.lift > target) s.lift = Math.max(target, s.lift - dt * 4);
    }
  }
  function render(now: number): void {
    drawBeach(now);
  }
  function step(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(reduceMotion ? 0.05 : dt);
    render(now);
    raf = requestAnimationFrame(step);
  }
  function start(): void {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(step);
  }
  function stop(): void {
    running = false;
    cancelAnimationFrame(raf);
  }

  // ----------------------------------------------------------- discovery
  // Clicking a stone toggles it: flip it up to reveal its critter, click again
  // to lower it back down. The animal underneath is assigned once and stays the
  // same. To get new critters, start a new beach.
  function flip(s: Stone): void {
    if (s.open) {
      s.open = false;
      card!.classList.remove('tp-open');
      return;
    }
    s.open = true;
    if (!s.species) s.species = pickSpecies();
    const sp = s.species;
    const isNew = !discovered.has(sp.id);
    if (isNew) {
      discovered.add(sp.id);
      saveDiscovered(discovered);
      updateJournal();
    }
    showCard(sp, isNew);
  }

  function paintRevealSprite(sp: TidepoolSpecies): void {
    if (photoEl) photoEl.classList.add('tp-hidden');
    revealCanvas!.classList.remove('tp-hidden');
    const size = 120;
    revealCanvas!.width = size * dpr;
    revealCanvas!.height = size * dpr;
    rctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    rctx!.imageSmoothingEnabled = false;
    rctx!.clearRect(0, 0, size, size);
    rctx!.fillStyle = '#0b3346';
    rctx!.fillRect(0, 0, size, size);
    rctx!.fillStyle = 'rgba(120,160,170,0.35)';
    rctx!.fillRect(0, size * 0.7, size, size * 0.3);
    drawCritter(rctx!, sp, size / 2, size / 2 + 6, PIX * 1.6);
  }

  function showCard(sp: TidepoolSpecies, isNew: boolean): void {
    const override = PHOTOS[sp.id];
    const photo = sp.photo ?? override?.photo;
    const credit = sp.photoCredit ?? override?.credit ?? '';
    if (photo && photoEl) {
      // real photo when we have one; fall back to the sprite if it fails to load
      photoEl.classList.remove('tp-hidden');
      revealCanvas!.classList.add('tp-hidden');
      photoEl.onerror = () => {
        paintRevealSprite(sp);
        if (creditEl) creditEl.classList.add('tp-hidden');
      };
      photoEl.alt = sp.common;
      photoEl.src = photo;
      if (creditEl) {
        creditEl.textContent = credit;
        creditEl.classList.toggle('tp-hidden', !credit);
      }
    } else {
      paintRevealSprite(sp);
      if (creditEl) creditEl.classList.add('tp-hidden');
    }

    nameEl!.textContent = sp.common;
    sciEl!.textContent = sp.scientific;
    factEl!.textContent = sp.facts[Math.floor(Math.random() * sp.facts.length)];
    badgeEl!.textContent = isNew ? 'New find!' : 'Found again';
    badgeEl!.classList.toggle('tp-badge-new', isNew);
    card!.classList.add('tp-open');
  }

  function updateJournal(): void {
    progressEl!.textContent = `${discovered.size} / ${total} species`;
    barEl!.style.width = `${(discovered.size / total) * 100}%`;
  }

  function hitTest(px: number, py: number): Stone | null {
    for (let i = stones.length - 1; i >= 0; i--) {
      const s = stones[i];
      if (px >= s.x - s.w / 2 && px <= s.x + s.w / 2 && py >= s.y - s.h && py <= s.y + s.h / 2) return s;
    }
    return null;
  }

  // -------------------------------------------------------------- wiring
  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    const rect2 = canvas.getBoundingClientRect();
    const px = e.clientX - rect2.left;
    const py = e.clientY - rect2.top;
    const s = hitTest(px, py);
    if (s) flip(s);
  });
  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const rect2 = canvas.getBoundingClientRect();
    hand.x = e.clientX - rect2.left + 6;
    hand.y = e.clientY - rect2.top + 2;
    hand.show = !!hitTest(e.clientX - rect2.left, e.clientY - rect2.top);
    canvas.style.cursor = hand.show ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', () => {
    hand.show = false;
  });

  closeBtn.addEventListener('click', () => {
    card.classList.remove('tp-open');
  });
  card.addEventListener('click', (e) => {
    if (e.target === card) card.classList.remove('tp-open');
  });
  resetBtn?.addEventListener('click', () => {
    for (const s of stones) {
      s.species = null;
      s.open = false;
    }
    sceneSalt++;
    buildScene();
  });

  const ro = new ResizeObserver(() => {
    fit();
    if (!running && onscreen && !document.hidden) render(performance.now());
  });
  ro.observe(wrap);

  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) onscreen = en.isIntersecting;
      if (onscreen && !document.hidden) start();
      else stop();
    },
    { threshold: 0.05 },
  );
  io.observe(canvas);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (onscreen) start();
  });

  // --------------------------------------------------------------- init
  fit();
  updateJournal();
  render(performance.now());
  start();
}
