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
 * Rocks are heavy: one shudders as you take its weight, comes up leaning a
 * touch too far, drips sand and seawater, and the animal under it reacts
 * before the card opens. "New beach" sends a wave in that brings the new
 * beach under its foam, and a first find hops into the journal's count when
 * its card closes. The motion is pure functions of time in
 * tidepool-motion.ts, and the hop is journal-hop.ts, shared with herping.
 *
 * Mounted by src/components/hobbies/TidePool.astro via [data-tp-*] hooks.
 */
import { covered, whenUncovered } from '../covered';
import { SPECIES, type TidepoolSpecies, type TidepoolCategory } from './tidepool-species';
import photoData from './tidepool-photos.json';
import { revealFromPixels, stopPixelReveal } from './pixel-reveal';
import { stampFind, upgradePhoto } from './specimen';
import { journalHop, type HopSprite } from './journal-hop';
import {
  REST,
  UP,
  TILT,
  clamp,
  critterReact,
  heaviness,
  lowerEnd,
  lowerPose,
  makeTide,
  raiseEnd,
  raisePose,
  raiseTiming,
  reactionFor,
  reactionReach,
  tideCell,
  tideFront,
  tideDone,
  tideOver,
  tideReach,
  tideWashing,
  upAt,
  type Pose,
  type Reaction,
  type Tide,
} from './tidepool-motion';

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

// `open` 1 is today's anemone; toward 0 its tentacles pull in and down
// until it's a shut dome.
function anemoneAt(c: Ctx, u: number, col: string, acc: string, open: number): void {
  if (open < 0.15) {
    // Shut: squeezed into a low dome with its tentacle tips tucked in on top.
    rect(c, u, -3, 2, 6, 3, shade(col, -0.1));
    rect(c, u, -3, 4, 6, 1, shade(col, -0.3));
    rect(c, u, -2, 1, 4, 1, shade(col, -0.1));
    rect(c, u, -1, 1, 2, 1, acc);
    return;
  }
  rect(c, u, -3, 0, 6, 5, shade(col, -0.1));
  rect(c, u, -3, 4, 6, 1, shade(col, -0.3));
  for (let i = -4; i <= 4; i++) {
    const h = Math.max(1, Math.round((2 + ((i + 4) % 3)) * open));
    const x = Math.round(i * (0.55 + 0.45 * open));
    rect(c, u, x, -h, 1, h + 1, i % 2 ? col : acc);
  }
}
const anemone: Sprite = (c, u, col, acc) => anemoneAt(c, u, col, acc, 1);

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

function drawCritter(c: Ctx, sp: TidepoolSpecies, cx: number, cy: number, unit: number, open = 1): void {
  c.save();
  c.translate(snap(cx), snap(cy));
  if (sp.category === 'anemone' && open < 1) anemoneAt(c, unit * sp.size, sp.color, sp.accent, open);
  else SPRITES[sp.category](c, unit * sp.size, sp.color, sp.accent, sp);
  c.restore();
}

/** The critter on its own little canvas, in its colours and in ink, for the
 *  hop into the journal. */
function hopSprite(sp: TidepoolSpecies, dpr: number, ink: string): HopSprite {
  const size = 96;
  const make = () => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(size * dpr);
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    drawCritter(c, sp, size / 2, size / 2, PIX);
    return { cv, c };
  };
  const color = make().cv;
  const inked = make();
  inked.c.setTransform(1, 0, 0, 1, 0, 0);
  inked.c.globalCompositeOperation = 'source-in';
  inked.c.fillStyle = ink;
  inked.c.fillRect(0, 0, inked.cv.width, inked.cv.height);
  return { color, ink: inked.cv, size };
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
  /** 0 for the lightest stone, 1 for the heaviest. */
  heavy: number;
  pose: Pose;
  anim: { kind: 'raise' | 'lower'; start: number; from: number; dir: 1 | -1; landed?: boolean } | null;
  react: { start: number; kind: Reaction; dir: 1 | -1; reach: number } | null;
  /** Crumbs and drips to let go of during a lift: when (s) and where. */
  drips: Array<{ at: number; lx: number; drip: boolean }>;
  bits: Bit[];
}

/** A grain of sand or a drop of seawater on the beach, falling or landed. */
interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The sand it lands on, px from the top. */
  ground: number;
  size: number;
  color: string;
  kind: 'crumb' | 'drip' | 'puff';
  born: number;
  landed: number | null;
}

/** A beach: its stones and its baked sand. */
interface Scene {
  salt: number;
  stones: Stone[];
  bg: HTMLCanvasElement | null;
}

const GRAVITY = 1400;
const SAND = ['#cdb98f', '#a8916a', '#8f7a56'];
const PUFF = ['#dccba6', '#cdb98f', '#bba57c'];
const SEA = ['#8cc4cf', '#bfe0e6', '#5f9fae'];

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
  const markEl = root.querySelector<HTMLElement>('[data-tp-mark]');
  const closeBtn = root.querySelector<HTMLButtonElement>('[data-tp-close]');
  const countEl = root.querySelector<HTMLElement>('[data-tp-count]');
  const lastEl = root.querySelector<HTMLElement>('[data-tp-last]');
  const barEl = root.querySelector<HTMLElement>('[data-tp-bar]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-tp-reset]');
  const photoEl = root.querySelector<HTMLImageElement>('[data-tp-photo]');
  const creditEl = root.querySelector<HTMLElement>('[data-tp-credit]');
  const frame = root.querySelector<HTMLElement>('[data-tp-frame]');
  const live = root.querySelector<HTMLElement>('[data-tp-live]');

  if (!canvas || !card || !revealCanvas || !nameEl || !sciEl || !factEl || !badgeEl || !closeBtn || !countEl || !barEl) {
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
  // The stone the arrow keys are on; ringed while the beach has keyboard focus.
  let picked: Stone | null = null;
  let sceneSalt = 0; // bumped by "New beach" so the layout reshuffles (but stays stable across resizes)
  const hand = { x: -100, y: -100, show: false };
  // Waves in flight, each carrying the beach it brings until it's in.
  const tides: Array<Tide & { scene: Scene | null }> = [];
  // A stone on its way up, and when its card opens.
  let pending: { stone: Stone; at: number } | null = null;
  // The find on the open card. The journal's count stays behind the real
  // one while a first find is hopping in.
  let cardFind: { stone: Stone; species: TidepoolSpecies; isNew: boolean } | null = null;
  const journal = journalHop({
    count: countEl,
    bar: barEl,
    total,
    found: () => discovered.size,
    grid: () => canvas,
    pix: PIX,
  });
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
    stones = buildStones(sceneSalt);
    picked = null;
    bg = bakeBackground(sceneSalt);
  }

  function buildStones(salt: number): Stone[] {
    const r = rng(Math.round(W) * 13 + 7 + salt * 101);
    const out: Stone[] = [];
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
      out.push({
        kind, x, y, w, h, lift: 0, open: false, species: null, base: '', detail: [],
        heavy: heaviness(w, h) * (kind === 'log' ? 0.7 : 1),
        pose: REST, anim: null, react: null, drips: [], bits: [],
      });
    }
    out.sort((a, b) => a.y - b.y);
    for (const s of out) decorateStone(s, r);
    return out;
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
    // A resize mid-wave lands on the beach the last press asked for.
    tides.length = 0;
    pending = null;
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

  function bakeBackground(salt: number): HTMLCanvasElement | null {
    const c = document.createElement('canvas');
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const b = c.getContext('2d');
    if (!b) return null;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.imageSmoothingEnabled = false;
    const r = rng(Math.round(W) * 31 + 17 + salt * 101);
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

    return c;
  }

  function drawBeach(now: number): void {
    const ts = tides.map((tide) => (now - tide.start) / 1000);
    if (bg) ctx!.drawImage(bg, 0, 0, W, H);
    // Each wave's new beach shows wherever its water has reached, cut on the
    // beach's pixel grid so the edge sits under the foam.
    tides.forEach((tide, i) => {
      if (!tide.scene?.bg || !tideWashing(tide, ts[i])) return;
      ctx!.save();
      ctx!.beginPath();
      for (let x = 0; x < W; x += PIX) {
        const rows = Math.ceil((tideReach(tide, ts[i], x + PIX / 2) - PIX / 2) / PIX);
        if (rows > 0) ctx!.rect(x, 0, PIX, rows * PIX);
      }
      ctx!.clip();
      ctx!.drawImage(tide.scene.bg, 0, 0, W, H);
      ctx!.restore();
    });
    const wet = tides.length ? paintTide(ts) : null;
    if (wet) ctx!.drawImage(wet.under, 0, 0, wet.cols * PIX, wet.rows * PIX);

    // The beach as it was gives way under each wave; each new one firms up
    // under the foam that brought it.
    const washing = tides.map((tide, i) => (tide.scene && tideWashing(tide, ts[i]) ? i : -1)).filter((i) => i >= 0);
    const over = (s: Stone, from: number) => {
      let most = 0;
      for (const i of washing) {
        if (i < from) continue;
        most = Math.max(most, tideOver(tides[i], ts[i], s.x, s.y - s.h / 2, s.y + s.h / 2));
      }
      return most;
    };
    for (const s of stones) drawStone(s, now, 1 - over(s, 0));
    for (const i of washing) {
      for (const s of tides[i].scene!.stones) {
        const own = tideOver(tides[i], ts[i], s.x, s.y - s.h / 2, s.y + s.h / 2);
        if (own > 0) drawStone(s, now, own * (1 - over(s, i + 1)));
      }
    }
    if (wet) ctx!.drawImage(wet.over, 0, 0, wet.cols * PIX, wet.rows * PIX);
    if (picked && frame?.matches(':focus-visible')) drawPickRing(picked);
    if (hand.show && !reduceMotion) drawHand(hand.x, hand.y);
  }

  // The water and the wet sand, one cell per beach pixel, into two small
  // images drawn up to size: the wet sand under the stones, the water and
  // foam over them.
  let tideLayer: { cols: number; rows: number; under: HTMLCanvasElement; over: HTMLCanvasElement; ui: ImageData; oi: ImageData } | null = null;
  const cell = { water: 0, churn: 0, foam: 0, wet: 0 };
  function paintTide(ts: number[]): { cols: number; rows: number; under: HTMLCanvasElement; over: HTMLCanvasElement } | null {
    const cols = Math.ceil(W / PIX);
    const rows = Math.ceil(H / PIX);
    if (!tideLayer || tideLayer.cols !== cols || tideLayer.rows !== rows) {
      const mk = () => {
        const c = document.createElement('canvas');
        c.width = cols;
        c.height = rows;
        return c;
      };
      const under = mk();
      const over = mk();
      tideLayer = {
        cols, rows, under, over,
        ui: under.getContext('2d')!.createImageData(cols, rows),
        oi: over.getContext('2d')!.createImageData(cols, rows),
      };
    }
    const { ui, oi } = tideLayer;
    const ud = ui.data;
    const od = oi.data;
    ud.fill(0);
    od.fill(0);
    const live = tides.map((tide, i) => (tideDone(tide, ts[i]) ? -1 : i)).filter((i) => i >= 0);
    const fronts = new Float64Array(live.length);
    const reaches = new Float64Array(live.length);
    let top = H;
    for (const i of live) top = Math.min(top, tides[i].top);
    const r0 = Math.max(0, Math.floor(top / PIX));
    // The water is the offshore blue over the pale shorebreak, and a deeper
    // blue over the sand, so that at about half strength it still comes out
    // near the offshore #7bb8c4 there instead of going grey-green.
    const shore = H * 0.3;
    const sandTop = H * 0.4;
    for (let c = 0; c < cols; c++) {
      const x = c * PIX + PIX / 2;
      let deepest = 0;
      live.forEach((i, k) => {
        fronts[k] = tideFront(tides[i], ts[i], x);
        reaches[k] = tideReach(tides[i], ts[i], x);
        deepest = Math.max(deepest, reaches[k], fronts[k]);
      });
      const r1 = Math.min(rows, Math.ceil(deepest / PIX) + 1);
      for (let r = r0; r < r1; r++) {
        const y = r * PIX + PIX / 2;
        let water = 0;
        let churn = 0;
        let foam = 0;
        let wetness = 0;
        for (let k = 0; k < live.length; k++) {
          const i = live[k];
          tideCell(tides[i], ts[i], y, fronts[k], reaches[k], c, PIX, cell);
          if (cell.water > water) {
            water = cell.water;
            churn = cell.churn;
          }
          if (cell.foam > foam) foam = cell.foam;
          if (cell.wet > wetness) wetness = cell.wet;
        }
        const o = (r * cols + c) * 4;
        if (foam > 0) {
          od[o] = 246;
          od[o + 1] = 250;
          od[o + 2] = 246;
          od[o + 3] = foam * 255;
        } else if (water > 0) {
          const m = clamp((y - shore) / (sandTop - shore), 0, 1);
          const br = 123 - 51 * m;
          const bg = 184 + 26 * m;
          const bb = 196 + 59 * m;
          // Paler and sandier toward the foam.
          od[o] = br + (194 - br) * churn;
          od[o + 1] = bg + (224 - bg) * churn;
          od[o + 2] = bb + (218 - bb) * churn;
          od[o + 3] = water * 255;
        } else if (wetness > 0) {
          ud[o] = 62;
          ud[o + 1] = 44;
          ud[o + 2] = 24;
          ud[o + 3] = 0.32 * wetness * 255;
        }
      }
    }
    tideLayer.under.getContext('2d')!.putImageData(ui, 0, 0);
    tideLayer.over.getContext('2d')!.putImageData(oi, 0, 0);
    return tideLayer;
  }

  // Dark and light rings, so the pick shows on sand, rock and pool alike.
  function drawPickRing(s: Stone): void {
    const pad = 6;
    const left = snap(s.x - s.w / 2 - pad);
    const top = snap(s.y - s.h / 2 - s.lift * (s.h + 14) - pad);
    const w = snap(s.w + pad * 2);
    const h = snap(s.y + s.h / 2 + pad) - top;
    ctx!.lineWidth = 2;
    ctx!.strokeStyle = '#16150f';
    ctx!.strokeRect(left + 1, top + 1, w - 2, h - 2);
    ctx!.strokeStyle = '#fbfaf8';
    ctx!.strokeRect(left + 3, top + 3, w - 6, h - 6);
  }

  function drawStone(s: Stone, now: number, alpha = 1): void {
    if (alpha <= 0) return;
    ctx!.globalAlpha = alpha;
    const base = s.base || (s.kind === 'rock' ? '#7a7066' : '#5a4023');
    const pose = s.pose;
    const lift = pose.lift;

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
        const r = s.react
          ? critterReact(s.react.kind, (now - s.react.start) / 1000, s.react.dir, s.react.reach)
          : null;
        drawCritter(ctx!, s.species, s.x + wob + (r?.dx ?? 0), s.y + (r?.dy ?? 0), PIX, r?.open ?? 1);
      }
    }

    // the stone itself, lifted up + tilted as it flips; it shudders as you
    // take its weight and squashes for a frame when it lands
    ctx!.save();
    ctx!.translate(snap(s.x) + pose.dx, snap(s.y - lift * (s.h + 14)));
    if (pose.squash) {
      ctx!.translate(0, s.h / 2);
      ctx!.scale(1 + 0.08 * pose.squash, 1 - 0.14 * pose.squash);
      ctx!.translate(0, -s.h / 2);
    }
    ctx!.rotate(pose.tilt);
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
    drawBits(s, now);
    ctx!.globalAlpha = 1;
  }

  // Sand and seawater falling off a stone, kicked out as it lands, or
  // flicked up as a find hops away. Landed sand sits a moment and goes; a
  // landed drop leaves a dark wet dot that soaks in.
  function drawBits(s: Stone, now: number): void {
    const a = ctx!.globalAlpha;
    for (const b of s.bits) {
      let k = 1;
      let color = b.color;
      if (b.landed !== null) {
        const age = (now - b.landed) / 1000;
        if (b.kind === 'drip') {
          color = 'rgba(52,38,22,0.4)';
          k = 1 - clamp(age / 0.5, 0, 1);
        } else {
          k = 1 - clamp((age - (b.kind === 'puff' ? 0.08 : 0.25)) / 0.25, 0, 1);
        }
      }
      if (k <= 0) continue;
      ctx!.globalAlpha = a * k;
      ctx!.fillStyle = color;
      ctx!.fillRect(snap(b.x), snap(b.y), b.size, b.size);
    }
    ctx!.globalAlpha = a;
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
  function update(now: number, dt: number): void {
    // A wave that has washed all the way in leaves its beach behind, and any
    // older wave still coming in is under it.
    tides.forEach((tide, i) => {
      if (!tide.scene || tideWashing(tide, (now - tide.start) / 1000)) return;
      stones = tide.scene.stones;
      bg = tide.scene.bg;
      picked = null;
      for (let j = 0; j <= i; j++) tides[j].scene = null;
    });
    for (let i = tides.length - 1; i >= 0; i--) {
      if (!tides[i].scene && tideDone(tides[i], (now - tides[i].start) / 1000)) tides.splice(i, 1);
    }

    const all = [...stones];
    for (const tide of tides) if (tide.scene) all.push(...tide.scene.stones);
    for (const s of all) {
      if (reduceMotion) {
        // As today: up or down in a few frames.
        const target = s.open ? 1 : 0;
        if (s.lift < target) s.lift = Math.min(target, s.lift + dt * 4);
        else if (s.lift > target) s.lift = Math.max(target, s.lift - dt * 4);
        s.pose = { lift: s.lift, tilt: TILT * s.lift, dx: 0, squash: 0 };
        continue;
      }
      const a = s.anim;
      if (a) {
        const t = Math.max(0, (now - a.start) / 1000);
        if (a.kind === 'raise') {
          s.pose = raisePose(t, s.heavy, a.from);
          while (s.drips.length && s.drips[0].at <= t) shed(s, s.drips.shift()!, now);
          if (!s.react && s.pose.lift > 0.1 && s.species) {
            s.react = {
              start: now,
              kind: reactionFor(s.species.category),
              dir: a.dir,
              reach: reactionReach(s.species.category),
            };
          }
          if (t >= raiseEnd(s.heavy, a.from)) {
            s.anim = null;
            s.pose = UP;
          }
        } else {
          s.pose = lowerPose(t, a.from);
          if (!a.landed && t >= lowerEnd(a.from) - 0.035) {
            a.landed = true;
            if (a.from > 0.2) puff(s, now);
          }
          if (t >= lowerEnd(a.from)) {
            s.anim = null;
            s.pose = REST;
            s.react = null;
          }
        }
        s.lift = s.pose.lift;
      }
      for (let i = s.bits.length - 1; i >= 0; i--) {
        const b = s.bits[i];
        if (b.landed === null) {
          b.vy += GRAVITY * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (b.vy > 0 && b.y >= b.ground) {
            b.y = b.ground;
            b.landed = now;
          }
        } else if (now - b.landed > 700) s.bits.splice(i, 1);
      }
    }

    // The card waits for the rock to be all the way up.
    if (pending && now >= pending.at) {
      const s = pending.stone;
      pending = null;
      reveal(s);
    }
  }

  /** When each crumb and drip lets go of a stone coming up, and where along
   *  its underside. Most go as it nears the top. */
  function planDrips(s: Stone, from: number): Stone['drips'] {
    if (from > 0.3) return [];
    const { strain, rise } = raiseTiming(s.heavy, from);
    const n = Math.round((s.kind === 'log' ? 5 : 6) + s.heavy * 4 + Math.random() * 3);
    const out: Stone['drips'] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        at: strain + rise * (0.35 + Math.random() * 0.75),
        lx: (Math.random() - 0.5) * s.w * 0.7,
        drip: Math.random() < (s.kind === 'log' ? 0.3 : 0.45),
      });
    }
    return out.sort((x, y) => x.at - y.at);
  }

  function pickOf<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
  }

  /** One crumb or drop leaving the stone's underside as it is now. */
  function shed(s: Stone, d: Stone['drips'][number], now: number): void {
    const p = s.pose;
    const ly = s.h / 2 - PIX;
    const cx = snap(s.x) + p.dx;
    const cy = snap(s.y - p.lift * (s.h + 14));
    const cos = Math.cos(p.tilt);
    const sin = Math.sin(p.tilt);
    const x = cx + d.lx * cos - ly * sin;
    const y = cy + d.lx * sin + ly * cos;
    s.bits.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 40,
      vy: -30 + Math.random() * 50,
      ground: Math.max(y + PIX * 2, s.y + s.h * (-0.1 + Math.random() * 0.5)),
      size: Math.random() < 0.6 ? PIX : PIX / 2,
      color: d.drip ? pickOf(SEA) : pickOf(SAND),
      kind: d.drip ? 'drip' : 'crumb',
      born: now,
      landed: null,
    });
  }

  /** Sand kicked out from under both ends as a stone lands. */
  function puff(s: Stone, now: number): void {
    const n = 6 + Math.round(s.w / 14);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const y = s.y + s.h / 2 - PIX;
      s.bits.push({
        x: s.x + side * (s.w / 2 - Math.random() * s.w * 0.25),
        y,
        vx: side * (50 + Math.random() * 120),
        vy: -(80 + Math.random() * 160),
        ground: y + Math.random() * 6,
        size: Math.random() < 0.5 ? PIX : PIX / 2,
        color: PUFF[i % PUFF.length],
        kind: 'puff',
        born: now,
        landed: null,
      });
    }
  }

  /** A little sand flicked up where a find hops off from. */
  function kick(s: Stone, x: number, y: number, now: number): void {
    for (let i = 0; i < 4; i++) {
      s.bits.push({
        x: x + (Math.random() - 0.5) * 12,
        y: y + PIX,
        vx: (Math.random() - 0.5) * 140,
        vy: -(60 + Math.random() * 110),
        ground: y + PIX + Math.random() * 6,
        size: PIX / 2,
        color: pickOf(PUFF),
        kind: 'puff',
        born: now,
        landed: null,
      });
    }
  }

  function render(now: number): void {
    drawBeach(now);
  }
  function step(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(now, reduceMotion ? 0.05 : dt);
    render(now);
    raf = requestAnimationFrame(step);
  }
  function start(): void {
    // Not under a scene that's still playing; it starts once that's gone.
    if (running || covered()) return;
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
  //
  // One stone comes up at a time. While it's on its way up (a third of a
  // second) the beach ignores taps, and then its card covers the beach.
  // Lowering isn't held up: each tap drops its own stone.
  function flip(s: Stone): void {
    if (washingNow() || pending) return;
    const now = performance.now();
    if (s.open) {
      s.open = false;
      if (!reduceMotion) {
        s.anim = { kind: 'lower', start: now, from: s.lift, dir: 1 };
        s.drips = [];
      }
      closeCard();
      return;
    }
    s.open = true;
    if (!s.species) s.species = pickSpecies();
    if (reduceMotion) {
      reveal(s);
      return;
    }
    const from = s.lift;
    s.anim = { kind: 'raise', start: now, from, dir: Math.random() < 0.5 ? 1 : -1 };
    s.react = null;
    s.drips = planDrips(s, from);
    pending = { stone: s, at: now + upAt(s.heavy, from) * 1000 };
  }

  /** The stone is up: log the find and open its card. */
  function reveal(s: Stone): void {
    const sp = s.species!;
    const isNew = !discovered.has(sp.id);
    if (isNew) {
      discovered.add(sp.id);
      saveDiscovered(discovered);
      // The count waits for the find to hop into it when the card closes.
      if (reduceMotion) updateJournal();
    }
    // As today, under the card: on a phone the line takes a row of its own
    // the first time, and that shouldn't jolt the beach as a find lands.
    showLastFind(sp);
    showCard(sp, isNew);
    cardFind = { stone: s, species: sp, isNew };
  }

  function washingNow(): boolean {
    const now = performance.now();
    return tides.some((tide) => !!tide.scene && tideWashing(tide, (now - tide.start) / 1000));
  }

  /** A first find hops from under its rock into the journal's count, and
   *  the count rolls and the rule fills as it lands. */
  function hopHome(f: { stone: Stone; species: TidepoolSpecies }): void {
    const box = canvas!.getBoundingClientRect();
    const s = f.stone;
    const now = performance.now();
    const wob = Math.sin(now / 360 + s.x) * PIX;
    const from = { x: box.left + snap(s.x + wob), y: box.top + snap(s.y) };
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#16150f';
    const flies = journal.hop({ sprite: hopSprite(f.species, dpr, ink), from, end: 0.34 });
    if (flies && stones.includes(s)) kick(s, from.x - box.left, from.y - box.top, now);
  }

  function paintRevealSprite(sp: TidepoolSpecies): void {
    if (photoEl) photoEl.classList.add('is-hidden');
    revealCanvas!.classList.remove('is-hidden');
    // The card's frame is 4:3, so the sprite sits in the middle of a 160 by
    // 120 scene.
    const w = 160;
    const size = 120;
    revealCanvas!.width = w * dpr;
    revealCanvas!.height = size * dpr;
    rctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    rctx!.imageSmoothingEnabled = false;
    rctx!.clearRect(0, 0, w, size);
    rctx!.fillStyle = '#0b3346';
    rctx!.fillRect(0, 0, w, size);
    rctx!.fillStyle = 'rgba(120,160,170,0.35)';
    rctx!.fillRect(0, size * 0.7, w, size * 0.3);
    drawCritter(rctx!, sp, w / 2, size / 2 + 6, PIX * 1.6);
  }

  function showCard(sp: TidepoolSpecies, isNew: boolean): void {
    const override = PHOTOS[sp.id];
    const photo = sp.photo ?? override?.photo;
    const credit = sp.photoCredit ?? override?.credit ?? '';
    stopPixelReveal(revealCanvas!);
    if (photo && photoEl) {
      // real photo when we have one; fall back to the sprite if it fails to load.
      // The square stays empty until the photo has loaded, then the photo
      // resolves out of pixels, like the beach it came from.
      photoEl.classList.add('is-hidden');
      revealCanvas!.classList.add('is-hidden');
      photoEl.onerror = () => {
        upgradePhoto(photoEl, '');
        paintRevealSprite(sp);
        if (creditEl) creditEl.classList.add('is-hidden');
      };
      photoEl.onload = () => revealFromPixels(revealCanvas!, photoEl);
      photoEl.alt = sp.common;
      if (photoEl.getAttribute('src') === photo && photoEl.complete && photoEl.naturalWidth) {
        revealFromPixels(revealCanvas!, photoEl);
      } else {
        photoEl.src = photo;
      }
      upgradePhoto(photoEl, photo);
      if (creditEl) {
        creditEl.textContent = credit;
        creditEl.classList.toggle('is-hidden', !credit);
      }
    } else {
      // A photo still loading for an earlier critter mustn't land on this one.
      if (photoEl) {
        photoEl.onload = null;
        upgradePhoto(photoEl, '');
      }
      paintRevealSprite(sp);
      if (creditEl) creditEl.classList.add('is-hidden');
    }

    nameEl!.textContent = sp.common;
    sciEl!.textContent = sp.scientific;
    factEl!.textContent = sp.facts[Math.floor(Math.random() * sp.facts.length)];
    badgeEl!.textContent = isNew ? 'New to your journal' : 'Found again';
    if (markEl) stampFind(markEl, badgeEl!, isNew);
    openCard();
  }

  // The card is a modal: focus moves to its button, Escape or the scrim
  // closes it, and focus goes back where it was.
  let returnFocus: HTMLElement | null = null;
  function openCard(): void {
    if (!card!.classList.contains('is-open')) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    card!.classList.add('is-open');
    closeBtn!.focus({ preventScroll: true });
  }
  function closeCard(): void {
    if (!card!.classList.contains('is-open')) return;
    card!.classList.remove('is-open');
    returnFocus?.focus({ preventScroll: true });
    returnFocus = null;
    const f = cardFind;
    cardFind = null;
    if (f?.isNew && !reduceMotion) hopHome(f);
  }

  function showLastFind(sp: TidepoolSpecies): void {
    if (lastEl) lastEl.textContent = `Last find: ${sp.common}`;
  }

  function updateJournal(): void {
    journal.show(discovered.size);
  }

  function hitTest(px: number, py: number): Stone | null {
    for (let i = stones.length - 1; i >= 0; i--) {
      const s = stones[i];
      if (px >= s.x - s.w / 2 && px <= s.x + s.w / 2 && py >= s.y - s.h && py <= s.y + s.h / 2) return s;
    }
    return null;
  }

  // -------------------------------------------------------------- wiring
  // Flip on click, not pointerdown. The card opens over the beach, so a tap's
  // click would land on its scrim and close it again, and the mousedown that
  // follows a pointerdown would pull focus off the card's button.
  canvas.addEventListener('click', (e: MouseEvent) => {
    const rect2 = canvas.getBoundingClientRect();
    const s = hitTest(e.clientX - rect2.left, e.clientY - rect2.top);
    if (s) {
      picked = s;
      flip(s);
    }
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

  // Keyboard play: the arrow keys walk the stones from left to right, and
  // Enter or Space flips the one they're on, the same as a tap.
  function byX(): Stone[] {
    return [...stones].sort((a, b) => a.x - b.x);
  }
  function pick(s: Stone): void {
    picked = s;
    const row = byX();
    const name = s.kind === 'rock' ? 'Rock' : 'Driftwood log';
    if (live) live.textContent = `${name} ${row.indexOf(s) + 1} of ${row.length}${s.open ? ', flipped over' : ''}`;
  }
  if (frame) {
    frame.addEventListener('focus', () => {
      if (!picked && stones.length && frame.matches(':focus-visible')) pick(byX()[0]);
    });
    frame.addEventListener('keydown', (e: KeyboardEvent) => {
      if (washingNow()) {
        if (/^(Arrow|Home|End|Enter| )/.test(e.key)) e.preventDefault();
        return;
      }
      const row = byX();
      if (!row.length) return;
      const at = picked ? row.indexOf(picked) : -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') pick(row[Math.min(row.length - 1, at + 1)]);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pick(row[Math.max(0, at - 1)]);
      else if (e.key === 'Home') pick(row[0]);
      else if (e.key === 'End') pick(row[row.length - 1]);
      else if (e.key === 'Enter' || e.key === ' ') flip((picked ??= row[0]));
      else return;
      e.preventDefault();
    });
  }

  closeBtn.addEventListener('click', closeCard);
  card.addEventListener('click', (e) => {
    if (e.target === card) closeCard();
  });
  card.addEventListener('keydown', (e) => {
    // One control in the card, so Tab stays on it.
    if (e.key === 'Tab') {
      e.preventDefault();
      closeBtn.focus();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCard();
  });
  // The tide brings the new beach. Every press sends its own wave, and the
  // beach changes under each one, so five presses end on the beach five
  // presses always gave.
  resetBtn?.addEventListener('click', () => {
    // A rock still coming up goes out with the old beach, card and all.
    pending = null;
    sceneSalt++;
    if (reduceMotion) {
      for (const s of stones) {
        s.species = null;
        s.open = false;
      }
      buildScene();
      return;
    }
    picked = null;
    tides.push({
      ...makeTide(W, H, performance.now()),
      scene: { salt: sceneSalt, stones: buildStones(sceneSalt), bg: bakeBackground(sceneSalt) },
    });
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
  whenUncovered(() => {
    if (onscreen && !document.hidden) start();
  });

  // --------------------------------------------------------------- init
  fit();
  updateJournal();
  // The journal saves in the order things were found, so its last entry is
  // the most recent new find.
  const lastId = [...discovered].pop();
  const lastSpecies = SPECIES.find((s) => s.id === lastId);
  if (lastSpecies) showLastFind(lastSpecies);
  render(performance.now());
  start();
}
