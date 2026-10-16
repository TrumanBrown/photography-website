/** The part of the lightbox's on-screen <img> that the upgrade changes. */
export type ShownImage = Pick<HTMLImageElement, "src" | "srcset">;

/**
 * Fetches and decodes an image off screen. Resolves once it can be painted
 * without a blank frame and rejects if it fails to load.
 */
export type LoadImage = (url: string) => Promise<void>;

export const loadOriginal: LoadImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      // Decode before swapping so the visible image never flashes blank.
      if (image.decode) image.decode().then(resolve, () => resolve());
      else resolve();
    };
    image.onerror = () => reject(new Error(`Couldn't load ${url}`));
    image.src = url;
  });

/**
 * Returns `upgrade(img, full)`, which swaps the original in for the
 * size-capped copy the lightbox opened on, once the original has loaded.
 *
 * What's remembered is the <img>, not the photograph. PhotoSwipe keeps only
 * five slides' images and throws the rest away, and throws them all away when
 * the lightbox closes. The <img> it builds when you come back starts on the
 * capped copy again, so it has to be upgraded again too. The original is
 * normally in the browser's cache by then (a year, immutable), so that costs
 * nothing.
 */
export function createUpgrader(load: LoadImage = loadOriginal) {
  const started = new WeakSet<ShownImage>();

  return function upgrade(
    img: ShownImage | undefined,
    full: string | undefined,
  ): void {
    // Galleries that already link the original have nothing to upgrade to.
    if (!img || !full || img.src === full || started.has(img)) return;

    started.add(img);
    load(full).then(
      () => {
        img.src = full;
        img.srcset = "";
      },
      // Leave the capped copy up rather than break the slide, and try again
      // the next time this photograph is on screen.
      () => started.delete(img),
    );
  };
}
