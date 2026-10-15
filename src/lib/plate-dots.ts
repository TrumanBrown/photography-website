/**
 * Reading the dots off a stipple plate (src/assets/plates/), for the hobby
 * cards' opening scenes and the plain dive (src/lib/open.ts), and for a
 * hobby page picking a scene up where the last page left it
 * (src/lib/scenes/resume.ts).
 */

/** A card plate is 880 wide, a mini 360; scenes work in card units. */
export const CARD_W = 880;

/** The dots of a stipple plate: centres and radii in image pixels. */
export interface DotField {
  x: Float32Array;
  y: Float32Array;
  r: Float32Array;
  n: number;
  /** Average ink colour, so the dots are drawn in the plate's own ink. */
  color: string;
}

/**
 * Find the dots in a plate's pixels (RGBA, row by row): every patch of
 * touching inked pixels is one dot, at its centre, as big as its area. Where
 * the shading is dense the dots touch and run together; a patch much bigger
 * than a typical dot is cut back into typical dots, a dot's width apart, so
 * it reads as stipple when it's blown up rather than one big blot.
 */
export function findDots(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaMin = 96,
): DotField {
  const size = width * height;
  const seen = new Uint8Array(size);
  const stack = new Int32Array(size);
  // Every inked pixel, patch by patch.
  const members = new Int32Array(size);
  const starts: number[] = [];
  const counts: number[] = [];
  let used = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let p = 0; p < size; p++) {
    if (seen[p] || data[p * 4 + 3] < alphaMin) continue;
    seen[p] = 1;
    let top = 0;
    stack[top++] = p;
    starts.push(used);
    while (top) {
      const q = stack[--top];
      members[used++] = q;
      red += data[q * 4];
      green += data[q * 4 + 1];
      blue += data[q * 4 + 2];
      const qx = q % width;
      const qy = (q - qx) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = qy + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx;
          if (nx < 0 || nx >= width) continue;
          const nq = ny * width + nx;
          if (seen[nq] || data[nq * 4 + 3] < alphaMin) continue;
          seen[nq] = 1;
          stack[top++] = nq;
        }
      }
    }
    counts.push(used - starts[starts.length - 1]);
  }

  const sorted = [...counts].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)] ?? 1;
  const typicalR = Math.sqrt(typical / Math.PI);
  const step = Math.max(2, 2 * typicalR);
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  for (let c = 0; c < counts.length; c++) {
    const from = starts[c];
    const count = counts[c];
    if (count <= typical * 2.5) {
      let sx = 0;
      let sy = 0;
      for (let i = from; i < from + count; i++) {
        const q = members[i];
        sx += q % width;
        sy += Math.floor(q / width);
      }
      xs.push(sx / count + 0.5);
      ys.push(sy / count + 0.5);
      rs.push(Math.sqrt(count / Math.PI));
      continue;
    }
    // A run of touching dots: one dot per step-wide cell of it.
    const cells = new Map<number, [number, number, number]>();
    for (let i = from; i < from + count; i++) {
      const q = members[i];
      const x = q % width;
      const y = Math.floor(q / width);
      const key = Math.floor(y / step) * 10000 + Math.floor(x / step);
      const cell = cells.get(key);
      if (cell) {
        cell[0] += x;
        cell[1] += y;
        cell[2]++;
      } else cells.set(key, [x, y, 1]);
    }
    for (const [key, [sx, sy, n]] of cells) {
      // A nudge off the grid, the same each time, so it reads as stipple.
      const h1 = Math.sin(key * 12.9898) * 43758.5453;
      const h2 = Math.sin(key * 78.233) * 43758.5453;
      xs.push(sx / n + 0.5 + (h1 - Math.floor(h1) - 0.5) * step * 0.4);
      ys.push(sy / n + 0.5 + (h2 - Math.floor(h2) - 0.5) * step * 0.4);
      rs.push(Math.min(typicalR, Math.sqrt(n / Math.PI) * 1.1));
    }
  }
  const avg = (v: number) => Math.round(v / Math.max(1, used));
  return {
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    r: Float32Array.from(rs),
    n: xs.length,
    color: `rgb(${avg(red)}, ${avg(green)}, ${avg(blue)})`,
  };
}

/**
 * A spot in among the dots, near the middle of the drawing, with as much
 * clear paper around it as possible. Diving in there leaves the screen bare
 * at the end rather than inside a dot.
 */
export function quietSpot(field: DotField): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < field.n; i++) {
    cx += field.x[i];
    cy += field.y[i];
  }
  cx /= Math.max(1, field.n);
  cy /= Math.max(1, field.n);
  const span = 40;
  let best = { x: cx, y: cy };
  let bestScore = -Infinity;
  for (let gy = -span; gy <= span; gy += 4) {
    for (let gx = -span; gx <= span; gx += 4) {
      const x = cx + gx;
      const y = cy + gy;
      let clear = Infinity;
      for (let i = 0; i < field.n; i++) {
        const dx = field.x[i] - x;
        const dy = field.y[i] - y;
        if (Math.abs(dx) > 30 || Math.abs(dy) > 30) continue;
        clear = Math.min(clear, Math.hypot(dx, dy) - field.r[i]);
      }
      // Clear paper counts most; staying near the middle breaks ties.
      const score = Math.min(clear, 30) - 0.02 * Math.hypot(gx, gy);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/** The dots of a loaded plate image, in its own pixels. */
export function readDots(img: HTMLImageElement): DotField | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0);
    return findDots(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return null;
  }
}

/** A plate's dots scaled to card units, whatever size the plate is. */
export function cardUnits(
  field: DotField | null,
  width: number,
): DotField | null {
  if (!field) return null;
  const k = CARD_W / width;
  return {
    ...field,
    x: field.x.map((v) => v * k),
    y: field.y.map((v) => v * k),
    r: field.r.map((v) => v * k),
  };
}
