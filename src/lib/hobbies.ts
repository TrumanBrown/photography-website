import type { CollectionEntry } from 'astro:content';

type Hobby = CollectionEntry<'hobbies'>;

/** Slug derived from the JSON filename (mirrors sessionSlug). */
export function hobbySlug(entry: Hobby): string {
  return entry.id.replace(/\.(json|ya?ml)$/i, '');
}

/**
 * Sort policy for the hobbies landing page: entries with an explicit `order`
 * come first (ascending), then the rest alphabetically by title.
 */
export function sortHobbies(entries: Hobby[]): Hobby[] {
  const list = [...entries];
  list.sort((a, b) => {
    const ao = a.data.order;
    const bo = b.data.order;
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    return a.data.title.localeCompare(b.data.title);
  });
  return list;
}

/**
 * What's in Things to try, said the same way everywhere it's counted: "6
 * hobbies and a daily puzzle". Narrow nature is the puzzle; the rest are
 * hobbies.
 */
export function thingsToTryLine(entries: Hobby[]): string {
  const hobbies = entries.filter((h) => hobbySlug(h) !== 'narrow-nature').length;
  const puzzle = hobbies < entries.length;
  const noun = hobbies === 1 ? 'hobby' : 'hobbies';
  return puzzle ? `${hobbies} ${noun} and a daily puzzle` : `${hobbies} ${noun}`;
}
