/**
 * Bring a specimen photograph in from pixels. The toys are pixel art and the
 * cards show real photographs, so for a beat the photo arrives at the beach's
 * own resolution (6, 12, 24, then 48 blocks across) before it sharpens. A port
 * of Magic UI's pixel-image reduced to its idea: draw the loaded photo small on
 * a canvas with smoothing off, step up, then hand over to the <img>.
 *
 * Used by the tide pool and herping reveal cards (SpecimenCard.astro), which
 * already hold a canvas (for the sprite) and an <img> (for the photo) in the
 * same frame. The steps count blocks across, and the rows follow the frame's
 * shape.
 */

const STEPS = [6, 12, 24, 48];
/** The card's frame, for when it can't be measured yet (the card opens just after). */
const FRAME_ASPECT = 4 / 3;
const STEP_MS = 90;

const pending = new WeakMap<HTMLCanvasElement, number[]>();

/** Cancel a reveal still in progress on this canvas. */
export function stopPixelReveal(canvas: HTMLCanvasElement): void {
  pending.get(canvas)?.forEach((id) => window.clearTimeout(id));
  pending.delete(canvas);
}

/**
 * Play the reveal from `img` (already loaded) through `canvas`, toggling
 * `hiddenClass` to swap which one shows. Under reduced motion, or if the image
 * can't be drawn, the photo just appears.
 */
export function revealFromPixels(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  hiddenClass = "is-hidden",
): void {
  stopPixelReveal(canvas);
  const showPhoto = () => {
    canvas.classList.add(hiddenClass);
    img.classList.remove(hiddenClass);
  };

  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !ctx || !img.complete || !img.naturalWidth) {
    showPhoto();
    return;
  }

  // The card crops the photo to its frame from the middle (object-fit: cover).
  // The canvas itself is still hidden here, so measure the frame it sits in.
  const box = (canvas.parentElement ?? canvas).getBoundingClientRect();
  const aspect =
    box.width && box.height ? box.width / box.height : FRAME_ASPECT;
  let sw = img.naturalWidth;
  let sh = sw / aspect;
  if (sh > img.naturalHeight) {
    sh = img.naturalHeight;
    sw = sh * aspect;
  }
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  const tiny = document.createElement("canvas");
  const tctx = tiny.getContext("2d");
  if (!tctx) {
    showPhoto();
    return;
  }

  canvas.width = 192;
  canvas.height = Math.round(192 / aspect);
  const draw = (blocks: number) => {
    const rows = Math.max(1, Math.round(blocks / aspect));
    tiny.width = blocks;
    tiny.height = rows;
    tctx.drawImage(img, sx, sy, sw, sh, 0, 0, blocks, rows);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tiny, 0, 0, canvas.width, canvas.height);
  };

  // The first step is drawn before the canvas shows, so it never flashes
  // whatever the last card left on it.
  draw(STEPS[0]);
  img.classList.add(hiddenClass);
  canvas.classList.remove(hiddenClass);
  const timers = STEPS.slice(1).map((blocks, i) =>
    window.setTimeout(() => draw(blocks), (i + 1) * STEP_MS),
  );
  timers.push(
    window.setTimeout(() => {
      pending.delete(canvas);
      showPhoto();
    }, STEPS.length * STEP_MS),
  );
  pending.set(canvas, timers);
}
