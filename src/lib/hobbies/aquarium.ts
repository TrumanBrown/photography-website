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
 * Mounted by src/components/hobbies/AquariumTank.astro. The loop pauses when
 * offscreen or the tab is hidden, and honors prefers-reduced-motion.
 *
 * Tuning lives in three places: SPECIES (roster + balance), the constants
 * below (PIX / capacity / starter), and the draw* functions (look).
 */

export type Zone = 'top' | 'mid' | 'bottom';
export type Shape = 'fish' | 'tall' | 'long' | 'gourami' | 'betta' | 'angelfish' | 'shrimp' | 'snail';

export interface Species {
  id: string;
  name: string;
  emoji: string;
  /** Approx adult length in inches — drives on-screen size and bioload. */
  adultInches: number;
  /** Relative bioload (waste) contributed per individual. */
  bioload: number;
  /** Suggested minimum tank in gallons; a gentle warning shows if exceeded. */
  minGallons: number;
  zone: Zone;
  shape: Shape;
  /** Primary body color. */
  color: string;
  /** Secondary color for fins / stripe / detail. */
  accent: string;
}

/** Curated common planted-tank species, spanning a wide bioload range. */
export const SPECIES: Species[] = [
  // --- bottom: inverts + catfish + loaches ---
  { id: 'cherry-shrimp', name: 'Cherry shrimp', emoji: '🦐', adultInches: 1.2, bioload: 0.05, minGallons: 5, zone: 'bottom', shape: 'shrimp', color: '#e23b3b', accent: '#ff8a8a' },
  { id: 'amano-shrimp', name: 'Amano shrimp', emoji: '🦐', adultInches: 2.0, bioload: 0.12, minGallons: 10, zone: 'bottom', shape: 'shrimp', color: '#9aa888', accent: '#d8cba2' },
  { id: 'ghost-shrimp', name: 'Ghost shrimp', emoji: '🦐', adultInches: 1.5, bioload: 0.08, minGallons: 5, zone: 'bottom', shape: 'shrimp', color: '#cfd6dd', accent: '#9aa6b0' },
  { id: 'nerite-snail', name: 'Nerite snail', emoji: '🐌', adultInches: 1.0, bioload: 0.1, minGallons: 5, zone: 'bottom', shape: 'snail', color: '#b9904f', accent: '#42301a' },
  { id: 'mystery-snail', name: 'Mystery snail', emoji: '🐌', adultInches: 2.0, bioload: 0.35, minGallons: 10, zone: 'bottom', shape: 'snail', color: '#e7b84a', accent: '#7a531b' },
  { id: 'pygmy-cory', name: 'Pygmy cory', emoji: '🐟', adultInches: 1.3, bioload: 0.35, minGallons: 10, zone: 'bottom', shape: 'fish', color: '#9aa7b0', accent: '#39454e' },
  { id: 'bronze-cory', name: 'Bronze cory', emoji: '🐟', adultInches: 2.5, bioload: 0.7, minGallons: 15, zone: 'bottom', shape: 'long', color: '#9c8961', accent: '#d9c79a' },
  { id: 'panda-cory', name: 'Panda cory', emoji: '🐟', adultInches: 2.0, bioload: 0.55, minGallons: 15, zone: 'bottom', shape: 'fish', color: '#e9e9e9', accent: '#222222' },
  { id: 'kuhli-loach', name: 'Kuhli loach', emoji: '🐟', adultInches: 3.5, bioload: 0.6, minGallons: 15, zone: 'bottom', shape: 'long', color: '#d99a3a', accent: '#3a2412' },
  { id: 'otocinclus', name: 'Otocinclus', emoji: '🐟', adultInches: 1.6, bioload: 0.3, minGallons: 10, zone: 'bottom', shape: 'long', color: '#b6a079', accent: '#46371f' },
  { id: 'bristlenose-pleco', name: 'Bristlenose pleco', emoji: '🐟', adultInches: 4.5, bioload: 3.2, minGallons: 25, zone: 'bottom', shape: 'long', color: '#4a4036', accent: '#211c16' },
  // --- mid: tetras, rasboras, danios, livebearers, barbs ---
  { id: 'ember-tetra', name: 'Ember tetra', emoji: '🐟', adultInches: 1.0, bioload: 0.25, minGallons: 10, zone: 'mid', shape: 'fish', color: '#e8631f', accent: '#ffb06b' },
  { id: 'neon-tetra', name: 'Neon tetra', emoji: '🐟', adultInches: 1.5, bioload: 0.3, minGallons: 10, zone: 'mid', shape: 'fish', color: '#2bb6d6', accent: '#e3354e' },
  { id: 'cardinal-tetra', name: 'Cardinal tetra', emoji: '🐟', adultInches: 2.0, bioload: 0.35, minGallons: 15, zone: 'mid', shape: 'fish', color: '#1fa7c2', accent: '#d52240' },
  { id: 'rummynose-tetra', name: 'Rummynose tetra', emoji: '🐟', adultInches: 2.0, bioload: 0.4, minGallons: 20, zone: 'mid', shape: 'fish', color: '#d7dbde', accent: '#c0392b' },
  { id: 'black-neon-tetra', name: 'Black neon tetra', emoji: '🐟', adultInches: 1.6, bioload: 0.3, minGallons: 15, zone: 'mid', shape: 'fish', color: '#b9c2c7', accent: '#1c2a33' },
  { id: 'harlequin-rasbora', name: 'Harlequin rasbora', emoji: '🐟', adultInches: 1.8, bioload: 0.35, minGallons: 10, zone: 'mid', shape: 'fish', color: '#df8b3c', accent: '#2a1a12' },
  { id: 'chili-rasbora', name: 'Chili rasbora', emoji: '🐟', adultInches: 0.7, bioload: 0.12, minGallons: 5, zone: 'mid', shape: 'fish', color: '#d22b2b', accent: '#7a1414' },
  { id: 'celestial-pearl-danio', name: 'Celestial pearl danio', emoji: '🐟', adultInches: 1.0, bioload: 0.2, minGallons: 10, zone: 'mid', shape: 'fish', color: '#3a4a5a', accent: '#e9c46a' },
  { id: 'zebra-danio', name: 'Zebra danio', emoji: '🐟', adultInches: 2.0, bioload: 0.4, minGallons: 10, zone: 'mid', shape: 'fish', color: '#c7cdd2', accent: '#2b4a7a' },
  { id: 'guppy', name: 'Guppy', emoji: '🐠', adultInches: 2.0, bioload: 0.5, minGallons: 10, zone: 'mid', shape: 'fish', color: '#34b3a0', accent: '#f4a93b' },
  { id: 'endlers', name: "Endler's livebearer", emoji: '🐠', adultInches: 1.0, bioload: 0.3, minGallons: 5, zone: 'mid', shape: 'fish', color: '#2fa86f', accent: '#f0a93b' },
  { id: 'platy', name: 'Platy', emoji: '🐠', adultInches: 2.5, bioload: 0.6, minGallons: 10, zone: 'mid', shape: 'fish', color: '#f0682e', accent: '#ffd17a' },
  { id: 'molly', name: 'Molly', emoji: '🐠', adultInches: 4.0, bioload: 1.0, minGallons: 20, zone: 'mid', shape: 'fish', color: '#2a2a2a', accent: '#cfcfcf' },
  { id: 'cherry-barb', name: 'Cherry barb', emoji: '🐟', adultInches: 2.0, bioload: 0.45, minGallons: 15, zone: 'mid', shape: 'fish', color: '#c0392b', accent: '#e8a0a0' },
  { id: 'tiger-barb', name: 'Tiger barb', emoji: '🐟', adultInches: 2.8, bioload: 0.8, minGallons: 20, zone: 'mid', shape: 'fish', color: '#e0a73b', accent: '#2a2a2a' },
  // --- mid: gouramis + cichlids (tall, laterally compressed) ---
  { id: 'honey-gourami', name: 'Honey gourami', emoji: '🐟', adultInches: 2.0, bioload: 0.9, minGallons: 10, zone: 'mid', shape: 'gourami', color: '#f0b53d', accent: '#c97b1c' },
  { id: 'dwarf-gourami', name: 'Dwarf gourami', emoji: '🐠', adultInches: 3.5, bioload: 1.2, minGallons: 15, zone: 'mid', shape: 'gourami', color: '#2f6fb0', accent: '#d8542e' },
  { id: 'pearl-gourami', name: 'Pearl gourami', emoji: '🐠', adultInches: 4.5, bioload: 1.6, minGallons: 30, zone: 'mid', shape: 'gourami', color: '#cdb89a', accent: '#8a5a3a' },
  { id: 'betta', name: 'Betta', emoji: '🐟', adultInches: 2.7, bioload: 1.0, minGallons: 5, zone: 'mid', shape: 'betta', color: '#3550d6', accent: '#d63b86' },
  { id: 'german-blue-ram', name: 'German blue ram', emoji: '🐠', adultInches: 2.5, bioload: 1.3, minGallons: 20, zone: 'mid', shape: 'tall', color: '#3a7bd5', accent: '#f2c84b' },
  { id: 'bolivian-ram', name: 'Bolivian ram', emoji: '🐠', adultInches: 3.0, bioload: 1.4, minGallons: 20, zone: 'mid', shape: 'tall', color: '#c2a25a', accent: '#d9572b' },
  { id: 'angelfish', name: 'Angelfish', emoji: '🐠', adultInches: 6.0, bioload: 3.0, minGallons: 29, zone: 'mid', shape: 'angelfish', color: '#dcdcdc', accent: '#2b2b2b' },
  // --- top swimmers ---
  { id: 'hatchetfish', name: 'Hatchetfish', emoji: '🐟', adultInches: 1.8, bioload: 0.35, minGallons: 15, zone: 'top', shape: 'fish', color: '#cfd3c8', accent: '#7a6a3a' },
  { id: 'killifish', name: 'Killifish', emoji: '🐠', adultInches: 2.2, bioload: 0.5, minGallons: 10, zone: 'top', shape: 'fish', color: '#d98a3d', accent: '#3a7bd5' },
];

/** CSS pixels per drawn "pixel" block — the chunkiness of the 8-bit look. */
const PIX = 4;
/** Bioload units a planted gallon can comfortably carry (tuned for feel). */
const PLANTED_CAPACITY_PER_GALLON = 0.55;
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
  const palette = root.querySelector<HTMLElement>('[data-aquarium-palette]');
  const gallonsInput = root.querySelector<HTMLInputElement>('[data-aquarium-gallons]');
  const gallonsLabel = root.querySelector<HTMLElement>('[data-aquarium-gallons-label]');
  const bioloadBar = root.querySelector<HTMLElement>('[data-aquarium-bioload-bar]');
  const bioloadLabel = root.querySelector<HTMLElement>('[data-aquarium-bioload-label]');
  const stockList = root.querySelector<HTMLElement>('[data-aquarium-stock]');
  const emptyNote = root.querySelector<HTMLElement>('[data-aquarium-empty]');
  const warnNote = root.querySelector<HTMLElement>('[data-aquarium-warn]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-aquarium-reset]');

  if (
    !canvas || !palette || !gallonsInput || !gallonsLabel || !bioloadBar ||
    !bioloadLabel || !stockList || !emptyNote || !warnNote || !resetBtn
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
  function addFish(species: Species, atX?: number, atY?: number): void {
    if (fish.length >= MAX_FISH) return;
    const [yLo, yHi] = zoneBand(species.zone);
    const size = pxSize(species);
    const swim = species.shape !== 'shrimp' && species.shape !== 'snail';
    const baseY = atY != null ? Math.max(yLo, Math.min(yHi, atY)) : yLo + Math.random() * (yHi - yLo);
    fish.push({
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
    });
    lastSpecies = species;
    syncUI();
  }

  function removeOne(speciesId: string): void {
    for (let i = fish.length - 1; i >= 0; i--) {
      if (fish[i].species.id === speciesId) {
        fish.splice(i, 1);
        break;
      }
    }
    syncUI();
  }

  function reset(): void {
    fish.length = 0;
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
    const capacity = gallons * PLANTED_CAPACITY_PER_GALLON;
    const pct = capacity > 0 ? totalBioload() / capacity : 0;
    bioloadBar!.style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`;

    let color = '#10b981';
    let label = 'Lightly stocked';
    if (pct > 1) {
      color = '#ef4444';
      label = 'Overstocked';
    } else if (pct > 0.85) {
      color = '#f59e0b';
      label = 'Heavily stocked';
    } else if (pct >= 0.4) {
      label = 'Healthy';
    }
    bioloadBar!.style.backgroundColor = color;
    bioloadLabel!.textContent = fish.length === 0 ? '0%' : `${Math.round(pct * 100)}% · ${label}`;

    const c = counts();
    stockList!.replaceChildren();
    let tooSmall: string | null = null;
    for (const s of SPECIES) {
      const n = c.get(s.id);
      if (!n) continue;
      if (s.minGallons > gallons && !tooSmall) tooSmall = `${s.name} likes ${s.minGallons}+ gallons`;
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between gap-2';
      const leftLabel = document.createElement('span');
      leftLabel.textContent = `${s.emoji} ${s.name} ×${n}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className =
        'rounded px-1.5 leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200';
      remove.setAttribute('aria-label', `Remove one ${s.name}`);
      remove.textContent = '−';
      remove.addEventListener('click', () => removeOne(s.id));
      li.append(leftLabel, remove);
      stockList!.append(li);
    }
    emptyNote!.hidden = fish.length > 0;
    warnNote!.textContent = tooSmall ? `⚠ ${tooSmall}` : '';
    warnNote!.hidden = !tooSmall;
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
    const sh = f.species.shape;
    const len = f.size;
    const ht = len * SHAPE_RATIO[sh];
    const col = f.species.color, acc = f.species.accent;
    ctx!.save();
    ctx!.translate(snap(f.x), snap(f.y));
    ctx!.scale(f.dir, 1);
    if (sh === 'shrimp') drawShrimpSprite(ctx!, f.size, col, acc);
    else if (sh === 'snail') drawSnailSprite(ctx!, f.size, col, acc);
    else if (sh === 'gourami') drawGourami(ctx!, len, ht, col, acc);
    else if (sh === 'betta') drawBetta(ctx!, len, ht, col, acc);
    else if (sh === 'angelfish') drawAngelfish(ctx!, len, ht, col, acc);
    else if (sh === 'tall') drawCichlid(ctx!, len, ht, col, acc);
    else if (sh === 'long') drawLongFish(ctx!, len, ht, col, acc);
    else drawSwimmer(ctx!, len, ht, col, acc);
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
      const swim = f.species.shape !== 'shrimp' && f.species.shape !== 'snail';
      if (swim) f.y = f.baseY + Math.sin(now / 700 + f.phase) * f.wobble;
      else if (f.species.shape === 'shrimp') f.y = f.baseY + Math.sin(now / 300 + f.phase) * 1.5;
    }
    if (!reduceMotion) {
      const sub = substrateY();
      for (const b of bubbles) {
        b.y -= b.speed * dt;
        if (b.y < -8) b.y = sub - 4;
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
    for (const f of floaters) drawFloater(f, now);
    drawBubbles();
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
  for (const s of SPECIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1.5 text-sm hover:border-sky-400 hover:bg-sky-50 dark:border-neutral-700 dark:hover:border-sky-500 dark:hover:bg-sky-950';
    btn.setAttribute('aria-label', `Add ${s.name}`);
    const em = document.createElement('span');
    em.setAttribute('aria-hidden', 'true');
    em.textContent = s.emoji;
    const nm = document.createElement('span');
    nm.textContent = s.name;
    btn.append(em, nm);
    btn.addEventListener('click', () => addFish(s));
    palette.append(btn);
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
    addFish(lastSpecies, e.clientX - rect.left, e.clientY - rect.top);
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
