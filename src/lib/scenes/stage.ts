/**
 * What every hobby scene (src/lib/scenes/) is built from: dot sets in a
 * plate's own units, affine moves, a camera, easing, and stipple for the
 * props, drawn with the same pen as the plates. Nothing here touches the
 * page, so all of it can be tested.
 *
 * Units are a card plate's pixels (880 × 660). A mini plate's dots are scaled
 * up to match, so a scene runs the same from either.
 */

export const PLATE_W = 880;
export const PLATE_H = 660;

/** Dots of one colour: centres and radii, `n` of them. */
export interface Dots {
  x: Float32Array;
  y: Float32Array;
  r: Float32Array;
  n: number;
}

export type Pt = readonly [number, number];

/* --------------------------------------------------------------- easing */

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** How far `t` is through the span from `a` to `b`, 0 to 1. */
export const seg = (t: number, a: number, b: number) =>
  clamp01((t - a) / (b - a));
export const smoothstep = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (6 * t - 15) + 10);
};
export const easeOut = (x: number, p = 3) => 1 - Math.pow(1 - clamp01(x), p);
export const easeIn = (x: number, p = 3) => Math.pow(clamp01(x), p);
/** Ease out past the end and back, like something set down with a bit of bounce. */
export const backOut = (x: number, s = 1.7) => {
  const t = clamp01(x) - 1;
  return t * t * ((s + 1) * t + s) + 1;
};
/** A damped spring from 0 settling on 1, overshooting and swinging back `swings` times. */
export const spring = (x: number, swings = 2, damp = 0.35) => {
  const t = clamp01(x);
  if (t >= 1) return 1;
  return (
    1 -
    Math.cos(t * Math.PI * (swings + 0.5)) *
      Math.pow(damp, t * swings) *
      (1 - t)
  );
};

/* ---------------------------------------------------------------- moves */

/** Canvas-style affine map: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export type Mat = readonly [number, number, number, number, number, number];

export const ID: Mat = [1, 0, 0, 1, 0, 0];

/** `p` after `q`. */
export function mul(p: Mat, q: Mat): Mat {
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}

/** Applied right to left, like function composition: chain(a, b)(p) = a(b(p)). */
export function chain(...ms: Mat[]): Mat {
  return ms.reduceRight<Mat>((acc, m) => mul(m, acc), ID);
}

export const move = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];

/** Scale about (px, py). */
export const scale = (sx: number, sy = sx, px = 0, py = 0): Mat => [
  sx,
  0,
  0,
  sy,
  px - sx * px,
  py - sy * py,
];

/** Turn by `a` radians about (px, py); positive turns clockwise on screen. */
export function turn(a: number, px = 0, py = 0): Mat {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, -s, c, px - c * px + s * py, py - s * px - c * py];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** How much a map grows areas, as a length: what a dot's radius scales by. */
export const grow = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/* --------------------------------------------------------------- camera */

/**
 * Where the world sits on screen: the world point (fx, fy) is drawn at the
 * screen point (ax, ay), and one plate unit is `s` CSS pixels.
 */
export interface Cam {
  ax: number;
  ay: number;
  fx: number;
  fy: number;
  s: number;
}

export const camMat = (c: Cam): Mat => [
  c.s,
  0,
  0,
  c.s,
  c.ax - c.fx * c.s,
  c.ay - c.fy * c.s,
];

export function toScreen(c: Cam, x: number, y: number): [number, number] {
  return [c.ax + (x - c.fx) * c.s, c.ay + (y - c.fy) * c.s];
}

/** Between two cameras; the zoom moves evenly in log scale, as eyes judge it. */
export function camLerp(a: Cam, b: Cam, k: number): Cam {
  return {
    ax: lerp(a.ax, b.ax, k),
    ay: lerp(a.ay, b.ay, k),
    fx: lerp(a.fx, b.fx, k),
    fy: lerp(a.fy, b.fy, k),
    s: a.s * Math.pow(b.s / a.s, k),
  };
}

/** The same view, `k` times closer, holding the world point (x, y) still. */
export function closer(c: Cam, k: number, x: number, y: number): Cam {
  const [sx, sy] = toScreen(c, x, y);
  return { ax: sx, ay: sy, fx: x, fy: y, s: c.s * k };
}

/**
 * Diving into the world point (tx, ty): it glides from wherever `from` shows
 * it to (cx, cy) while the zoom eases from `from.s` to `s1` and comes to a
 * stop there, `u` of the way through (0 to 1).
 */
export function dive(
  from: Cam,
  tx: number,
  ty: number,
  s1: number,
  u: number,
  cx: number,
  cy: number,
): Cam {
  const [px, py] = toScreen(from, tx, ty);
  const zoom = smootherstep(u);
  const glide = smootherstep(u / 0.8);
  return {
    ax: lerp(px, cx, glide),
    ay: lerp(py, cy, glide),
    fx: tx,
    fy: ty,
    s: from.s * Math.pow(s1 / from.s, zoom),
  };
}

/* ----------------------------------------------------------------- dice */

/** Small seeded generator, so a scene's props come out the same each time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------- geometry */

export function inPoly(poly: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

export function segDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const k = len ? clamp01(((px - ax) * dx + (py - ay) * dy) / len) : 0;
  return Math.hypot(px - ax - k * dx, py - ay - k * dy);
}

/** Distance from (x, y) to the outline of `poly`. */
export function edgeDist(poly: readonly Pt[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = segDist(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * A polygon set up for many tests, as stipple asks of every candidate dot:
 * whether a point is inside it, and whether it's within `reach` of its
 * outline (no farther than `most`). Edges are filed in a coarse grid, so a
 * point near the outline only checks the one or two edges beside it.
 */
export function outline(poly: readonly Pt[], most = 4) {
  const xs = poly.map(([x]) => x);
  const ys = poly.map(([, y]) => y);
  const x0 = Math.min(...xs) - most;
  const y0 = Math.min(...ys) - most;
  const x1 = Math.max(...xs) + most;
  const y1 = Math.max(...ys) + most;
  const size = 8;
  const gw = Math.ceil((x1 - x0) / size) + 1;
  const gh = Math.ceil((y1 - y0) / size) + 1;
  const cells: number[][] = Array.from({ length: gw * gh }, () => []);
  // And for the inside test, the edges each row of cells crosses: a ray
  // across the shape only ever meets those.
  const rows: number[][] = Array.from({ length: gh }, () => []);
  poly.forEach((b, i) => {
    const a = poly[(i + poly.length - 1) % poly.length];
    const l = Math.floor((Math.min(a[0], b[0]) - most - x0) / size);
    const r = Math.floor((Math.max(a[0], b[0]) + most - x0) / size);
    const t = Math.floor((Math.min(a[1], b[1]) - most - y0) / size);
    const btm = Math.floor((Math.max(a[1], b[1]) + most - y0) / size);
    for (let j = t; j <= btm; j++) {
      rows[j].push(i);
      for (let k = l; k <= r; k++) cells[j * gw + k].push(i);
    }
  });
  // Inside is read off a mask, filled a row at a time between the edges'
  // crossings, a quarter of a unit fine (coarser for a big shape).
  const res = Math.max(0.25, Math.max(x1 - x0, y1 - y0) / 1600);
  const mw = Math.ceil((x1 - x0) / res) + 1;
  const mh = Math.ceil((y1 - y0) / res) + 1;
  let mask: Uint8Array | null = null;
  const fill = () => {
    const m = new Uint8Array(mw * mh);
    const xs: number[] = [];
    for (let j = 0; j < mh; j++) {
      const y = y0 + (j + 0.5) * res;
      xs.length = 0;
      for (const i of rows[Math.min(gh - 1, Math.floor((y - y0) / size))]) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[(i + poly.length - 1) % poly.length];
        if (yi > y !== yj > y) xs.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil((xs[k] - x0) / res - 0.5));
        const to = Math.min(mw - 1, Math.floor((xs[k + 1] - x0) / res - 0.5));
        if (to >= from) m.fill(1, j * mw + from, j * mw + to + 1);
      }
    }
    return m;
  };
  return {
    inside(x: number, y: number) {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      mask ??= fill();
      return (
        mask[Math.floor((y - y0) / res) * mw + Math.floor((x - x0) / res)] === 1
      );
    },
    near(x: number, y: number, reach: number) {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      const cell =
        cells[Math.floor((y - y0) / size) * gw + Math.floor((x - x0) / size)];
      for (const i of cell) {
        const a = poly[(i + poly.length - 1) % poly.length];
        const b = poly[i];
        if (segDist(x, y, a[0], a[1], b[0], b[1]) < reach) return true;
      }
      return false;
    },
  };
}

/** The point `k` of the way along a polyline, by length, and its heading. */
export function along(
  pts: readonly Pt[],
  k: number,
): { x: number; y: number; angle: number } {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(l);
    total += l;
  }
  let left = clamp01(k) * total;
  for (let i = 1; i < pts.length; i++) {
    const l = lens[i - 1];
    if (left <= l || i === pts.length - 1) {
      const f = l ? Math.min(1, left / l) : 0;
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return {
        x: lerp(x0, x1, f),
        y: lerp(y0, y1, f),
        angle: Math.atan2(y1 - y0, x1 - x0),
      };
    }
    left -= l;
  }
  const [x, y] = pts[pts.length - 1];
  return { x, y, angle: 0 };
}

/* ----------------------------------------------------------------- dots */

export function makeDots(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  r: ArrayLike<number>,
): Dots {
  return {
    x: Float32Array.from(x),
    y: Float32Array.from(y),
    r: Float32Array.from(r),
    n: x.length,
  };
}

export function pick(d: Dots, idx: readonly number[]): Dots {
  return makeDots(
    idx.map((i) => d.x[i]),
    idx.map((i) => d.y[i]),
    idx.map((i) => d.r[i]),
  );
}

export function merge(...sets: Dots[]): Dots {
  const n = sets.reduce((sum, d) => sum + d.n, 0);
  const out = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    r: new Float32Array(n),
    n,
  };
  let at = 0;
  for (const d of sets) {
    out.x.set(d.x.subarray(0, d.n), at);
    out.y.set(d.y.subarray(0, d.n), at);
    out.r.set(d.r.subarray(0, d.n), at);
    at += d.n;
  }
  return out;
}

/** Scale every coordinate and radius, e.g. a mini plate's dots up to card units. */
export function scaleDots(d: Dots, k: number): Dots {
  return {
    x: d.x.map((v) => v * k),
    y: d.y.map((v) => v * k),
    r: d.r.map((v) => v * k),
    n: d.n,
  };
}

export function median(values: ArrayLike<number>): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

export function centroid(d: Dots): [number, number] {
  let x = 0;
  let y = 0;
  for (let i = 0; i < d.n; i++) {
    x += d.x[i];
    y += d.y[i];
  }
  return [x / Math.max(1, d.n), y / Math.max(1, d.n)];
}

/** A part of a plate: outlines its dots sit inside, or a test for them. */
export type PartTest =
  | readonly (readonly Pt[])[]
  | ((x: number, y: number) => boolean);

/**
 * Split a plate's dots into named parts. Each dot goes to the first part that
 * claims it, and anything unclaimed to `rest`.
 */
export function split(
  d: Dots,
  parts: ReadonlyArray<readonly [string, PartTest]>,
): Record<string, Dots> {
  const idx: number[][] = parts.map(() => []);
  const rest: number[] = [];
  for (let i = 0; i < d.n; i++) {
    const x = d.x[i];
    const y = d.y[i];
    const at = parts.findIndex(([, test]) =>
      typeof test === "function"
        ? test(x, y)
        : test.some((poly) => inPoly(poly, x, y)),
    );
    (at < 0 ? rest : idx[at]).push(i);
  }
  const out: Record<string, Dots> = { rest: pick(d, rest) };
  parts.forEach(([name], i) => (out[name] = pick(d, idx[i])));
  return out;
}

/* -------------------------------------------------------------- stipple */

export type Box = readonly [number, number, number, number];

/**
 * Spacing between dots where a plate is as dark as it goes, in dot radii.
 * Measured off the plates: about 2.7 units apart for dots of radius 1.6.
 */
const DENSE = 1.75;

/** A stipple dot's radius for its spacing, the way the plates size theirs. */
export const penSize = (spacing: number, r0: number) =>
  Math.max(0.78 * r0, Math.min(1.15 * r0, 0.46 * spacing));

/**
 * Stipple a shape in the plates' pen: blue-noise dots whose density follows
 * `tone` (0 is bare paper, 1 as dark as the plates go) inside `box`. The
 * plates are relaxed by Lloyd's method; Poisson-disk sampling with a spacing
 * that follows the tone gives the same even, hand-placed look, cheaply.
 */
export function stipple(
  tone: (x: number, y: number) => number,
  box: Box,
  r0: number,
  rand: () => number,
): Dots {
  const dmin = DENSE * r0;
  // Buckets of dots, a couple of spacings wide: pale areas, where dots are
  // far apart, then check a few buckets rather than many tiny cells.
  const cell = 2 * dmin;
  const [x0, y0, x1, y1] = box;
  const gw = Math.max(1, Math.ceil((x1 - x0) / cell));
  const gh = Math.max(1, Math.ceil((y1 - y0) / cell));
  const head = new Int32Array(gw * gh).fill(-1);
  const next: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const ds: number[] = [];
  const active: number[] = [];

  const spacing = (x: number, y: number) => {
    const t = tone(x, y);
    return t < 0.02 ? 0 : dmin / Math.sqrt(Math.min(1, t));
  };
  const clear = (x: number, y: number, d: number) => {
    const gx = Math.floor((x - x0) / cell);
    const gy = Math.floor((y - y0) / cell);
    const reach = Math.ceil(d / cell);
    const top = Math.min(gh - 1, gy + reach);
    const right = Math.min(gw - 1, gx + reach);
    const dd = d * d;
    for (let j = Math.max(0, gy - reach); j <= top; j++)
      for (let i = Math.max(0, gx - reach); i <= right; i++)
        for (let q = head[j * gw + i]; q >= 0; q = next[q]) {
          const dx = xs[q] - x;
          const dy = ys[q] - y;
          if (dx * dx + dy * dy < dd) return false;
        }
    return true;
  };
  const add = (x: number, y: number, d: number) => {
    const gx = Math.min(gw - 1, Math.floor((x - x0) / cell));
    const gy = Math.min(gh - 1, Math.floor((y - y0) / cell));
    const at = gy * gw + gx;
    next.push(head[at]);
    head[at] = xs.length;
    active.push(xs.length);
    xs.push(x);
    ys.push(y);
    ds.push(d);
  };

  const grow = () => {
    while (active.length) {
      const slot = Math.floor(rand() * active.length);
      const p = active[slot];
      let found = false;
      for (let k = 0; k < 16; k++) {
        const a = rand() * Math.PI * 2;
        const dist = ds[p] * (1 + rand());
        const x = xs[p] + Math.cos(a) * dist;
        const y = ys[p] + Math.sin(a) * dist;
        if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
        const d = spacing(x, y);
        if (d && clear(x, y, d)) {
          add(x, y, d);
          found = true;
          break;
        }
      }
      if (!found) {
        active[slot] = active[active.length - 1];
        active.pop();
      }
    }
  };

  // Seed from a fine lattice in random order, growing each seed out before
  // the next: a seed only takes where nothing has reached yet, so even thin
  // or separate pieces of the shape fill, and the spacing stays even.
  const fine = dmin * 0.8;
  const seeds: number[] = [];
  for (let y = y0 + fine / 2; y < y1; y += fine)
    for (let x = x0 + fine / 2; x < x1; x += fine) seeds.push(x, y);
  for (let i = seeds.length / 2 - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [seeds[2 * i], seeds[2 * j]] = [seeds[2 * j], seeds[2 * i]];
    [seeds[2 * i + 1], seeds[2 * j + 1]] = [seeds[2 * j + 1], seeds[2 * i + 1]];
  }
  for (let i = 0; i < seeds.length; i += 2) {
    const x = seeds[i] + (rand() - 0.5) * fine * 0.5;
    const y = seeds[i + 1] + (rand() - 0.5) * fine * 0.5;
    // Most of the shape is filled by now: check that before the tone.
    if (!clear(x, y, dmin)) continue;
    const d = spacing(x, y);
    if (!d || !clear(x, y, d)) continue;
    add(x, y, d);
    grow();
  }

  return makeDots(
    xs,
    ys,
    ds.map((d) => penSize(d, r0) * (1 + 0.06 * (rand() - 0.5))),
  );
}

/**
 * A dotted pen line along `pts`, a dot every `gap` units (by default they
 * nearly touch, so it reads as a line), each nudged a little off it.
 */
export function dotLine(
  pts: readonly Pt[],
  r: number,
  gap = 1.9 * r,
  rand: () => number = Math.random,
  wobble = 0.12,
): Dots {
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    let at = carry;
    for (; at <= len; at += gap) {
      const k = at / len;
      const off = (rand() - 0.5) * 2 * wobble * r;
      xs.push(lerp(ax, bx, k) + nx * off);
      ys.push(lerp(ay, by, k) + ny * off);
      rs.push(r * (1 + 0.08 * (rand() - 0.5)));
    }
    carry = at - len;
  }
  return makeDots(xs, ys, rs);
}

/** A dotted circle, like the plates' bubbles. */
export function dotRing(
  cx: number,
  cy: number,
  radius: number,
  r: number,
  gap = 2.2 * r,
  rand: () => number = Math.random,
): Dots {
  const n = Math.max(5, Math.round((2 * Math.PI * radius) / gap));
  const spin = rand() * Math.PI * 2;
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = spin + ((i + (rand() - 0.5) * 0.2) / n) * Math.PI * 2;
    const reach = radius * (1 + (rand() - 0.5) * 0.04);
    xs.push(cx + Math.cos(a) * reach);
    ys.push(cy + Math.sin(a) * reach);
    rs.push(r * (1 + 0.08 * (rand() - 0.5)));
  }
  return makeDots(xs, ys, rs);
}

/**
 * A spot within `reach` of `near` to dive into: where about `want` dots fall
 * within `size` units, so the dive ends on a screenful of dots that neither
 * thins to bare paper nor runs together into blots.
 */
export function aim(
  d: Dots,
  near: Pt,
  reach: number,
  size = 20,
  want = 110,
): [number, number] {
  let best: [number, number] = [near[0], near[1]];
  let bestScore = -Infinity;
  const step = size / 2;
  for (let y = near[1] - reach; y <= near[1] + reach; y += step)
    for (let x = near[0] - reach; x <= near[0] + reach; x += step) {
      const off = Math.hypot(x - near[0], y - near[1]);
      if (off > reach) continue;
      let count = 0;
      for (let i = 0; i < d.n; i++)
        if (Math.abs(d.x[i] - x) < size && Math.abs(d.y[i] - y) < size) count++;
      // Nearer breaks ties.
      const score = -Math.abs(count - want) / want - (0.15 * off) / reach;
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
  return best;
}

/** The typical radius of the dots within `size` units of (x, y). */
export function radiusNear(d: Dots, x: number, y: number, size: number) {
  const near: number[] = [];
  for (let i = 0; i < d.n; i++)
    if (Math.abs(d.x[i] - x) < size && Math.abs(d.y[i] - y) < size)
      near.push(d.r[i]);
  return near.length ? median(near) : median(d.r);
}

/* ----------------------------------------------------------------- wakes */

/**
 * A grid of points over the screen, `step` CSS px apart, from the top left
 * corner to just past the bottom right one. Holes of 0.75 steps around
 * every point cover the screen between them.
 */
export interface Grid {
  cols: number;
  rows: number;
  step: number;
}

export function screenGrid(w: number, h: number, step: number): Grid {
  return {
    cols: Math.ceil(w / step) + 1,
    rows: Math.ceil(h / step) + 1,
    step,
  };
}

/** The hole size, as a share of the grid step, that leaves no paper. */
export const COVER = 0.75;

/** A figure on screen at a moment: discs as x, y, radius in CSS px. */
export interface Passing {
  t: number;
  discs: ArrayLike<number>;
}

/**
 * When a moving figure's wake reaches each point of `grid`: it spreads out
 * from wherever the figure has been, taking `reach(d)` ms to get `d` px past
 * its edge. With `after`, a point the figure covers doesn't open until it
 * has gone by, plus `after` ms, so the page never shows through the gaps in
 * its dots; otherwise points it passes over open at once.
 */
export function wakeTimes(
  grid: Grid,
  passing: readonly Passing[],
  reach: (d: number) => number,
  after?: number,
): Float32Array {
  const { cols, rows, step } = grid;
  const out = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = i * step;
      const y = j * step;
      let best = Infinity;
      let covered = -Infinity;
      for (const { t, discs } of passing)
        for (let k = 0; k + 2 < discs.length; k += 3) {
          const d = Math.hypot(x - discs[k], y - discs[k + 1]) - discs[k + 2];
          const at = t + (d > 0 ? reach(d) : 0);
          if (at < best) best = at;
          if (d <= 0 && t > covered) covered = t;
        }
      out[j * cols + i] =
        after === undefined ? best : Math.max(best, covered + after);
    }
  return out;
}

/** The latest a point of the grid starts to open. */
export function lastOf(times: Float32Array): number {
  let last = -Infinity;
  for (const v of times) if (v > last) last = v;
  return last;
}

/**
 * The holes open at `t`: each grid point opens over `grow` ms from when the
 * wake reaches it, from a pinprick to a hole that meets its neighbours, so
 * the edge of the wake is a halftone. Writes x, y, r into `out`; returns how
 * many.
 */
export function wakeHoles(
  times: Float32Array,
  grid: Grid,
  t: number,
  grow: number,
  out: Float32Array,
): number {
  const { cols, rows, step } = grid;
  let n = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = (t - times[j * cols + i]) / grow;
      if (k <= 0) continue;
      const r = step * COVER * smootherstep(k);
      if (r < 0.4) continue;
      out[n * 3] = i * step;
      out[n * 3 + 1] = j * step;
      out[n * 3 + 2] = r;
      n++;
    }
  return n;
}

/** A grid step that suits the screen: finer on a phone. */
export const wakeStep = (w: number, h: number) =>
  Math.max(13, Math.min(22, Math.min(w, h) / 40));

/**
 * How far a figure has to travel along (dx, dy) until every one of its
 * points is off the screen, by `margin` px; `at(k)` gives its points (x, y
 * pairs, CSS px) having gone `k` of the way along a unit move.
 */
export function exitDistance(
  at: (k: number) => ArrayLike<number>,
  w: number,
  h: number,
  margin = 40,
  most = 6000,
): number {
  const gone = (k: number) => {
    const pts = at(k);
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const x = pts[i];
      const y = pts[i + 1];
      if (x > -margin && x < w + margin && y > -margin && y < h + margin)
        return false;
    }
    return true;
  };
  let lo = 0;
  let hi = 1;
  while (!gone(hi) && hi < most) hi *= 2;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (gone(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * CSS's cubic-bezier(x1, y1, x2, y2) timing function, so a motion drawn on a
 * canvas can match one CSS plays exactly.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let u = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

/** CSS's `ease-in-out`. */
export const cssEaseInOut = cubicBezier(0.42, 0, 0.58, 1);
