/**
 * Fish jumping into the aquarium.
 *
 * Adding a species launches it from its swatch in the picker: the little
 * two-colour swatch grows into the fish itself as it leaps, flicks water off
 * its tail on the way, and comes down through the surface of the tank with a
 * splash. Then the tank takes over (src/lib/hobbies/aquarium.ts) and the fish
 * carries on down to its depth, trailing bubbles. Every add is its own jump,
 * so a quick run of taps sends a run of fish in.
 *
 * The leap happens above the page, on one fixed canvas that only exists
 * while something's in the air. It snaps to the tank's pixel grid, so the
 * fish lands in the tank on the same pixels it was drawn on in the air.
 */

import type { Species } from "./aquarium-species";

export interface Point {
  x: number;
  y: number;
}

/** Where a jumping fish is, `t` seconds after it leaves, and how it's moving. */
export interface ArcState extends Point {
  vx: number;
  vy: number;
}

export interface Arc {
  /** Seconds from leaving to hitting the water. */
  duration: number;
  at(t: number): ArcState;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * A thrown arc from `from` to `to`, peaking `lift` px above the higher of the
 * two. Steady sideways speed and constant downward pull, the way anything
 * thrown moves, so it leaves fast, hangs at the top and comes down fast.
 */
export function jumpArc(from: Point, to: Point, lift = 56): Arc {
  const rise = Math.abs(from.y - to.y);
  const h = Math.max(8, lift);
  // y(k) = straight line - 4·b·k(1-k); b puts the top `h` above the higher end.
  const b = (rise / 2 + h + Math.sqrt(h * rise + h * h)) / 2;
  const duration = clamp(
    0.45 + Math.hypot(to.x - from.x, to.y - from.y) / 1600,
    0.55,
    0.95,
  );
  return {
    duration,
    at(t) {
      const k = clamp(t / duration, 0, 1);
      return {
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k - 4 * b * k * (1 - k),
        vx: (to.x - from.x) / duration,
        vy: (to.y - from.y - 4 * b * (1 - 2 * k)) / duration,
      };
    },
  };
}

/**
 * Nose angle along the arc, for a fish facing `dir`: level when moving
 * sideways, tipped up on the way up and down on the way in. Never past 70°.
 */
export function heading(vx: number, vy: number, dir: 1 | -1): number {
  const limit = (70 * Math.PI) / 180;
  return dir * clamp(Math.atan2(vy, Math.abs(vx)), -limit, limit);
}

/** What the tank needs to take a fish over as it hits the water. */
export interface Splash {
  species: Species;
  /** Where it went in, in tank pixels from the tank's left edge. */
  x: number;
  /** The depth it's heading for, in tank pixels. */
  y: number;
  dir: 1 | -1;
  /** Nose angle and downward speed (px/s) as it went in. */
  angle: number;
  speed: number;
}

export interface Launch {
  species: Species;
  /** Drawn length, the same as it'll have in the tank. */
  size: number;
  dir: 1 | -1;
  /** Swatch it leaves from, in viewport pixels. Without one it drops in. */
  swatch?: DOMRect;
  /** Where it goes in, in tank pixels, and the depth it's heading for. */
  entryX: number;
  depth: number;
}

export interface JumpsOptions {
  tank: HTMLCanvasElement;
  /** Size of one drawn pixel, so the leap matches the tank's grid. */
  pix: number;
  /** The fish facing +x on its own canvas, centred, with its size in CSS px. */
  sprite(species: Species, size: number): Sprite;
  /** The fish reaches the water; the tank carries on from here. */
  onSplash(splash: Splash): void;
}

export interface Sprite {
  image: CanvasImageSource;
  width: number;
  height: number;
}

interface Jump extends Launch {
  arc: Arc;
  start: number;
  lastDrip: number;
  /** Page position of the surface where it goes in. */
  entry: Point;
}

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  color: string;
  /** Page y of the water it falls back into, or none. */
  surface: number | null;
}

/** Morph from swatch to fish, s. */
const MORPH = 0.2;
const GRAVITY = 1400;
const DRIP_EVERY = 0.035;
/** How long a poured-out fish is seen falling, s. */
const FALL_LIFE = 0.9;

export interface Jumps {
  launch(launch: Launch): void;
  /** A fish carried out of the tank, falling free from `at` (page pixels)
   *  at velocity `v`, turned `turn` radians. */
  fall(
    fish: { species: Species; size: number; dir: 1 | -1 },
    at: Point,
    v: Point,
    turn: number,
  ): void;
  /** Water pouring over the rim at `at` (page pixels), toward `side`. */
  pour(at: Point, side: 1 | -1, count: number): void;
  /** Drop everything in the air: the tank was emptied. */
  clear(): void;
  /** Fish in the air, so the tank can count them against its limit. */
  readonly pending: number;
}

export function createJumps(options: JumpsOptions): Jumps {
  const { tank, pix, sprite, onSplash } = options;
  const jumps: Jump[] = [];
  /** Fish poured out of a tipped tank, falling away. */
  const fallers: Array<{
    species: Species;
    size: number;
    dir: 1 | -1;
    x: number;
    y: number;
    vx: number;
    vy: number;
    turn: number;
    spin: number;
    born: number;
  }> = [];
  const drops: Drop[] = [];
  let layer: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let raf = 0;
  let last = 0;

  const snap = (v: number) => Math.round(v / pix) * pix;

  /** Splash blues that show on the page around the tank, in either theme. */
  function waterColors(): string[] {
    return document.documentElement.classList.contains("dark")
      ? ["#8ccbe2", "#bfe6f2", "#e6f5fa"]
      : ["#24779c", "#3b8db4", "#5ea9cb"];
  }

  /** Drips can be over the water or the page, so mix in a light one. */
  function dripColors(): string[] {
    return document.documentElement.classList.contains("dark")
      ? ["#8ccbe2", "#e6f5fa"]
      : ["#3b8db4", "#a6d6e8"];
  }

  function ensureLayer(): CanvasRenderingContext2D | null {
    if (ctx && layer?.isConnected) return ctx;
    layer = document.createElement("canvas");
    layer.className = "aq-air";
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

  function spray(
    at: Point,
    now: number,
    count: number,
    surface: number | null,
  ): void {
    const colors = waterColors();
    for (let i = 0; i < count; i++) {
      drops.push({
        x: at.x + (Math.random() - 0.5) * 14,
        y: at.y,
        // A crown: most of it straight up, a little thrown wide.
        vx: (Math.random() - 0.5) * 300,
        vy: -170 - Math.random() * 260,
        born: now,
        life: 1,
        size: Math.random() < 0.75 ? pix : pix / 2,
        color: colors[i % colors.length],
        surface,
      });
    }
  }

  function launch(spec: Launch): void {
    const now = performance.now();
    const box = tank.getBoundingClientRect();
    const sx = window.scrollX;
    const sy = window.scrollY;
    const entry = { x: box.left + spec.entryX + sx, y: box.top + sy };
    const from = spec.swatch
      ? {
          x: spec.swatch.left + spec.swatch.width / 2 + sx,
          y: spec.swatch.top + spec.swatch.height / 2 + sy,
        }
      : { x: entry.x, y: entry.y - 70 };
    const arc = jumpArc(from, entry, spec.swatch ? 56 : 18);
    jumps.push({ ...spec, arc, start: now, lastDrip: 0, entry });
    if (!raf) {
      last = now;
      raf = requestAnimationFrame(frame);
    }
  }

  function draw(c: CanvasRenderingContext2D, jump: Jump, t: number): void {
    const { x, y, vx, vy } = jump.arc.at(t);
    const box = tank.getBoundingClientRect();
    // Page to screen, then onto the tank's pixel grid.
    const gx = box.left + snap(x - window.scrollX - box.left);
    const gy = box.top + snap(y - window.scrollY - box.top);
    const m = jump.swatch ? clamp(t / MORPH, 0, 1) : 1;
    const turn = heading(vx, vy, jump.dir) * m;
    const len = jump.size;

    c.save();
    c.translate(gx, gy);
    c.rotate(turn);
    if (m < 1 && jump.swatch) {
      // The swatch, 60/40 like its CSS, growing as it fades.
      const grow = 1 + (len / jump.swatch.width - 1) * m;
      const w = jump.swatch.width * grow;
      const h = jump.swatch.height * grow;
      c.globalAlpha = 1 - m;
      c.fillStyle = jump.species.color;
      c.fillRect(-w / 2, -h / 2, w * 0.6, h);
      c.fillStyle = jump.species.accent;
      c.fillRect(-w / 2 + w * 0.6, -h / 2, w * 0.4, h);
    }
    if (m > 0) {
      const art = sprite(jump.species, len);
      const start = jump.swatch ? jump.swatch.width / len : 1;
      const scale = start + (1 - start) * m;
      c.globalAlpha = m;
      c.scale(jump.dir * scale, scale);
      c.drawImage(
        art.image,
        -art.width / 2,
        -art.height / 2,
        art.width,
        art.height,
      );
    }
    c.restore();
  }

  function frame(now: number): void {
    const c = ensureLayer();
    if (!c || !layer) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (layer.width !== Math.round(w * dpr)) layer.width = Math.round(w * dpr);
    if (layer.height !== Math.round(h * dpr))
      layer.height = Math.round(h * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, w, h);

    for (let i = jumps.length - 1; i >= 0; i--) {
      const jump = jumps[i];
      const t = (now - jump.start) / 1000;
      if (t >= jump.arc.duration) {
        const end = jump.arc.at(jump.arc.duration);
        jumps.splice(i, 1);
        spray(jump.entry, now, 18, jump.entry.y);
        onSplash({
          species: jump.species,
          x: jump.entryX,
          y: jump.depth,
          dir: jump.dir,
          angle: heading(end.vx, end.vy, jump.dir),
          speed: Math.max(0, end.vy),
        });
        continue;
      }
      // Water flicks off its tail once it's clear of the swatch.
      if (t > MORPH && t - jump.lastDrip > DRIP_EVERY) {
        jump.lastDrip = t;
        const at = jump.arc.at(t);
        // It faces the way it's going, so its tail is straight back.
        const speed = Math.hypot(at.vx, at.vy) || 1;
        const back = jump.size * 0.45;
        const colors = dripColors();
        drops.push({
          x: at.x - (at.vx / speed) * back,
          y: at.y - (at.vy / speed) * back,
          vx: at.vx * 0.12 + (Math.random() - 0.5) * 80,
          vy: at.vy * 0.12 - Math.random() * 60,
          born: now,
          life: 0.45 + Math.random() * 0.25,
          size: Math.random() < 0.5 ? pix : pix / 2,
          color: colors[Math.floor(Math.random() * colors.length)],
          surface: null,
        });
      }
      draw(c, jump, t);
    }

    const box = tank.getBoundingClientRect();
    for (let i = fallers.length - 1; i >= 0; i--) {
      const f = fallers[i];
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.turn += f.spin * dt;
      const age = (now - f.born) / 1000;
      if (age > FALL_LIFE) {
        fallers.splice(i, 1);
        continue;
      }
      const art = sprite(f.species, f.size);
      c.save();
      c.globalAlpha =
        1 - clamp((age - FALL_LIFE * 0.55) / (FALL_LIFE * 0.45), 0, 1);
      c.translate(f.x - window.scrollX, f.y - window.scrollY);
      c.rotate(f.turn);
      c.scale(f.dir, 1);
      c.drawImage(
        art.image,
        -art.width / 2,
        -art.height / 2,
        art.width,
        art.height,
      );
      c.restore();
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.vy += GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const age = (now - d.born) / 1000;
      // Gone when it's had its time, or it has fallen back into the water.
      if (age > d.life || (d.surface !== null && d.vy > 0 && d.y > d.surface)) {
        drops.splice(i, 1);
        continue;
      }
      c.globalAlpha = Math.min(1, (1 - age / d.life) * 3);
      c.fillStyle = d.color;
      const gx = box.left + snap(d.x - window.scrollX - box.left);
      const gy = box.top + snap(d.y - window.scrollY - box.top);
      c.fillRect(gx, gy, d.size, d.size);
    }
    c.globalAlpha = 1;

    if (jumps.length || drops.length || fallers.length)
      raf = requestAnimationFrame(frame);
    else teardown();
  }

  function wake(): void {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  return {
    launch,
    fall(fish, at, v, turn) {
      fallers.push({
        ...fish,
        x: at.x,
        y: at.y,
        vx: v.x,
        vy: v.y,
        turn,
        spin: fish.dir * (2 + Math.random() * 4),
        born: performance.now(),
      });
      wake();
    },
    pour(at, side, count) {
      const now = performance.now();
      const colors = waterColors();
      for (let i = 0; i < count; i++) {
        drops.push({
          x: at.x,
          y: at.y + Math.random() * pix * 2,
          vx: side * (60 + Math.random() * 160),
          vy: -60 + Math.random() * 90,
          born: now,
          life: 0.7 + Math.random() * 0.3,
          size: Math.random() < 0.7 ? pix : pix / 2,
          color: colors[Math.floor(Math.random() * colors.length)],
          surface: null,
        });
      }
      wake();
    },
    clear() {
      jumps.length = 0;
      drops.length = 0;
      fallers.length = 0;
      teardown();
    },
    get pending() {
      return jumps.length;
    },
  };
}
