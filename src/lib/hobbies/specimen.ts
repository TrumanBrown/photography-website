/**
 * The specimen card's stamp. The tide pool and herping toys share one reveal
 * card (src/components/hobbies/SpecimenCard.astro); on a first find it gets
 * "New to your journal" stamped on the blank card beside its picture, the way
 * a new specimen gets its accession stamp, and never over the animal. The
 * plain label stays for screen readers but is hidden while the stamp says it.
 */

import { stamp } from "../motion";

interface Mark {
  stamp?: HTMLElement;
  timer?: number;
}

const marks = new WeakMap<HTMLElement, Mark>();

/** Lands just after the card opens, as the photo resolves. */
const STAMP_DELAY_MS = 260;

/** `slot` is the card's [data-<prefix>-mark], where the stamp goes down. */
export function stampFind(
  slot: HTMLElement,
  badge: HTMLElement,
  isNew: boolean,
): void {
  const mark = marks.get(slot) ?? {};
  window.clearTimeout(mark.timer);
  mark.stamp?.remove();
  mark.stamp = undefined;
  badge.classList.toggle("is-stamped", isNew);
  if (isNew) {
    mark.timer = window.setTimeout(() => {
      mark.stamp = stamp(slot, "New", {
        unit: "to your journal",
        className: "stamp-ink specimen-stamp",
        stay: true,
        tilt: -8,
      });
    }, STAMP_DELAY_MS);
  }
  marks.set(slot, mark);
}

/**
 * The card's photograph runs across its top at 4:3, about 600 px wide, so it
 * needs iNaturalist's 1024 px "large" copy to stay sharp. The 500 px "medium"
 * copy is what the toys preload and what the data files point at, so a card
 * opens on that at once and swaps to the large one when it's in. Any other
 * URL (a hobby-media copy) has no large size and is shown as it is.
 */
export function largePhoto(url: string): string | null {
  const m = url.match(
    /^(https:\/\/(?:inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)\/photos\/\d+\/)medium\.(jpe?g|png)$/i,
  );
  return m ? `${m[1]}large.${m[2]}` : null;
}

/** Long enough for the pixel reveal to finish before the sharper copy goes in. */
const SWAP_AFTER_MS = 420;
const swaps = new WeakMap<HTMLImageElement, HTMLImageElement>();

/**
 * Loads the large copy of `quick` (already in `img`) and puts it in once it's
 * decoded, unless the card has moved on to another animal by then.
 */
export function upgradePhoto(img: HTMLImageElement, quick: string): void {
  swaps.delete(img);
  const full = largePhoto(quick);
  if (!full) return;
  const started = performance.now();
  const loader = new Image();
  loader.decoding = "async";
  swaps.set(img, loader);
  const swap = () => {
    if (swaps.get(img) !== loader) return;
    swaps.delete(img);
    img.onload = null;
    img.onerror = null;
    img.src = full;
  };
  loader.onload = () => {
    const ready = loader.decode ? loader.decode().catch(() => {}) : null;
    Promise.resolve(ready).then(() =>
      window.setTimeout(
        swap,
        Math.max(0, started + SWAP_AFTER_MS - performance.now()),
      ),
    );
  };
  loader.src = full;
}
