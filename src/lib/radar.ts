/**
 * The radar from my balcFlights-LED panel, as pure functions so they can be
 * tested: reading seattlebalc.com's flight API, distance and bearing from its
 * centre, the panel's text, its 64 × 64 layout and a 3 × 5 pixel font. The
 * drawing is in src/lib/led-radar.ts. Formats and colours follow the panel's
 * own code (balc_flights_led/presentation.py and display.py).
 */

export const PANEL = 64;
export const FLIGHTS_URL = "https://seattlebalc.com/api/v1/flights";
/** The API's default centre and range, used when a response leaves them out. */
export const DEFAULT_CENTER = { latitude: 47.6175, longitude: -122.305 };
export const DEFAULT_RANGE_NM = 16;

export type Rgb = readonly [number, number, number];

export const COLORS = {
  text: [255, 255, 255] as Rgb,
  stale: [255, 176, 0] as Rgb,
  overhead: [255, 110, 0] as Rgb,
  ring: [31, 107, 58] as Rgb,
  ringOuter: [21, 70, 42] as Rgb,
  sweep: [47, 191, 95] as Rgb,
  target: [0, 194, 255] as Rgb,
  origin: [163, 180, 194] as Rgb,
  detail: [163, 180, 194] as Rgb,
  label: [124, 147, 166] as Rgb,
  trend: {
    1: [58, 209, 106],
    0: [240, 180, 41],
    [-1]: [232, 80, 58],
  } as Record<-1 | 0 | 1, Rgb>,
};

export const SWEEP_DEG_PER_S = 85;
export const SWEEP_TAIL = 6;
export const SWEEP_TAIL_DEG = 5;
export const SWEEP_ALPHA = 0.34;
export const AFTERGLOW_DEG = 110;
export const AFTERGLOW_FLOOR = 0.45;
export const TRAIL_POINTS = 4;
export const TRAIL_ALPHA = 0.34;
export const TRAIL_FALLOFF = 0.07;
export const BLINK_DUTY = 0.72;

export interface Flight {
  label: string;
  type: string | null;
  latitude: number;
  longitude: number;
  altitudeFeet: number | null;
  speedKnots: number | null;
  headingDegrees: number | null;
  verticalRateFpm: number | null;
  onGround: boolean;
}

export interface Snapshot {
  center: { latitude: number; longitude: number };
  rangeNm: number;
  flights: Flight[];
  /** "ok", or "degraded" when the API fell back to cached data. */
  status: string;
  /** Milliseconds since the epoch the API says the data is from. */
  at: number;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Read the API's JSON into flights with a usable position. */
export function readSnapshot(json: unknown, now = Date.now()): Snapshot {
  const data = (json ?? {}) as Record<string, any>;
  const center = data.query?.center;
  const lat = num(center?.latitude);
  const lon = num(center?.longitude);
  const flights: Flight[] = [];
  for (const raw of Array.isArray(data.flights) ? data.flights : []) {
    const pos = raw?.position ?? {};
    const at = pos.projected ?? pos;
    const latitude = num(at.latitude) ?? num(pos.latitude);
    const longitude = num(at.longitude) ?? num(pos.longitude);
    if (latitude === null || longitude === null) continue;
    const ids = raw.identifiers ?? {};
    flights.push({
      label: matrixText(ids.callsign || ids.registration || ids.icao24 || ""),
      type:
        typeof raw.aircraft?.typeCode === "string"
          ? raw.aircraft.typeCode
          : null,
      latitude,
      longitude,
      altitudeFeet: num(pos.altitudeFeet),
      speedKnots: num(raw.movement?.speedKnots),
      headingDegrees: num(raw.movement?.headingDegrees),
      verticalRateFpm: num(raw.movement?.verticalRateFeetPerMinute),
      onGround: pos.onGround === true,
    });
  }
  const generated = Date.parse(data.generatedAt ?? "");
  return {
    center:
      lat !== null && lon !== null
        ? { latitude: lat, longitude: lon }
        : DEFAULT_CENTER,
    rangeNm: num(data.query?.radiusNauticalMiles) ?? DEFAULT_RANGE_NM,
    flights,
    status: typeof data.status === "string" ? data.status : "ok",
    at: Number.isFinite(generated) ? generated : now,
  };
}

const EARTH_NM = 3440.065;
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in nautical miles and bearing in degrees from `from` to `to`. */
export function rangeAndBearing(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): { distanceNm: number; bearing: number } {
  const p1 = rad(from.latitude);
  const p2 = rad(to.latitude);
  const dp = p2 - p1;
  const dl = rad(to.longitude - from.longitude);
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const distanceNm = 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(dl) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const bearing = (deg(Math.atan2(y, x)) + 360) % 360;
  return { distanceNm, bearing };
}

/** Where a flight is `seconds` later at its speed and heading (dead reckoning). */
export function advance(flight: Flight, seconds: number): Flight {
  if (
    flight.onGround ||
    flight.speedKnots === null ||
    flight.headingDegrees === null ||
    seconds <= 0
  )
    return flight;
  const nm = (flight.speedKnots * Math.min(seconds, 60)) / 3600;
  const d = nm / EARTH_NM;
  const h = rad(flight.headingDegrees);
  const p1 = rad(flight.latitude);
  const l1 = rad(flight.longitude);
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(h),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(h) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return { ...flight, latitude: deg(p2), longitude: deg(l2) };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function compassPoint(bearing: number): string {
  return COMPASS[Math.floor((((bearing % 360) + 360) % 360) / 45 + 0.5) % 8];
}

export function trendValue(fpm: number | null): -1 | 0 | 1 {
  if (fpm === null || Math.abs(fpm) < 100) return 0;
  return fpm > 0 ? 1 : -1;
}

export function trendText(fpm: number | null): string {
  return { 1: "CLB", 0: "LVL", [-1]: "DES" }[trendValue(fpm)];
}

export function distanceText(nm: number): string {
  return nm < 10 ? `${nm.toFixed(1)}NM` : `${Math.round(nm)}NM`;
}

export function altitudeText(feet: number | null): string {
  return feet === null ? "ALT?" : `${Math.round(feet)}FT`;
}

/** Only what the panel's font can draw: capitals, digits, ".", "-", "?" and spaces. */
export function matrixText(value: string): string {
  const kept = value.toUpperCase().replace(/[^A-Z0-9.\-? ]/g, "");
  return kept.trim() || "UNKNOWN";
}

export interface Contact {
  label: string;
  distanceNm: number;
  bearing: number;
  trend: -1 | 0 | 1;
  nearest: boolean;
}

export interface Reading {
  contacts: Contact[];
  /** The nearest airborne flight, with what the panel prints for it. */
  nearest: {
    flight: Flight;
    distanceNm: number;
    bearing: number;
    label: string;
    detail: [string, string];
    compass: string;
    distance: string;
    trend: -1 | 0 | 1;
  } | null;
}

/** Every flight in range, nearest first, and the panel's text for the nearest. */
export function readRadar(
  snapshot: Snapshot,
  flights = snapshot.flights,
): Reading {
  const placed = flights
    .filter((f) => !f.onGround)
    .map((flight) => ({ flight, ...rangeAndBearing(snapshot.center, flight) }))
    .filter((p) => p.distanceNm <= snapshot.rangeNm)
    .sort((a, b) => a.distanceNm - b.distanceNm);
  const first = placed[0];
  const contacts = placed.map((p, i) => ({
    label: p.flight.label,
    distanceNm: p.distanceNm,
    bearing: p.bearing,
    trend: trendValue(p.flight.verticalRateFpm),
    nearest: i === 0,
  }));
  if (!first) return { contacts, nearest: null };
  const f = first.flight;
  const speed =
    f.speedKnots === null ? "--KT" : `${Math.round(f.speedKnots)}KT`;
  return {
    contacts,
    nearest: {
      flight: f,
      distanceNm: first.distanceNm,
      bearing: first.bearing,
      label: f.label,
      detail: [
        matrixText(
          [f.type, altitudeText(f.altitudeFeet)].filter(Boolean).join(" "),
        ),
        matrixText(`${speed} ${trendText(f.verticalRateFpm)}`),
      ],
      compass: compassPoint(first.bearing),
      distance: distanceText(first.distanceNm),
      trend: trendValue(f.verticalRateFpm),
    },
  };
}

/* ------------------------------------------------------------- the font */

const GLYPHS: Record<string, readonly string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["#.#", "###", "###", "###", "#.#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "###", ".##"],
  R: ["##.", "#.#", "###", "##.", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", ".##"],
  V: ["#.#", "#.#", "#.#", ".#.", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", "#..", "#.."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
  ".": ["...", "...", "...", "...", ".#."],
  "-": ["...", "...", "###", "...", "..."],
  "?": ["##.", "..#", ".#.", "...", ".#."],
  " ": ["...", "...", "...", "...", "..."],
};

/** A glyph as 5 rows of 3 columns; anything the font lacks draws as "?". */
export function glyph(char: string): boolean[][] {
  return (GLYPHS[char] ?? GLYPHS["?"]).map((row) =>
    [...row].map((cell) => cell === "#"),
  );
}

export const GLYPH_W = 3;
export const GLYPH_H = 5;
/** Width of `text` in panel pixels at `scale`: 3 per glyph and 1 between. */
export function textWidth(text: string, scale = 1): number {
  return text.length ? (text.length * (GLYPH_W + 1) - 1) * scale : 0;
}

/** As much of `text` as fits in `width` pixels. */
export function fitText(text: string, width: number, scale = 1): string {
  let out = text;
  while (out && textWidth(out, scale) > width) out = out.slice(0, -1);
  return out.trimEnd();
}

/** The panel pixels `text` lights, from (x, y), at `scale`. */
export function textPixels(
  text: string,
  x: number,
  y: number,
  scale = 1,
): Array<[number, number]> {
  const lit: Array<[number, number]> = [];
  [...text].forEach((char, i) => {
    const g = glyph(char);
    const left = x + i * (GLYPH_W + 1) * scale;
    g.forEach((row, r) =>
      row.forEach((on, c) => {
        if (!on) return;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++)
            lit.push([left + c * scale + dx, y + r * scale + dy]);
      }),
    );
  });
  return lit;
}

/* ------------------------------------------------------------- layout */

export interface Layout {
  labelScale: number;
  rows: [number, number];
  center: [number, number];
  radius: number;
}

/** The 64 × 64 layout: the callsign as large as fits, two detail rows, then the radar. */
export function layout(label: string): Layout {
  const labelScale = textWidth(label, 2) <= PANEL - 2 ? 2 : 1;
  const first = GLYPH_H * labelScale + 2;
  const rows: [number, number] = [first, first + GLYPH_H + 1];
  const block = rows[1] + GLYPH_H + 1;
  const diameter = PANEL - block - 1;
  const radius = Math.max(3, Math.floor((diameter - 1) / 2));
  return { labelScale, rows, center: [PANEL / 2, PANEL - radius - 2], radius };
}

/** A contact's pixel on the radar, or null past the range. */
export function radarPoint(
  distanceNm: number,
  bearing: number,
  rangeNm: number,
  { center, radius }: Pick<Layout, "center" | "radius">,
): [number, number] | null {
  if (rangeNm <= 0 || distanceNm > rangeNm) return null;
  const a = rad(bearing);
  const r = (radius * distanceNm) / rangeNm;
  return [
    Math.round(center[0] + Math.sin(a) * r),
    Math.round(center[1] - Math.cos(a) * r),
  ];
}

/** Pixels on a dashed midpoint circle: every other one, so rings sit under the contacts. */
export function dashedCircle(
  center: [number, number],
  radius: number,
): Array<[number, number]> {
  if (radius < 2) return [];
  const out: Array<[number, number]> = [];
  let x = radius;
  let y = 0;
  let error = 1 - radius;
  let index = 0;
  while (x >= y) {
    if (index % 2 === 0) {
      for (const [ox, oy] of [
        [x, y],
        [y, x],
        [-y, x],
        [-x, y],
        [-x, -y],
        [-y, -x],
        [y, -x],
        [x, -y],
      ])
        out.push([center[0] + ox, center[1] + oy]);
    }
    index++;
    y++;
    if (error < 0) error += 2 * y + 1;
    else {
      x--;
      error += 2 * (y - x) + 1;
    }
  }
  return out;
}

/** How bright a contact is, from where the sweep is: brightest as it passes. */
export function afterglow(sweepDeg: number, bearing: number): number {
  const since = (((sweepDeg - bearing) % 360) + 360) % 360;
  return since < AFTERGLOW_DEG
    ? 1 - (since / AFTERGLOW_DEG) * (1 - AFTERGLOW_FLOOR)
    : AFTERGLOW_FLOOR;
}

export function dim(color: Rgb, k: number): Rgb {
  const f = Math.max(0, Math.min(1, k));
  return [
    Math.round(color[0] * f),
    Math.round(color[1] * f),
    Math.round(color[2] * f),
  ];
}

/* ------------------------------------------------------------- the sample */

/** A plane in the sample, crossing the radar on a straight line. */
export interface SampleFlight {
  label: string;
  type: string;
  /** Feet where its line passes closest to the centre. */
  altitudeFeet: number;
  speedKnots: number;
  headingDegrees: number;
  verticalRateFpm: number;
  /** How far its line passes from the centre, to the right of its heading. */
  offsetNm: number;
  /** Where along its line it starts, 0 to 1. */
  phase: number;
}

/**
 * What the panel flies when the feed has no planes in range: Seattle's sky on
 * a normal day, with arrivals coming down over the city toward Sea-Tac,
 * departures climbing out, a Cessna over Lake Washington and an overflight.
 * Real airline codes, made-up flight numbers.
 */
export const SAMPLE_FLIGHTS: readonly SampleFlight[] = [
  {
    label: "ASA1083",
    type: "B39M",
    altitudeFeet: 4600,
    speedKnots: 190,
    headingDegrees: 166,
    verticalRateFpm: -900,
    offsetNm: -1.2,
    phase: 0.42,
  },
  {
    label: "QXE2367",
    type: "E75L",
    altitudeFeet: 7200,
    speedKnots: 230,
    headingDegrees: 170,
    verticalRateFpm: -1100,
    offsetNm: 2.6,
    phase: 0.08,
  },
  {
    label: "UAL1922",
    type: "B739",
    altitudeFeet: 3400,
    speedKnots: 175,
    headingDegrees: 163,
    verticalRateFpm: -800,
    offsetNm: -0.4,
    phase: 0.86,
  },
  {
    label: "DAL1471",
    type: "A321",
    altitudeFeet: 9800,
    speedKnots: 280,
    headingDegrees: 345,
    verticalRateFpm: 2200,
    offsetNm: 6.5,
    phase: 0.27,
  },
  {
    label: "SWA2840",
    type: "B38M",
    altitudeFeet: 12000,
    speedKnots: 300,
    headingDegrees: 20,
    verticalRateFpm: 1800,
    offsetNm: -7,
    phase: 0.63,
  },
  {
    label: "N512KW",
    type: "C172",
    altitudeFeet: 1500,
    speedKnots: 95,
    headingDegrees: 95,
    verticalRateFpm: 0,
    offsetNm: 3.8,
    phase: 0.5,
  },
  {
    label: "AAL2390",
    type: "A21N",
    altitudeFeet: 15000,
    speedKnots: 320,
    headingDegrees: 250,
    verticalRateFpm: 0,
    offsetNm: -10,
    phase: 0.15,
  },
];

/** How far past the range a sample plane flies before it comes back round. */
const SAMPLE_REACH = 1.15;

/**
 * The sample `seconds` in. Each plane flies its line at its own speed, leaves
 * past the range and comes back in from the other side, so it never jumps
 * where it can be seen.
 */
export function sampleSnapshot(
  seconds: number,
  center = DEFAULT_CENTER,
  rangeNm = DEFAULT_RANGE_NM,
): Snapshot {
  const reach = rangeNm * SAMPLE_REACH;
  const flights: Flight[] = SAMPLE_FLIGHTS.map((s) => {
    const half = Math.sqrt(Math.max(0, reach ** 2 - s.offsetNm ** 2));
    const length = 2 * half;
    const travelled = s.phase * length + (s.speedKnots * seconds) / 3600;
    const along = (((travelled % length) + length) % length) - half;
    const h = rad(s.headingDegrees);
    const north = along * Math.cos(h) - s.offsetNm * Math.sin(h);
    const east = along * Math.sin(h) + s.offsetNm * Math.cos(h);
    const minutes = (along / s.speedKnots) * 60;
    const feet = s.altitudeFeet + s.verticalRateFpm * minutes;
    return {
      label: s.label,
      type: s.type,
      latitude: center.latitude + north / 60,
      longitude:
        center.longitude + east / (60 * Math.cos(rad(center.latitude))),
      altitudeFeet: Math.max(800, Math.round(feet / 25) * 25),
      speedKnots: s.speedKnots,
      headingDegrees: s.headingDegrees,
      verticalRateFpm: s.verticalRateFpm,
      onGround: false,
    };
  });
  return { center, rangeNm, flights, status: "sample", at: 0 };
}

/** The sentence under the panel, which is also what a screen reader hears. */
export function describe(
  reading: Reading,
  rangeNm: number,
  sample = false,
): string {
  const n = reading.contacts.length;
  const planes = `${n} plane${n === 1 ? "" : "s"} within ${rangeNm} nautical miles`;
  const count = sample
    ? `Sample flights, shown while the live feed has no planes near Seattle: ${planes}.`
    : n === 0
      ? `No planes within ${rangeNm} nautical miles of Seattle right now.`
      : `${planes} of Seattle right now.`;
  const near = reading.nearest;
  if (!near) return count;
  const f = near.flight;
  const parts = [
    f.type ? `a ${f.type}` : null,
    f.altitudeFeet !== null
      ? `at ${Math.round(f.altitudeFeet).toLocaleString("en-US")} ft`
      : null,
  ].filter(Boolean);
  return `${count} Nearest is ${f.label}${parts.length ? `, ${parts.join(" ")}` : ""}, ${near.distanceNm.toFixed(1)} nautical miles ${compassWord(near.bearing)}.`;
}

const WORDS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
];
function compassWord(bearing: number): string {
  return WORDS[COMPASS.indexOf(compassPoint(bearing))];
}
