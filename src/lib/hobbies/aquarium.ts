/**
 * Planted-aquarium stocking sandbox — the interactive for the
 * "Aquarium Keeping" hobby page.
 *
 * Self-contained: no dependencies, no network, no image assets. The whole
 * scene is drawn as procedural **pixel art** on a <canvas> — everything snaps
 * to a fixed PIX grid and image smoothing is off, so it reads as chunky 8-bit.
 *
 * Rendering layers (back to front):
 *   1. Baked background (offscreen canvas, redrawn only on resize): water
 *      gradient, silhouette plants, hardscape (rocks + driftwood), gravel
 *      substrate, carpet plants.
 *   2. Animated: caustic light, swaying foreground plants, fish (by depth
 *      zone), rising bubbles.
 *
 * The bioload meter is a *playful approximation* of real stocking math (waste
 * scales with adult size; planted tanks buy a little headroom) — NOT advice.
 *
 * Mounted by src/components/hobbies/AquariumTank.astro, which renders the
 * species picker from SPECIES at build time; this engine binds to its
 * [data-aquarium-add] buttons. The loop pauses when offscreen or the tab is
 * hidden, and honors prefers-reduced-motion.
 *
 * Tuning lives in three places: SPECIES in ./aquarium-species (roster +
 * balance), the constants below (PIX / capacity / starter), and the draw*
 * functions (look).
 */

import { rollTo, setHair } from '../motion';
import { SPECIES, type Shape, type Species, type Zone } from './aquarium-species';
import { createJumps, type Sprite } from './aquarium-jump';
import { stockingStatus } from './stocking';

export { SPECIES, type Shape, type Species, type Zone };

/** CSS pixels per drawn "pixel" block — the chunkiness of the 8-bit look. */
const PIX = 4;
/** Hard cap so the loop stays smooth on phones. */
const MAX_FISH = 55;
/** A pleasant non-empty starting community. */
const STARTER: ReadonlyArray<readonly [string, number]> = [
  ['neon-tetra', 7],
  ['harlequin-rasbora', 5],
  ['pygmy-cory', 5],
  ['cherry-shrimp', 5],
  ['honey-gourami', 1],
];

interface Fish {
  species: Species;
  x: number;
  y: number;
  baseY: number;
  dir: 1 | -1;
  speed: number;
  size: number;
  phase: number;
  wobble: number;
  /** Set while it's still sinking to its depth after jumping in. */
  dive?: Dive;
}

interface Dive {
  /** Seconds in, and how long the sink takes. */
  t: number;
  dur: number;
  /** Nose angle it went in at; it levels out as it slows. */
  tilt: number;
}

/**
 * A pixel net coming down for one fish: in from above the surface, a quick
 * scoop round the fish, then up and out with it. The fish has already left
 * the stock list; it's only drawn here until the net has it out of sight.
 */
interface Net {
  fish: Fish;
  t: number;
  /** Where the fish was when the net was sent. */
  x: number;
  y: number;
  /** Handle leans the way the net comes in from. */
  side: 1 | -1;
}

/** Seconds: the net coming down, the scoop, and the lift out. */
const NET_IN = 0.38;
const NET_SCOOP = 0.16;
const NET_OUT = 0.42;

/**
 * Where a net is `t` seconds after it's sent, and whether it has the fish.
 * `x`/`y` is the middle of the net's rim; it comes down from `top` (above the
 * tank) to `y`, scoops a little sideways, then lifts back past `top`.
 */
export function netPath(
  t: number,
  fishX: number,
  fishY: number,
  top: number,
  side: 1 | -1,
): { x: number; y: number; holding: boolean; done: boolean } {
  const ease = (k: number) => k * k * (3 - 2 * k);
  if (t < NET_IN) {
    const k = ease(t / NET_IN);
    return { x: fishX - side * 10 * (1 - k), y: top + (fishY - top) * k, holding: false, done: false };
  }
  if (t < NET_IN + NET_SCOOP) {
    const k = ease((t - NET_IN) / NET_SCOOP);
    return { x: fishX + side * 8 * k, y: fishY + 4 * Math.sin(k * Math.PI), holding: k > 0.5, done: false };
  }
  const k = Math.min(1, (t - NET_IN - NET_SCOOP) / NET_OUT);
  // Lifting out speeds up, the way you'd pull a net.
  const lift = k * k;
  return {
    x: fishX + side * 8 + side * 14 * lift,
    y: fishY + (top - 20 - fishY) * lift,
    holding: true,
    done: k >= 1,
  };
}

/**
 * The tank tipping over to empty it. It leans one way, holds while everything
 * pours out, and rocks back level. `lean` is the angle in radians.
 */
export const TIP_MS = 1500;
export function tipLean(ms: number, side: 1 | -1): number {
  const ease = (k: number) => k * k * (3 - 2 * k);
  const max = (side * 16 * Math.PI) / 180;
  if (ms <= 0 || ms >= TIP_MS) return 0;
  if (ms < 320) return max * ease(ms / 320);
  if (ms < 900) return max;
  // Back level with a little overshoot, like setting a heavy tank down.
  const k = (ms - 900) / (TIP_MS - 900);
  return max * (1 - ease(k)) - max * 0.08 * Math.sin(Math.PI * k);
}

/** How a fish came in through the surface (from ./aquarium-jump). */
interface Entry {
  dir: 1 | -1;
  angle: number;
  /** Downward speed as it hit the water, px/s. */
  speed: number;
}

/** A bubble knocked off a fish on its way down; it rises and pops. */
interface Fizz {
  x: number;
  y: number;
  vy: number;
  life: number;
}

/** Rings on the surface where something went in. */
interface Ripple {
  x: number;
  t: number;
}

interface Plant {
  x: number;
  height: number;
  sway: number;
  kind: 'vallis' | 'stem';
  c1: string;
  c2: string;
}

interface Bubble {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
}

interface Floater {
  x: number;
  /** Canopy half-width in pixel blocks. */
  cells: number;
  phase: number;
  /** How far the roots dangle, in CSS px. */
  rootLen: number;
}

// ----------------------------------------------------------- pixel helpers
function snap(v: number): number {
  return Math.round(v / PIX) * PIX;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Mix a color toward white (amt > 0) or black (amt < 0); amt in -1..1. */
function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const mix = (c: number) => Math.round((target - c) * p + c);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// ------------------------------------------------------------ fish sprites
// All sprite drawers assume the context is already translated to the fish
// center and scaled by its facing direction (so +x is "forward").

function tailFan(c: CanvasRenderingContext2D, len: number, ht: number, color: string, round: boolean): void {
  const rx = len / 2;
  const tl = len * 0.42;
  for (let xx = 0; xx <= tl; xx += PIX) {
    const f = xx / tl;
    const hh = round ? ht * 0.5 * (0.45 + 0.55 * f) : ht * 0.5 * f + PIX;
    c.fillStyle = xx > tl * 0.6 ? shade(color, -0.15) : color;
    c.fillRect(snap(-rx - xx), snap(-hh), PIX, Math.max(PIX, snap(2 * hh)));
  }
}

function forkTail(c: CanvasRenderingContext2D, len: number, ht: number, color: string): void {
  const rx = len / 2;
  const tl = len * 0.42;
  for (let xx = 0; xx <= tl; xx += PIX) {
    const f = xx / tl;
    const hh = ht * 0.5 * (0.2 + 0.8 * f);
    c.fillStyle = xx > tl * 0.6 ? shade(color, -0.15) : color;
    c.fillRect(snap(-rx - xx), snap(-hh), PIX, Math.max(PIX, snap(hh)));
    c.fillRect(snap(-rx - xx), snap(hh * 0.1), PIX, Math.max(PIX, snap(hh)));
  }
}

function fishMouth(c: CanvasRenderingContext2D, len: number, ht: number): void {
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.fillRect(snap(len * 0.46), snap(ht * 0.04), PIX, PIX);
}

function fishBody(c: CanvasRenderingContext2D, len: number, ht: number, color: string): void {
  const rx = len / 2;
  const ry = ht / 2;
  const top = shade(color, 0.16);
  const bottom = shade(color, -0.22);
  for (let yy = -ry; yy <= ry; yy += PIX) {
    const t = yy / ry;
    const hw = rx * Math.sqrt(Math.max(0, 1 - t * t));
    if (hw < PIX * 0.5) continue;
    c.fillStyle = yy < -ry * 0.55 ? top : yy > ry * 0.6 ? bottom : color;
    const x0 = snap(-hw);
    c.fillRect(x0, snap(yy), Math.max(PIX, snap(hw) - x0), PIX);
  }
}

function fishEye(c: CanvasRenderingContext2D, len: number, ht: number): void {
  const ex = snap(len * 0.32);
  const ey = snap(-ht * 0.14);
  c.fillStyle = '#0d0d0d';
  c.fillRect(ex, ey, PIX, PIX * 2);
  c.fillStyle = 'rgba(240,240,240,0.55)';
  c.fillRect(ex, ey, PIX, PIX);
}

const SHAPE_RATIO: Record<Shape, number> = {
  fish: 0.46, long: 0.32, tall: 0.66, gourami: 0.6, betta: 0.58, angelfish: 1.15, shrimp: 1, snail: 1,
};

// generic schooling fish (tetras, barbs, danios, livebearers)
function drawSwimmer(c: CanvasRenderingContext2D, len: number, ht: number, color: string, accent: string): void {
  forkTail(c, len, ht, color);
  fishBody(c, len, ht, color);
  const rx = len / 2;
  c.fillStyle = accent;
  c.fillRect(snap(-rx * 0.7), snap(-PIX), Math.max(PIX, snap(rx * 1.4)), PIX * 2); // lateral stripe
  c.fillStyle = shade(color, -0.12);
  c.fillRect(snap(-len * 0.12), snap(-ht * 0.5) - PIX, Math.max(PIX, snap(len * 0.34)), PIX); // dorsal
  c.fillStyle = shade(accent, -0.1);
  c.fillRect(snap(-len * 0.1), snap(ht * 0.42), Math.max(PIX, snap(len * 0.2)), PIX); // anal fin
  c.fillRect(snap(len * 0.04), snap(ht * 0.16), PIX * 2, PIX); // pectoral
  fishEye(c, len, ht);
  fishMouth(c, len, ht);
}

// elongated bottom-dwellers (cory, loach, oto, pleco): downturned snout + barbels
function drawLongFish(c: CanvasRenderingContext2D, len: number, ht: number, color: string, accent: string): void {
  fishBody(c, len, ht, color);
  tailFan(c, len, ht, color, false);
  c.fillStyle = shade(color, -0.15);
  c.fillRect(snap(-len * 0.05), snap(-ht * 0.5 - PIX), Math.max(PIX, snap(len * 0.26)), PIX); // dorsal
  c.fillStyle = shade(color, -0.1);
  c.fillRect(snap(len * 0.4), snap(ht * 0.12), PIX * 2, PIX); // downturned snout
  c.fillStyle = accent;
  c.fillRect(snap(len * 0.44), snap(ht * 0.28), PIX, PIX);
  c.fillRect(snap(len * 0.38), snap(ht * 0.32), PIX, PIX); // barbels
  c.fillStyle = shade(color, -0.18);
  c.fillRect(snap(len * 0.02), snap(ht * 0.42), PIX * 2, PIX); // low pectoral
  fishEye(c, len, ht);
}

// gourami: oval compressed body + the signature trailing pelvic feelers
function drawGourami(c: CanvasRenderingContext2D, len: number, ht: number, color: string, accent: string): void {
  const rx = len / 2, ry = ht / 2;
  c.fillStyle = shade(color, -0.18);
  c.fillRect(snap(-rx * 0.85), snap(ry - PIX), Math.max(PIX, snap(rx * 1.45)), PIX * 2); // long anal fin
  c.fillStyle = shade(color, -0.1);
  c.fillRect(snap(-rx * 0.5), snap(-ry - PIX), Math.max(PIX, snap(rx)), PIX);
  c.fillRect(snap(-rx * 0.95), snap(-ry - PIX * 2), PIX * 3, PIX * 2); // dorsal ridge + rear point
  fishBody(c, len, ht, color);
  tailFan(c, len, ht, color, true);
  c.fillStyle = accent; // pelvic feelers
  const fx = snap(rx * 0.18);
  const segs = Math.round((ht * 1.15) / PIX);
  for (let i = 0; i < segs; i++) {
    const yy = ry * 0.45 + i * PIX;
    const off = Math.round(Math.sin(i * 0.45) * PIX * 1.2);
    c.fillRect(fx + off + PIX * 2, snap(yy), PIX, PIX);
    c.fillRect(fx + off - PIX, snap(yy + PIX), PIX, PIX);
  }
  fishEye(c, len, ht);
  fishMouth(c, len, ht);
}

// betta: small body with big flowing fins
function drawBetta(c: CanvasRenderingContext2D, len: number, ht: number, color: string, accent: string): void {
  const rx = len / 2;
  for (let xx = 0; xx <= len * 0.55; xx += PIX) {
    const f = xx / (len * 0.55);
    const hh = ht * 0.85 * (0.3 + 0.7 * f);
    c.fillStyle = xx > len * 0.28 ? shade(accent, -0.14) : accent;
    c.fillRect(snap(-rx - xx), snap(-hh), PIX, Math.max(PIX, snap(2 * hh)));
  } // big flowing caudal
  c.fillStyle = accent;
  c.fillRect(snap(-rx * 0.7), snap(-ht * 0.5 - PIX * 3), Math.max(PIX, snap(rx * 1.15)), PIX * 3); // dorsal flow
  c.fillStyle = shade(accent, -0.08);
  c.fillRect(snap(-rx * 0.7), snap(ht * 0.38), Math.max(PIX, snap(rx * 1.25)), PIX * 3); // anal flow
  fishBody(c, len, ht * 0.82, color);
  c.fillStyle = shade(color, 0.15);
  c.fillRect(snap(-rx * 0.6), snap(-PIX), Math.max(PIX, snap(rx)), PIX); // sheen
  fishEye(c, len, ht * 0.82);
  fishMouth(c, len, ht * 0.82);
}

// angelfish: tall diamond body with long swept-back dorsal/anal fins + ventral filaments + bars
function drawAngelfish(c: CanvasRenderingContext2D, len: number, ht: number, color: string, accent: string): void {
  const rx = len / 2, ry = ht / 2;
  c.fillStyle = shade(color, -0.08);
  const dn = Math.round((ry * 1.4) / PIX);
  for (let i = 0; i <= dn; i++) { const f = i / dn; const y = -ry * 0.35 - i * PIX; const x0 = -rx * 0.6 * f - rx * 0.12; const x1 = rx * 0.4 * (1 - f); if (x1 <= x0) continue; c.fillRect(snap(x0), snap(y), Math.max(PIX, snap(x1 - x0)), PIX); }
  for (let i = 0; i <= dn; i++) { const f = i / dn; const y = ry * 0.35 + i * PIX; const x0 = -rx * 0.6 * f - rx * 0.12; const x1 = rx * 0.35 * (1 - f); if (x1 <= x0) continue; c.fillRect(snap(x0), snap(y), Math.max(PIX, snap(x1 - x0)), PIX); }
  for (let yy = -ry; yy <= ry; yy += PIX) { const t = yy / ry; const hw = rx * Math.pow(Math.max(0, 1 - t * t), 0.62); if (hw < PIX * 0.5) continue; c.fillStyle = yy < -ry * 0.5 ? shade(color, 0.16) : yy > ry * 0.55 ? shade(color, -0.22) : color; c.fillRect(snap(-hw), snap(yy), Math.max(PIX, snap(2 * hw)), PIX); }
  c.fillStyle = accent;
  for (const bx of [rx * 0.34, -rx * 0.02, -rx * 0.42]) c.fillRect(snap(bx), snap(-ry * 0.8), PIX, Math.max(PIX, snap(ry * 1.6)));
  c.fillStyle = shade(color, -0.1);
  for (let i = 0; i < Math.round((ry * 1.3) / PIX); i++) { const yy = ry * 0.55 + i * PIX; const off = Math.round(Math.sin(i * 0.3) * PIX); c.fillRect(snap(rx * 0.16 + off), snap(yy), PIX, PIX); }
  const tl = len * 0.28;
  for (let xx = 0; xx <= tl; xx += PIX) { const f = xx / tl; const hh = ry * 0.45 * (0.2 + 0.8 * f); c.fillStyle = color; c.fillRect(snap(-rx - xx), snap(-hh), PIX, Math.max(PIX, snap(hh))); c.fillRect(snap(-rx - xx), snap(hh * 0.1), PIX, Math.max(PIX, snap(hh))); }
  fishEye(c, len, ht * 0.62);
}

// oval cichlid (rams): continuous dorsal + vertical bar
function drawCichlid(c: CanvasRenderingContext2D, len: number, ht: number, color: string, accent: string): void {
  c.fillStyle = shade(color, -0.15);
  c.fillRect(snap(-len * 0.34), snap(-ht * 0.5 - PIX), Math.max(PIX, snap(len * 0.7)), PIX * 2); // continuous dorsal
  fishBody(c, len, ht, color);
  tailFan(c, len, ht, color, true);
  c.fillStyle = accent;
  c.fillRect(snap(-len * 0.04), snap(-ht * 0.42), PIX, Math.max(PIX, snap(ht * 0.84))); // vertical bar
  c.fillStyle = shade(accent, -0.1);
  c.fillRect(snap(0), snap(ht * 0.42), PIX * 2, PIX);
  fishEye(c, len, ht);
  fishMouth(c, len, ht);
}

function drawShrimpSprite(c: CanvasRenderingContext2D, size: number, color: string, accent: string): void {
  const r = size * 0.5;
  const top = shade(color, 0.25);
  const bottom = shade(color, -0.25);
  for (let yy = -r * 0.5; yy <= r * 0.5; yy += PIX) {
    const t = yy / (r * 0.5);
    const hw = r * Math.sqrt(Math.max(0, 1 - t * t));
    c.fillStyle = yy < 0 ? top : bottom;
    c.fillRect(snap(-hw), snap(yy), Math.max(PIX, snap(2 * hw)), PIX);
  }
  c.fillStyle = accent;
  c.fillRect(snap(-r), snap(-r * 0.6), PIX, PIX * 2);
  c.fillRect(snap(-r - PIX), snap(-r * 0.3), PIX, PIX * 2);
  c.fillStyle = shade(color, -0.2);
  for (let lx = -r * 0.4; lx < r * 0.5; lx += PIX * 2) c.fillRect(snap(lx), snap(r * 0.3), PIX, PIX);
  c.fillStyle = '#0b0b0b';
  c.fillRect(snap(r * 0.5), snap(-r * 0.2), PIX, PIX);
}

function drawSnailSprite(c: CanvasRenderingContext2D, size: number, color: string, accent: string): void {
  const r = size * 0.5;
  c.fillStyle = accent;
  c.fillRect(snap(-r * 1.1), snap(r * 0.2), Math.max(PIX, snap(r * 2.2)), PIX * 2);
  for (let yy = -r; yy <= 0; yy += PIX) {
    const t = yy / r;
    const hw = r * Math.sqrt(Math.max(0, 1 - t * t));
    c.fillStyle = yy < -r * 0.5 ? shade(color, 0.2) : color;
    c.fillRect(snap(-hw), snap(yy), Math.max(PIX, snap(2 * hw)), PIX);
  }
  c.fillStyle = shade(color, -0.3);
  c.fillRect(-PIX, snap(-r * 0.4), PIX * 2, PIX);
  c.fillStyle = accent;
  c.fillRect(snap(r * 0.6), snap(-r * 0.2), PIX, PIX * 2);
}

/** Draw a species `size` px long, centred on the origin and facing +x. */
function drawSpecies(c: CanvasRenderingContext2D, species: Species, size: number): void {
  const sh = species.shape;
  const ht = size * SHAPE_RATIO[sh];
  const col = species.color, acc = species.accent;
  if (sh === 'shrimp') drawShrimpSprite(c, size, col, acc);
  else if (sh === 'snail') drawSnailSprite(c, size, col, acc);
  else if (sh === 'gourami') drawGourami(c, size, ht, col, acc);
  else if (sh === 'betta') drawBetta(c, size, ht, col, acc);
  else if (sh === 'angelfish') drawAngelfish(c, size, ht, col, acc);
  else if (sh === 'tall') drawCichlid(c, size, ht, col, acc);
  else if (sh === 'long') drawLongFish(c, size, ht, col, acc);
  else drawSwimmer(c, size, ht, col, acc);
}

// --------------------------------------------------- baked hardscape/plants
function bakeBlade(c: CanvasRenderingContext2D, x: number, baseY: number, height: number, color: string): void {
  const segs = Math.floor(height / PIX);
  c.fillStyle = color;
  for (let i = 0; i < segs; i++) {
    const y = baseY - i * PIX;
    const off = Math.sin(i * 0.3 + x) * (i / segs) * 6;
    c.fillRect(snap(x + off), snap(y), PIX, PIX);
    c.fillRect(snap(x + off) + PIX, snap(y), PIX, PIX);
  }
}

function bakeRock(c: CanvasRenderingContext2D, cx: number, baseY: number, w: number, h: number): void {
  const rows = Math.floor(h / PIX);
  for (let i = 0; i < rows; i++) {
    const f = i / rows;
    const hw = (w / 2) * (1 - f * 0.8);
    const y = snap(baseY) - i * PIX - PIX;
    c.fillStyle = f < 0.3 ? '#6b7178' : f > 0.7 ? '#3c4146' : '#51575d';
    c.fillRect(snap(cx - hw), y, Math.max(PIX, snap(2 * hw)), PIX);
  }
}

function bakeDriftwood(c: CanvasRenderingContext2D, cx: number, baseY: number, scale: number): void {
  const u = PIX;
  const trunkH = Math.round(18 * scale);
  const y = snap(baseY) - u;
  // thick diagonal trunk
  c.fillStyle = '#3c2a18';
  let x = cx;
  for (let i = 0; i < trunkH; i++) {
    c.fillRect(snap(x), y - i * u, u * 3, u * 2);
    x += u * 0.5;
  }
  // upper branch reaching up and forward
  const topX = x;
  const topY = y - trunkH * u;
  for (let i = 0; i < Math.round(12 * scale); i++) {
    c.fillRect(snap(topX - i * u), snap(topY - i * u), u * 2, u);
  }
  // lower branch the other way
  for (let i = 0; i < Math.round(10 * scale); i++) {
    c.fillRect(snap(cx - i * u), y - Math.round(6 * scale) * u - i * u, u * 2, u);
  }
  // bark highlight
  c.fillStyle = '#543c24';
  for (let i = 0; i < trunkH; i++) c.fillRect(snap(cx + i * u * 0.5), y - i * u, u, u);
}

// simple deterministic PRNG so the scene is stable across rebakes
function makeRng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function initAquarium(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-aquarium-canvas]');
  const addButtons = root.querySelectorAll<HTMLButtonElement>('[data-aquarium-add]');
  const gallonsInput = root.querySelector<HTMLInputElement>('[data-aquarium-gallons]');
  const gallonsLabel = root.querySelector<HTMLElement>('[data-aquarium-gallons-label]');
  const bioloadBar = root.querySelector<HTMLElement>('[data-aquarium-bioload-bar]');
  const bioloadPct = root.querySelector<HTMLElement>('[data-aquarium-bioload-pct]');
  const bioloadWord = root.querySelector<HTMLElement>('[data-aquarium-bioload-word]');
  const stockList = root.querySelector<HTMLElement>('[data-aquarium-stock]');
  const emptyNote = root.querySelector<HTMLElement>('[data-aquarium-empty]');
  const warnNote = root.querySelector<HTMLElement>('[data-aquarium-warn]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-aquarium-reset]');

  if (
    !canvas || !gallonsInput || !gallonsLabel || !bioloadBar || !bioloadPct ||
    !bioloadWord || !stockList || !emptyNote || !warnNote || !resetBtn
  ) {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const bgCanvas = document.createElement('canvas');
  const bgCtx = bgCanvas.getContext('2d');
  if (!bgCtx) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrap: Element = canvas.parentElement ?? canvas;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let gallons = Number(gallonsInput.value) || 20;
  let lastSpecies: Species | null = null;
  let onscreen = true;
  let running = false;
  let raf = 0;
  let last = 0;
  const fish: Fish[] = [];
  let frontPlants: Plant[] = [];
  let bubbles: Bubble[] = [];
  let floaters: Floater[] = [];
  const fizz: Fizz[] = [];
  const ripples: Ripple[] = [];
  const nets: Net[] = [];
  /** Everything poured out when the tank was tipped, still falling. */
  const spilled: Array<{ fish: Fish; x: number; y: number; vx: number; vy: number; spin: number; turn: number }> = [];
  let tip: { start: number; side: 1 | -1; left: number; top: number } | null = null;
  const tank: HTMLElement = canvas.parentElement ?? canvas;
  const sprites = new Map<string, Sprite>();

  /** A species drawn once on its own canvas, for drawing turned. */
  function spriteFor(s: Species, size: number): Sprite {
    const key = `${s.id}:${size.toFixed(1)}:${dpr}`;
    const cached = sprites.get(key);
    if (cached) return cached;
    const ht = size * SHAPE_RATIO[s.shape];
    // Even, and roomy enough for the longest tails and tallest fins.
    const width = 2 * snap(size * 1.3) + PIX * 4;
    const height = 2 * snap(Math.max(ht * 1.4, size * 0.65)) + PIX * 8;
    const image = document.createElement('canvas');
    image.width = Math.round(width * dpr);
    image.height = Math.round(height * dpr);
    const c = image.getContext('2d');
    if (c) {
      c.setTransform(dpr, 0, 0, dpr, (width / 2) * dpr, (height / 2) * dpr);
      c.imageSmoothingEnabled = false;
      drawSpecies(c, s, size);
    }
    const art = { image, width, height };
    sprites.set(key, art);
    return art;
  }

  function byId(id: string): Species {
    const s = SPECIES.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown species: ${id}`);
    return s;
  }

  function substrateY(): number {
    return H * 0.86;
  }

  // ---------------------------------------------------------------- sizing
  function fit(): void {
    const cssW = canvas!.clientWidth || (wrap as HTMLElement).clientWidth || 640;
    const cssH = Math.max(220, Math.min(460, Math.round(cssW * 0.52)));
    canvas!.style.height = `${cssH}px`;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas!.width = Math.round(cssW * dpr);
    canvas!.height = Math.round(cssH * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.imageSmoothingEnabled = false;
    W = cssW;
    H = cssH;
    sprites.clear();
    buildScene();
    bake();
  }

  function zoneBand(zone: Zone): [number, number] {
    const sub = substrateY();
    if (zone === 'top') return [H * 0.08, H * 0.32];
    if (zone === 'bottom') return [sub - 18, sub - 4];
    return [H * 0.3, H * 0.74];
  }

  // Tank-size feel: a fish looks smaller in a bigger tank (apparent size ~
  // 1/cbrt(volume)); planting gets denser. Both clamped so it stays readable.
  const REF_GALLONS = 20;
  function fishScale(): number {
    return Math.max(0.72, Math.min(1.3, Math.cbrt(REF_GALLONS / gallons)));
  }
  function plantFactor(): number {
    return Math.max(0.65, Math.min(1.7, Math.pow(gallons / REF_GALLONS, 0.45)));
  }

  function pxSize(s: Species): number {
    const base = 14 + s.adultInches * 6;
    return base * Math.max(0.75, Math.min(1.3, W / 720)) * fishScale();
  }

  // ------------------------------------------------------------- scene gen
  function buildScene(): void {
    const r = makeRng(Math.round(W) * 7 + 13);
    const sub = substrateY();
    frontPlants = [];
    const palettes: Array<[string, string]> = [
      ['#3f9d4a', '#2f7d32'],
      ['#359a3f', '#246b2b'],
      ['#2fa35a', '#1f7a44'],
      ['#7fae3a', '#5c8423'],
      ['#b5532f', '#7e3a20'],
    ];
    const kinds: Array<Plant['kind']> = ['vallis', 'stem'];
    const clumps = Math.max(3, Math.round((W / 110) * plantFactor()));
    for (let i = 0; i < clumps; i++) {
      const kind = kinds[Math.floor(r() * kinds.length)];
      const x = ((i + 0.5) / clumps) * W + (r() - 0.5) * 28;
      const height = kind === 'vallis' ? H * (0.28 + 0.28 * r()) : H * (0.16 + 0.16 * r());
      const g = palettes[kind === 'vallis' ? i % 4 : Math.floor(r() * palettes.length)];
      const sway = kind === 'vallis' ? 10 : 5;
      frontPlants.push({ x, height, sway, kind, c1: g[0], c2: g[1] });
    }
    bubbles = [];
    const count = Math.max(10, Math.round(W / 60));
    const src = W * 0.16;
    for (let i = 0; i < count; i++) {
      bubbles.push({
        x: src + (r() - 0.5) * 24,
        y: sub - r() * H,
        size: r() < 0.5 ? PIX : PIX * 2,
        speed: 18 + r() * 34,
        phase: r() * 6,
      });
    }

    floaters = [];
    const floatCount = Math.max(1, Math.round((W / 220) * plantFactor()));
    for (let i = 0; i < floatCount; i++) {
      floaters.push({
        x: ((i + 0.5) / floatCount) * W + (r() - 0.5) * 40,
        cells: 4 + Math.floor(r() * 4),
        phase: r() * 6,
        rootLen: H * (0.06 + r() * 0.06),
      });
    }
  }

  // --------------------------------------------------------- bake static bg
  function bake(): void {
    const c = bgCtx!;
    bgCanvas.width = canvas!.width;
    bgCanvas.height = canvas!.height;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    const sub = substrateY();

    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#10465f');
    g.addColorStop(0.55, '#0b3346');
    g.addColorStop(1, '#072531');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(120,200,220,0.08)';
    c.fillRect(0, 0, W, snap(H * 0.12));

    // background silhouette plants for depth
    const r = makeRng(Math.round(W) * 3 + 5);
    const back = Math.max(4, Math.round((W / 90) * plantFactor()));
    for (let i = 0; i < back; i++) {
      const x = ((i + 0.3) / back) * W + (r() - 0.5) * 20;
      bakeBlade(c, x, sub, H * (0.22 + 0.3 * r()), '#0c3a2a');
    }

    // hardscape
    bakeRock(c, W * 0.16, sub, snap(W * 0.13), snap(H * 0.13));
    bakeRock(c, W * 0.82, sub, snap(W * 0.17), snap(H * 0.17));
    bakeRock(c, W * 0.66, sub, snap(W * 0.1), snap(H * 0.1));
    bakeRock(c, W * 0.06, sub, snap(W * 0.08), snap(H * 0.08));
    bakeDriftwood(c, W * 0.52, sub, 1);
    bakeDriftwood(c, W * 0.3, sub, 0.7);

    // substrate + gravel
    c.fillStyle = '#241a12';
    c.fillRect(0, snap(sub), W, H - snap(sub));
    const grav = ['#2e2117', '#3a2c1d', '#1d140d', '#43331f'];
    for (let gy = snap(sub); gy < H; gy += PIX) {
      for (let gx = 0; gx < W; gx += PIX) {
        const k = (gx * 13 + gy * 7) % 11;
        if (k < 4) {
          c.fillStyle = grav[k % grav.length];
          c.fillRect(gx, gy, PIX, PIX);
        }
      }
    }

    // carpet plants along the front edge
    for (let cx = 0; cx < W; cx += PIX * 2) {
      const hh = PIX * (2 + ((cx * 7) % 3));
      c.fillStyle = (cx / PIX) % 2 ? '#2f7d32' : '#37913f';
      c.fillRect(snap(cx), snap(sub) - hh + PIX, PIX, hh);
    }
  }

  // ----------------------------------------------------------- stock model
  function addFish(species: Species, atX?: number, atY?: number, entry?: Entry): void {
    if (fish.length >= MAX_FISH) return;
    const [yLo, yHi] = zoneBand(species.zone);
    const size = pxSize(species);
    const swim = species.shape !== 'shrimp' && species.shape !== 'snail';
    const baseY = atY != null ? Math.max(yLo, Math.min(yHi, atY)) : yLo + Math.random() * (yHi - yLo);
    const f: Fish = {
      species,
      x: atX != null ? Math.max(size, Math.min(W - size, atX)) : Math.random() * W,
      y: baseY,
      baseY,
      dir: Math.random() < 0.5 ? -1 : 1,
      speed:
        (species.shape === 'snail' ? 4 : species.shape === 'shrimp' ? 14 : 22 + Math.random() * 16) *
        (reduceMotion ? 0.18 : 1),
      size,
      phase: Math.random() * Math.PI * 2,
      wobble: swim ? 4 + Math.random() * 4 : 1.5,
    };
    if (entry) {
      // In through the surface: it sinks to its depth, as fast as it hit the
      // water at first and slowing, nose levelling out as it goes.
      f.dir = entry.dir;
      f.y = 0;
      f.dive = {
        t: 0,
        dur: Math.max(0.35, Math.min(1.2, (3 * baseY) / Math.max(60, entry.speed))),
        tilt: entry.angle,
      };
      ripples.push({ x: f.x, t: 0 });
    }
    fish.push(f);
    lastSpecies = species;
    syncUI();
  }

  function removeOne(speciesId: string): void {
    for (let i = fish.length - 1; i >= 0; i--) {
      if (fish[i].species.id === speciesId) {
        const [caught] = fish.splice(i, 1);
        // The net comes for the one it took off the list.
        if (!reduceMotion && running) {
          nets.push({ fish: caught, t: 0, x: caught.x, y: caught.y, side: caught.x < W / 2 ? 1 : -1 });
        }
        break;
      }
    }
    syncUI();
  }

  function reset(): void {
    jumps.clear();
    nets.length = 0;
    if (!reduceMotion && running && fish.length) {
      // Tip the tank out: everything in it pours over the low side.
      const side: 1 | -1 = Math.random() < 0.5 ? -1 : 1;
      const box = canvas!.getBoundingClientRect();
      tip = { start: performance.now(), side, left: box.left + window.scrollX, top: box.top + window.scrollY };
      for (const f of fish) {
        spilled.push({
          fish: f,
          x: f.x,
          y: f.y,
          vx: side * (40 + Math.random() * 80),
          vy: -20 - Math.random() * 40,
          spin: (Math.random() - 0.5) * 6,
          turn: 0,
        });
      }
      tank.classList.add('is-tipping');
      tank.style.transformOrigin = side > 0 ? '100% 100%' : '0% 100%';
    }
    fish.length = 0;
    fizz.length = 0;
    ripples.length = 0;
    syncUI();
  }

  function counts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const f of fish) m.set(f.species.id, (m.get(f.species.id) ?? 0) + 1);
    return m;
  }

  function totalBioload(): number {
    let t = 0;
    for (const f of fish) t += f.species.bioload;
    return t;
  }

  // -------------------------------------------------------------- UI sync
  function syncUI(): void {
    const { pct, label } = stockingStatus(gallons, totalBioload());
    const empty = fish.length === 0;
    rollTo(bioloadPct!, empty ? 0 : Math.round(pct * 100));
    bioloadWord!.textContent = empty ? 'Empty' : label;
    setHair(bioloadBar!, empty ? 0 : Math.min(1, pct));

    // The rows are rebuilt on every change, which would drop keyboard focus
    // from a remove button. Remember it so it can land on the same species, or
    // the row that takes its place.
    const active = document.activeElement;
    const hadFocus = active instanceof HTMLElement && stockList!.contains(active);
    const focusId = hadFocus ? active.dataset.species : undefined;
    const focusRow = hadFocus ? Array.from(stockList!.children).findIndex((li) => li.contains(active)) : -1;

    const c = counts();
    stockList!.replaceChildren();
    let tooSmall: string | null = null;
    for (const s of SPECIES) {
      const n = c.get(s.id);
      if (!n) continue;
      if (s.minGallons > gallons && !tooSmall) tooSmall = `${s.name} likes ${s.minGallons}+ gallons`;
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'aq-stock-name';
      name.textContent = s.name;
      const count = document.createElement('span');
      count.className = 'aq-stock-n';
      count.textContent = `×${n}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'aq-stock-rm';
      remove.dataset.species = s.id;
      remove.setAttribute('aria-label', `Remove one ${s.name}`);
      remove.textContent = '−';
      remove.addEventListener('click', () => removeOne(s.id));
      li.append(name, count, remove);
      stockList!.append(li);
    }
    emptyNote!.hidden = !empty;
    warnNote!.textContent = tooSmall ?? '';
    warnNote!.hidden = !tooSmall;

    if (hadFocus) {
      const removes = Array.from(stockList!.querySelectorAll<HTMLButtonElement>('.aq-stock-rm'));
      const next =
        removes.find((b) => b.dataset.species === focusId) ?? removes[Math.min(focusRow, removes.length - 1)];
      (next ?? resetBtn!).focus();
    }
  }

  // -------------------------------------------------------------- drawing
  function drawCaustics(now: number): void {
    if (reduceMotion) return;
    ctx!.save();
    ctx!.fillStyle = 'rgba(150,210,230,0.05)';
    ctx!.transform(1, 0, -0.4, 1, 0, 0);
    const bands = 4;
    for (let i = 0; i < bands; i++) {
      const x = ((now / 30 + (i * W) / bands) % (W + 160)) - 80;
      ctx!.fillRect(snap(x), 0, PIX * 3, H * 0.7);
    }
    ctx!.restore();
  }

  function drawPlant(p: Plant, now: number): void {
    const sub = substrateY();
    const sway = reduceMotion ? 0 : p.sway;
    if (p.kind === 'vallis') {
      const blades = 5;
      for (let b = 0; b < blades; b++) {
        const bx = p.x + (b - blades / 2) * PIX * 1.6;
        const segs = Math.floor(p.height / PIX);
        for (let i = 0; i < segs; i++) {
          const f = i / segs;
          const y = sub - i * PIX;
          const x = bx + Math.sin(now / 700 + p.x * 0.03 + b + f * 2) * sway * f;
          ctx!.fillStyle = (i + b) % 2 ? p.c1 : p.c2;
          ctx!.fillRect(snap(x), snap(y), PIX, PIX);
          ctx!.fillRect(snap(x) + PIX, snap(y), PIX, PIX);
        }
      }
    } else {
      const segs = Math.floor(p.height / PIX);
      for (let i = 0; i < segs; i++) {
        const f = i / segs;
        const y = sub - i * PIX;
        const x = p.x + Math.sin(now / 800 + p.x * 0.02 + f * 2) * sway * f;
        ctx!.fillStyle = p.c2;
        ctx!.fillRect(snap(x), snap(y), PIX, PIX);
        if (i % 3 === 0) {
          ctx!.fillStyle = p.c1;
          ctx!.fillRect(snap(x) - PIX * 2, snap(y), PIX * 2, PIX);
          ctx!.fillRect(snap(x) + PIX, snap(y), PIX * 2, PIX);
        }
      }
    }
  }

  function drawBubbles(): void {
    ctx!.fillStyle = 'rgba(220,240,255,0.6)';
    for (const b of bubbles) {
      const x = b.x + Math.sin(b.y * 0.05 + b.phase) * PIX;
      ctx!.fillRect(snap(x), snap(b.y), b.size, b.size);
    }
  }

  function drawFloater(f: Floater, now: number): void {
    const drift = reduceMotion ? 0 : Math.sin(now / 1600 + f.phase) * 8;
    const cx = f.x + drift;
    const topY = PIX;
    const w = f.cells;
    // canopy: a rounded leaf clump, taller in the middle
    for (let gx = -w; gx <= w; gx++) {
      const colH = Math.max(1, Math.round((1 - Math.abs(gx) / (w + 1)) * 3));
      for (let gy = 0; gy < colH; gy++) {
        ctx!.fillStyle = (gx + gy) % 2 ? '#3f9d4a' : '#2f7d32';
        ctx!.fillRect(snap(cx + gx * PIX), snap(topY + gy * PIX), PIX, PIX);
      }
    }
    // top highlight
    ctx!.fillStyle = '#57b85e';
    for (let gx = -w; gx <= w; gx += 2) ctx!.fillRect(snap(cx + gx * PIX), snap(topY), PIX, PIX);
    // dangling roots
    ctx!.fillStyle = 'rgba(186,204,176,0.5)';
    const segs = Math.floor(f.rootLen / PIX);
    for (let rt = -1; rt <= 1; rt++) {
      const rx0 = cx + rt * PIX * 2;
      for (let i = 0; i < segs; i++) {
        const sway = reduceMotion ? 0 : Math.sin(now / 600 + rt + i * 0.4) * (i / segs) * 4;
        ctx!.fillRect(snap(rx0 + sway), snap(topY + 3 * PIX + i * PIX), PIX, PIX);
      }
    }
  }

  function drawFish(f: Fish): void {
    // Still coming in nose-first: the same pixels, turned.
    if (f.dive) {
      const k = Math.min(1, f.dive.t / f.dive.dur);
      const turn = f.dive.tilt * Math.pow(1 - k, 2);
      if (Math.abs(turn) > 0.02) {
        const art = spriteFor(f.species, f.size);
        ctx!.save();
        ctx!.translate(snap(f.x), snap(f.y));
        ctx!.rotate(turn);
        ctx!.scale(f.dir, 1);
        ctx!.drawImage(art.image, -art.width / 2, -art.height / 2, art.width, art.height);
        ctx!.restore();
        return;
      }
    }
    ctx!.save();
    ctx!.translate(snap(f.x), snap(f.y));
    ctx!.scale(f.dir, 1);
    drawSpecies(ctx!, f.species, f.size);
    ctx!.restore();
  }

  // ---------------------------------------------------------------- loop
  function update(dt: number, now: number): void {
    for (const f of fish) {
      f.x += f.dir * f.speed * dt;
      const margin = f.size * 0.6;
      if (f.x < margin) {
        f.x = margin;
        f.dir = 1;
      } else if (f.x > W - margin) {
        f.x = W - margin;
        f.dir = -1;
      }
      if (f.dive) {
        const d = f.dive;
        d.t += dt;
        const k = Math.min(1, d.t / d.dur);
        f.y = f.baseY * (1 - Math.pow(1 - k, 3));
        // Bubbles knocked off it on the way down.
        if (Math.random() < dt * 16) {
          fizz.push({ x: f.x - f.dir * f.size * 0.3, y: f.y, vy: -(40 + Math.random() * 40), life: 1.2 });
        }
        if (k >= 1) {
          f.dive = undefined;
          // Start the bob from the middle of its swing, so it doesn't jump.
          f.phase = -now / (f.species.shape === 'shrimp' ? 300 : 700);
        }
        continue;
      }
      const swim = f.species.shape !== 'shrimp' && f.species.shape !== 'snail';
      if (swim) f.y = f.baseY + Math.sin(now / 700 + f.phase) * f.wobble;
      else if (f.species.shape === 'shrimp') f.y = f.baseY + Math.sin(now / 300 + f.phase) * 1.5;
    }
    for (let i = fizz.length - 1; i >= 0; i--) {
      const b = fizz[i];
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.y < PIX) fizz.splice(i, 1);
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].t += dt;
      if (ripples[i].t > 0.6) ripples.splice(i, 1);
    }
    for (let i = nets.length - 1; i >= 0; i--) {
      nets[i].t += dt;
      if (nets[i].t > NET_IN + NET_SCOOP + NET_OUT) nets.splice(i, 1);
    }
    if (tip) {
      const ms = now - tip.start;
      const lean = tipLean(ms, tip.side);
      tank.style.transform = lean ? `rotate(${lean}rad)` : '';
      const tilt = Math.abs(lean) / ((16 * Math.PI) / 180);
      const cos = Math.cos(lean);
      const sin = Math.sin(lean);
      // Tank pixels to page pixels, turned about the low bottom corner.
      const ox = tip.side < 0 ? 0 : W;
      const toPage = (x: number, y: number) => ({
        x: tip!.left + ox + (x - ox) * cos - (y - H) * sin,
        y: tip!.top + H + (x - ox) * sin + (y - H) * cos,
      });
      // Everything rushes for the low corner of the rim and pours out.
      const rimX = tip.side < 0 ? 0 : W;
      const rimY = PIX * 2;
      for (let i = spilled.length - 1; i >= 0; i--) {
        const s = spilled[i];
        const dx = rimX - s.x;
        const dy = rimY - s.y;
        const d = Math.hypot(dx, dy) || 1;
        const pull = 3600 * tilt;
        s.vx += (dx / d) * pull * dt;
        s.vy += (dy / d) * pull * dt;
        s.vx *= 1 - Math.min(1, 1.2 * dt);
        s.vy *= 1 - Math.min(1, 1.2 * dt);
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.turn += s.spin * dt;
        const over = tip.side < 0 ? s.x <= s.fish.size * 0.2 : s.x >= W - s.fish.size * 0.2;
        if (d < s.fish.size * 0.6 || (over && s.y < H * 0.3)) {
          jumps.fall(
            { species: s.fish.species, size: s.fish.size, dir: s.fish.dir },
            toPage(s.x, s.y),
            { x: s.vx * cos - s.vy * sin, y: s.vx * sin + s.vy * cos },
            s.turn + lean,
          );
          spilled.splice(i, 1);
        }
      }
      if (tilt > 0.6 && Math.random() < dt * 30) jumps.pour(toPage(rimX, rimY), tip.side, 3);
      if (ms >= TIP_MS) {
        tip = null;
        spilled.length = 0;
        tank.style.transform = '';
        tank.classList.remove('is-tipping');
      }
    }
    if (!reduceMotion) {
      const sub = substrateY();
      for (const b of bubbles) {
        b.y -= b.speed * dt;
        if (b.y < -8) b.y = sub - 4;
      }
    }
  }

  /** Two dashes running out along the surface from where a fish went in. */
  function drawRipples(): void {
    for (const r of ripples) {
      const k = r.t / 0.6;
      const spread = 6 + 70 * (1 - Math.pow(1 - k, 3));
      ctx!.fillStyle = `rgba(210,240,250,${0.6 * (1 - k)})`;
      ctx!.fillRect(snap(r.x - spread) - PIX * 2, 0, PIX * 2, PIX);
      ctx!.fillRect(snap(r.x + spread), 0, PIX * 2, PIX);
    }
  }

  /** A pixel net: a hoop of mesh on a handle, carrying its fish once caught. */
  function drawNet(n: Net): void {
    const top = -PIX * 6;
    const at = netPath(n.t, n.x, n.y, top, n.side);
    const reach = Math.max(PIX * 5, n.fish.size * 0.75);
    const rimY = snap(at.y - reach * 0.55);
    if (at.holding) {
      const art = spriteFor(n.fish.species, n.fish.size);
      ctx!.save();
      ctx!.translate(snap(at.x), snap(at.y));
      ctx!.rotate(0.35 * n.side);
      ctx!.scale(n.fish.dir, 1);
      ctx!.drawImage(art.image, -art.width / 2, -art.height / 2, art.width, art.height);
      ctx!.restore();
    }
    // Handle, from the rim's far edge up out of the tank, leaning away.
    ctx!.fillStyle = '#8a6a43';
    for (let y = rimY; y > -PIX; y -= PIX) {
      const x = at.x + n.side * reach + n.side * (rimY - y) * 0.45;
      ctx!.fillRect(snap(x), snap(y), PIX, PIX);
    }
    // Rim and mesh bag.
    ctx!.fillStyle = 'rgba(232,238,232,0.9)';
    for (let x = -reach; x <= reach; x += PIX) ctx!.fillRect(snap(at.x + x), rimY, PIX, PIX);
    ctx!.fillStyle = 'rgba(232,238,232,0.42)';
    const depth = reach * 1.15;
    for (let y = PIX; y <= depth; y += PIX) {
      const half = reach * Math.sqrt(Math.max(0, 1 - (y / depth) * (y / depth)));
      for (let x = -half; x <= half; x += PIX * 2) {
        ctx!.fillRect(snap(at.x + x + ((y / PIX) % 2) * PIX), rimY + snap(y), PIX, PIX);
      }
    }
  }

  function render(now: number): void {
    ctx!.drawImage(bgCanvas, 0, 0, W, H);
    drawCaustics(now);
    for (const p of frontPlants) drawPlant(p, now);
    for (const z of ['bottom', 'mid', 'top'] as Zone[]) {
      for (const f of fish) if (f.species.zone === z) drawFish(f);
    }
    for (const s of spilled) {
      const art = spriteFor(s.fish.species, s.fish.size);
      ctx!.save();
      ctx!.translate(snap(s.x), snap(s.y));
      ctx!.rotate(s.turn);
      ctx!.scale(s.fish.dir, 1);
      ctx!.drawImage(art.image, -art.width / 2, -art.height / 2, art.width, art.height);
      ctx!.restore();
    }
    for (const n of nets) drawNet(n);
    for (const f of floaters) drawFloater(f, now);
    drawBubbles();
    ctx!.fillStyle = 'rgba(220,240,255,0.6)';
    for (const b of fizz) ctx!.fillRect(snap(b.x), snap(b.y), PIX, PIX);
    drawRipples();
  }

  function step(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt, now);
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

  // ------------------------------------------------------------- wiring
  const jumps = createJumps({
    tank: canvas,
    pix: PIX,
    sprite: spriteFor,
    onSplash(splash) {
      addFish(splash.species, splash.x, splash.y, splash);
    },
  });

  /**
   * Add a fish the way the visitor asked for it: leaping from the swatch they
   * tapped, or dropping in over the spot they tapped in the tank. Under
   * reduced motion it's just there.
   */
  function sendIn(species: Species, swatch?: Element | null, atX?: number, atY?: number): void {
    if (fish.length + jumps.pending >= MAX_FISH) return;
    lastSpecies = species;
    if (reduceMotion) {
      addFish(species, atX, atY);
      return;
    }
    const size = pxSize(species);
    const [yLo, yHi] = zoneBand(species.zone);
    const x = atX != null ? Math.max(size, Math.min(W - size, atX)) : size + Math.random() * Math.max(0, W - 2 * size);
    const depth = atY != null ? Math.max(yLo, Math.min(yHi, atY)) : yLo + Math.random() * (yHi - yLo);
    const from = swatch?.getBoundingClientRect();
    const across = from ? canvas!.getBoundingClientRect().left + x - (from.left + from.width / 2) : Math.random() - 0.5;
    jumps.launch({ species, size, dir: across < 0 ? -1 : 1, swatch: from, entryX: x, depth });
  }

  for (const btn of addButtons) {
    const s = SPECIES.find((x) => x.id === btn.dataset.aquariumAdd);
    if (s) btn.addEventListener('click', () => sendIn(s, btn.querySelector('.aq-sw')));
  }

  let rebuildT = 0;
  function rescaleFish(): void {
    for (const f of fish) f.size = pxSize(f.species);
  }
  function scheduleRebuild(): void {
    clearTimeout(rebuildT);
    rebuildT = window.setTimeout(() => {
      buildScene();
      bake();
      if (!running && onscreen && !document.hidden) render(performance.now());
    }, 70);
  }
  gallonsInput.addEventListener('input', () => {
    gallons = Number(gallonsInput.value) || 20;
    gallonsLabel.textContent = `${gallons} gal`;
    rescaleFish();
    scheduleRebuild();
    syncUI();
  });
  resetBtn.addEventListener('click', reset);
  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!lastSpecies) return;
    const rect = canvas.getBoundingClientRect();
    sendIn(lastSpecies, null, e.clientX - rect.left, e.clientY - rect.top);
  });

  const ro = new ResizeObserver(() => {
    fit();
    for (const f of fish) {
      const [lo, hi] = zoneBand(f.species.zone);
      f.baseY = Math.max(lo, Math.min(hi, f.baseY));
      f.x = Math.min(f.x, W);
    }
    if (!running && onscreen && !document.hidden) render(performance.now());
  });
  ro.observe(wrap);

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) onscreen = entry.isIntersecting;
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

  // ------------------------------------------------------------- init
  fit();
  gallonsLabel.textContent = `${gallons} gal`;
  for (const [id, n] of STARTER) for (let i = 0; i < n; i++) addFish(byId(id));
  syncUI();
  render(performance.now());
  start();
}
