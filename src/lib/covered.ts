/**
 * While a hobby card's scene plays over the page it opened into
 * (src/lib/landing.ts), the page is underneath it. The hobby islands' own
 * animations keep to their still frame until the scene is gone, so nothing
 * on the page competes with it for the screen; then they start up.
 */

/** On <html> while a scene covers the page. */
export const COVERED = "landing-scene";
const UNCOVERED = "landing:uncovered";

export function covered(): boolean {
  return document.documentElement.classList.contains(COVERED);
}

/** Run `start` once the page is uncovered (never, if it isn't covered). */
export function whenUncovered(start: () => void): void {
  if (covered())
    document.addEventListener(UNCOVERED, () => start(), { once: true });
}

/** The scene's gone: let the page move again. */
export function uncover(): void {
  const root = document.documentElement;
  if (!root.classList.contains(COVERED)) return;
  root.classList.remove(COVERED);
  document.dispatchEvent(new Event(UNCOVERED));
}
