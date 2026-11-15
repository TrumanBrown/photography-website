/**
 * The night drive's world (herping.ts): a forest road you drive slowly down
 * at night, drawn in stipple only where the headlights reach.
 *
 * The roadside is made of props, each cut out of one of Truman's photos and
 * stippled like a small plate by the stipple-plates skill (`herping-drive` in
 * its subjects.json): a sword fern clump and three mossy trunks, at several
 * sizes so the pen stays the same from far ahead to right beside the car. The
 * road and fence are drawn here in the same pen: edge lines, centre dashes,
 * puddles, gravel, and a post-and-rail fence on some stretches.
 *
 * Every dot has a fixed rank between 0 and 1 and shows when the light on it
 * (and its share of the density at that distance) is above its rank, so light
 * thins a drawing dot by dot rather than fading it.
 */
import type { HerpCategory } from "./herping-species";

/* ----------------------------------------------------------- the dot file */

/** One size of a prop: its dots, in its own pixels. */
export interface PropSize {
  w: number;
  h: number;
  n: number;
  x: Float32Array;
  y: Float32Array;
  r: Float32Array;
}

/** A prop as stipple.py `build_drive` wrote it. */
export interface Prop {
  name: string;
  /** Height in the world, metres, and width over height. */
  metres: number;
  aspect: number;
  /** Silhouette, for the paper it clears behind it. */
  maskW: number;
  maskH: number;
  mask: Uint8Array;
  /** Smallest first. */
  sizes: PropSize[];
}

/** Read a `.bin` from stipple.py's `build_drive`. Null if it isn't one. */
export function parseDrive(buf: ArrayBuffer): Prop[] | null {
  if (buf.byteLength < 8) return null;
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "DRIV") return null;
  if (view.getUint16(4, true) !== 1) return null;
  const count = view.getUint16(6, true);
  let at = 8;
  const props: Prop[] = [];
  try {
    for (let p = 0; p < count; p++) {
      const len = view.getUint8(at++);
      const name = String.fromCharCode(...bytes.subarray(at, at + len));
      at += len;
      const metres = view.getFloat32(at, true);
      const aspect = view.getFloat32(at + 4, true);
      const maskW = view.getUint16(at + 8, true);
      const maskH = view.getUint16(at + 10, true);
      at += 12;
      const mask = bytes.slice(at, at + maskW * maskH);
      at += maskW * maskH;
      const nSizes = view.getUint8(at++);
      const sizes: PropSize[] = [];
      for (let s = 0; s < nSizes; s++) {
        const w = view.getUint16(at, true);
        const h = view.getUint16(at + 2, true);
        const n = view.getUint32(at + 4, true);
        at += 8;
        const x = new Float32Array(n);
        const y = new Float32Array(n);
        const r = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          x[i] = view.getUint16(at + i * 2, true) / 16;
          y[i] = view.getUint16(at + n * 2 + i * 2, true) / 16;
          r[i] = view.getUint8(at + n * 4 + i) / 64;
        }
        at += n * 5;
        sizes.push({ w, h, n, x, y, r });
      }
      props.push({ name, metres, aspect, maskW, maskH, mask, sizes });
    }
  } catch {
    return null;
  }
  return props.length === count ? props : null;
}

/* ------------------------------------------------------------- the camera */

/** The road: half its width, where the car sits on it, how high the eye is. */
export const ROAD = {
  half: 3.2,
  camX: 1.5,
  camH: 1.45,
  /** Slow road-cruising speed, metres a second (about 12 km/h). */
  speed: 3.2,
};

/** How far ahead anything is drawn, metres. */
export const FAR = 95;

/** The pen: the drawn dots' radius, and the area one dot stands for at full density. */
export const PEN = 0.75;
export const PEN_AREA = 0.866 * (2.15 * PEN) ** 2;

export interface Camera {
  W: number;
  H: number;
  /** Focal length, px. */
  f: number;
  /** Screen row of the horizon. */
  horizon: number;
  /** Where the car is along the road, metres. */
  z: number;
}

export function camera(W: number, H: number, z: number): Camera {
  // A phone's frame is nearly square: a longer lens, so the verges fill it.
  return { W, H, f: W * (W < 600 ? 1.05 : 0.6), horizon: H * 0.42, z };
}

/** Distance ahead of the car to the bottom of the screen. */
export function nearest(c: Camera): number {
  return (c.f * ROAD.camH) / (c.H - c.horizon);
}

/** A world point (x across, h up, z along) on screen, and px per metre there. */
export function project(
  c: Camera,
  x: number,
  h: number,
  z: number,
): { x: number; y: number; s: number } {
  const s = c.f / (z - c.z);
  return {
    x: c.W / 2 + (x - ROAD.camX) * s,
    y: c.horizon + (ROAD.camH - h) * s,
    s,
  };
}

/* -------------------------------------------------------------- the light */

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The low beams, fixed: full on the road and verges ahead, a cone that
 * widens with distance, reaching higher up the trunks further away, and gone
 * by about 60 m. `xr` is across from the car, `h` up, `dz` ahead, metres.
 */
export function lowBeam(xr: number, h: number, dz: number): number {
  if (dz <= 0.5) return 0;
  const range = smooth((62 - dz) / 30);
  const cone = 2.4 + 0.6 * dz;
  const across = smooth((cone - Math.abs(xr)) / (0.45 * cone));
  const reach = 1.4 + 0.2 * dz;
  const up = smooth((reach + 2 - h) / 2);
  return range * across * up;
}

/** The steerable spotlight on screen. */
export interface Beam {
  x: number;
  y: number;
}

/** The spotlight's radii on screen, px: an ellipse a little wider than tall. */
export function spotRadii(c: Camera): [number, number] {
  const rx = Math.min(c.W, c.H * 1.8) * (c.W < 600 ? 0.3 : 0.22);
  return [rx, rx * 0.75];
}

/** Distance from the spotlight's middle on screen, 1 at its rim. */
export function spotDistance(c: Camera, beam: Beam, x: number, y: number) {
  const rx = Math.min(c.W, c.H * 1.8) * (c.W < 600 ? 0.3 : 0.22);
  const dx = (x - beam.x) / rx;
  const dy = (y - beam.y) / (rx * 0.75);
  return Math.sqrt(dx * dx + dy * dy);
}

/** The spotlight's light: full, then a soft rim, and it carries about 90 m. */
export function spotAt(
  c: Camera,
  beam: Beam,
  x: number,
  y: number,
  dz: number,
): number {
  if (dz > 92) return 0;
  const d = spotDistance(c, beam, x, y);
  if (d >= 1) return 0;
  return smooth((1 - d) / 0.5) * smooth((92 - dz) / 50);
}

/** All the light on a point: `xr`, `h`, `dz` in the world, `x`, `y` on screen. */
export function lightAt(
  c: Camera,
  beam: Beam,
  xr: number,
  h: number,
  dz: number,
  x: number,
  y: number,
): number {
  return Math.min(1, Math.max(lowBeam(xr, h, dz), spotAt(c, beam, x, y, dz)));
}

/**
 * Eyeshine: how strongly a pair of eyes on the road catches the light.
 * Brightest in the spotlight, still a glint in the low beams far past where
 * they light the road (eyes reflect what lights them), and a faint tell just
 * past the spotlight's rim. It never fades as the light comes on.
 */
export function eyeshine(
  c: Camera,
  beam: Beam,
  xr: number,
  dz: number,
  x: number,
  y: number,
): number {
  const d = spotDistance(c, beam, x, y);
  const range = smooth((90 - dz) / 50);
  const tell = 0.42 * smooth((1.75 - d) / 0.75) * range;
  const spot = spotAt(c, beam, x, y, dz) * 1.2;
  const low = 0.85 * lowBeam(xr, 0, Math.min(dz, 24)) * range;
  return Math.min(1, Math.max(tell, spot, low));
}

/** A steady pseudo-random number in [0, 1) for a dot, the same every frame. */
export function threshold(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** A small seeded random generator. */
export function rng(seed: number): () => number {
  let s = Math.floor(Math.abs(seed)) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/* -------------------------------------------------------------- the world */

/** The road is built in stretches this long, each from its own seed. */
export const TILE = 20;

/**
 * How a mark's dots shrink with distance (their screen area): on the ground,
 * foreshortened; facing the car, like a post; or along the road, like a
 * rail's side.
 */
export const Lie = { Ground: 0, Facing: 1, Along: 2 } as const;

/** A prop stood on the verge. */
export interface Placed {
  prop: number;
  x: number;
  z: number;
  scale: number;
  mirror: boolean;
  seed: number;
}

/** A post of the fence; its rail runs to the next post up the road. */
export interface Post {
  x: number;
  z: number;
}

/** Numbers per mark: x, h, z, the world area its dot stands for (m²), tone, `Lie`, rank. */
export const MARK = 7;

export interface Tile {
  /** Road marks, `MARK` numbers each. */
  marks: Float32Array;
  count: number;
  placed: Placed[];
  posts: Post[];
}

/** Kinds of prop the tile builder asks for, by name in the dot file. */
export const FERNS = ["fern"];
export const TRUNKS = ["maple", "alder", "mossy"];

/** Build one stretch of road. `index` is which stretch, `salt` which road. */
export function buildTile(
  index: number,
  salt: number,
  props: readonly Pick<Prop, "name">[],
): Tile {
  const R = rng(index * 7919 + salt * 104729 + 17);
  const z0 = index * TILE;
  const marks: number[] = [];
  const mark = (
    x: number,
    h: number,
    z: number,
    area: number,
    tone: number,
    lie: number,
  ) => marks.push(x, h, z, area, tone, lie, R());
  const { half } = ROAD;

  // Puddles first, so the grit can leave them clear: still dark water with a
  // lit wet rim, and the headlights caught across it as short streaks.
  const pools: Array<[number, number, number, number]> = [];
  const count = R() < 0.7 ? 1 + (R() < 0.35 ? 1 : 0) : 0;
  for (let p = 0; p < count; p++) {
    const px = (R() * 2 - 1) * (half - 0.9);
    const pz = z0 + 2 + R() * (TILE - 4);
    const rx = 0.5 + R() * 0.55;
    const rz = 1.0 + R() * 1.4;
    pools.push([px, pz, rx, rz]);
    const k = R() * 6;
    const n = Math.round((2 * Math.PI * Math.max(rx, rz)) / 0.02);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const wob = 1 + 0.1 * Math.sin(3 * t + k) + 0.05 * Math.sin(5 * t + k);
      for (const [g, tone] of [
        [1, 0.7],
        [1.05, 0.35],
      ])
        mark(
          px + Math.cos(t) * rx * g * wob,
          0,
          pz + Math.sin(t) * rz * g * wob,
          0.0006,
          tone,
          Lie.Ground,
        );
    }
    for (let st = 0; st < 3; st++) {
      const sz = pz - rz * (0.15 + 0.22 * st);
      const w = rx * (0.55 - 0.13 * st) * (0.8 + 0.4 * R());
      const sx = px + (R() - 0.5) * rx * 0.4;
      for (let x = -w; x <= w; x += 0.018)
        mark(sx + x, 0, sz + (R() - 0.5) * 0.04, 0.0005, 0.85, Lie.Ground);
    }
  }
  const inPool = (x: number, z: number) =>
    pools.some(
      ([px, pz, rx, rz]) => ((x - px) / rx) ** 2 + ((z - pz) / rz) ** 2 < 1.1,
    );

  // Gravel and grit on the road, thicker on the shoulders, leaf litter beyond.
  for (let i = 0; i < 2600; i++) {
    const x = (R() * 2 - 1) * (half + 2.5);
    const edge = Math.abs(x) > half - 0.05;
    const off = Math.abs(x) > half + 0.9;
    const z = z0 + R() * TILE;
    if (inPool(x, z)) continue;
    mark(x, 0, z, 1 / 16, off ? 0.05 : edge ? 0.12 : 0.02, Lie.Ground);
  }
  // Edge lines, both sides, and the centre dashes: 3 m of paint every 12 m.
  const lines: Array<[number, number, number]> = [
    [-half + 0.12, 0, TILE],
    [half - 0.12, 0, TILE],
  ];
  for (let d = 0; d < TILE; d += 12) {
    const start = (d + (index % 2 ? 6 : 0)) % TILE;
    lines.push([0, start, Math.min(TILE, start + 3)]);
  }
  const step = 0.028;
  for (const [cx, a, b] of lines) {
    for (let z = a; z < b; z += step) {
      for (let k = -2; k <= 2; k++) {
        mark(
          cx + k * 0.024 + (R() - 0.5) * 0.012,
          0,
          z0 + z + (R() - 0.5) * step,
          step * 0.024,
          0.55,
          Lie.Ground,
        );
      }
    }
  }
  // The verges: sword ferns at the road's edge, trunks further back.
  const ids = (names: string[]) =>
    names
      .map((n) => props.findIndex((p) => p.name === n))
      .filter((i) => i >= 0);
  const ferns = ids(FERNS);
  const trunks = ids(TRUNKS);
  const fenced = R() < 0.5;
  const placed: Placed[] = [];
  for (const side of [-1, 1]) {
    const fence = side > 0 && fenced;
    // Two rows of ferns: one along the edge, one further back among the trees.
    if (ferns.length)
      for (const [near, gap] of [
        [fence ? 1.1 : 0.5, 1.9],
        [3.2, 2.8],
      ])
        for (let z = R() * gap; z < TILE; z += gap * (0.7 + R() * 0.7)) {
          placed.push({
            prop: ferns[Math.floor(R() * ferns.length)],
            x: side * (half + near + R() * 1.6),
            z: z0 + z,
            scale: 0.85 + R() * 0.55,
            mirror: R() < 0.5,
            seed: Math.floor(R() * 1e6),
          });
        }
    if (trunks.length)
      for (let z = R() * 4; z < TILE; z += 3 + R() * 4) {
        placed.push({
          prop: trunks[Math.floor(R() * trunks.length)],
          x: side * (half + 1.6 + R() * 7.5),
          z: z0 + z,
          scale: 0.85 + R() * 0.4,
          mirror: R() < 0.5,
          seed: Math.floor(R() * 1e6),
        });
      }
  }
  const posts: Post[] = [];
  if (fenced)
    for (let z = 0; z < TILE; z += 2.5)
      posts.push({ x: half + 0.55, z: z0 + z });

  return {
    marks: Float32Array.from(marks),
    count: marks.length / MARK,
    placed,
    posts,
  };
}

/**
 * One post of the fence and the rail from it to the next post up the road,
 * as marks relative to the post's foot (`MARK` numbers each). A square-sawn
 * post with denser edges, a top rail and a middle rail.
 */
export const FENCE: Float32Array = (() => {
  const out: number[] = [];
  const R = rng(4242);
  for (let h = 0.02; h < 1.0; h += 0.022) {
    for (let x = -0.06; x <= 0.06; x += 0.02) {
      const edge = Math.abs(x) > 0.045;
      out.push(
        x + (R() - 0.5) * 0.008,
        h + (R() - 0.5) * 0.01,
        0,
        0.0005,
        edge ? 0.8 : 0.4,
        Lie.Facing,
        R(),
      );
    }
  }
  for (const top of [0.97, 0.55]) {
    for (let z = 0.06; z < 2.5; z += 0.04) {
      for (let k = 0; k < 4; k++) {
        const h = top - k * 0.026;
        out.push(
          -0.06,
          h + (R() - 0.5) * 0.008,
          z + (R() - 0.5) * 0.02,
          0.001,
          k === 0 || k === 3 ? 0.8 : 0.45,
          Lie.Along,
          R(),
        );
      }
    }
  }
  return Float32Array.from(out);
})();

/** Screen area of one road mark at `dz` ahead, px². */
export function markArea(
  c: Camera,
  lie: number,
  area: number,
  xr: number,
  dz: number,
): number {
  const f2 = c.f * c.f;
  if (lie === Lie.Facing) return (f2 * area) / (dz * dz);
  const k = lie === Lie.Ground ? ROAD.camH : Math.max(0.3, Math.abs(xr));
  return (f2 * area * k) / (dz * dz * dz);
}

/**
 * The share of a mark set's dots to show at a distance, so its density on
 * screen stays at `tone` of the pen's full density: all of them where they
 * spread out near the car, fewer as they crowd together far ahead.
 */
export function keepShare(screenArea: number, tone: number): number {
  return Math.min(1, (tone * screenArea) / PEN_AREA);
}

/* ------------------------------------------------------------ the animals */

/** A stippled animal at one size: dots to draw and the paper it sits on, CSS px. */
export interface CritterArt {
  /** Dots x, y, r around the animal's middle, head toward +x. */
  dots: Float32Array;
  /** Discs of paper cleared under it and just round it. */
  holes: Float32Array;
  /** The two eyes, x, y. */
  eyes: [number, number, number, number];
  /** Body length, px. */
  length: number;
}

interface Capsule {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  ra: number;
  rb: number;
}

/** Signed distance to a capsule whose radius tapers from `ra` to `rb`. */
function capsule(c: Capsule, x: number, y: number): number {
  const dx = c.bx - c.ax;
  const dy = c.by - c.ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(
    0,
    Math.min(1, ((x - c.ax) * dx + (y - c.ay) * dy) / len2),
  );
  const px = c.ax + dx * t - x;
  const py = c.ay + dy * t - y;
  return Math.hypot(px, py) - (c.ra + (c.rb - c.ra) * t);
}

const cap = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ra: number,
  rb = ra,
): Capsule => ({ ax, ay, bx, by, ra, rb });

/** A limb out from the body: shoulder, elbow, foot, each side. */
function limbs(
  at: number,
  side: number,
  reach: number,
  bend: number,
  r: number,
): Capsule[] {
  const out: Capsule[] = [];
  for (const s of [-1, 1]) {
    const ex = at + bend * 0.5;
    const ey = s * (side + reach * 0.6);
    out.push(cap(at, s * side * 0.6, ex, ey, r * 1.15, r));
    out.push(cap(ex, ey, ex + bend, s * (side + reach), r, r * 0.8));
  }
  return out;
}

/**
 * Each kind's outline, top down, in units of its length: tail at -0.5, snout
 * at +0.5. Eyes are [x, half the gap between them].
 */
function outline(kind: HerpCategory): {
  parts: Capsule[];
  eye: [number, number];
} {
  switch (kind) {
    case "newt":
      return {
        parts: [
          cap(-0.5, 0, -0.08, 0, 0.012, 0.04),
          cap(-0.1, 0, 0.3, 0, 0.065, 0.06),
          cap(0.3, 0, 0.44, 0, 0.058, 0.045),
          ...limbs(0.24, 0.05, 0.08, 0.05, 0.016),
          ...limbs(-0.04, 0.05, 0.08, -0.05, 0.017),
        ],
        eye: [0.4, 0.04],
      };
    case "lizard":
      return {
        parts: [
          cap(-0.5, 0, 0.0, 0, 0.008, 0.035),
          cap(0.0, 0, 0.3, 0, 0.05, 0.05),
          cap(0.3, 0, 0.47, 0, 0.044, 0.03),
          ...limbs(0.25, 0.04, 0.1, 0.06, 0.013),
          ...limbs(0.02, 0.04, 0.1, -0.06, 0.014),
        ],
        eye: [0.41, 0.032],
      };
    case "frog":
      return {
        parts: [
          cap(-0.12, 0, 0.3, 0, 0.17, 0.15),
          cap(0.3, 0, 0.44, 0, 0.13, 0.08),
          // Hind legs folded beside the body, feet forward.
          ...[-1, 1].flatMap((s) => [
            cap(-0.14, s * 0.12, -0.3, s * 0.26, 0.05, 0.04),
            cap(-0.3, s * 0.26, 0.04, s * 0.27, 0.04, 0.03),
            cap(0.04, s * 0.27, -0.06, s * 0.36, 0.025, 0.02),
          ]),
          ...limbs(0.26, 0.12, 0.08, 0.05, 0.022),
        ],
        eye: [0.36, 0.1],
      };
    case "toad":
      return {
        parts: [
          cap(-0.14, 0, 0.26, 0, 0.2, 0.18),
          cap(0.26, 0, 0.42, 0, 0.15, 0.09),
          ...[-1, 1].flatMap((s) => [
            cap(-0.14, s * 0.14, -0.26, s * 0.26, 0.05, 0.04),
            cap(-0.26, s * 0.26, -0.02, s * 0.28, 0.04, 0.03),
          ]),
          ...limbs(0.22, 0.14, 0.06, 0.05, 0.024),
        ],
        eye: [0.34, 0.11],
      };
    case "snake": {
      const parts: Capsule[] = [];
      const steps = 14;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const y = (t: number) => 0.07 * Math.sin(t * Math.PI * 3);
        const r = (t: number) => 0.006 + 0.024 * Math.min(1, t * 2.5);
        parts.push(cap(t0 - 0.5, y(t0), t1 - 0.5, y(t1), r(t0), r(t1)));
      }
      parts.push(cap(0.46, 0, 0.5, 0, 0.032, 0.022));
      return { parts, eye: [0.47, 0.018] };
    }
    default:
      return {
        parts: [
          cap(-0.5, 0, -0.05, 0, 0.01, 0.036),
          cap(-0.06, 0, 0.3, 0, 0.052, 0.05),
          cap(0.3, 0, 0.36, 0, 0.044, 0.04),
          cap(0.36, 0, 0.48, 0, 0.052, 0.032),
          ...limbs(0.25, 0.045, 0.08, 0.05, 0.014),
          ...limbs(-0.02, 0.045, 0.08, -0.05, 0.015),
        ],
        eye: [0.42, 0.036],
      };
  }
}

/**
 * Stipple an animal `length` px long: dots on a jittered grid a dot's
 * spacing apart, every one along the outline and `tone` (0 to 1) of the ones
 * inside, plus discs of paper that clear the road under it and round it so it
 * reads against the drawing.
 */
export function critterArt(
  kind: HerpCategory,
  length: number,
  tone: number,
  seed: number,
  spacing = 1.6,
): CritterArt {
  const { parts, eye } = outline(kind);
  const R = rng(seed);
  // Wider than life, so a small animal still has an inside to stipple.
  const widen = 1.7;
  const dist = (x: number, y: number) => {
    let d = Infinity;
    for (const p of parts) d = Math.min(d, capsule(p, x, y / widen));
    return d * length;
  };
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;
  for (const p of parts) {
    const r = Math.max(p.ra, p.rb);
    minX = Math.min(minX, p.ax - r, p.bx - r);
    maxX = Math.max(maxX, p.ax + r, p.bx + r);
    maxY = Math.max(
      maxY,
      (Math.abs(p.ay) + r) * widen,
      (Math.abs(p.by) + r) * widen,
    );
  }
  const dots: number[] = [];
  const holes: number[] = [];
  // A little bigger and closer than the roadside's dots, so the animal reads
  // as one denser mass, with a ring of clear paper round it.
  const dotR = spacing * 0.42;
  const inside = 0.45 + 0.45 * tone;
  const pad = spacing * 2.4;
  for (
    let gy = -maxY * length - pad;
    gy <= maxY * length + pad;
    gy += spacing
  ) {
    for (
      let gx = minX * length - pad;
      gx <= maxX * length + pad;
      gx += spacing
    ) {
      const x = gx + (R() - 0.5) * spacing * 0.5;
      const y = gy + (R() - 0.5) * spacing * 0.5;
      const d = dist(x / length, y / length);
      if (d < pad) holes.push(x, y, spacing * 1.1);
      if (d > 0) continue;
      const rim = d > -spacing * 0.9;
      if (rim || R() < inside) dots.push(x, y, dotR * (0.9 + 0.2 * R()));
    }
  }
  // The eyes sit far enough apart to read as a pair, even on a small animal.
  const gap = Math.max(eye[1] * widen * length, 2.6);
  return {
    dots: Float32Array.from(dots),
    holes: Float32Array.from(holes),
    eyes: [eye[0] * length, -gap, eye[0] * length, gap],
    length,
  };
}

/** How pale a hex colour is, 0 to 1. */
export function paleness(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
