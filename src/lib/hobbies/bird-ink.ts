/**
 * Inking in the bird. Once the selfie-to-bird picture is drawn, it's taken
 * away and put back as stipple, dot by dot, the way the hobby plates are
 * drawn: dots fall where the picture is darkest first, each in the colour of
 * the picture underneath, until the shapes are there. Then the finished
 * picture comes up through the dots. The canvas ends exactly as the finished
 * picture, so a download is unchanged.
 */

/** One stipple dot, in canvas pixels, with its colour. */
export interface InkDot {
  x: number;
  y: number;
  r: number;
  color: string;
}

/** Small seeded generator (mulberry32), so a picture always stipples the same. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stipple a picture (RGBA pixels): `count` dots placed where it's darker
 * more often than where it's pale (a dot lands with chance 0.06 + darkness),
 * ordered darkest first so the shapes come before the shading.
 */
export function stippleDots(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  count: number,
  seed = 1,
): InkDot[] {
  const random = rng(seed);
  const dots: Array<InkDot & { dark: number }> = [];
  let tries = 0;
  while (dots.length < count && tries < count * 40) {
    tries++;
    const x = Math.floor(random() * width);
    const y = Math.floor(random() * height);
    const p = (y * width + x) * 4;
    const lum =
      (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
    const dark = 1 - lum;
    if (random() > 0.06 + dark) continue;
    dots.push({
      x: x + 0.5,
      y: y + 0.5,
      r: 0.9 + dark * 1.6,
      color: `rgb(${data[p]}, ${data[p + 1]}, ${data[p + 2]})`,
      dark,
    });
  }
  dots.sort((a, b) => b.dark - a.dark);
  return dots.map(({ x, y, r, color }) => ({ x, y, r, color }));
}

/** How long the dots take, then the picture coming up through them, ms. */
export const INK_MS = 1100;
export const INK_REVEAL_MS = 380;

export interface Inking {
  /** Jump to the finished picture now (e.g. before a download). */
  finish(): void;
}

/**
 * Ink the picture currently on `canvas` back in. Returns null (and leaves the
 * picture alone) when it can't be read.
 */
export function inkIn(canvas: HTMLCanvasElement, paper: string): Inking | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  const done = document.createElement("canvas");
  done.width = w;
  done.height = h;
  const doneCtx = done.getContext("2d");
  if (!doneCtx) return null;
  doneCtx.drawImage(canvas, 0, 0);
  let pixels: ImageData;
  try {
    pixels = doneCtx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
  const dots = stippleDots(pixels.data, w, h, Math.round((w * h) / 34), w + h);

  let raf = 0;
  let drawn = 0;
  const start = performance.now();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const finish = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(done, 0, 0);
    ctx.restore();
  };

  function frame(now: number) {
    const t = now - start;
    // Ease out: most of the dots go down early, the last ones trickle in.
    const k = Math.min(1, t / INK_MS);
    const want = Math.round(dots.length * (1 - Math.pow(1 - k, 2.2)));
    ctx!.save();
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    for (; drawn < want; drawn++) {
      const d = dots[drawn];
      ctx!.fillStyle = d.color;
      ctx!.beginPath();
      ctx!.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx!.fill();
    }
    const reveal = (t - INK_MS * 0.82) / INK_REVEAL_MS;
    if (reveal > 0) {
      // The finished picture comes up through the dots.
      ctx!.globalAlpha = Math.min(1, reveal * reveal);
      ctx!.drawImage(done, 0, 0);
    }
    ctx!.restore();
    if (reveal < 1) raf = requestAnimationFrame(frame);
    else finish();
  }
  raf = requestAnimationFrame(frame);
  return { finish };
}
