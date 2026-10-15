/**
 * Scene labels (the globe's coordinates): small tracked caps over a paper
 * halo, drawn as pictures with the page's own fonts. A scene playing in the
 * worker asks the page for them (player.ts). Nothing else lives here, so the
 * page can draw them without loading the scenes.
 */

export const labelFont = (font: string) => `600 11px ${font}`;
export const LABEL_SPACING = "1.4px";
export const LABEL_HALO = 4;

/** A label drawn as a picture, `w` × `h` CSS px, its text `LABEL_HALO` in from the top left. */
export interface LabelArt {
  image: HTMLCanvasElement | OffscreenCanvas | ImageBitmap;
  w: number;
  h: number;
}

/** Labels as pictures, at a pixel ratio; null until one is ready. */
export type Labeler = (
  text: string,
  color: string,
  dpr: number,
) => LabelArt | null;

/** A canvas of its own for drawing on, wherever this runs. */
export function scratch2d(
  w: number,
  h: number,
  options?: CanvasRenderingContext2DSettings,
) {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement("canvas"), {
          width: w,
          height: h,
        });
  const ctx = canvas.getContext("2d", options) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  return ctx ? { canvas, ctx } : null;
}

/** Draws a label, with the fonts of wherever this runs: the page's, on the page. */
export function drawLabel(
  text: string,
  color: string,
  paper: string,
  font: string,
  dpr: number,
): LabelArt | null {
  const probe = scratch2d(1, 1);
  if (!probe) return null;
  probe.ctx.font = labelFont(font);
  if ("letterSpacing" in probe.ctx) probe.ctx.letterSpacing = LABEL_SPACING;
  const w = Math.ceil(probe.ctx.measureText(text).width) + 2 * LABEL_HALO;
  const h = 11 * 1.4 + 2 * LABEL_HALO;
  const art = scratch2d(Math.ceil(w * dpr), Math.ceil(h * dpr));
  if (!art) return null;
  const { ctx } = art;
  ctx.scale(dpr, dpr);
  ctx.font = labelFont(font);
  if ("letterSpacing" in ctx) ctx.letterSpacing = LABEL_SPACING;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = LABEL_HALO;
  ctx.strokeStyle = paper;
  ctx.strokeText(text, LABEL_HALO, LABEL_HALO);
  ctx.fillStyle = color;
  ctx.fillText(text, LABEL_HALO, LABEL_HALO);
  return { image: art.canvas, w, h };
}
