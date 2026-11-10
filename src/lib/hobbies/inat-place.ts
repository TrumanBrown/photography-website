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

/** US states by postal code, for places iNaturalist saved as codes ("US-WA"). */
const US_STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

/** "US-WA" -> "Washington", "US" -> "USA"; anything else as it is. */
function spelledOut(part: string): string {
  const state = /^US-([A-Z]{2})$/.exec(part)?.[1];
  if (state && US_STATES[state]) return US_STATES[state];
  return part === "US" ? "USA" : part;
}

/**
 * The last two parts of a place, minus house numbers and postcodes, with
 * country and state codes spelled out ("US-WA, US" -> "Washington, USA").
 */
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
    .map(spelledOut)
    .join(", ");
}

/** Snap a latitude or longitude to the 0.1° grid. */
export function coarseCoord(value: number): number {
  const snapped = Number(
    (Math.round(value / COARSE_GRID) * COARSE_GRID).toFixed(1),
  );
  return snapped === 0 ? 0 : snapped; // never -0
}
