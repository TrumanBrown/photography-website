import {
  clamp01,
  type Dots,
  makeDots,
  type Pt,
  seeded,
  smoothstep,
  stipple,
} from "./stage";

/**
 * The hand that picks up the salamander (herping.ts), in the plates' pen: a
 * left hand palm up, seen from the thumb side and a little below, the wrist
 * at the origin on the palm's surface, fingers along -x curling up at their
 * tips. It's made of tubes, each shaded like a rounded form lit from the
 * upper left, with pen contours, creases at the joints and nails. The thumb
 * and first finger come up around the salamander and are drawn over it; the
 * other fingers show below the first, their nails underneath.
 */

/** A tube's axis, as x, y and radius, and how far toward you it sits. */
interface Tube {
  axis: ReadonlyArray<readonly [number, number, number]>;
  z: number;
}

/** Hand units are card units at the hand's own size. */
const INDEX: Tube = {
  axis: [
    [-200, 38, 27],
    [-236, 36, 25],
    [-345, 31, 22],
    [-408, 14, 20],
    [-442, -10, 18],
  ],
  z: 0,
};
/** Where the first finger leaves the palm. */
const KNUCKLE = -228;
const PALM: Tube = {
  axis: [
    [6, 48, 48],
    [-120, 47, 47],
    [-226, 44, 34],
  ],
  z: -14,
};
const FOREARM: Tube = {
  axis: [
    [0, 50, 48],
    [160, 46, 56],
    [300, 42, 62],
  ],
  z: -8,
};
/** The other fingers, behind the first and lower, seen from a little below. */
const FINGERS: Tube[] = [
  {
    axis: [
      [-232, 46, 24],
      [-356, 43, 22],
      [-430, 28, 20],
      [-466, 4, 17],
    ],
    z: -40,
  },
  {
    axis: [
      [-228, 55, 23],
      [-344, 53, 21],
      [-412, 40, 19],
      [-446, 19, 16],
    ],
    z: -70,
  },
  {
    axis: [
      [-222, 63, 20],
      [-316, 62, 18],
      [-368, 53, 16],
      [-398, 37, 14],
    ],
    z: -96,
  },
];
const THUMB: Tube = {
  axis: [
    [-40, 40, 36],
    [-95, 4, 30],
    [-140, -38, 26],
    [-166, -74, 22],
  ],
  z: 10,
};
/** The thumb's nail faces you, on its last joint. */
const NAIL: ReadonlyArray<readonly [number, number]> = [
  [-150, -53],
  [-167, -78],
];
const NAIL_HALF = 11;
/** The sleeve: a rolled cuff, then the sleeve itself off the screen. */
export const CUFF = 236;
const ROLL: Tube = {
  axis: [
    [CUFF + 8, 44, 70],
    [CUFF + 52, 42, 74],
  ],
  z: 6,
};
const SLEEVE: Tube = {
  axis: [
    [CUFF + 50, 40, 68],
    [480, 32, 74],
  ],
  z: 0,
};

/** Light from the upper left and in front: y is down. */
const LIGHT = (() => {
  const v = [-0.45, -0.62, 0.64];
  const n = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / n);
})();

/** Where a point sits on a tube: how far inside its edge, its height and normal. */
interface Hit {
  inside: number;
  height: number;
  nx: number;
  ny: number;
  nz: number;
}

function onTube(tube: Tube, x: number, y: number, out: Hit): boolean {
  let best = -Infinity;
  let bx = 0;
  let by = 0;
  let bd = 0;
  let br = 1;
  const a = tube.axis;
  for (let i = 1; i < a.length; i++) {
    const [x0, y0, r0] = a[i - 1];
    const [x1, y1, r1] = a[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const u = clamp01(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy));
    const ax = x0 + u * dx;
    const ay = y0 + u * dy;
    const r = r0 + u * (r1 - r0);
    const d = Math.hypot(x - ax, y - ay);
    if (r - d > best) {
      best = r - d;
      bx = x - ax;
      by = y - ay;
      bd = d;
      br = r;
    }
  }
  if (best <= 0) return false;
  const q = bd / br;
  const side = bd > 1e-6 ? q / bd : 0;
  out.inside = best;
  out.nx = bx * side;
  out.ny = by * side;
  out.nz = Math.sqrt(Math.max(0, 1 - q * q));
  out.height = br * out.nz + tube.z;
  return true;
}

/**
 * A group of tubes that join smoothly, like the palm into its finger: the
 * nearest one at a point leads, blended with the others where they meet.
 */
function onGroup(tubes: readonly Tube[], x: number, y: number, out: Hit) {
  const one: Hit = { inside: 0, height: 0, nx: 0, ny: 0, nz: 0 };
  let total = 0;
  let inside = -Infinity;
  let top = -Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (const tube of tubes) {
    if (!onTube(tube, x, y, one)) continue;
    const w = Math.exp(one.height / 7);
    total += w;
    nx += w * one.nx;
    ny += w * one.ny;
    nz += w * one.nz;
    inside = Math.max(inside, one.inside);
    top = Math.max(top, one.height);
  }
  if (!total) return false;
  const n = Math.hypot(nx, ny, nz) || 1;
  out.inside = inside;
  out.height = top;
  out.nx = nx / n;
  out.ny = ny / n;
  out.nz = nz / n;
  return true;
}

const lit = (h: Hit) => h.nx * LIGHT[0] + h.ny * LIGHT[1] + h.nz * LIGHT[2];

/**
 * Skin: nearly bare paper where the light falls full on it, darkest turning
 * away. The dark plates draw light in dots, so there it's the other way.
 */
function skin(h: Hit, dark: boolean): number {
  const light = lit(h);
  if (dark) return 0.1 + 0.62 * Math.pow(clamp01((light + 0.45) / 1.35), 1.1);
  let tone = 0.07 + 0.64 * Math.pow(clamp01((0.92 - light) / 1.42), 1.1);
  // A little reflected light just inside the shadowed edge.
  if (light < 0) tone *= 1 - 0.22 * smoothstep((0.4 - h.nz) / 0.4);
  return tone;
}

/** A pen contour, heavier on the shadowed side. */
const rim = (h: Hit) => h.inside < 1.2 + 1.2 * clamp01(0.5 - lit(h));

/** How close a point is to a line, for creases. */
function nearLine(pts: readonly Pt[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const u = clamp01(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy));
    best = Math.min(best, Math.hypot(x - x0 - u * dx, y - y0 - u * dy));
  }
  return best;
}

/**
 * Short creases across a tube at its joint `j` (an axis point), `from` to
 * `to` of the way across (-1 its top edge, 1 its bottom), bowed toward the
 * tip, `count` of them `gap` apart.
 */
function across(
  tube: Tube,
  j: number,
  from: number,
  to: number,
  count = 2,
  gap = 6,
): Pt[][] {
  const [x, y, r] = tube.axis[j];
  const [nx, ny] = tube.axis[j + 1];
  const len = Math.hypot(nx - x, ny - y);
  const dx = (nx - x) / len;
  const dy = (ny - y) / len;
  // Across the finger, pointing down its back.
  const px = dy > 0 ? dy : -dy;
  const py = dy > 0 ? -dx : dx;
  const lines: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    const o = (i - (count - 1) / 2) * gap;
    const at = (k: number, bow: number): Pt => [
      x + dx * (o + bow) + px * k * r,
      y + dy * (o + bow) + py * k * r,
    ];
    lines.push([at(from, 0), at((from + to) / 2, 2.5), at(to, 0)]);
  }
  return lines;
}

/** Creases at the first finger's joints: on its palm side and over its knuckles. */
const CREASES: Pt[][] = [
  ...across(INDEX, 2, -0.95, -0.35, 2, 6),
  ...across(INDEX, 2, 0.35, 0.95, 3, 5),
  ...across(INDEX, 3, -0.95, -0.4, 1),
  ...across(INDEX, 3, 0.4, 0.95, 2, 5),
];
const FINGER_CREASES: Pt[][] = FINGERS.flatMap((finger) => [
  ...across(finger, 1, 0.35, 0.95, 2, 5),
  ...across(finger, 2, 0.4, 0.95, 1),
]);
/** Wrinkles across the back of the thumb's joints. */
const THUMB_CREASES: Pt[][] = [
  ...across(THUMB, 2, -0.6, 0.6, 3, 5),
  ...across(THUMB, 1, -0.5, 0.5, 2, 6),
];
/** Folds in the rolled cuff and the sleeve. */
const FOLDS: Pt[][] = [
  [
    [CUFF + 22, -24],
    [CUFF + 20, 20],
    [CUFF + 22, 70],
    [CUFF + 26, 108],
  ],
  [
    [CUFF + 38, -28],
    [CUFF + 35, 30],
    [CUFF + 38, 112],
  ],
  [
    [CUFF + 70, -22],
    [CUFF + 100, 10],
    [CUFF + 116, 50],
  ],
  [
    [CUFF + 84, 84],
    [CUFF + 130, 96],
    [CUFF + 170, 100],
  ],
  [
    [CUFF + 150, -30],
    [CUFF + 170, -4],
    [CUFF + 182, 26],
  ],
];

const onAny = (lines: Pt[][], x: number, y: number, w: number) =>
  lines.some((line) => nearLine(line, x, y) < w);

/**
 * A fingernail under a fingertip, facing down: the curl of the tip turned
 * away from the light, past its last joint.
 */
function underNail(
  tube: Tube,
  x: number,
  y: number,
  h: Hit,
  dark: boolean,
): number {
  const n = tube.axis.length;
  const [jx, jy] = tube.axis[n - 2];
  const [tx, ty, tr] = tube.axis[n - 1];
  const along =
    ((x - jx) * (tx - jx) + (y - jy) * (ty - jy)) /
    ((tx - jx) ** 2 + (ty - jy) ** 2);
  if (along < 0.3 || Math.hypot(x - tx, y - ty) > tr + 2) return 0;
  const down = h.ny * 0.8 - h.nx * 0.6;
  if (down > 0.5) return dark ? 0.6 : 0.06;
  if (down > 0.36) return 0.9;
  return 0;
}

export interface HandDots {
  /** Palm, wrist, sleeve and the fingers behind: under the salamander. */
  hand: Dots;
  /** Thumb and first finger: over it. */
  thumb: Dots;
  /**
   * Discs that fill each with paper first: the skin is pale, and its few
   * dots alone would let whatever is behind show through.
   */
  handFill: Dots;
  thumbFill: Dots;
}

/** Discs down a tube's axis, a little inside its edge. */
function fill(tubes: readonly Tube[], inset: number): Dots {
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  for (const { axis } of tubes)
    for (let i = 1; i < axis.length; i++) {
      const [x0, y0, r0] = axis[i - 1];
      const [x1, y1, r1] = axis[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(len / (0.3 * Math.min(r0, r1))));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const u = k / n;
        xs.push(x0 + u * (x1 - x0));
        ys.push(y0 + u * (y1 - y0));
        rs.push(Math.max(0.5, r0 + u * (r1 - r0) - inset));
      }
    }
  return makeDots(xs, ys, rs);
}

export function makeHand(r0: number, dark = false): HandDots {
  const rand = seeded(41);
  const hit: Hit = { inside: 0, height: 0, nx: 0, ny: 0, nz: 0 };
  const near: Hit = { inside: 0, height: 0, nx: 0, ny: 0, nz: 0 };
  const back = [PALM, FOREARM];
  const finger = (x: number, y: number) =>
    x < KNUCKLE && onTube(INDEX, x, y, hit);
  // Creases are lines of ink; on the dark plates, lines of paper.
  const CREASE = dark ? 0 : 0.85;

  const hand = stipple(
    (x, y) => {
      // The thumb and first finger are drawn on their own, over the salamander.
      if (onTube(THUMB, x, y, hit) || finger(x, y)) return 0;
      if (onTube(ROLL, x, y, hit) || onTube(SLEEVE, x, y, hit)) {
        if (rim(hit)) return 1;
        if (onAny(FOLDS, x, y, 1.5)) return 0.9;
        // Cloth: a mid-tone that darkens away from the light.
        const roll = x < CUFF + 54;
        return (roll ? 0.22 : 0.32) + 0.45 * clamp01(0.7 - lit(hit));
      }
      if (onGroup(back, x, y, hit)) {
        if (rim(hit)) return 0.95;
        return skin(hit, dark);
      }
      for (let i = 0; i < FINGERS.length; i++) {
        const tube = FINGERS[i];
        if (!onTube(tube, x, y, hit)) continue;
        if (rim(hit)) return 0.95;
        const nail = underNail(tube, x, y, hit, dark);
        if (nail) return nail;
        if (onAny(FINGER_CREASES, x, y, 1.2)) return CREASE;
        // Shaded where it tucks in under the finger in front of it.
        const cover = i ? FINGERS[i - 1] : INDEX;
        let shade = 0.03;
        if (onTube({ ...cover, axis: grown(cover, 6) }, x, y, near))
          shade += 0.28 * clamp01(near.inside / 6);
        return clamp01(
          Math.min(0.85, skin(hit, dark) + (dark ? -shade : shade)),
        );
      }
      return 0;
    },
    [-486, -60, 486, 124],
    r0,
    rand,
  );

  const nail = (x: number, y: number) => {
    const [[x0, y0], [x1, y1]] = NAIL;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const u = clamp01(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy));
    return NAIL_HALF - Math.hypot(x - x0 - u * dx, y - y0 - u * dy);
  };
  const thumb = stipple(
    (x, y) => {
      if (onTube(THUMB, x, y, hit)) {
        // Where it grows out of the palm, only a light crease.
        const root = x > -80 && y > 30;
        if (rim(hit)) return root ? 0.5 : 1;
        const onNail = nail(x, y);
        if (onNail > 0) return onNail < 1.6 ? 0.95 : dark ? 0.7 : 0.05;
        // The skin folds round the nail.
        if (onNail > -3.5) return dark ? 0.15 : 0.55;
        if (onAny(THUMB_CREASES, x, y, 1.2)) return CREASE;
        return skin(hit, dark);
      }
      if (finger(x, y)) {
        if (rim(hit)) return 1;
        const tip = underNail(INDEX, x, y, hit, dark);
        if (tip) return tip;
        if (onAny(CREASES, x, y, 1.2)) return CREASE;
        return skin(hit, dark);
      }
      return 0;
    },
    [-486, -82, 10, 76],
    r0,
    rand,
  );
  // The first finger's fill stops short of its knuckle, where its dots
  // stop: the palm goes on under it.
  const reach = INDEX.axis.filter(([x, , r]) => x <= KNUCKLE - r);
  return {
    hand,
    thumb,
    handFill: fill([PALM, FOREARM, ROLL, SLEEVE, ...FINGERS], 2.5),
    thumbFill: fill([THUMB, { axis: reach, z: 0 }], 2.5),
  };
}

/** A tube's axis a little fatter. */
function grown(tube: Tube, by: number) {
  return tube.axis.map(([x, y, r]) => [x, y, r + by] as const);
}
