/**
 * Text drawn on a canvas, in the site's own face. The page is set in Libre
 * Franklin, but a canvas paints with whatever face is loaded when fillText
 * runs and never repaints by itself, so text drawn before the web font
 * arrives keeps the fallback for good. The maps used to ask for bold
 * system-ui and the hiking postcard for Georgia and Arial, which read as a
 * random font switch next to the page (TTT-4, November 2026 review).
 *
 * canvasFont() is the font string, at 300 or 400 only, like the page's light
 * titles and its body text. Draw with it once canvasFontReady() resolves: a
 * one-off render (the postcard) awaits it, and a draw loop leaves its text out
 * while canvasFontIsReady() is false and redraws when the promise resolves.
 */

export type CanvasFontWeight = 300 | 400;

const FAMILY = '"Libre Franklin", sans-serif';

export function canvasFont(
  size: number,
  weight: CanvasFontWeight = 400,
): string {
  return `${weight} ${size}px ${FAMILY}`;
}

let ready = false;
let waiting: Promise<void> | null = null;

/**
 * Resolves once Libre Franklin can be drawn: the face is asked for, then
 * document.fonts.ready. A failed load resolves it too, so text is still drawn,
 * in the fallback, rather than never.
 */
export function canvasFontReady(): Promise<void> {
  if (waiting) return waiting;
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  const done = () => {
    ready = true;
  };
  if (!fonts) {
    done();
    waiting = Promise.resolve();
    return waiting;
  }
  // One variable file covers 300 to 500, so loading one weight loads both.
  waiting = fonts
    .load(canvasFont(16))
    .then(() => fonts.ready)
    .then(done, done);
  return waiting;
}

/** Whether canvasFontReady() has resolved, for draw loops. */
export function canvasFontIsReady(): boolean {
  if (!ready) void canvasFontReady();
  return ready;
}
