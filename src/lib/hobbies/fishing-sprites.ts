/**
 * Pixel fish sprites for the Fishing hobby — one draw function per category in
 * fishing-species.ts. Each draws a fish facing LEFT, centered at the origin, in
 * chunky `u`-sized blocks (snap to the grid, image smoothing off). The SAME
 * sprite is used small on the map and larger beside the caught-fish photos, so a
 * long species list stays cheap (color/accent are the only per-species inputs).
 */
import type { FishCategory } from './fishing-species';

type Ctx = CanvasRenderingContext2D;
const EYE = '#0b0b0b';

function R(c: Ctx, u: number, x: number, y: number, w: number, h: number, col: string): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x * u), Math.round(y * u), Math.round(w * u), Math.round(h * u));
}
function hx(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function shade(hex: string, amt: number): string {
  const [r, g, b] = hx(hex);
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const m = (c: number) => Math.round((t - c) * p + c);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}

type Sprite = (c: Ctx, u: number, col: string, acc: string) => void;

const SPRITES: Record<FishCategory, Sprite> = {
  bass(c, u, col, acc) {
    const dk = shade(col, -0.22), lt = shade(col, 0.18);
    R(c, u, -5, -2.5, 9, 5, col); R(c, u, -5, -2.5, 9, 1, lt); R(c, u, -5, 1.5, 9, 1, dk);
    R(c, u, -6, -1.5, 1, 3, col); R(c, u, -6.5, 0.2, 1, 1, col);
    R(c, u, 4, -2, 2, 4, col); R(c, u, 6, -3, 1, 2, col); R(c, u, 6, 1, 1, 2, col);
    R(c, u, -2, -3.5, 5, 1, dk); R(c, u, -3, 1.7, 2, 1, acc);
    R(c, u, -3, -0.5, 6, 1, shade(col, -0.1)); R(c, u, -4.5, -1, 1, 1, EYE);
  },
  walleye(c, u, col, acc) {
    const dk = shade(col, -0.2), lt = shade(col, 0.2);
    R(c, u, -6, -1.7, 11, 3.4, col); R(c, u, -6, -1.7, 11, 1, lt); R(c, u, -6, 1, 11, 1, dk);
    R(c, u, -7, -1, 1, 2, col); R(c, u, 5, -1.6, 1.6, 3.2, col); R(c, u, 6.4, -2.4, 1, 2, col); R(c, u, 6.4, 1, 1, 2, col);
    R(c, u, -3, -2.7, 3, 1, dk); R(c, u, 1.5, -2.6, 3, 1, dk);
    R(c, u, -3, 1.3, 2, 1, acc); R(c, u, -5.3, -0.9, 1.3, 1.3, '#f0e6b0'); R(c, u, -5, -0.7, 1, 1, EYE);
  },
  pike(c, u, col, acc) {
    const dk = shade(col, -0.2), lt = shade(col, 0.16);
    R(c, u, -7, -1.4, 12, 2.8, col); R(c, u, -7, -1.4, 12, 1, lt); R(c, u, -7, 0.6, 12, 0.8, dk);
    R(c, u, -9, -0.6, 2, 1.4, col); R(c, u, -9.6, 0, 1, 0.8, col);
    R(c, u, 5, -1.4, 1.5, 2.8, col); R(c, u, 6.4, -2, 1, 1.6, col); R(c, u, 6.4, 0.6, 1, 1.6, col);
    R(c, u, 2.5, -2.2, 3, 1, dk);
    for (let i = 0; i < 4; i++) R(c, u, -5 + i * 2.4, -0.3, 1, 1, acc);
    R(c, u, -7.2, -0.6, 1, 1, EYE);
  },
  panfish(c, u, col, acc) {
    const dk = shade(col, -0.22), lt = shade(col, 0.2);
    R(c, u, -3, -3, 6, 6, col); R(c, u, -2.5, -3.5, 5, 1, col); R(c, u, -2.5, 3, 5, 0.8, dk);
    R(c, u, -3, -3, 6, 1, lt); R(c, u, -4, -1.5, 1, 3, col);
    R(c, u, 3, -2, 1.6, 4, col); R(c, u, 4.4, -2.6, 1, 2, col); R(c, u, 4.4, 1.2, 1, 2, col);
    R(c, u, -1, -4, 4, 1, dk); R(c, u, -2.5, 3, 3, 1, acc); R(c, u, -3.4, -1, 1.4, 2, acc);
    R(c, u, -2.6, -1.2, 1, 1, EYE); R(c, u, -1, -0.5, 3, 1, shade(col, 0.1));
  },
  trout(c, u, col, acc) {
    const dk = shade(col, -0.2), lt = shade(col, 0.2);
    R(c, u, -6, -1.8, 11, 3.6, col); R(c, u, -6, -1.8, 11, 1, lt); R(c, u, -6, 1.1, 11, 1, dk);
    R(c, u, -7, -1, 1, 2.4, col);
    R(c, u, 5, -1.8, 1.6, 3.6, col); R(c, u, 6.4, -2.6, 1, 2.2, col); R(c, u, 6.4, 1, 1, 2.2, col);
    R(c, u, -2, -2.8, 3, 1, dk); R(c, u, 3, -2.2, 1.4, 0.8, dk);
    R(c, u, -2, 1.8, 2, 1, acc); R(c, u, -6, -0.4, 11, 1, acc);
    for (let i = 0; i < 5; i++) R(c, u, -4 + i * 1.8, -1.2, 0.8, 0.8, dk);
    R(c, u, -5.4, -0.8, 1, 1, EYE);
  },
  salmon(c, u, col, acc) {
    const dk = shade(col, -0.2), lt = shade(col, 0.18);
    R(c, u, -6.5, -2, 12, 4, col); R(c, u, -4, -2.6, 5, 1, col); R(c, u, -6.5, -2, 12, 1, lt); R(c, u, -6.5, 1.3, 12, 1, dk);
    R(c, u, -7.6, -1, 1.2, 2.6, col);
    R(c, u, 5.5, -2, 1.6, 4, col); R(c, u, 6.9, -2.8, 1, 2.4, col); R(c, u, 6.9, 1.2, 1, 2.4, col);
    R(c, u, -1, -3.2, 3, 1, dk); R(c, u, 3.5, -2.4, 1.4, 0.8, dk);
    R(c, u, -2, 2, 2, 1, acc); for (let i = 0; i < 5; i++) R(c, u, -3 + i * 1.7, -1.4, 0.8, 0.8, dk);
    R(c, u, -6, -0.8, 1, 1, EYE);
  },
  sturgeon(c, u, col, acc) {
    const lt = shade(col, 0.14), dk = shade(col, -0.18);
    R(c, u, -6, -1.2, 11, 2.4, col); R(c, u, -6, -1.2, 11, 1, lt); R(c, u, -6, 0.8, 11, 0.8, dk);
    R(c, u, -9, -0.4, 3, 1.2, col); R(c, u, -9.8, 0.1, 1, 0.7, col);
    R(c, u, 5, -1.4, 1.4, 1.8, col); R(c, u, 6.2, -2.2, 1, 1.6, col); R(c, u, 4.6, 1.2, 1.6, 0.8, col);
    for (let i = 0; i < 6; i++) R(c, u, -5 + i * 1.7, -1.7, 0.9, 0.7, acc);
    R(c, u, -7.5, 1, 1, 0.8, acc); R(c, u, -6.6, 1, 1, 0.8, acc);
    R(c, u, -6.4, -0.4, 1, 1, EYE);
  },
  catfish(c, u, col, acc) {
    const lt = shade(col, 0.16), dk = shade(col, -0.2);
    R(c, u, -6, -1.6, 10, 3.4, col); R(c, u, -6.5, -1.2, 1, 2.8, col); R(c, u, -6, -1.6, 10, 1, lt); R(c, u, -6, 1, 10, 1, dk);
    R(c, u, 4, -1.8, 1.6, 3.8, col); R(c, u, 5.6, -2.4, 1, 3, col);
    R(c, u, -1, -2.6, 3, 1, dk); R(c, u, -2, 1.9, 2, 1, acc);
    R(c, u, -8, -1.4, 2, 1, acc); R(c, u, -8, 0.6, 2, 1, acc); R(c, u, -7.5, -0.6, 1.5, 1, acc);
    R(c, u, -5.6, -0.7, 1, 1, EYE);
  },
  minnow(c, u, col, acc) {
    const dk = shade(col, -0.2),
      lt = shade(col, 0.2);
    R(c, u, -6, -1.5, 11, 3, col); R(c, u, -6, -1.5, 11, 1, lt); R(c, u, -6, 1.1, 11, 0.9, dk);
    R(c, u, -7, -0.7, 1, 1.4, col); R(c, u, -7.7, -0.2, 0.8, 0.8, col);
    R(c, u, 5, -1.4, 1.6, 2.8, col); R(c, u, 6.6, -2.2, 1, 1.8, col); R(c, u, 6.6, 0.4, 1, 1.8, col);
    R(c, u, 0.5, -2.4, 2.4, 1, dk);
    R(c, u, -2, 1.7, 1.6, 1, acc); R(c, u, 2.4, 1.5, 1.4, 1, acc);
    R(c, u, -5.6, -0.6, 1, 1, EYE);
  },
};

/** Draw a fish centered at (cx, cy). `dir` -1 = facing left (default), 1 = right. */
export function drawFish(
  c: Ctx,
  category: FishCategory,
  cx: number,
  cy: number,
  u: number,
  color: string,
  accent: string,
  dir: -1 | 1 = -1,
): void {
  c.save();
  c.translate(Math.round(cx), Math.round(cy));
  if (dir > 0) c.scale(-1, 1);
  SPRITES[category](c, u, color, accent);
  c.restore();
}
