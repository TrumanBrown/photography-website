/**
 * The specimen card's stamp. The tide pool and herping toys share one reveal
 * card (src/components/hobbies/SpecimenCard.astro); on a first find it gets
 * "New to your journal" stamped on the blank card beside its picture, the way
 * a new specimen gets its accession stamp, and never over the animal. The
 * plain label stays for screen readers but is hidden while the stamp says it.
 */

import { stamp } from "@/lib/motion";

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
