/**
 * Where an iNaturalist observation was made, coarsened before a hobby page
 * shows it.
 *
 * iNaturalist fills `place_guess` from the map pin, often as a street address
 * ("123 Main St, Springfield, OR 97477, USA"), and an unobscured observation's
 * coordinates are accurate to metres. A backyard frog would map the yard, and
 * a reptile's exact spot is what a collector looks for. The pages show a town
 * or region and a point on a grid instead.
 */

/** Degrees per grid step: 0.1° is about 11 km north to south. */
export const COARSE_GRID = 0.1;

/** The last two parts of a place, minus house numbers and postcodes. */
export function coarsePlace(placeGuess?: string | null): string {
  if (!placeGuess) return "";
  return placeGuess
    .split(",")
    .map((part) =>
      part
        .replace(/\S*\d\S*/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .slice(-2)
    .join(", ");
}

/** Snap a latitude or longitude to the 0.1° grid. */
export function coarseCoord(value: number): number {
  const snapped = Number(
    (Math.round(value / COARSE_GRID) * COARSE_GRID).toFixed(1),
  );
  return snapped === 0 ? 0 : snapped; // never -0
}
