/**
 * A first find hopping into the field journal, shared by tide pooling and the
 * night drive (FieldJournal.astro).
 *
 * When the card closes on a first find, a copy of the animal springs off from
 * where it was found and arcs up to the journal's count, shrinking to the size
 * of the figure and going to ink as it comes down. The count rolls, the rule
 * fills and the count dips under it as it lands, not before. Every find is its
 * own hop, so two quick finds send two and the count goes up as each lands.
 * On a phone with the count scrolled off the top, the copy hops off the top
 * edge and the count changes as it goes.
 *
 * Like the aquarium's jumps (aquarium-jump.ts, whose jumpArc it uses), it
 * flies on one fixed canvas (`.j-air`, styled in FieldJournal.astro) that
 * only exists while something's in the air, snapped to the toy's own grid.
 * The pure parts (hopScale, hopInk, landDip, landFrames, hopTarget, hopLift)
 * are tested in journal-hop.test.ts.
 */
import { jumpArc, type Arc, type Point } from "./aquarium-jump";
import { rollTo, setHair } from "../motion";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const easeOutQuad = (k: number) => 1 - (1 - k) ** 2;
const easeInOut = (k: number) =>
  k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);

/** The sprite's size along the hop, `k` 0 to 1: full size as it leaves,
 *  shrinking from a third of the way to `end` of that as it lands. */
export function hopScale(k: number, end = 0.4): number {
  const s = clamp((k - 0.3) / 0.7, 0, 1);
  return 1 - (1 - end) * easeInOut(s);
}

/** How far it has gone to ink, `k` 0 to 1: its own colours most of the
 *  way, ink as it comes down into the count. */
export function hopInk(k: number): number {
  return easeInOut(clamp((k - 0.55) / 0.4, 0, 1));
}

/** How long the count dips as a find lands in it, ms. */
export const LAND_MS = 180;

/** The count's dip as the find lands in it, px down, `t` s after. */
export function landDip(t: number): number {
  if (t <= 0 || t >= LAND_MS / 1000) return 0;
  return t < 0.05
    ? 2 * easeOutQuad(t / 0.05)
    : 2 * (1 - easeInOut((t - 0.05) / 0.13));
}

/** The dip as keyframes for the count's holder. */
export function landFrames(): Keyframe[] {
  return [0, 0.25, 0.5, 0.75, 1].map((offset) => ({
    offset,
    transform: `translateY(${landDip((offset * LAND_MS) / 1000)}px)`,
  }));
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a hop lands, in viewport px: the middle of the count, or just past
 * the edge of the screen nearest it when it's scrolled off (a phone).
 */
export function hopTarget(count: Box, vh: number): Point {
  const bottom = count.top + count.height;
  return {
    x: count.left + count.width / 2,
    y:
      bottom < 0
        ? -24
        : count.top > vh
          ? vh + 24
          : count.top + count.height / 2,
  };
}

/**
 * How far above the higher end the arc peaks, px: a different height each
 * time, but its top stays on the screen when the count is near the top edge.
 */
export function hopLift(toY: number, rand: () => number = Math.random): number {
  return Math.max(8, Math.min(40 + rand() * 36, toY - 14));
}

export interface HopSprite {
  /** The find as it looks in the toy, centred on a canvas `size` CSS px
   *  square. */
  color: HTMLCanvasElement;
  /** The same as an ink silhouette, which it turns into as it comes down.
   *  Without one it stays as it is all the way. */
  ink?: HTMLCanvasElement;
  size: number;
}

export interface Find {
  sprite: HopSprite;
  /** Where it leaves from, viewport px. */
  from: Point;
  /** Its size when it lands, as a share of `sprite.size`. */
  end: number;
}

export interface JournalOptions {
  /** The FieldJournal's count and rule. */
  count: HTMLElement;
  bar: HTMLElement;
  total: number;
  /** How many species are logged, so the count never runs past it. */
  found(): number;
  /** The toy's canvas, whose grid the hop snaps to, and that grid's size. */
  grid: () => HTMLElement;
  pix: number;
  /** Smooth the sprite as it shrinks (a stipple), or keep its pixels hard. */
  smooth?: boolean;
}

export interface JournalHop {
  /** Show `n` now: on load, and under reduced motion as a find is logged. */
  show(n: number): void;
  /** Send a first find into the count, which goes up by one as it lands.
   *  False when neither end is on screen, and the count changes at once. */
  hop(find: Find): boolean;
  readonly pending: number;
}

interface Hop extends Find {
  arc: Arc;
  start: number;
}

export function journalHop(options: JournalOptions): JournalHop {
  const { count, bar, total, found, grid, pix, smooth = false } = options;
  const hops: Hop[] = [];
  let shown = 0;
  let layer: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let raf = 0;

  const snap = (v: number) => Math.round(v / pix) * pix;

  function show(n: number): void {
    shown = n;
    rollTo(count, n);
    setHair(bar, n / total);
  }

  function land(): void {
    show(Math.min(found(), shown + 1));
    count.parentElement?.animate?.(landFrames(), { duration: LAND_MS });
  }

  function ensureLayer(): CanvasRenderingContext2D | null {
    if (ctx && layer?.isConnected) return ctx;
    layer = document.createElement("canvas");
    layer.className = "j-air";
    layer.setAttribute("aria-hidden", "true");
    document.body.append(layer);
    ctx = layer.getContext("2d");
    return ctx;
  }

  function teardown(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    layer?.remove();
    layer = null;
    ctx = null;
  }

  function frame(now: number): void {
    raf = 0;
    const c = ensureLayer();
    if (!c || !layer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (layer.width !== Math.round(w * dpr)) layer.width = Math.round(w * dpr);
    if (layer.height !== Math.round(h * dpr))
      layer.height = Math.round(h * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = smooth;
    c.clearRect(0, 0, w, h);
    const box = grid().getBoundingClientRect();

    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i];
      const t = (now - hop.start) / 1000;
      if (t >= hop.arc.duration) {
        hops.splice(i, 1);
        land();
        continue;
      }
      const k = clamp(t / hop.arc.duration, 0, 1);
      const at = hop.arc.at(t);
      // Page to screen, then onto the toy's grid.
      const gx = box.left + snap(at.x - window.scrollX - box.left);
      const gy = box.top + snap(at.y - window.scrollY - box.top);
      const size = hop.sprite.size * hopScale(k, hop.end);
      const x = Math.round(gx - size / 2);
      const y = Math.round(gy - size / 2);
      const ink = hop.sprite.ink ? hopInk(k) : 0;
      if (ink < 1) {
        c.globalAlpha = 1 - ink;
        c.drawImage(hop.sprite.color, x, y, size, size);
      }
      if (ink > 0 && hop.sprite.ink) {
        c.globalAlpha = ink;
        c.drawImage(hop.sprite.ink, x, y, size, size);
      }
      c.globalAlpha = 1;
    }

    if (hops.length) raf = requestAnimationFrame(frame);
    else teardown();
  }

  return {
    show,
    hop(find) {
      const to = hopTarget(count.getBoundingClientRect(), window.innerHeight);
      const vh = window.innerHeight;
      if (
        (find.from.y < -40 || find.from.y > vh + 40) &&
        (to.y < 0 || to.y > vh)
      ) {
        land();
        return false;
      }
      const page = (p: Point) => ({
        x: p.x + window.scrollX,
        y: p.y + window.scrollY,
      });
      hops.push({
        ...find,
        arc: jumpArc(page(find.from), page(to), hopLift(to.y)),
        start: performance.now(),
      });
      if (!raf) raf = requestAnimationFrame(frame);
      return true;
    },
    get pending() {
      return hops.length;
    },
  };
}
