import land from "./geo-land.json";

/**
 * Geography for the globe.
 *
 * `land` is a simplified Natural Earth 110m coastline, rounded to a half-degree
 * grid — enough shape to recognise a continent at 150px, small enough to ship.
 */
export const LAND: number[][][] = land as number[][][];

export interface Coords {
  lat: number;
  lon: number;
}

/**
 * Fallback coordinates for the places that appear in session `location` fields.
 *
 * Sessions whose photographs carry GPS in their EXIF get exact coordinates from
 * prebuild instead, and never consult this table. It exists so the globe still
 * works for sessions shot on gear that doesn't record position, and so the site
 * degrades to "no pin" rather than "no globe" when somewhere new shows up.
 *
 * Keys are matched loosely — case, accents and punctuation are ignored, and a
 * location falls back to its broader parts ("Bijagua, Costa Rica" → "Costa
 * Rica") before giving up.
 */
const GAZETTEER: Record<string, Coords> = {
  // Costa Rica
  "alajuela province, costa rica": { lat: 10.55, lon: -84.6 },
  "bijagua, costa rica": { lat: 10.73, lon: -85.05 },
  "guanacaste, costa rica": { lat: 10.63, lon: -85.44 },
  "limon province, costa rica": { lat: 10.2, lon: -83.5 },
  "puntarenas province, costa rica": { lat: 10.3, lon: -84.82 },
  "costa rica": { lat: 9.93, lon: -84.08 },

  // Washington
  "cascades, washington": { lat: 47.6, lon: -121.3 },
  "central cascades, washington": { lat: 47.6, lon: -121.2 },
  "north cascades, washington": { lat: 48.7, lon: -121.2 },
  "deception pass state park, washington": { lat: 48.41, lon: -122.64 },
  "eastern washington": { lat: 47.1, lon: -119.3 },
  "western washington": { lat: 47.4, lon: -122.2 },
  "mount rainier national park, washington": { lat: 46.88, lon: -121.73 },
  "olympic peninsula, washington": { lat: 47.8, lon: -123.8 },
  "puget sound, washington": { lat: 47.7, lon: -122.45 },
  "puget sound lowlands, washington": { lat: 47.5, lon: -122.3 },
  washington: { lat: 47.4, lon: -120.5 },

  // China
  "hunan, china": { lat: 29.33, lon: 110.48 },
  "lijiang, yunnan, china": { lat: 26.87, lon: 100.23 },
  "yunnan, china": { lat: 25.04, lon: 102.71 },
  "shanghai, china": { lat: 31.23, lon: 121.47 },
  "tibet, china": { lat: 29.65, lon: 91.13 },
  china: { lat: 34.0, lon: 108.0 },
  beijing: { lat: 39.9, lon: 116.4 },
  "xi'an": { lat: 34.34, lon: 108.94 },
  chengdu: { lat: 30.66, lon: 104.07 },

  // Broad fallbacks, so somewhere new still lands on the right continent.
  california: { lat: 36.78, lon: -119.42 },
  oregon: { lat: 43.8, lon: -120.55 },
  alaska: { lat: 64.2, lon: -149.5 },
  "british columbia": { lat: 53.73, lon: -127.65 },
  mexico: { lat: 23.63, lon: -102.55 },
  japan: { lat: 36.2, lon: 138.25 },
  nepal: { lat: 28.39, lon: 84.12 },
  norway: { lat: 60.47, lon: 8.47 },
  iceland: { lat: 64.96, lon: -19.02 },
  ecuador: { lat: -1.83, lon: -78.18 },
  peru: { lat: -9.19, lon: -75.02 },
  panama: { lat: 8.54, lon: -80.78 },
};

/** Gazetteer keys longest-first, so "costa rica" wins over "rica". */
const KEYS_BY_LENGTH = Object.keys(GAZETTEER).sort(
  (a, b) => b.length - a.length,
);

/** Lower-case, strip accents and collapse punctuation so lookups are forgiving. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a session to a point on the globe.
 *
 * Explicit coordinates (from EXIF GPS) always win. Otherwise the location
 * string is looked up whole, then progressively from the broadest part inwards,
 * so an unknown town still lands in the right country.
 */
export function coordsFor(
  location: string,
  explicit?: Coords | null,
): Coords | undefined {
  if (
    explicit &&
    Number.isFinite(explicit.lat) &&
    Number.isFinite(explicit.lon)
  ) {
    return explicit;
  }
  if (!location) return undefined;

  const key = normalize(location);
  if (GAZETTEER[key]) return GAZETTEER[key];

  // "Lijiang, Yunnan, China" → try "Yunnan, China", then "China".
  const parts = key
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const tail = parts.slice(i).join(", ");
    if (GAZETTEER[tail]) return GAZETTEER[tail];
  }

  // Last resort: the longest known place named anywhere inside the string, on
  // whole words only. Catches "Northern California coast" and routes written
  // as "Beijing → Xi'an → Chengdu".
  for (const candidate of KEYS_BY_LENGTH) {
    const pattern = new RegExp(
      `(^|[^a-z0-9])${escapeRegex(candidate)}([^a-z0-9]|$)`,
    );
    if (pattern.test(key)) return GAZETTEER[candidate];
  }
  return undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the site knows where a location is, used to decide on a pin. */
export function isMapped(location: string, explicit?: Coords | null): boolean {
  return coordsFor(location, explicit) !== undefined;
}
