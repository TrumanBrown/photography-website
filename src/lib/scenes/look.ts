/** How a frame left the whole sheet: its opacity and blur (CSS px). */
export interface Look {
  opacity: number;
  blur: number;
}

/** The sheet's look as CSS on its canvas: only what changed is written. */
export function applyLook(canvas: HTMLCanvasElement, look: Look): void {
  const opacity = look.opacity < 0.999 ? String(Math.max(0, look.opacity)) : "";
  if (canvas.style.opacity !== opacity) canvas.style.opacity = opacity;
  const filter = look.blur > 0.05 ? `blur(${look.blur.toFixed(2)}px)` : "";
  if (canvas.style.filter !== filter) canvas.style.filter = filter;
}
