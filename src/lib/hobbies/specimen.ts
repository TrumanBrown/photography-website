/**
 * The specimen card's stamp. The tide pool and herping toys share one reveal
 * card (src/components/hobbies/SpecimenCard.astro); on a first find it gets
 * "New to your journal" stamped across the corner of its picture, the way a
 * new specimen gets its accession stamp. The plain label stays for screen
 * readers but is hidden while the stamp says it.
 */

import { stamp } from "@/lib/motion";

interface Mark {
  stamp?: HTMLElement;
  timer?: number;
}

const marks = new WeakMap<HTMLElement, Mark>();

/** Lands just after the card opens, as the photo resolves. */
const STAMP_DELAY_MS = 260;

export function stampFind(
  pic: HTMLElement,
  badge: HTMLElement,
  isNew: boolean,
): void {
  const mark = marks.get(pic) ?? {};
  window.clearTimeout(mark.timer);
  mark.stamp?.remove();
  mark.stamp = undefined;
  badge.classList.toggle("is-stamped", isNew);
  if (isNew) {
    mark.timer = window.setTimeout(() => {
      mark.stamp = stamp(pic, "New", {
        unit: "to your journal",
        className: "stamp-ink specimen-stamp",
        stay: true,
        tilt: -8,
      });
    }, STAMP_DELAY_MS);
  }
  marks.set(pic, mark);
}
