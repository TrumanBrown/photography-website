/**
 * Narrow nature (Day list in the code) - a daily puzzle that asks you to read
 * a community rather than a single organism.
 *
 * Six species were all recorded at one real place in one month. They arrive one
 * at a time, the one whose sightings spread widest around the place first, so
 * the first one gets you to the right part of the world and the last one is
 * nearly the answer. Each draws a ring round the pin of how far from the place
 * half its sightings are, so the map shows how much it narrows. You pin the
 * place and choose the month, once. Every species you ask for lowers the most
 * you can score, and the board shows both that ceiling ("Up to 5,400 points")
 * and what the next species costs, so the trade is visible before you make it.
 *
 * Two modes share the board. Today's list is the same round for everyone,
 * picked by date from day-list.json. More lists deals up to ten a day per
 * browser from day-list-extra.json, a separate set of places, so an extra list
 * can never spoil a future daily one. Both modes remember a round in progress,
 * so reloading can't reset how many species you've seen.
 *
 * It plays as one full-screen pixel world (mock D, 2026-11-24): the map at a
 * quarter of its resolution in a day or a night palette (./day-list-pixel),
 * the rings in colours picked from each species' photo (./day-list-tints), a
 * hand of six cards, and on Lock it in the bullseye slides to the place and a
 * red finder box closes in on it before the verdict drops in.
 *
 * Puzzle data is built at release time by scripts/build-day-list.mjs. Photos
 * come from the iNaturalist CDN already allow-listed in the site's CSP, so the
 * island makes no runtime API calls. The map (zoom, terrain, gestures) is
 * ./day-list-map.
 *
 * Mounted by src/components/hobbies/DayList.astro via [data-daylist] hooks.
 */
import { covered, whenUncovered } from "../covered";
import { initUnderlineTabs, prefersReducedMotion } from "../motion";
import { PRESS_DOWN_MS, createPinMotion } from "./pin-drop";
import {
  MAX_ZOOM,
  answerView,
  createWorldMap,
  graticuleStep,
  type Box,
  type Inset,
  type LonLat,
  type WorldMap,
} from "./day-list-map";
import {
  ENCODED,
  PALETTES,
  PIN,
  PIN_PRESS,
  PIN_SQUASH,
  circle,
  computeGeo,
  destination,
  disc,
  drawToken,
  line,
  outlined,
  px,
  rasterRing,
  recolour,
  shade,
  sprite,
  type Frame,
  type Geo,
  type Grid,
} from "./day-list-pixel";
import {
  assignTints,
  hexRgb,
  photoHues,
  punch,
  ringFor,
  type Peak,
  type RGB,
  type Tint,
} from "./day-list-tints";
import {
  VERDICTS,
  countEase,
  flashAt,
  headAt,
  hitEnds,
  revealPlan,
  ripplesAt,
  settledAt,
  shadeAt,
  tapeKm,
  tierFor,
  type RevealPlan,
  type Tier,
} from "./day-list-reveal";
import puzzles from "./day-list.json";
import { nameParts } from "./day-list-names";
import { speciesName } from "../species-name";
import { siteConfig } from "../../../site.config";

interface Clue {
  id: number;
  name: string;
  sci: string;
  group: string;
  /** Worldwide iNaturalist observations: how often it is recorded, not range. */
  global: number;
  /** Observations at this place in this month. */
  local: number;
  /**
   * Km from the place holding half its research-grade records worldwide. The
   * six run from the widest to the most local. Null for a species that filled
   * a round with nothing better left, and missing from a set built before
   * November 2026; either way the card shows `global` instead.
   */
  reach?: number | null;
  /** Standing at this place, by majority of the place's flagged records. */
  standing: "native" | "introduced" | "endemic";
  fact: string;
  wiki: string;
  /** IUCN or regional conservation rank, where iNaturalist publishes one. */
  rank: string;
  photo: string;
  by: string;
  licence: string;
  photoSource: string;
}

export interface Round {
  placeId: number;
  name: string;
  region: string;
  official: string;
  month: number;
  /** Published place boundary. A pin inside it is exactly right. */
  bbox: Box;
  clues: Clue[];
}

type Mode = "daily" | "extra";

/** Where a round stands: species shown, the guess so far, locked in or not. */
export interface Progress {
  lines: number;
  lat?: number;
  lon?: number;
  month?: number;
  done: boolean;
}

/** More lists, per browser. `played` and `scores` are today's. */
export interface ExtraState {
  day: number;
  played: number[];
  scores: Record<string, number>;
  /** Every extra place this browser has started, oldest first. */
  seen: number[];
  current: (Progress & { placeId: number }) | null;
}

const DATA = puzzles as { built: string; source: string; rounds: Round[] };
const ROUNDS = DATA.rounds;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Reading further makes the answer easier, so the place is worth less. */
const CLUE_MULTIPLIER = [1, 0.88, 0.76, 0.65, 0.55, 0.46];
const MAX_PLACE_POINTS = 5000;
const MAX_MONTH_POINTS = 1000;

const DAILY_KEY = "day-list-v2";
const EXTRA_KEY = "day-list-extra-v1";
/** Extra lists a browser can start in a day. The pool is finite, so pace it. */
export const EXTRA_PER_DAY = 10;

const MAP_LABEL =
  "World map. Each species draws a ring round your pin, as far as half its sightings are from the spot. Tap where you think the six were seen. Arrow keys move the pin, plus and minus zoom.";

// The page is in English, so dates and numbers are too.
const DATE_LONG = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const DATE_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
});
const count = (value: number): string =>
  Math.round(value).toLocaleString("en-US");
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * A reach rounded up to two figures, so "half within" stays true: 3,229 km
 * reads 3,300 and 747 reads 750.
 */
export function reachKm(km: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(km)) - 1);
  return Math.ceil(km / step) * step;
}

/** The line under a species name, read out for each card. */
export function reachLine(clue: Pick<Clue, "reach" | "global">): string {
  return clue.reach
    ? `Half its sightings within ${count(reachKm(clue.reach))} km of the spot`
    : `${count(clue.global)} sightings worldwide`;
}

/** What the banner says for a guess `km` from the place. */
export function verdictFor(km: number): string {
  return VERDICTS[tierFor(km)];
}

const degrees = (v: number, pos: string, neg: string) =>
  `${Math.abs(v).toFixed(1)}° ${v >= 0 ? pos : neg}`;

/** "43.4° N · 142.5° E", the way the hobby scene's finder box labels a spot. */
export function coords(at: LonLat): string {
  return `${degrees(at.lat, "N", "S")} · ${degrees(at.lon, "E", "W")}`;
}

function todayNumber(): number {
  const now = new Date();
  return Math.floor(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000,
  );
}

function readStore(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStore(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing; the puzzle still plays, it just won't persist */
  }
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Today's daily round from storage. Saves from before rounds were remembered in
 * progress have no `done`, but they were only ever written at lock-in.
 */
export function readDaily(raw: unknown, day: number): Progress | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<Progress> & { day?: number };
  if (s.day !== day) return null;
  const guessed = isNum(s.lat) && isNum(s.lon) && isNum(s.month);
  return {
    lines: isNum(s.lines) ? s.lines : 1,
    lat: isNum(s.lat) ? s.lat : undefined,
    lon: isNum(s.lon) ? s.lon : undefined,
    month: isNum(s.month) ? s.month : undefined,
    done: guessed && (typeof s.done === "boolean" ? s.done : true),
  };
}

/** More lists from storage, with today's count reset when the day turns. */
export function readExtra(raw: unknown, day: number): ExtraState {
  const fresh: ExtraState = {
    day,
    played: [],
    scores: {},
    seen: [],
    current: null,
  };
  if (!raw || typeof raw !== "object") return fresh;
  const s = raw as Partial<ExtraState>;
  const seen = Array.isArray(s.seen) ? s.seen.filter(isNum) : [];
  const current =
    s.current && typeof s.current === "object" && isNum(s.current.placeId)
      ? s.current
      : null;
  if (s.day !== day) {
    // A list left half-played on an earlier day carries over, as today's first.
    const carry = current && !current.done ? current : null;
    return {
      ...fresh,
      seen,
      played: carry ? [carry.placeId] : [],
      current: carry,
    };
  }
  return {
    day,
    seen,
    current,
    played: Array.isArray(s.played) ? s.played.filter(isNum) : [],
    scores:
      s.scores && typeof s.scores === "object"
        ? (s.scores as Record<string, number>)
        : {},
  };
}

/**
 * The next extra place: one this browser hasn't started, or once they've all
 * been played, the one started longest ago.
 */
export function pickExtra(
  pool: number[],
  seen: number[],
  random: () => number = Math.random,
): number {
  const unseen = pool.filter((id) => !seen.includes(id));
  if (unseen.length) return unseen[Math.floor(random() * unseen.length)];
  return seen.find((id) => pool.includes(id)) ?? pool[0];
}

function haversineKm(a: LonLat, b: LonLat): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point of a place's boundary closest to a pin, or the pin if inside. */
function nearestPoint(pin: LonLat, bbox: Box): LonLat {
  return {
    lat: clamp(pin.lat, bbox.s, bbox.n),
    lon: clamp(pin.lon, bbox.w, bbox.e),
  };
}

/**
 * Distance from a guess to the place itself, not to its centre. Madagascar is
 * 1,500 km long: a pin on its north coast is a correct answer, and scoring it
 * against a centroid would call that a 700 km miss.
 */
function distanceToPlace(pin: LonLat, bbox: Box): number {
  const edge = nearestPoint(pin, bbox);
  if (edge.lat === pin.lat && edge.lon === pin.lon) return 0; // inside
  return haversineKm(pin, edge);
}

function monthsApart(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
}

/** The most a guess can score once `lines` species are showing. */
export function bestPossible(lines: number): number {
  const index = Math.min(Math.max(lines, 1), CLUE_MULTIPLIER.length) - 1;
  return (
    Math.round(MAX_PLACE_POINTS * CLUE_MULTIPLIER[index]) + MAX_MONTH_POINTS
  );
}

/** Points for a guess. `month` is 0-11; the round's is 1-12. */
export function scoreGuess(
  round: Pick<Round, "bbox" | "month">,
  guess: LonLat & { month: number; lines: number },
) {
  const km = distanceToPlace(guess, round.bbox);
  const used = clamp(Math.round(guess.lines), 1, CLUE_MULTIPLIER.length);
  const multiplier = CLUE_MULTIPLIER[used - 1];
  const placePoints = Math.round(
    MAX_PLACE_POINTS * Math.exp(-km / 1800) * multiplier,
  );
  const off = monthsApart(guess.month, round.month - 1);
  const monthPoints = Math.max(0, Math.round(MAX_MONTH_POINTS * (1 - off / 6)));
  return {
    km,
    off,
    used,
    placePoints,
    monthPoints,
    score: placePoints + monthPoints,
  };
}

type Scored = ReturnType<typeof scoreGuess>;

/**
 * Where the straight line from a pin to a place's middle crosses into its
 * boundary, as a share of the way (0 when the pin is already inside). The
 * line the bullseye leaves behind stops there, since the distance is
 * measured to the boundary.
 */
export function entryFraction(pin: LonLat, to: LonLat, box: Box): number {
  const axis = (a: number, q: number, lo: number, hi: number) =>
    a < lo ? (lo - a) / (q - a) : a > hi ? (hi - a) / (q - a) : 0;
  return clamp(
    Math.max(
      0,
      axis(pin.lon, to.lon, box.w, box.e),
      axis(pin.lat, to.lat, box.s, box.n),
    ),
    0,
    1,
  );
}

/** Where to send people from the share text. */
const SHARE_URL = `${siteConfig.domain}/hobbies/narrow-nature`;

/**
 * The daily result as text to paste: which list and day, a square per species
 * (a book for each one read), one for how far and one for the month, the
 * numbers, and where to play. The squares are the grid people expect from
 * daily puzzles; the page itself never shows emoji.
 */
export function shareText(result: {
  list: number;
  date: Date;
  km: number;
  off: number;
  used: number;
  total: number;
  score: number;
}): string {
  const { km, off, used, total, score } = result;
  let read = "";
  for (let i = 0; i < total; i++) read += i < used ? "\u{1F4D6}" : "\u2B1C";
  // The same tiers and colours as the verdict banner (./day-list-reveal).
  const distance = [
    "\u{1F7E5}",
    "\u{1F7E7}",
    "\u{1F7E8}",
    "\u{1F7E9}",
    "\u{1F3AF}",
  ][tierFor(km)];
  const season =
    off === 0
      ? "\u{1F7E9}"
      : off <= 1
        ? "\u{1F7E8}"
        : off <= 3
          ? "\u{1F7E7}"
          : "\u2B1C";
  const where =
    km === 0 ? "inside the boundary" : `${count(Math.round(km))} km off`;
  return [
    `Narrow nature list ${result.list}, ${DATE_SHORT.format(result.date)}`,
    read,
    `${distance}${season}`,
    `${where} \u00b7 ${used}/${total} species \u00b7 ${count(score)}`,
    SHARE_URL,
  ].join("\n");
}

const STANDING_LABEL: Record<Clue["standing"], string> = {
  native: "",
  introduced: "Introduced here",
  endemic: "Found nowhere else",
};

const IPA = "ˈˌːəæɑɪʊŋʃʒθðɔɛʌɒɜɐɾʔ";
const IPA_IN_BRACKETS = new RegExp(
  `\\s*\\((?=[^()]*[${IPA}])[^()]*\\/[^()]*\\)`,
  "g",
);
const IPA_BARE = new RegExp(`\\s*\\/(?=[^/\\s]*[${IPA}])[^/\\s]+\\/`, "g");
// Wikipedia's audio link, which can sit inside the pronunciation bracket.
const LISTEN = /\s*\(\s*listen\s*\)/gi;

// Words a period can follow without ending the sentence: an initial ("P.
// aethiopicus"), a dotted short form ("U.S.", "e.g.") or a common abbreviation.
const NOT_AN_END =
  /(?:^|[\s(])(?:[A-Za-z]|(?:[A-Za-z]\.)+[A-Za-z]|approx|ca|cf|etc|var|subsp|ssp|spp?|vs|St|Mt|Mr|Mrs|Ms|Dr|Jr|Sr|No|Fr|Ft)$/;

/** The text up to the end of its first sentence. */
function firstSentence(text: string): string {
  const end = /[.!?]['")\]]*\s+(?=["'(]?[A-Z0-9])/g;
  for (const match of text.matchAll(end)) {
    const before = text.slice(0, match.index);
    if (match[0][0] === "." && NOT_AN_END.test(before)) continue;
    return text.slice(0, match.index + match[0].trimEnd().length);
  }
  return text;
}

/** Shorter than this, a fact is a stub ("...") rather than something to read. */
const MIN_FACT_LENGTH = 15;

/**
 * The fact for the full list, or "" when there's nothing worth a line.
 * Wikipedia's opening sentence repeats the Latin name in brackets and often
 * carries a pronunciation. Both sit right under a name that's already shown,
 * so they come out. A bracket needs an IPA letter to count as a
 * pronunciation, so "(25 mi/h)" survives. Only the first sentence shows, and
 * a stub or a sentence cut off with "..." doesn't show at all.
 */
export function tidyFact(fact: string, sci: string): string {
  const latin = new RegExp(
    `\\s*\\(\\s*${sci.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`,
    "g",
  );
  const tidy = firstSentence(
    fact
      .replace(LISTEN, "")
      .replace(IPA_IN_BRACKETS, "")
      .replace(IPA_BARE, "")
      .replace(latin, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;:])/g, "$1")
      .trim(),
  );
  if (tidy.length < MIN_FACT_LENGTH || /(\.\.\.|\u2026)$/.test(tidy)) return "";
  return tidy;
}

function escapeHtml(value: string): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}

/**
 * A species' name as a card shows it before the answer, any place in it a
 * bar (day-list-names.ts). Screen readers hear "place hidden" instead.
 */
function hiddenNameHtml(name: string): string {
  return (
    nameParts(speciesName(name))
      // The space beside a bar is a fixed one, which the card's line clamp
      // can't drop.
      .map((p) =>
        p.hidden
          ? `<span class="dl-hide" title="Hidden until you guess"><span class="dl-sr">place hidden</span></span>`
          : escapeHtml(p.text).replace(/^ | $/g, "&nbsp;"),
      )
      .join("")
  );
}

function hiddenNameText(name: string): string {
  return nameParts(speciesName(name))
    .map((p) => (p.hidden ? "place hidden" : p.text))
    .join("");
}

/**
 * The lines of the photo credits footnote, in board order. Only photos already
 * on the board are listed, because a photographer's name can give the place
 * away.
 */
export function photoCredits(clues: Round["clues"], shown: number): string {
  return clues
    .slice(0, Math.max(0, shown))
    .map(
      (clue) =>
        `<li>${escapeHtml(speciesName(clue.name))} &middot; &copy; ${escapeHtml(
          clue.by,
        )} &middot; <span class="dl-nowrap">${escapeHtml(clue.licence)}</span></li>`,
    )
    .join("");
}

/* ------------------------------------------------------------- motion */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = (t: number) => {
  const k = clamp(t, 0, 1);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
};
const easeOutBack = (t: number, s = 1.4) =>
  1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
const now = () => performance.now();
const reduced = () => prefersReducedMotion();
/** A duration, or none under reduced motion. */
const dur = (n: number) => (reduced() ? 0 : n);
const wait = (n: number): Promise<void> =>
  new Promise((r) => setTimeout(r, reduced() ? 0 : n));
const frames2 = (): Promise<void> =>
  new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  );

/** Tween over `ms`, calling `step` with an eased 0 to 1. */
function tween(
  ms: number,
  step: (t: number) => void,
  ease: (t: number) => number = easeOut,
): Promise<void> {
  if (reduced() || ms <= 0) {
    step(1);
    return Promise.resolve();
  }
  const t0 = now();
  return new Promise((resolve) => {
    const frame = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      step(ease(k));
      if (k < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/** Two significant figures, for a ring's tag as it rolls. */
const twoFigures = (km: number) => {
  if (km < 10) return Math.round(km);
  const step = 10 ** Math.max(0, Math.floor(Math.log10(km)) - 1);
  return Math.round(km / step) * step;
};

/* ------------------------------------------------------------- the photos */

interface PhotoEntry {
  img: HTMLImageElement;
  ready: Promise<HTMLImageElement>;
}

/** A photo read small: a 64 px copy, its strong colours, its token pixels. */
interface PhotoInfo {
  small: HTMLCanvasElement | null;
  hues: Peak[];
  tokens: Map<number, Uint8ClampedArray>;
}

const photos = new Map<string, PhotoEntry>();
const infos = new Map<string, Promise<PhotoInfo>>();

/**
 * Every copy of a clue photo loads with CORS, the cards' too, so the copy a
 * canvas reads to pick the ring's colour is never a cached one without the
 * header (iNaturalist's bucket varies on Origin).
 */
function photo(src: string): PhotoEntry {
  const known = photos.get(src);
  if (known) return known;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = src;
  const ready = img.decode().then(
    () => img,
    () => img,
  );
  const entry = { img, ready };
  photos.set(src, entry);
  return entry;
}

/** The photo, or after 350 ms whatever it has, so a slow one never holds a turn. */
function photoSoon(src: string): Promise<HTMLImageElement> {
  const e = photo(src);
  return Promise.race([
    e.ready,
    new Promise<HTMLImageElement>((r) => setTimeout(() => r(e.img), 350)),
  ]);
}

/** A square middle crop of `img`, `n` pixels across. */
function shrink(img: CanvasImageSource, n: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return c;
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  const iw =
    (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width;
  const ih =
    (img as HTMLImageElement).naturalHeight ||
    (img as HTMLCanvasElement).height;
  const s = Math.min(iw, ih);
  x.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, n, n);
  return c;
}

const NO_INFO = (): PhotoInfo => ({ small: null, hues: [], tokens: new Map() });

function photoInfo(src: string): Promise<PhotoInfo> {
  let known = infos.get(src);
  if (!known) {
    known = photo(src).ready.then((img) => {
      if (!img.naturalWidth) return NO_INFO();
      try {
        const small = shrink(img, 64);
        const data = small
          .getContext("2d", { willReadFrequently: true })!
          .getImageData(0, 0, 64, 64).data;
        return { small, hues: photoHues(data, 64), tokens: new Map() };
      } catch {
        // A canvas that can't be read: the slot's colour in the set will do.
        return NO_INFO();
      }
    });
    infos.set(src, known);
  }
  return known;
}

/** A photo as `n` x `n` punched-up pixels, for a token on its ring. */
function tokenPixels(
  info: PhotoInfo | null | undefined,
  n: number,
): Uint8ClampedArray | null {
  if (!info?.small) return null;
  let pix = info.tokens.get(n);
  if (!pix) {
    try {
      const c = shrink(info.small, n);
      pix = punch(
        c
          .getContext("2d", { willReadFrequently: true })!
          .getImageData(0, 0, n, n).data,
      );
    } catch {
      return null;
    }
    info.tokens.set(n, pix);
  }
  return pix;
}

/* ---------------------------------------------------------- the game */

/** One per species: its reach in km and where its ring's motion stands. */
interface RingState {
  km: number | null;
  shown: boolean;
  /** The tightening: from `from` km at `t0`, over `d` ms. */
  t0: number;
  d: number;
  from: number;
  /** Its photo is on its way from the card. */
  flying: boolean;
  /** When the photo landed on the ring (0 not yet). */
  landed: number;
}

/**
 * The answer as it plays: the line running out, the hold, the boundary, the
 * finder and the hit, paced by `plan` (./day-list-reveal).
 */
interface Answer {
  pin: LonLat;
  to: LonLat;
  /** How far along the line from the pin the boundary is. */
  frac: number;
  plan: RevealPlan;
  t0: number;
  /** Each wider ring follows this far behind the last. */
  lag: number;
  settle: number;
  boxT: number;
  findT: number;
  lockT: number;
  /** How far the hold has darkened the world round the answer, 0 to 1. */
  dim: number;
  /** When the finder locked on, for the flash and the ripples (0 not yet). */
  hitAt: number;
  /** The finder's box in CSS pixels, once it's drawn. */
  finder: Rect | null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a ring's token and tag went on the last frame. */
interface Lay {
  i: number;
  tok: { x: number; y: number } | null;
  centre: { x: number; y: number };
  rpx: number;
  css: { x: number; y: number } | null;
  cssCentre: { x: number; y: number };
  cssR: number;
}

/** A ring as one frame draws it. */
interface Item {
  i: number;
  g: RingState;
  km: number;
  labelKm: number;
  col: RGB;
  rank: number;
  c: LonLat;
  rpx: number;
}

/** A frame's pixels, their palette, and frame pixels to a CSS pixel. */
interface MapFrame extends Frame {
  s: number;
}

/** The camera's move to the answer. */
const CAMERA_MS = 820;
/**
 * Each result's colour on the map, by tier, matching the share squares: red
 * a world away, orange, yellow, green near, and the game's amber inside.
 * The verdict banner uses the same ones (DayList.astro).
 */
const TIER_RGB: Record<"day" | "night", RGB[]> = {
  day: ["#c8352c", "#ef7f22", "#f0d43a", "#4fae3c", "#ffb000"].map(hexRgb),
  night: ["#f0584f", "#f59238", "#f5dc4a", "#62c44c", "#ffb000"].map(hexRgb),
};
/** Each species' bearing round its ring, for its token. */
const BEARINGS = [-48, 30, -120, 120, -10, 70];
/** Under this radius, in map pixels, a ring shows as a dot. */
const DOT = 2.5;
/** The world keeps its own shape on a screen wider than this. */
const MAX_ASPECT = 2;
/** Laptops and up; under this the phone layout. */
const PHONE_BELOW = 760;
/**
 * Under this width the hand and the months only fit beside each other with
 * the hand in two rows, which needs some height: a screen this narrow and
 * shorter than PHONE_SHORT (a phone on its side, a small window) gets the
 * phone layout too.
 */
const NARROW_BELOW = 1010;
const PHONE_SHORT = 600;
/** A phone's cards, two rows of three photos: their height range, px. */
const CARD_MIN = 60;
const CARD_MAX = 180;

const meets = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const snapTo = (v: number, u: number) => Math.round(v / u) * u;

export function initDayList(root: HTMLElement): void {
  const q = <T extends Element>(selector: string) =>
    root.querySelector<T>(selector);
  const canvas = q<HTMLCanvasElement>("[data-daylist-map]");
  const surface = q<HTMLElement>("[data-daylist-mapwrap]");
  const labels = q<HTMLElement>("[data-daylist-labels]");
  const ui = q<HTMLElement>(".dl-ui");
  const tray = q<HTMLElement>("[data-daylist-clues]");
  const hand = q<HTMLElement>("[data-daylist-hand]");
  const guessPanel = q<HTMLElement>("[data-daylist-guess]");
  const lockBtn = q<HTMLButtonElement>("[data-daylist-lock]");
  const lockHint = q<HTMLElement>("[data-daylist-hint]");
  const resultSlot = q<HTMLElement>("[data-daylist-result]");
  const worthEl = q<HTMLElement>("[data-daylist-worth]");
  const stakes = q<HTMLElement>("[data-daylist-stakes]");
  const stakesUp = q<HTMLElement>("[data-daylist-stakes-up]");
  const readout = q<HTMLElement>("[data-daylist-reach-readout]");
  const reachEl = q<HTMLElement>("[data-daylist-reach]");
  const pickEl = q<HTMLElement>("[data-daylist-pick]");
  const titlePanel = q<HTMLElement>(".dl-title");
  const zoomBox = q<HTMLElement>(".dl-zoom");
  const monthBox = q<HTMLElement>("[data-daylist-months]");
  const monthKeys = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-daylist-month]"),
  );
  if (
    !canvas ||
    !surface ||
    !labels ||
    !ui ||
    !tray ||
    !hand ||
    !guessPanel ||
    !lockBtn ||
    !lockHint ||
    !resultSlot ||
    !worthEl ||
    !stakes ||
    !stakesUp ||
    !readout ||
    !reachEl ||
    !titlePanel ||
    !zoomBox ||
    !monthBox ||
    monthKeys.length !== MONTHS.length
  )
    return;

  const announce = q<HTMLElement>("[data-daylist-announce]");
  const metaEl = q<HTMLElement>("[data-daylist-meta]");
  const boardTitle = q<HTMLElement>("[data-daylist-title]");
  const modes = q<HTMLElement>("[data-daylist-modes]");
  const zoomInBtn = q<HTMLButtonElement>('[data-daylist-zoom="in"]');
  const zoomOutBtn = q<HTMLButtonElement>('[data-daylist-zoom="out"]');
  const viewBtn = q<HTMLButtonElement>("[data-daylist-view]");
  const howKey = q<HTMLButtonElement>("[data-daylist-how]");
  const howPanel = q<HTMLElement>("[data-daylist-howpanel]");
  const howRing = q<HTMLCanvasElement>("[data-daylist-howring]");
  const howClose = q<HTMLButtonElement>("[data-daylist-how-close]");
  const sheet = q<HTMLDialogElement>("[data-daylist-sheet]");
  const sheetClose = q<HTMLButtonElement>("[data-daylist-sheet-close]");
  const rollSlot = q<HTMLElement>("[data-daylist-roll]");
  const credits = q<HTMLDetailsElement>("[data-daylist-credits]");
  const creditList = q<HTMLElement>("[data-daylist-credit-list]");

  const day = todayNumber();
  const daily = ROUNDS[day % ROUNDS.length];
  const isDark = () => document.documentElement.classList.contains("dark");
  const coarse = window.matchMedia("(pointer: coarse)");

  let mode: Mode = "daily";
  let round = daily;
  let lines = 1;
  let pin: LonLat | null = null;
  let month: number | null = null;
  let done = false;
  let result: Scored | null = null;
  // Bumped whenever a round loads, so anything still playing for the last
  // round stops touching the board.
  let generation = 0;
  // True from "Lock it in" until the answer has landed on the map.
  let revealing = false;
  // Room the answer's framing keeps clear of the panels over the map.
  let answerRoom: Inset = {};
  let extraPool: Round[] | null = null;
  let extra = readExtra(readStore(EXTRA_KEY), day);
  // The pin dropping in, its rings, and the press on Lock it in.
  const pins = createPinMotion();

  let phone = false;
  let rings: RingState[] = [];
  let tints: Tint[] | null = null;
  let pinfo: (PhotoInfo | null)[] = [];
  // The hand is dealt: the photos are in, or have had their chance.
  let ready = false;
  /** The species whose card the mouse is on, its ring drawn thicker. */
  let hot: number | null = null;
  /** Where the bullseye is, and where it wants to be. */
  let centre: LonLat | null = null;
  let pointerAt: LonLat | null = null;
  let restAt: LonLat | null = null;
  let lastFrame = 0;
  /** The first ring opening out past its size and back as a list starts. */
  let breath: { t0: number; d: number } | null = null;
  let ans: Answer | null = null;
  let answerShown = false;
  /** The distance riding the line's head as it runs out to the place. */
  let tapeEl: HTMLElement | null = null;
  let lay: (Lay | undefined)[] = [];
  /**
   * The part of the map's canvas on screen, in its CSS pixels: all of it,
   * except on a phone after the answer, when it runs past both sides.
   */
  let vis: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** The species a phone's strip names: the one last tapped, or the newest. */
  let picked: number | null = null;
  /** A token's photo in map pixels, odd so it has a middle; the mock's 9 read as a blob of colour. */
  const TOK = 11;

  const tintOf = (i: number): Tint => tints?.[i] ?? ringFor(i);

  /* ---------------------------------------------------------------- map */

  // The draw pass reads its frame back every time, so the canvas keeps its
  // pixels where the CPU can reach them.
  canvas.getContext("2d", { willReadFrequently: true });
  const map = createWorldMap({
    canvas,
    surface,
    onTap: (at) => placePin(at, "tap"),
    focusPoint: () => pin ?? centre ?? null,
    drawOverlay: draw,
    onView: syncMapControls,
    wheelZoom: true,
    colours: () => ENCODED,
    pixelScale: () => (phone ? 0.5 : 0.25),
    maxAspect: MAX_ASPECT,
    shownWidth: () => (vis ? vis.x1 - vis.x0 : Infinity),
  });
  if (!map) return;
  const m: WorldMap = map;

  const visNow = () => vis ?? { x0: 0, y0: 0, x1: m.width, y1: m.height };

  let frame: MapFrame | null = null;
  let classes: Uint8Array | null = null;
  let geo: Geo | null = null;

  /** Recolour the map's frame into the palette, then draw the game on it. */
  function draw(ctx: CanvasRenderingContext2D, wm: WorldMap): void {
    const c = ctx.canvas;
    const W = c.width;
    const H = c.height;
    if (!W || !H || !wm.width) return;
    const P = isDark() ? PALETTES.night : PALETTES.day;
    const img = ctx.getImageData(0, 0, W, H);
    if (!classes || classes.length !== W * H) classes = new Uint8Array(W * H);
    const s = W / wm.width;
    const f: MapFrame = { d: img.data, W, H, P, s };
    recolour(f, classes, wm.project(0, -90).y * s, gridFor(wm, W, H, s));
    frame = f;
    // The hold darkens the map alone, so the pin, the line and the rings
    // stay lit; the flash goes over everything.
    if (ans && ans.dim > 0) darken(f, ans);
    let busy = drawGame(wm);
    if (ans && ans.hitAt) busy = flash(f, ans) || busy;
    ctx.putImageData(img, 0, 0);
    frame = null;
    if (busy) wm.redraw();
  }

  let grid: Grid | null = null;
  /**
   * The frame's columns and rows the graticule runs along, as far apart as
   * the map's own (graticuleStep), and on past the world's edges into the
   * sea on a wide screen.
   */
  function gridFor(wm: WorldMap, W: number, H: number, s: number): Grid {
    const cols =
      grid?.cols.length === W ? grid.cols.fill(0) : new Uint8Array(W);
    const rows =
      grid?.rows.length === H ? grid.rows.fill(0) : new Uint8Array(H);
    const step = graticuleStep(wm.worldWidth / 360);
    const nw = wm.unproject(0, 0);
    const se = wm.unproject(wm.width, wm.height);
    for (
      let lon = Math.ceil(nw.lon / step) * step;
      lon <= se.lon;
      lon += step
    ) {
      if (Math.abs(lon) % 360 === 180) continue;
      const x = Math.floor((Math.round(wm.project(lon, 0).x) + 0.5) * s);
      if (x >= 0 && x < W) cols[x] = 1;
    }
    for (
      let lat = Math.ceil(se.lat / step) * step;
      lat <= nw.lat;
      lat += step
    ) {
      if (Math.abs(lat) >= 90) continue;
      const y = Math.floor((Math.round(wm.project(0, lat).y) + 0.5) * s);
      if (y >= 0 && y < H) rows[y] = 1;
    }
    grid = { cols, rows };
    return grid;
  }

  /** A place on the frame, in whole frame pixels. */
  const at = (lon: number, lat: number) => {
    const p = m.project(lon, lat);
    return { x: Math.floor(p.x * frame!.s), y: Math.floor(p.y * frame!.s) };
  };
  /** A place on the frame, in fractional frame pixels, through the frame's geo. */
  const fx = (lon: number) => (lon - geo!.lon[0]) / geo!.dlon;
  const fy = (lat: number) => (lat - geo!.lat[0]) / geo!.dlat;
  /**
   * A world narrower than the canvas, with sea either side: a ring is drawn
   * once round its own middle, carrying on past the world's edge into the
   * sea, never again a world away (rasterRing's `once`).
   */
  let once = false;
  const narrowWorld = () => m.worldWidth / m.view.k < m.width - 1;
  /** Its copy a world over, when that's the one on the frame. */
  function fxIn(lon: number): number {
    let x = fx(lon);
    if (once) return x;
    const world = 360 / geo!.dlon;
    if (x < -0.5 && x + world <= geo!.W) x += world;
    else if (x > geo!.W - 0.5 && x - world >= 0) x -= world;
    return x;
  }
  /** A point on a ring, on the same copy of the world as the ring's middle. */
  function fxNear(lon: number, middle: number): number {
    let l = lon;
    while (l - middle > 180) l -= 360;
    while (middle - l > 180) l += 360;
    return fxIn(l);
  }
  /** A ring's radius in frame pixels, north to south. */
  const ringPx = (km: number) => km / 111.2 / Math.abs(geo!.dlat);

  /* --------------------------------------------- the rings, frame by frame */

  /** A ring's radius now: it tightens from `from` and snaps a touch past. */
  function kmAt(g: RingState, t: number): number {
    const km = g.km ?? 0;
    if (!g.d || t >= g.t0 + g.d) return km;
    if (t <= g.t0) return g.from;
    return g.from + (km - g.from) * easeOutBack((t - g.t0) / g.d, 1.25);
  }
  /** The figure on it, which rolls down without the snap. */
  function labelAt(g: RingState, t: number): number {
    const km = g.km ?? 0;
    if (!g.d || t >= g.t0 + g.d) return km;
    if (t <= g.t0) return g.from;
    return g.from + (km - g.from) * easeOut((t - g.t0) / g.d);
  }
  function breathAt(t: number): number | null {
    if (!breath) return null;
    const p = (t - breath.t0) / breath.d;
    if (p >= 1) {
      breath = null;
      return null;
    }
    if (p <= 0) return 0.4;
    if (p < 0.42) return lerp(0.4, 1.14, easeOut(p / 0.42));
    return lerp(1.14, 1, easeInOut((p - 0.42) / 0.58));
  }
  function newestShown(): number | null {
    let k: number | null = null;
    rings.forEach((g, i) => {
      if (g.shown && g.km) k = i;
    });
    return k;
  }
  function lensTarget(wm: WorldMap): LonLat {
    if (pin) return pin;
    if (pointerAt) return pointerAt;
    if (restAt) return restAt;
    return wm.unproject(wm.width / 2, wm.height / 2);
  }
  /**
   * During the answer each ring rides the line's head from the pin, then
   * drifts on into the place's middle, the wider ones a beat behind.
   */
  function slideCentre(rank: number, t: number): LonLat {
    const a = ans!;
    const p = headAt(a.plan, a.frac, t - a.t0 - rank * a.lag);
    return {
      lon: lerp(a.pin.lon, a.to.lon, p),
      lat: lerp(a.pin.lat, a.to.lat, p),
    };
  }
  const slidingUntil = () =>
    ans ? ans.t0 + settledAt(ans.plan, ans.frac) + 5 * ans.lag : 0;

  function drawGame(wm: WorldMap): boolean {
    const f = frame!;
    const P = f.P;
    const t = now();
    let busy = false;
    geo = computeGeo(geo, f.W, f.H, f.s, wm.unproject);
    once = narrowWorld();

    // The bullseye follows its target on a quick spring, so the lens trails
    // the mouse by a hair and a moved pin draws its rings across.
    const want = lensTarget(wm);
    const dt = lastFrame ? Math.min(50, Math.max(0, t - lastFrame)) : 16;
    lastFrame = t;
    if (!centre || reduced()) centre = { ...want };
    else {
      const k = 1 - Math.exp(-dt / (pin ? 70 : 30));
      centre = {
        lon: lerp(centre.lon, want.lon, k),
        lat: lerp(centre.lat, want.lat, k),
      };
      const gap = Math.hypot(
        (want.lon - centre.lon) / geo.dlon,
        (want.lat - centre.lat) / geo.dlat,
      );
      if (gap < 0.2) centre = { ...want };
      else busy = true;
    }

    const items: Item[] = [];
    const newest = newestShown();
    rings.forEach((g, i) => {
      if (!g.shown || !g.km || !ready) return;
      let km = kmAt(g, t);
      if (g.d && t < g.t0 + g.d) busy = true;
      if (i === 0) {
        const b = breathAt(t);
        if (b !== null) {
          km *= b;
          busy = true;
        }
      }
      if (ans && ans.settle && t < ans.settle + 700) {
        const p = (t - ans.settle) / 700;
        km *=
          1 + 0.06 * Math.exp(-3.5 * p) * Math.sin(p * Math.PI * 3 + i * 0.7);
        busy = true;
      }
      items.push({
        i,
        g,
        km,
        labelKm: labelAt(g, t),
        col: tintOf(i).rgb,
        rank: 0,
        c: centre!,
        rpx: 0,
      });
    });
    const bySize = [...items].sort((a, b) => b.km - a.km);
    bySize.forEach((it, rank) => (it.rank = bySize.length - 1 - rank));
    for (const it of items) {
      it.c = ans ? slideCentre(it.rank, t) : centre!;
      it.rpx = ringPx(it.km);
    }
    if (ans && t < slidingUntil()) busy = true;

    // The rings, widest first so the tight ones sit on top.
    for (const it of bySize) {
      if (it.rpx < DOT) continue;
      const thick = (it.i === newest && !ans) || hot === it.i ? 2 : 1;
      let tintK = 0;
      if (it.i === newest && !ans && !done && it.rpx >= 3) {
        const full = isDark() ? 0.16 : 0.1;
        tintK = full * clamp((t - it.g.t0) / 220, 0, 1);
        if (tintK < full) busy = true;
      }
      rasterRing(f, geo, it.c, it.km, thick, it.col, tintK, once);
    }
    // Rings too small to see at this zoom: a pixel dot for the tightest.
    const dots = items.filter((it) => it.rpx < DOT);
    let dotAt: { x: number; y: number } | null = null;
    const nw = items.find((it) => it.i === newest);
    if (!dots.length && nw && phone && wm.view.k < 1.5 && nw.rpx < 13) {
      dotAt = { x: Math.round(fxIn(nw.c.lon)), y: Math.round(fy(nw.c.lat)) };
    }
    if (dots.length) {
      const tight = dots.reduce((a, b) => (b.km < a.km ? b : a));
      const x = Math.round(fxIn(tight.c.lon));
      const y = Math.round(fy(tight.c.lat));
      outlined(
        f,
        [
          [x, y],
          [x + 1, y],
          [x, y + 1],
          [x + 1, y + 1],
        ],
        tight.col,
      );
      dotAt = { x, y };
    }

    if (ans) busy = drawAnswerUnder(t) || busy;
    busy = placeTokens(items, t) || busy;
    if (ans) drawFinder();
    if (ans?.hitAt) busy = drawRipples(t) || busy;
    if (drawPin()) busy = true;

    // With no pin and no mouse on the map, a small cross marks the lens's middle.
    if (!pin && !done && !pointerAt) {
      const x = Math.round(fxIn(centre!.lon));
      const y = Math.round(fy(centre!.lat));
      const arms: [number, number][] = [];
      for (const k of [2, 3])
        arms.push([x + k, y], [x - k, y], [x, y + k], [x, y - k]);
      outlined(f, arms, P.ring);
    }

    placeDom(items, newest, dotAt);
    if (tapeEl) placeTape(t);
    return busy;
  }

  /* ------------------------------------------------------------ the pin */

  /** The pin in its pose from the pin motion, as a sprite of whole pixels. */
  function drawPin(): boolean {
    const f = frame!;
    const P = f.P;
    const key = { o: P.ink, a: P.pin, h: P.pinHi, d: P.pinLo };
    const pf = pins.frame(pin);
    const u = f.s;
    for (const r of pf.rings) {
      const p = at(r.at.lon, r.at.lat);
      const rr = Math.max(2, Math.round(r.r * u * 1.3));
      circle(f, p.x, p.y, rr, r.alpha > 0.3 ? P.ring : P.dots, r.alpha < 0.42);
    }
    for (const l of pf.lifting) {
      if (l.pose.alpha < 0.3) continue;
      const p = at(l.at.lon, l.at.lat);
      sprite(
        f,
        PIN,
        3,
        7,
        p.x + Math.round(l.pose.x * u),
        p.y + Math.round(l.pose.y * u),
        { o: P.ink, a: P.pinLo, h: P.pin, d: P.pinLo },
      );
    }
    if (pin && pf.pin) {
      const p = at(pin.lon, pin.lat);
      const pose = pf.pin;
      shade(f, p.x - 1, p.y + 1, 0.55);
      shade(f, p.x, p.y + 1, 0.55);
      shade(f, p.x + 1, p.y + 1, 0.55);
      const x = p.x + Math.round(pose.x * u);
      const y = p.y + Math.round(pose.y * u);
      if (pose.alpha < 0.15) {
        // Still too high and faint to show.
      } else if (pose.sx > 1.05 && pose.sy < 0.95) {
        sprite(f, PIN_SQUASH, 4, 5, x, y, key);
      } else if (pose.sx < 0.94) {
        sprite(f, PIN_PRESS, 3, 6, x, y, key);
      } else {
        sprite(f, PIN, 3, 7, x, y, key);
      }
    }
    return pf.busy;
  }

  /* ---------------------------------------- tokens and tags on the rings */

  const blockCache = { v: -1, rects: [] as Rect[] };
  let blockVersion = 0;
  /** The panels over the map, in the map's CSS pixels, which tokens keep clear of. */
  function blockers(): Rect[] {
    if (blockCache.v === blockVersion) return blockCache.rects;
    const r = canvas!.getBoundingClientRect();
    const els = phone
      ? [readout, zoomBox]
      : [
          titlePanel,
          stakes,
          readout,
          zoomBox,
          hand,
          guessPanel,
          resultSlot,
          ui!.querySelector(":scope > .dl-banner"),
          howPanel,
        ];
    const rects: Rect[] = [];
    for (const el of els) {
      if (!(el instanceof HTMLElement) || el.hidden || !el.isConnected)
        continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || Number(style.opacity) < 0.1)
        continue;
      rects.push({
        x: b.left - r.left - 8,
        y: b.top - r.top - 8,
        w: b.width + 16,
        h: b.height + 16,
      });
    }
    blockCache.v = blockVersion;
    blockCache.rects = rects;
    return rects;
  }

  /** Put each ring's token on its ring where it clears everything, and draw it. */
  function placeTokens(items: Item[], t: number): boolean {
    const f = frame!;
    const s = f.s;
    const u = 1 / s;
    const full = TOK + 4;
    const half = full / 2;
    const blocks = blockers().map((b) => ({
      x: b.x * s,
      y: b.y * s,
      w: b.w * s,
      h: b.h * s,
    }));
    if (pin) {
      const p = at(pin.lon, pin.lat);
      blocks.push({ x: p.x - 4, y: p.y - 8, w: 9, h: 10 });
    }
    const placed: { x: number; y: number }[] = [];
    lay = [];
    let busy = false;
    const newestFirst = [...items].sort((a, b) => b.i - a.i);
    const V = visNow();
    for (const it of newestFirst) {
      const e: Lay = {
        i: it.i,
        tok: null,
        centre: { x: fxIn(it.c.lon), y: fy(it.c.lat) },
        rpx: it.rpx,
        css: null,
        cssCentre: { x: 0, y: 0 },
        cssR: 0,
      };
      lay[it.i] = e;
      if (it.rpx < full * 0.7) continue;
      const base = BEARINGS[it.i % BEARINGS.length];
      for (let step = 0; step < 31; step++) {
        const off =
          step === 0 ? 0 : Math.ceil(step / 2) * 12 * (step % 2 ? 1 : -1);
        const qd = destination(it.c.lat, it.c.lon, base + off, it.km);
        const p = {
          x: Math.round(fxNear(qd.lon, it.c.lon)),
          y: Math.round(fy(qd.lat)),
        };
        const me = { x: p.x - half, y: p.y - half, w: full, h: full };
        const inside =
          me.x >= V.x0 * s + 1 &&
          me.y >= V.y0 * s + 1 &&
          me.x + me.w <= V.x1 * s - 1 &&
          me.y + me.h <= V.y1 * s - 1;
        if (!inside || blocks.some((b) => meets(me, b))) continue;
        if (
          !placed.every(
            (o) => Math.abs(o.x - p.x) > full || Math.abs(o.y - p.y) > full,
          )
        ) {
          continue;
        }
        e.tok = p;
        placed.push(p);
        break;
      }
    }
    for (const it of newestFirst) {
      const e = lay[it.i]!;
      const g = it.g;
      if (!e.tok || g.flying) continue;
      if (!g.landed || t < g.landed) continue;
      const since = t - g.landed;
      const grow = since >= 0 && since < 90 ? 1 : 0;
      if (since < 320) busy = true;
      drawToken(
        f,
        e.tok.x,
        e.tok.y,
        TOK,
        tintOf(it.i).rgb,
        tokenPixels(pinfo[it.i], TOK),
        grow,
      );
      // It lands with a ring of pixels thrown off round it.
      if (since > 40 && since < 300) {
        const k = (since - 40) / 260;
        circle(
          f,
          e.tok.x,
          e.tok.y,
          Math.round(half + 1 + k * 4),
          k < 0.6 ? f.P.ring : tintOf(it.i).rgb,
          k > 0.35,
        );
      }
    }
    // Token and centre, in CSS pixels, for the flight and the tags.
    for (const e of lay) {
      if (!e) continue;
      e.css = e.tok ? { x: (e.tok.x + 0.5) * u, y: (e.tok.y + 0.5) * u } : null;
      e.cssCentre = { x: (e.centre.x + 0.5) * u, y: (e.centre.y + 0.5) * u };
      e.cssR = e.rpx * u;
    }
    return busy;
  }

  const labelEls: HTMLElement[] = [];
  function labelEl(i: number): HTMLElement {
    let el = labelEls[i];
    if (!el || !el.isConnected) {
      el = document.createElement("span");
      el.className = "dl-rk dl-px15";
      labels!.append(el);
      labelEls[i] = el;
    }
    return el;
  }
  let hintEl: HTMLElement | null = null;
  const widths = new Map<string, number>();
  let measurer: CanvasRenderingContext2D | null = null;
  function textW(text: string, font: string): number {
    const key = `${font}|${text}`;
    let w = widths.get(key);
    if (w === undefined) {
      measurer ??= document.createElement("canvas").getContext("2d");
      if (!measurer) return text.length * 9;
      measurer.font = font;
      w = Math.ceil(measurer.measureText(text).width);
      widths.set(key, w);
    }
    return w;
  }

  /** Each ring's km on its tag, the zoom hint, and the readout by the score. */
  function placeDom(
    items: Item[],
    newest: number | null,
    dotAt: { x: number; y: number } | null,
  ): void {
    const u = 1 / frame!.s;
    const V = visNow();
    const blocks = blockers().slice();
    if (pin) {
      const p = m.project(pin.lon, pin.lat);
      blocks.push({ x: p.x - 16, y: p.y - 34, w: 32, h: 40 });
    }
    for (const e of lay) {
      if (e?.css)
        blocks.push({ x: e.css.x - 26, y: e.css.y - 26, w: 52, h: 52 });
    }
    const taken: Rect[] = [];
    const fontPx = phone ? 15 : 18;
    const font = `${fontPx}px "Jersey 15"`;
    const showing = new Set<number>();
    const fits = (b: Rect) =>
      b.x >= V.x0 + 4 &&
      b.y >= V.y0 + 4 &&
      b.x + b.w <= V.x1 - 4 &&
      b.y + b.h <= V.y1 - 4;
    if (!done && ready) {
      const newestFirst = [...items].sort((a, b) => b.i - a.i);
      for (const it of newestFirst) {
        const e = lay[it.i];
        if (!e) continue;
        const g = it.g;
        // Before a ring's photo lands its figure already rolls where it will be.
        if (!e.css && it.i !== newest) continue;
        if (e.css && !g.flying && !(g.landed && now() >= g.landed)) continue;
        if (!e.css && it.rpx < DOT) continue;
        const text = `${count(twoFigures(it.labelKm))} km`;
        const w = textW(text, font) + (phone ? 10 : 14);
        const h = phone ? 20 : 24;
        const tokR = (TOK + 4) * u * 0.5;
        let spots: [number, number][];
        if (e.css) {
          const { x, y } = e.css;
          spots = [
            [x + tokR + 6, y - h / 2],
            [x - tokR - 6 - w, y - h / 2],
            [x - w / 2, y - tokR - 6 - h],
            [x - w / 2, y + tokR + 6],
          ];
        } else {
          const { x, y } = e.cssCentre;
          const r = e.cssR;
          spots = [
            [x + r * 0.74 + 8, y - r * 0.74 - h],
            [x - r * 0.74 - 8 - w, y - r * 0.74 - h],
            [x + r * 0.74 + 8, y + r * 0.74],
            [x - r * 0.74 - 8 - w, y + r * 0.74],
          ];
        }
        const box = ([sx, sy]: [number, number]) => ({ x: sx, y: sy, w, h });
        const free = (b: Rect) =>
          !blocks.some((o) => meets(b, o)) && !taken.some((o) => meets(b, o));
        let spot = spots.map(box).find((b) => fits(b) && free(b));
        if (!spot && it.i === newest) {
          spot = spots
            .map(box)
            .find((b) => fits(b) && !taken.some((o) => meets(b, o)));
        }
        if (!spot) continue;
        taken.push(spot);
        const el = labelEl(it.i);
        el.hidden = false;
        if (el.textContent !== text) el.textContent = text;
        el.style.color = tintOf(it.i).hex;
        el.classList.toggle("is-hot", hot === it.i);
        el.style.transform = `translate(${snapTo(spot.x, u)}px, ${snapTo(spot.y, u)}px)`;
        showing.add(it.i);
      }
    }
    labelEls.forEach((el, i) => {
      if (el && !showing.has(i)) el.hidden = true;
    });

    // Rings too small to see: a word on how to get in close.
    if (dotAt && !done && ready) {
      if (!hintEl) {
        hintEl = document.createElement("span");
        hintEl.className = "dl-rh dl-px15";
        labels!.append(hintEl);
      }
      const words =
        phone || coarse.matches ? "Pinch to zoom in" : "Scroll to zoom in";
      if (hintEl.textContent !== words) hintEl.textContent = words;
      const w = textW(words, font) + (phone ? 10 : 14);
      const h = phone ? 20 : 24;
      const x = (dotAt.x + 0.5) * u;
      const y = (dotAt.y + 0.5) * u;
      const spots = [
        [x + 14, y + 8],
        [x - 14 - w, y + 8],
        [x + 14, y - 8 - h - 30],
        [x - 14 - w, y - 8 - h - 30],
      ].map(([sx, sy]) => ({ x: sx, y: sy, w, h }));
      const spot =
        spots.find(
          (b) =>
            fits(b) &&
            !blocks.some((o) => meets(b, o)) &&
            !taken.some((o) => meets(b, o)),
        ) ??
        spots.find(fits) ??
        spots[0];
      hintEl.hidden = false;
      hintEl.style.transform = `translate(${snapTo(spot.x, u)}px, ${snapTo(spot.y, u)}px)`;
    } else if (hintEl) hintEl.hidden = true;

    // The readout by the score: the newest ring's figure, rolling with it.
    const it = items.find((x) => x.i === newest);
    if (it) {
      const text = count(twoFigures(it.labelKm));
      if (reachEl!.textContent !== text) reachEl!.textContent = text;
      readout!.style.setProperty("--g-c", tintOf(it.i).hex);
    } else if (ready && newest === null && reachEl!.textContent !== "?") {
      reachEl!.textContent = "?";
    }

    if (ans && answerShown) placeAnswerLabels();
  }

  /* ------------------------------------------------------------ the answer */

  /** The place's box on the frame, never smaller than 5 pixels. */
  function boxPx() {
    const b = round.bbox;
    const a = at(b.w, b.n);
    const z = at(b.e, b.s);
    const grow = (lo: number, hi: number): [number, number] => {
      const need = 5 - (hi - lo);
      return need > 0
        ? [lo - Math.ceil(need / 2), hi + Math.floor(need / 2)]
        : [lo, hi];
    };
    const [x0, x1] = grow(a.x, z.x);
    const [y0, y1] = grow(a.y, z.y);
    return { x0, y0, x1, y1 };
  }

  /** The line the bullseye leaves behind it, and the boundary inking in. */
  function drawAnswerUnder(t: number): boolean {
    const f = frame!;
    const a = ans!;
    const P = f.P;
    const ms = t - a.t0;
    const busy = t < slidingUntil();
    const head = headAt(a.plan, a.frac, ms);
    if (a.frac > 0 && pin) {
      const k = Math.min(head, a.frac);
      const from = at(a.pin.lon, a.pin.lat);
      const to = at(lerp(a.pin.lon, a.to.lon, k), lerp(a.pin.lat, a.to.lat, k));
      const pts = line(from.x, from.y, to.x, to.y);
      const march = Math.min(ms, settledAt(a.plan, a.frac));
      const phase = Math.floor(Math.max(0, march) / 90) % 4;
      // The short way round leaves one side of the map and comes back in at
      // the other, so the line is drawn a world over each way too.
      const world = Math.round(360 / Math.abs(geo!.dlon));
      for (const shift of once ? [0] : [0, world, -world]) {
        for (let i = 0; i < pts.length; i++) {
          if ((i + 4 - phase) % 4 < 2) {
            px(f, pts[i][0] + shift, pts[i][1] + 1, P.ink);
            px(f, pts[i][0] + shift, pts[i][1], P.line);
          }
        }
      }
    }
    if (a.boxT > 0) {
      const { x0, y0, x1, y1 } = boxPx();
      const per: [number, number][] = [];
      for (let x = x0; x <= x1; x++) per.push([x, y0]);
      for (let y = y0 + 1; y <= y1; y++) per.push([x1, y]);
      for (let x = x1 - 1; x >= x0; x--) per.push([x, y1]);
      for (let y = y1 - 1; y > y0; y--) per.push([x0, y]);
      const n = Math.round(per.length * Math.min(1, a.boxT));
      // It inks in both ways round from where the line touched it, or from
      // the side nearest the pin when the pin is inside.
      const touch = at(
        lerp(a.pin.lon, a.to.lon, a.frac),
        lerp(a.pin.lat, a.to.lat, a.frac),
      );
      let start = 0;
      let best = Infinity;
      per.forEach(([x, y], i) => {
        const d = (x - touch.x) ** 2 + (y - touch.y) ** 2;
        if (d < best) {
          best = d;
          start = i;
        }
      });
      const shown: [number, number][] = [];
      for (let k = 0; k < Math.ceil(n / 2); k++) {
        shown.push(per[(start + k) % per.length]);
        shown.push(per[(start - k + per.length * 2) % per.length]);
      }
      // On a close guess it inks in the result's colour as the finder
      // locks on, then settles to white.
      const hot = a.hitAt && a.plan.flash && now() - a.hitAt < 420;
      outlined(f, shown, hot ? tierRgb(a.plan.tier) : P.bound);
    }
    return busy;
  }

  /** A result's colour on the map, the same bands as the share squares. */
  function tierRgb(tier: Tier): RGB {
    return TIER_RGB[isDark() ? "night" : "day"][tier];
  }

  /**
   * The hold: the world darkens towards the map's ink in three steps round
   * a pool of light on the pin and the place, so the eye has nowhere else
   * to go.
   */
  function darken(f: MapFrame, a: Answer): void {
    const p = at(a.pin.lon, a.pin.lat);
    const q = at(a.to.lon, a.to.lat);
    const b = boxPx();
    const cx = (p.x + q.x) / 2;
    const cy = (p.y + q.y) / 2;
    const inner =
      Math.hypot(q.x - p.x, q.y - p.y) / 2 +
      Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * 0.3 +
      5;
    const outer = inner + Math.max(f.W, f.H) * 0.2;
    const [ir, ig, ib] = f.P.ink;
    const d = f.d;
    for (let y = 0; y < f.H; y++) {
      const dy = (y - cy) ** 2;
      for (let x = 0; x < f.W; x++) {
        const k = shadeAt(Math.sqrt((x - cx) ** 2 + dy), inner, outer, a.dim);
        if (!k) continue;
        const i = (y * f.W + x) * 4;
        d[i] += (ir - d[i]) * k;
        d[i + 1] += (ig - d[i + 1]) * k;
        d[i + 2] += (ib - d[i + 2]) * k;
      }
    }
  }

  /** The flash in the result's colour as the finder locks on. */
  function flash(f: MapFrame, a: Answer): boolean {
    const ms = now() - a.hitAt;
    const k = flashAt(a.plan, ms);
    if (k > 0) {
      const [r, g, b] = tierRgb(a.plan.tier);
      const d = f.d;
      for (let i = 0; i < d.length; i += 4) {
        d[i] += (r - d[i]) * k;
        d[i + 1] += (g - d[i + 1]) * k;
        d[i + 2] += (b - d[i + 2]) * k;
      }
    }
    return ms < hitEnds(a.plan);
  }

  /** Ripples running out from the pin as the finder locks on. */
  function drawRipples(t: number): boolean {
    const f = frame!;
    const a = ans!;
    const ms = t - a.hitAt;
    const runs = ripplesAt(a.plan, ms);
    if (!runs.length) return ms < hitEnds(a.plan);
    const p = at(a.pin.lon, a.pin.lat);
    const reach = Math.max(
      12,
      Math.min(f.W, f.H) * (a.plan.tier === 4 ? 0.26 : 0.2),
    );
    const col = tierRgb(a.plan.tier);
    for (const q of runs) {
      const r = Math.round(3 + (reach - 3) * easeOut(q));
      const dotted = q > 0.55;
      // Ink either side, so the colour reads on land of the same colour.
      circle(f, p.x, p.y, r + 1, f.P.ink, dotted);
      circle(f, p.x, p.y, r - 1, f.P.ink, dotted);
      circle(f, p.x, p.y, r, col, dotted);
    }
    return true;
  }

  /** The red finder: four brackets close in, pulse as they lock, grow ticks. */
  function drawFinder(): void {
    const a = ans!;
    if (!(a.findT > 0)) return;
    const f = frame!;
    const { x0, y0, x1, y1 } = boxPx();
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const tw = Math.max(4, (x1 - x0) / 2 + 3);
    const th = Math.max(4, (y1 - y0) / 2 + 3);
    const start = Math.max(f.W, f.H) * 0.62;
    const k = easeOutBack(a.findT, a.plan.overshoot);
    const pulse = Math.round(
      Math.sin(Math.PI * a.lockT) *
        Math.max(1, Math.min(tw, th) * (a.plan.stamp ? 0.3 : 0.18)),
    );
    // The snap past the place is two pixels at most, so it never swallows it.
    const hw = Math.round(Math.max(tw - 2, lerp(start, tw, k))) - pulse;
    const hh = Math.round(Math.max(th - 2, lerp(start, th, k))) - pulse;
    const arm = Math.round(clamp(Math.min(hw, hh) * 0.45, 2, 5));
    const pts: [number, number][] = [];
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const x = Math.round(cx + sx * hw);
      const y = Math.round(cy + sy * hh);
      for (let qd = 0; qd <= arm; qd++) {
        pts.push([x - sx * qd, y]);
        if (qd) pts.push([x, y - sy * qd]);
      }
    }
    const tick =
      a.lockT > 0.25
        ? Math.round(
            Math.min(3, Math.min(hw, hh) * 0.4) *
              clamp((a.lockT - 0.25) / 0.6, 0, 1),
          )
        : 0;
    for (let qd = 1; qd <= tick; qd++) {
      pts.push([Math.round(cx), Math.round(cy - hh + qd)]);
      pts.push([Math.round(cx), Math.round(cy + hh - qd)]);
      pts.push([Math.round(cx - hw + qd), Math.round(cy)]);
      pts.push([Math.round(cx + hw - qd), Math.round(cy)]);
    }
    outlined(f, pts, f.P.box);
    const u = 1 / f.s;
    a.finder = {
      x: (cx - hw) * u,
      y: (cy - hh) * u,
      w: (2 * hw + 1) * u,
      h: (2 * hh + 1) * u,
    };
  }

  /** The place's name above the finder and its coordinates under it, clear of everything. */
  function placeAnswerLabels(): void {
    const fb = ans?.finder;
    if (!fb) return;
    const u = 1 / (frame?.s ?? 0.25);
    const V = visNow();
    const r = canvas!.getBoundingClientRect();
    const blocks: Rect[] = [];
    for (const el of [
      ui!.querySelector(":scope > .dl-banner"),
      resultSlot,
      stakes,
      zoomBox,
    ]) {
      if (!(el instanceof HTMLElement) || el.hidden || !el.offsetWidth)
        continue;
      const b = el.getBoundingClientRect();
      blocks.push({
        x: b.left - r.left - 6,
        y: b.top - r.top - 6,
        w: b.width + 12,
        h: b.height + 12,
      });
    }
    if (pin) {
      const p = m.project(pin.lon, pin.lat);
      blocks.push({ x: p.x - 16, y: p.y - 36, w: 32, h: 42 });
    }
    // The photo tokens on the rings round the place.
    for (const e of lay) {
      if (e?.css)
        blocks.push({ x: e.css.x - 18, y: e.css.y - 18, w: 36, h: 36 });
    }
    const fits = (b: Rect) =>
      b.x >= V.x0 + 4 &&
      b.y >= V.y0 + 4 &&
      b.x + b.w <= V.x1 - 4 &&
      b.y + b.h <= V.y1 - 4;
    const clampIn = (b: Rect): Rect => ({
      ...b,
      x: clamp(b.x, V.x0 + 4, V.x1 - 4 - b.w),
      y: clamp(b.y, V.y0 + 4, V.y1 - 4 - b.h),
    });
    const pick = (cands: Rect[], also: Rect[]) =>
      cands
        .map(clampIn)
        .find(
          (b) =>
            fits(b) &&
            !blocks.some((o) => meets(b, o)) &&
            !also.some((o) => meets(b, o)),
        ) ?? clampIn(cands[0]);
    const cx = fb.x + fb.w / 2;
    const taken: Rect[] = [fb];
    const coordsEl = labels!.querySelector<HTMLElement>(".dl-coords");
    let cBox: Rect | null = null;
    if (coordsEl && !coordsEl.hidden) {
      const w = coordsEl.offsetWidth;
      const h = coordsEl.offsetHeight;
      cBox = pick(
        [
          { x: cx - w / 2, y: fb.y + fb.h + 8, w, h },
          { x: cx - w / 2, y: fb.y - 8 - h, w, h },
          { x: fb.x + fb.w + 10, y: fb.y + fb.h / 2 - h / 2, w, h },
          { x: fb.x - 10 - w, y: fb.y + fb.h / 2 - h / 2, w, h },
        ],
        taken,
      );
      taken.push(cBox);
      coordsEl.style.transform = `translate(${snapTo(cBox.x, u)}px, ${snapTo(cBox.y, u)}px)`;
    }
    const name = labels!.querySelector<HTMLElement>(".dl-place");
    if (name && !name.hidden) {
      const w = name.offsetWidth;
      const h = name.offsetHeight;
      const below =
        cBox && cBox.y > fb.y ? cBox.y + cBox.h + 8 : fb.y + fb.h + 10;
      const above = cBox && cBox.y < fb.y ? cBox.y - 10 - h : fb.y - 12 - h;
      const b = pick(
        [
          { x: cx - w / 2, y: above, w, h },
          { x: cx - w / 2, y: below, w, h },
          { x: fb.x + fb.w + 12, y: fb.y - h / 2, w, h },
          { x: fb.x - 12 - w, y: fb.y - h / 2, w, h },
        ],
        taken,
      );
      name.style.transform = `translate(${snapTo(b.x, u)}px, ${snapTo(b.y, u)}px)`;
    }
  }

  /* ------------------------------------------------------------ the pin */

  /** How close a tap can land to the pin and only shift it, CSS px. */
  const NEAR_PX = 8;

  /**
   * Put the pin at `at`. A tap drops it in (or, right on top of the pin,
   * just shifts it and rings); an arrow key slides it; the key press that
   * places the first pin drops it like a tap.
   */
  function placePin(where: LonLat, how: "tap" | "key"): void {
    if (done || revealing) return;
    const was = pin;
    pin = { lat: clamp(where.lat, -85, 85), lon: clamp(where.lon, -180, 180) };
    if (!was) {
      pins.drop(pin, null);
    } else if (how === "key") {
      pins.slide(pin);
    } else {
      const a = m.project(was.lon, was.lat);
      const b = m.project(pin.lon, pin.lat);
      if (Math.hypot(a.x - b.x, a.y - b.y) <= NEAR_PX) pins.tapNear(pin);
      else pins.drop(pin, was);
    }
    surface!.classList.add("is-placed");
    blockVersion++;
    syncLock();
    persist();
    m.redraw();
    if (announce && how === "tap")
      announce.textContent = `Pin at ${coords(pin)}.`;
  }

  // Keyboard guessing: the pin starts in the middle of the lens and arrows
  // nudge it, by less the further in you've zoomed. Once the answer is in,
  // arrows pan the map instead, so the keyboard can look around it too.
  surface.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (done) {
      const pan: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const dir = pan[event.key];
      if (!dir || m.view.k <= 1.001) return;
      event.preventDefault();
      const by = (event.shiftKey ? 0.5 : 0.15) * m.width;
      m.panBy(dir[0] * by, dir[1] * by);
      return;
    }
    const step = Math.max(0.01, (event.shiftKey ? 15 : 4) / m.view.k);
    let next = pin;
    if (!next) {
      if (
        !event.key.startsWith("Arrow") &&
        event.key !== "Enter" &&
        event.key !== " "
      ) {
        return;
      }
      next = centre ?? restAt ?? m.unproject(m.width / 2, m.height / 2);
    } else if (event.key === "ArrowUp")
      next = { ...next, lat: next.lat + step };
    else if (event.key === "ArrowDown")
      next = { ...next, lat: next.lat - step };
    else if (event.key === "ArrowLeft")
      next = { ...next, lon: next.lon - step };
    else if (event.key === "ArrowRight")
      next = { ...next, lon: next.lon + step };
    else return;
    event.preventDefault();
    placePin(next, "key");
    if (pin) {
      m.show(pin);
      if (announce) announce.textContent = `Pin at ${coords(pin)}.`;
    }
  });

  // The lens: before a pin, the rings follow the mouse over the map.
  const localOf = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  surface.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const p = localOf(e);
    const where = m.unproject(p.x, p.y);
    // Off the world's edge on a wide screen the lens waits at the edge.
    pointerAt = {
      lat: clamp(where.lat, -85, 85),
      lon: clamp(where.lon, -180, 180),
    };
    if (!pin && !done) m.redraw();
  });
  surface.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "touch") return;
    if (pointerAt) restAt = pointerAt;
    pointerAt = null;
    m.redraw();
  });

  /* ------------------------------------------------------------ layout */

  function layout(): void {
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = root.clientHeight || innerHeight;
    const wasPhone = phone;
    phone = vw < PHONE_BELOW || (vw < NARROW_BELOW && vh < PHONE_SHORT);
    root.classList.toggle("is-phone", phone);
    for (const el of [canvas!, labels!]) {
      el.style.left = "";
      el.style.width = "";
      el.style.right = "";
    }
    surface!.style.marginTop = "";
    vis = null;
    root.style.removeProperty("--post-h");
    root.classList.remove("is-post-flow");
    if (phone && done) {
      layoutAnswerPhone();
      return;
    }
    let w: number;
    let h: number;
    if (phone) {
      // As wide as the phone, with everything on one screen: the map shows
      // the whole world at 1.6:1 if there's room (2:1 at the least), and the
      // cards take what's left between CARD_MIN and CARD_MAX. When even the
      // smallest cards and a 2:1 map don't fit, the page scrolls.
      w = Math.floor(vw / 4) * 4;
      const flat = Math.round(w / 2 / 4) * 4;
      const tall = Math.round(w / 1.6 / 4) * 4;
      root.style.setProperty("--card-h", `${CARD_MIN}px`);
      // Everything but the map, with the smallest cards. The hand's top
      // margin is left out: it takes whatever room is over.
      const px = (el: Element, prop: "marginTop" | "paddingBottom") =>
        parseFloat(getComputedStyle(el)[prop]) || 0;
      const rest =
        titlePanel!.offsetTop +
        titlePanel!.offsetHeight +
        px(surface!, "marginTop") +
        hand!.offsetHeight +
        px(guessPanel!, "marginTop") +
        guessPanel!.offsetHeight +
        px(root, "paddingBottom");
      let free = vh - rest;
      h = clamp(Math.floor(free / 4) * 4, flat, tall);
      free -= h;
      const cardH =
        CARD_MIN + clamp(Math.floor(free / 2), 0, CARD_MAX - CARD_MIN);
      root.style.setProperty("--card-h", `${cardH}px`);
      root.style.setProperty(
        "--how-top",
        `${titlePanel!.offsetTop + titlePanel!.offsetHeight + 6}px`,
      );
      surface!.style.left = "";
      surface!.style.top = "";
      surface!.style.marginLeft = `${Math.floor((vw - w) / 2)}px`;
    } else {
      // The whole screen; a screen taller than 1.6:1 gets a 1.6:1 map with
      // sea under it, and one wider than 2:1 a 2:1 world with sea either side.
      w = vw;
      h = vw / vh < 1.6 ? vw / 1.6 : vh;
      w = Math.ceil(w / 4) * 4;
      h = Math.ceil(h / 4) * 4;
      root.style.removeProperty("--card-h");
      surface!.style.left = `${Math.floor((vw - w) / 2)}px`;
      surface!.style.top = "0px";
      surface!.style.marginLeft = "";
    }
    surface!.style.width = `${w}px`;
    surface!.style.height = `${h}px`;
    root.style.setProperty("--stakes-w", `${stakes!.offsetWidth}px`);
    if (phone) {
      // The zoom keys sit in the map's bottom right corner.
      const top = surface!.offsetTop;
      root.style.setProperty("--map-top", `${top + h - 34 - 4 - 10}px`);
    }
    blockVersion++;
    if (wasPhone !== phone && !done) void m.reset(false);
    m.redraw();
  }

  /**
   * A phone after the answer: the postcard docks at the foot of the screen
   * and the map takes everything between it and the verdict. The map keeps
   * its 1.6:1 shape, so a taller map runs wider than the phone and its sides
   * go past the screen's edges; only the middle shows (`shownWidth`). An
   * answer that spans more of the world than that middle can hold even at
   * the widest zoom gets a shorter map, so the pin and the place both show.
   */
  function layoutAnswerPhone(): void {
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = root.clientHeight || innerHeight;
    const w = Math.floor(vw / 4) * 4;
    const shown = !resultSlot!.hidden;
    if (!shown) {
      resultSlot!.hidden = false;
      resultSlot!.style.visibility = "hidden";
    }
    const postH = resultSlot!.offsetHeight;
    if (!shown) {
      resultSlot!.hidden = true;
      resultSlot!.style.visibility = "";
    }
    root.style.setProperty("--post-h", `${postH}px`);
    surface!.style.marginTop = "";
    const top = surface!.offsetTop;
    // The map fills the room over the postcard, but no shorter than a 2.4:1
    // strip: with less room than that the postcard follows the map instead
    // of covering it, and the page scrolls.
    const least = Math.round(w / 2.4 / 4) * 4;
    const avail = Math.floor((vh - top - postH - 30) / 4) * 4;
    root.classList.toggle("is-post-flow", avail < least);
    let h = Math.max(least, avail);
    const b = answerBox();
    const across = (b.e - b.w) / 360;
    // The pin and the place at the widest zoom, inside the padding and the
    // zoom keys' strip (room() on a phone).
    const spare = w - 2 * 28 - 52;
    if (across > 0 && h * 1.6 * across > spare) {
      h = Math.max(least, Math.floor(spare / across / 1.6 / 4) * 4);
    }
    const cw = Math.max(w, Math.round((h * 1.6) / 4) * 4);
    const left = Math.round((w - cw) / 2 / 2) * 2;
    surface!.style.width = `${w}px`;
    surface!.style.height = `${h}px`;
    surface!.style.marginLeft = `${Math.floor((vw - w) / 2)}px`;
    for (const el of [canvas!, labels!]) {
      el.style.left = `${left}px`;
      el.style.width = `${cw}px`;
      el.style.right = "auto";
    }
    vis = { x0: -left, y0: 0, x1: -left + w, y1: h };
    // A shorter map sits in the middle of the space it was given.
    const drop = Math.max(0, Math.floor((avail - h) / 2 / 4) * 4);
    if (drop) {
      const base = parseFloat(getComputedStyle(surface!).marginTop) || 0;
      surface!.style.marginTop = `${base + drop}px`;
    }
    root.style.setProperty("--map-top", `${top + drop + h - 34 - 4 - 10}px`);
    blockVersion++;
    m.redraw();
  }

  /** The pin and the place together, which the answer frames. */
  function answerBox(): Box {
    const b = round.bbox;
    if (!pin) return b;
    return {
      w: Math.min(b.w, pin.lon),
      e: Math.max(b.e, pin.lon),
      s: Math.min(b.s, pin.lat),
      n: Math.max(b.n, pin.lat),
    };
  }

  /** What sits over the map once the answer is up, as room for the camera to keep clear. */
  function room(): Inset {
    if (phone) return { top: 12, bottom: 12, right: 52 };
    const r = surface!.getBoundingClientRect();
    const s = stakes!.getBoundingClientRect();
    const z = zoomBox!.getBoundingClientRect();
    const p = resultSlot!.getBoundingClientRect();
    // The zoom keys sit under the score, or by the postcard on a wide screen.
    const zoomUp = z.top < r.top + r.height / 2;
    const top = Math.max(124, s.bottom + 24, zoomUp ? z.bottom + 20 : 0);
    const postTop = p.height ? p.top : innerHeight - 280;
    const bottomEdge = Math.min(postTop, zoomUp ? Infinity : z.top) - 24;
    return {
      top: top - r.top,
      bottom: Math.max(0, r.bottom - bottomEdge),
      right: 64,
    };
  }

  /* -------------------------------------------------------- map controls */

  function isFramed(wm: WorldMap): boolean {
    if (!done || !pin) return false;
    const baseW = wm.worldWidth / wm.view.k;
    const v0 = visNow();
    const want = answerView(
      answerBox(),
      v0.x1 - v0.x0,
      wm.height,
      answerRoom,
      baseW,
    );
    const v = wm.view;
    return (
      Math.abs(Math.log(v.k / want.k)) < 0.08 &&
      Math.abs(v.cu - want.cu) < 0.05 / v.k &&
      Math.abs(v.cv - want.cv) < 0.05 / v.k
    );
  }

  function syncMapControls(wm: WorldMap): void {
    const k = wm.view.k;
    if (zoomInBtn) zoomInBtn.disabled = k >= MAX_ZOOM - 0.01;
    if (zoomOutBtn) zoomOutBtn.disabled = k <= 1.001;
    if (viewBtn) {
      // Zoomed in: a way back out. After the answer, a way back to it. Not
      // while the answer is landing, when the view moves by itself.
      const wasHidden = viewBtn.hidden;
      if (revealing) {
        viewBtn.hidden = true;
      } else if (done && !isFramed(wm)) {
        viewBtn.hidden = false;
        viewBtn.textContent = "Back to your guess";
        viewBtn.dataset.action = "answer";
      } else if (k > 1.001) {
        viewBtn.hidden = false;
        viewBtn.textContent = "Whole world";
        viewBtn.dataset.action = "world";
      } else {
        viewBtn.hidden = true;
      }
      if (wasHidden !== viewBtn.hidden) blockVersion++;
    }
  }

  zoomInBtn?.addEventListener("click", () => {
    const p = pin ?? centre;
    m.zoomBy(2, p ? m.project(p.lon, p.lat) : undefined);
  });
  zoomOutBtn?.addEventListener("click", () => m.zoomBy(0.5));
  viewBtn?.addEventListener("click", () => {
    if (viewBtn.dataset.action === "answer") {
      void m.fit(answerBox(), { room: answerRoom });
    } else void m.reset();
  });

  /* ------------------------------------------------------------ the hand */

  function reachBit(clue: Clue): string {
    const line = escapeHtml(reachLine(clue));
    if (!clue.reach) {
      return `<p class="dl-card-reach dl-px15"><span aria-hidden="true">${count(
        clue.global,
      )} <small>seen</small></span><span class="dl-sr">${line}</span></p>`;
    }
    const km = count(reachKm(clue.reach));
    return `<p class="dl-card-reach dl-px15" title="${line}"><span aria-hidden="true"><small>within</small> ${km} <small>km</small></span><span class="dl-sr">${line}</span></p>`;
  }

  function cardFace(i: number): string {
    const clue = round.clues[i];
    return `<div class="dl-card-face">
        <div class="dl-card-pic"><img src="${escapeHtml(
          clue.photo,
        )}" alt="" width="500" height="500" decoding="async" crossorigin="anonymous"></div>
        <p class="dl-card-name"><span>${hiddenNameHtml(clue.name)}</span></p>
        ${reachBit(clue)}
      </div>
      <span class="dl-card-n dl-px15" aria-hidden="true">${i + 1}</span>`;
  }

  /**
   * One card per species. Shown ones carry the photo, the name and the
   * reach; the next one is the key and says what it costs; the rest wait
   * face down with their number.
   */
  function slot(i: number): void {
    const li = tray!.children[i] as HTMLElement | undefined;
    if (!li) return;
    const pops = Array.from(li.querySelectorAll(":scope > .dl-pop"));
    li.className = "dl-card";
    li.dataset.i = String(i);
    li.style.setProperty("--c", tintOf(i).hex);
    if (i < lines || done) {
      li.classList.add("is-shown");
      li.classList.toggle("is-picked", i === (picked ?? lines - 1));
      li.innerHTML = cardFace(i);
    } else if (i === lines) {
      const cost = bestPossible(lines) - bestPossible(lines + 1);
      li.classList.add("is-next");
      li.innerHTML = `<button type="button" class="dl-key dl-key-next" data-daylist-more>
          <span>Show the next one</span>
          <span class="dl-price" aria-hidden="true">&minus;${count(cost)}</span>
          <span class="dl-price-unit" aria-hidden="true">points</span>
          <span class="dl-sr">, costs ${count(cost)} points</span>
        </button>
        <span class="dl-card-n dl-px15" aria-hidden="true">${i + 1}</span>`;
    } else {
      li.classList.add("is-back");
      li.innerHTML = `<div class="dl-card-back"><span class="dl-card-q dl-px25" aria-hidden="true">?</span><span class="dl-sr">Species ${
        i + 1
      }, not shown yet</span></div><span class="dl-card-n dl-px15" aria-hidden="true">${i + 1}</span>`;
    }
    li.append(...pops);
  }

  /** A phone's strip over the cards: the picked species, or the newest. */
  function syncPick(): void {
    if (!pickEl) return;
    const i = picked ?? lines - 1;
    const clue = round.clues[i];
    if (!clue) return;
    pickEl.style.setProperty("--c", tintOf(i).hex);
    const reach = clue.reach
      ? `within ${count(reachKm(clue.reach))} km`
      : `${count(clue.global)} seen`;
    pickEl.innerHTML = `<i></i><b>${hiddenNameHtml(clue.name)}</b><span>${reach}</span>`;
    Array.from(tray!.children).forEach((li, j) =>
      li.classList.toggle(
        "is-picked",
        j === i && li.classList.contains("is-shown"),
      ),
    );
  }

  /** The colours from the photos are in: every card, thumb and entry takes its own. */
  function paintTints(): void {
    Array.from(tray!.children).forEach((li, i) =>
      (li as HTMLElement).style.setProperty("--c", tintOf(i).hex),
    );
    root
      .querySelectorAll<HTMLElement>("[data-tint]")
      .forEach((el) =>
        el.style.setProperty("--c", tintOf(Number(el.dataset.tint)).hex),
      );
  }

  /**
   * Show a species: the key folds away into its card, and the photo comes up
   * from big pixels to sharp in five steps.
   */
  async function turn(i: number): Promise<void> {
    const li = tray!.children[i] as HTMLElement | undefined;
    if (!li) return;
    const old = li.querySelector<HTMLElement>(".dl-key-next, .dl-card-back");
    const clue = round.clues[i];
    const mine = generation;
    const img = photoSoon(clue.photo);
    if (reduced() || typeof li.animate !== "function") {
      slot(i);
      return;
    }
    const half = 70;
    if (old) {
      await old
        .animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
          duration: half,
          easing: "cubic-bezier(0.5, 0, 1, 1)",
          fill: "forwards",
        })
        .finished.catch(() => {});
    }
    if (mine !== generation) return;
    slot(i);
    const face = li.querySelector<HTMLElement>(".dl-card-face");
    const pic = li.querySelector<HTMLElement>(".dl-card-pic");
    if (!face || !pic) return;
    const cv = document.createElement("canvas");
    pic.append(cv);
    const loaded = await img;
    if (mine !== generation) return;
    const steps = [26, 14, 8, 4];
    blocky(cv, loaded, pic, steps[0]);
    face.animate(
      [
        { transform: "scaleX(0)" },
        { transform: "scaleX(1.08)", offset: 0.7 },
        { transform: "scaleX(1)" },
      ],
      { duration: half * 1.4, easing: "cubic-bezier(0, 0, 0.3, 1)" },
    );
    for (const b of steps.slice(1)) {
      await wait(80);
      if (mine !== generation) return;
      blocky(cv, loaded, pic, b);
    }
    await wait(80);
    if (mine !== generation) return;
    cv.remove();
  }

  /** The photo as `block`-pixel squares, for the turn. */
  function blocky(
    cv: HTMLCanvasElement,
    img: HTMLImageElement,
    pic: HTMLElement,
    block: number,
  ): void {
    const w = pic.clientWidth || 120;
    const h = pic.clientHeight || 120;
    const cols = Math.max(1, Math.round(w / block));
    const rows = Math.max(1, Math.round(h / block));
    cv.width = cols;
    cv.height = rows;
    const c = cv.getContext("2d");
    if (!c) return;
    if (!img.naturalWidth) {
      c.fillStyle = "#122a5b";
      c.fillRect(0, 0, cols, rows);
      return;
    }
    const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / k;
    const sh = h / k;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(
      img,
      (img.naturalWidth - sw) / 2,
      (img.naturalHeight - sh) / 2,
      sw,
      sh,
      0,
      0,
      cols,
      rows,
    );
  }

  /** The points a species cost, rising off the corner of its card. */
  function pop(li: Element | undefined, cost: number): void {
    if (!li) return;
    const el = document.createElement("span");
    el.className = "dl-pop dl-px25";
    el.setAttribute("aria-hidden", "true");
    el.textContent = `\u2212${count(cost)}`;
    li.append(el);
    if (reduced() || typeof el.animate !== "function") {
      setTimeout(() => el.remove(), 900);
      return;
    }
    const side =
      (Math.random() < 0.5 ? -1 : 1) * (4 + Math.round(Math.random() * 8));
    const rise = phone
      ? 18 + Math.round(Math.random() * 6)
      : 34 + Math.round(Math.random() * 12);
    const keys: Keyframe[] = [];
    const N = 12;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const e = 1 - Math.pow(1 - t, 2.2);
      const y = -Math.round((rise * e) / 3) * 3;
      const x = Math.round((side * t) / 3) * 3;
      const s = k === 0 ? 1.5 : k === 1 ? 1.15 : 1;
      keys.push({
        offset: t,
        transform: `translate(${x}px, ${y}px) scale(${s})`,
        opacity: t < 0.6 ? 1 : k === N ? 0 : t < 0.8 ? 0.7 : 0.35,
        easing: "steps(1, end)",
      });
    }
    const run = el.animate(keys, { duration: 820, fill: "forwards" });
    run.onfinish = () => el.remove();
    run.oncancel = () => el.remove();
  }

  /**
   * The big counter in whole steps, like an arcade score. `ease` shapes the
   * count: the answer's runs most of the way at once, then slows into its
   * last digits.
   */
  const countRuns = new WeakMap<HTMLElement, number>();
  function countTo(
    el: HTMLElement,
    to: number,
    ms = 360,
    from: number | null = null,
    ease: (k: number) => number = (k) => k,
  ): Promise<void> {
    const start = from ?? Number(el.dataset.value ?? to);
    el.dataset.value = String(to);
    const id = (countRuns.get(el) ?? 0) + 1;
    countRuns.set(el, id);
    if (reduced() || start === to) {
      el.textContent = count(to);
      return Promise.resolve();
    }
    const steps = Math.max(6, Math.round(ms / 40));
    return tween(
      ms,
      (k) => {
        if (id !== countRuns.get(el)) return;
        const v = start + (to - start) * ease(k);
        // Whole tens on the way, never past where it's going.
        const tens = to > start ? Math.floor(v / 10) : Math.ceil(v / 10);
        el.textContent = count(k >= 1 ? to : tens * 10);
      },
      (k) => Math.round(k * steps) / steps,
    );
  }

  /* ----------------------------------------------------------- the flight */

  /** Where a ring's token is on screen, or its middle when there's no room. */
  function flightTarget(i: number) {
    const r = canvas!.getBoundingClientRect();
    const e = lay[i];
    if (!e)
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, tok: false };
    const p = e.css || e.cssCentre;
    return {
      x: r.left + clamp(p.x, 0, r.width),
      y: r.top + clamp(p.y, 0, r.height),
      tok: Boolean(e.css),
    };
  }

  /** A photo as a token, `n` pixels across, square or round, drawn on `cv`. */
  function paintFlyer(
    cv: HTMLCanvasElement,
    i: number,
    n: number,
    round_: boolean,
  ): void {
    const P = isDark() ? PALETTES.night : PALETTES.day;
    const full = n + 4;
    cv.width = full;
    cv.height = full;
    const c = cv.getContext("2d");
    if (!c) return;
    c.clearRect(0, 0, full, full);
    const info = pinfo[i];
    if (!round_) {
      c.fillStyle = `rgb(${P.ink.join(",")})`;
      c.fillRect(0, 0, full, full);
      c.fillStyle = tintOf(i).hex;
      c.fillRect(1, 1, full - 2, full - 2);
      if (info?.small) {
        c.imageSmoothingEnabled = true;
        c.drawImage(info.small, 2, 2, n, n);
      }
      return;
    }
    const img = c.createImageData(full, full);
    const d = img.data;
    const set = (x: number, y: number, rgb: RGB) => {
      const o = (y * full + x) * 4;
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = 255;
    };
    const outer = disc(n + 2);
    const inner = disc(n);
    const pix = tokenPixels(info, n);
    const col = tintOf(i).rgb;
    const ins = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < n + 2 && y < n + 2 && outer[y][x];
    for (let y = -1; y <= n + 2; y++) {
      for (let x = -1; x <= n + 2; x++) {
        if (ins(x, y)) {
          const ix = x - 1;
          const iy = y - 1;
          if (pix && ix >= 0 && iy >= 0 && ix < n && iy < n && inner[iy][ix]) {
            const o = (iy * n + ix) * 4;
            set(x + 1, y + 1, [pix[o], pix[o + 1], pix[o + 2]]);
          } else set(x + 1, y + 1, col);
        } else if (
          ins(x - 1, y) ||
          ins(x + 1, y) ||
          ins(x, y - 1) ||
          ins(x, y + 1)
        ) {
          set(x + 1, y + 1, P.ink);
        }
      }
    }
    c.putImageData(img, 0, 0);
  }

  /**
   * The photo flies from its card to its token on the ring, in whole map
   * pixels: it shrinks a pixel at a time from the card's size to the
   * token's, turns round on the way, and bends a different way each time.
   */
  function fly(i: number, mine: number): void {
    const g = rings[i];
    if (!g) return;
    if (reduced() || !g.km) {
      g.flying = false;
      g.landed = now() - 5000;
      m.redraw();
      return;
    }
    const li = tray!.children[i];
    const pic = li?.querySelector(".dl-card-pic") ?? li;
    if (!pic) return;
    const r = pic.getBoundingClientRect();
    const unit = phone ? 2 : 4;
    const start = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const n0 = Math.max(TOK, Math.round(r.width / unit) - 4);
    const el = document.createElement("canvas");
    el.className = "dl-fly";
    el.setAttribute("aria-hidden", "true");
    root.append(el);
    const t0 = now();
    const D = 400;
    // It arcs up like a throw, by a different amount each time.
    const bend = 0.12 + Math.random() * 0.16;
    let lastN = -1;
    let lastRound: boolean | null = null;
    const step = () => {
      if (mine !== generation) {
        el.remove();
        return;
      }
      const p = clamp((now() - t0) / D, 0, 1);
      const tgt = flightTarget(i);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const dx = tgt.x - start.x;
      const dy = tgt.y - start.y;
      const up = dx >= 0 ? 1 : -1;
      const cx = start.x + dx / 2 + dy * bend * up;
      const cy = start.y + dy / 2 - dx * bend * up;
      const x =
        (1 - e) * (1 - e) * start.x + 2 * (1 - e) * e * cx + e * e * tgt.x;
      const y =
        (1 - e) * (1 - e) * start.y + 2 * (1 - e) * e * cy + e * e * tgt.y;
      const n = Math.round(lerp(n0, TOK, easeOut(clamp(p / 0.8, 0, 1))));
      const roundNow = p > 0.22;
      if (n !== lastN || roundNow !== lastRound) {
        paintFlyer(el, i, n, roundNow);
        lastN = n;
        lastRound = roundNow;
      }
      const size = (n + 4) * unit;
      const wr = canvas!.getBoundingClientRect();
      const left = wr.left + snapTo(x - size / 2 - wr.left, unit);
      const top = wr.top + snapTo(y - size / 2 - wr.top, unit);
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.transform = `translate(${left}px, ${top}px)`;
      el.style.opacity = tgt.tok || p < 0.8 ? "1" : p < 0.9 ? "0.6" : "0.3";
      if (p < 1) {
        requestAnimationFrame(step);
        return;
      }
      el.remove();
      g.flying = false;
      g.landed = now();
      m.redraw();
    };
    requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------ how to play */

  let howLoop = 0;
  function openHow(open: boolean): void {
    if (!howPanel || !howKey) return;
    if (howPanel.hidden === !open) return;
    howPanel.hidden = !open;
    howKey.setAttribute("aria-expanded", String(open));
    cancelAnimationFrame(howLoop);
    blockVersion++;
    if (!open) return;
    const r = titlePanel!.getBoundingClientRect();
    howPanel.style.top = phone ? "" : `${Math.round(r.bottom + 18)}px`;
    if (!reduced()) {
      howPanel.animate(
        [
          { transform: "translateY(-12px) scale(0.92)", opacity: 0 },
          {
            transform: "translateY(-4px) scale(1.02)",
            opacity: 1,
            offset: 0.6,
          },
          { transform: "none", opacity: 1 },
        ],
        { duration: 180, easing: "steps(4, end)" },
      );
    }
    howPanel.querySelectorAll(".dl-how-art *").forEach((el) => {
      for (const a of el.getAnimations()) a.currentTime = 0;
    });
    const t0 = now();
    const tick = () => {
      drawHowRing(reduced() ? 2400 * 0.9 : (now() - t0) % 2400);
      if (!reduced() && !howPanel.hidden) howLoop = requestAnimationFrame(tick);
    };
    tick();
  }

  /** The middle scene: a ring tightening round a pin, in the map's own pixels. */
  function drawHowRing(t: number): void {
    if (!howRing?.parentElement) return;
    const box = howRing.parentElement;
    const W = Math.max(16, Math.floor(box.clientWidth / 4));
    const H = Math.max(12, Math.floor(box.clientHeight / 4));
    if (howRing.width !== W || howRing.height !== H) {
      howRing.width = W;
      howRing.height = H;
    }
    howRing.style.width = `${W * 4}px`;
    howRing.style.height = `${H * 4}px`;
    const P = isDark() ? PALETTES.night : PALETTES.day;
    const c = howRing.getContext("2d");
    if (!c) return;
    const img = c.createImageData(W, H);
    const f: Frame = { d: img.data, W, H, P };
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2) + 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const lx = (x - cx + 3) / (W * 0.36);
        const ly = (y - cy + 1) / (H * 0.42);
        const land = lx * lx + ly * ly < 1 && !(x < cx - W * 0.2 && y > cy + 2);
        px(
          f,
          x,
          y,
          land ? P.land[1] : (x + y) % 2 === 0 && y % 6 === 0 ? P.dots : P.sea,
        );
      }
    }
    const ringAt = (r: number, col: RGB) => {
      const ins = (x: number, y: number) =>
        (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + r * 0.6;
      const edge: [number, number][] = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (
            ins(x, y) &&
            (!ins(x - 1, y) ||
              !ins(x + 1, y) ||
              !ins(x, y - 1) ||
              !ins(x, y + 1))
          ) {
            edge.push([x, y]);
          }
        }
      }
      outlined(f, edge, col);
    };
    const big = Math.min(H / 2 - 1, 9);
    const p = t / 2400;
    ringAt(big, ringFor(0).rgb);
    if (p > 0.2) {
      const k = clamp((p - 0.2) / 0.3, 0, 1);
      const r = Math.round(lerp(big, 4, easeOutBack(k, 1.6)));
      ringAt(Math.max(2, r), ringFor(3).rgb);
    }
    sprite(f, PIN, 3, 7, cx, cy, {
      o: P.ink,
      a: P.pin,
      h: P.pinHi,
      d: P.pinLo,
    });
    c.putImageData(img, 0, 0);
  }

  howKey?.addEventListener("click", () => openHow(Boolean(howPanel?.hidden)));
  howClose?.addEventListener("click", () => {
    openHow(false);
    howKey?.focus();
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && howPanel && !howPanel.hidden) {
      openHow(false);
      howKey?.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    const target = e.target as Node | null;
    if (
      howPanel &&
      !howPanel.hidden &&
      target &&
      !howPanel.contains(target) &&
      !howKey?.contains(target)
    ) {
      openHow(false);
    }
  });

  /* ------------------------------------------------------- months, lock */

  function syncMonths(): void {
    monthKeys.forEach((b, j) => {
      const on = month === j;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on || (month === null && j === 0) ? 0 : -1;
    });
  }

  function setMonth(j: number): void {
    if (done || revealing) return;
    month = j;
    syncMonths();
    syncLock();
    persist();
  }

  monthBox.addEventListener("click", (e) => {
    const b = (e.target as Element | null)?.closest<HTMLElement>(
      "[data-daylist-month]",
    );
    if (b) setMonth(Number(b.dataset.daylistMonth));
  });
  monthBox.addEventListener("keydown", (e) => {
    const b = (e.target as Element | null)?.closest<HTMLElement>(
      "[data-daylist-month]",
    );
    if (!b) return;
    const i = Number(b.dataset.daylistMonth);
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 6,
      ArrowUp: -6,
      Home: -i,
      End: 11 - i,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const j = (i + moves[e.key] + 12) % 12;
    monthKeys[j].focus();
    setMonth(j);
  });

  function syncLock(): void {
    lockBtn!.disabled = done || revealing || !pin || month === null;
    lockHint!.textContent = done
      ? ""
      : !pin && month === null
        ? "Tap the map, pick a month"
        : !pin
          ? "Now tap the map"
          : month === null
            ? "Now pick a month"
            : `Up to ${count(bestPossible(lines))} points`;
  }

  // A key sits down on its drop while it's held, and pops back up.
  root.addEventListener("pointerdown", (e) => {
    const k = (e.target as Element | null)?.closest<HTMLElement>(".dl-key");
    if (!k || (k as HTMLButtonElement).disabled) return;
    k.classList.add("is-down");
    const up = () => {
      setTimeout(() => k.classList.remove("is-down"), 40);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
    };
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const k = (e.target as Element | null)?.closest?.<HTMLElement>(".dl-key");
    if (!k || (k as HTMLButtonElement).disabled) return;
    k.classList.add("is-down");
    setTimeout(() => k.classList.remove("is-down"), 110);
  });

  /* ------------------------------------------------------------ saving */

  function persist(): void {
    const progress: Progress = { lines, done };
    if (pin) {
      progress.lat = pin.lat;
      progress.lon = pin.lon;
    }
    if (month !== null) progress.month = month;
    if (mode === "daily") {
      writeStore(DAILY_KEY, { day, ...progress });
    } else {
      extra.current = { placeId: round.placeId, ...progress };
      writeStore(EXTRA_KEY, extra);
    }
  }

  /* ---------------------------------------------------- showing the next */

  /** A new ring: it tightens from the last one's size while its photo flies to it. */
  function ringIn(k: number, mine: number): void {
    const t = now();
    const g = rings[k];
    let prev: number | null = null;
    for (let j = 0; j < k; j++) if (rings[j].shown && rings[j].km) prev = j;
    g.shown = true;
    const km = g.km ?? 0;
    const fromKm = prev !== null ? kmAt(rings[prev], t) : km * 1.7;
    g.from = fromKm > km * 1.02 ? fromKm : km * 1.3;
    g.t0 = t + dur(90);
    g.d = dur(460);
    g.flying = !reduced();
    g.landed = 0;
    if (reduced()) g.landed = t - 5000;
    else setTimeout(() => fly(k, mine), 110);
    m.redraw();
  }

  function reveal(fromKeyboard: boolean): void {
    if (done || revealing || lines >= round.clues.length) return;
    const mine = generation;
    const cost = bestPossible(lines) - bestPossible(lines + 1);
    lines += 1;
    picked = null;
    if (phone) hot = null;
    const k = lines - 1;
    ringIn(k, mine);
    void turn(k);
    if (lines < round.clues.length) slot(lines);
    pop(tray!.children[k], cost);
    void countTo(worthEl!, bestPossible(lines));
    syncLock();
    persist();
    paintCredits();
    syncPick();
    const clue = round.clues[k];
    if (announce) {
      announce.textContent =
        `Species ${lines} of ${round.clues.length}: ${hiddenNameText(clue.name)}. ` +
        `${reachLine(clue)}. Up to ${count(bestPossible(lines))} points now.`;
    }
    // The key that was pressed is going, so focus follows to the next one
    // (or the map once all six are out).
    const focused = document.activeElement;
    if (fromKeyboard || focused === document.body || tray!.contains(focused)) {
      const next = tray!.children[lines]?.querySelector<HTMLElement>(
        "[data-daylist-more]",
      );
      (next ?? surface!).focus({ preventScroll: true });
    }
  }

  tray.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    if (target?.closest("[data-daylist-more]")) {
      // A click fired by Enter or Space has no pointer, so detail is 0.
      reveal(event.detail === 0);
      return;
    }
    // A species tapped is named in a phone's strip, and its ring thickens.
    const li = target?.closest<HTMLElement>(".dl-card.is-shown");
    if (!li || done) return;
    picked = Number(li.dataset.i);
    hot = picked;
    syncPick();
    m.redraw();
  });
  // Holding Enter on Show the next one shouldn't spend all six.
  root.addEventListener(
    "keydown",
    (e) => {
      if (
        e.repeat &&
        e.key === "Enter" &&
        (e.target as Element | null)?.closest?.("[data-daylist-more]")
      ) {
        e.preventDefault();
      }
    },
    true,
  );
  // A card under the mouse thickens its ring.
  tray.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch" || done) return;
    const li = (e.target as Element | null)?.closest?.<HTMLElement>(
      ".dl-card.is-shown",
    );
    const i = li ? Number(li.dataset.i) : null;
    if (i === hot) return;
    hot = i;
    m.redraw();
  });
  tray.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "touch" || hot === null) return;
    hot = null;
    m.redraw();
  });

  /* ------------------------------------------------------------ the answer */

  const verdictLine = (r: Scored) =>
    r.km === 0 ? "Inside the boundary" : `${count(r.km)} km off`;

  /** Share on a phone, where most plays are; copy everywhere else. */
  const sharesNatively = () =>
    typeof navigator.share === "function" &&
    window.matchMedia("(pointer: coarse)").matches;

  function extraRow(): string {
    const played = extra.played.length;
    const points = Object.values(extra.scores).reduce((a, b) => a + b, 0);
    return played >= EXTRA_PER_DAY
      ? `That's all ten for today, ${count(points)} points. Ten more turn up tomorrow`
      : `${played} of ${EXTRA_PER_DAY} played today &middot; ${count(points)} points`;
  }

  function buildPost(r: Scored): void {
    const inMonth = MONTHS[round.month - 1];
    const guessed = MONTHS[month ?? 0];
    const thumbs = round.clues
      .map((c, j) => {
        const name = escapeHtml(speciesName(c.name));
        return `<li class="${j < r.used ? "is-used" : "is-unused"}" data-tint="${j}" style="--c: ${
          tintOf(j).hex
        }"><img src="${escapeHtml(c.photo)}" alt="${name}" title="${name}" width="500" height="500" decoding="async" crossorigin="anonymous"><span class="dl-px25" aria-hidden="true">${
          j + 1
        }</span></li>`;
      })
      .join("");
    const canNext = mode === "extra" && extra.played.length < EXTRA_PER_DAY;
    const shareLabel = sharesNatively() ? "Share result" : "Copy result";
    // The title panel and its tabs are away once the answer is up, so the
    // postcard is the way on to the other list.
    const actions =
      mode === "daily"
        ? `<button type="button" class="dl-key dl-key-amber" data-daylist-to-extra>Play more lists</button>
           <button type="button" class="dl-key" data-daylist-copy>${shareLabel}</button>`
        : `${
            canNext
              ? `<button type="button" class="dl-key dl-key-amber" data-daylist-next>Next list</button>`
              : ""
          }<button type="button" class="dl-key" data-daylist-to-daily>Today's list</button>`;
    resultSlot!.innerHTML = `
      <ol class="dl-post-thumbs" aria-label="The six species">${thumbs}</ol>
      <div class="dl-post-where">
        <h2 class="dl-px25" id="dl-post-place" tabindex="-1" data-daylist-place>${escapeHtml(
          round.name,
        )}</h2>
        <p class="dl-px15">${escapeHtml(round.region)} <span aria-hidden="true">&middot;</span> ${inMonth}</p>
        <p class="dl-post-used">${r.used} of ${round.clues.length} species used</p>
      </div>
      <dl class="dl-post-pts dl-px15">
        <dt>${verdictLine(r)}</dt><dd>${count(r.placePoints)}</dd>
        <dt>${r.off === 0 ? `${inMonth}, spot on` : `You said ${guessed}`}</dt><dd>${count(r.monthPoints)}</dd>
        <dt class="dl-tot">Total</dt><dd class="dl-tot" data-daylist-score>${count(r.score)}</dd>
      </dl>
      <div class="dl-post-acts">
        ${actions}
        <a class="dl-key" href="https://www.inaturalist.org/places/${
          round.placeId
        }" target="_blank" rel="noopener noreferrer">See the place</a>
        <button type="button" class="dl-key" data-daylist-list aria-haspopup="dialog">The full list</button>
        <p class="dl-post-note dl-px15">${
          mode === "daily" ? "A new list turns up tomorrow" : extraRow()
        }</p>
      </div>`;
  }

  function showPost(animate: boolean): void {
    resultSlot!.hidden = false;
    blockVersion++;
    if (!animate || reduced()) return;
    resultSlot!.animate(
      [
        { transform: "translateY(110%)" },
        { transform: "translateY(-10px)", offset: 0.7 },
        { transform: "translateY(0)" },
      ],
      { duration: 300, easing: "steps(7, end)" },
    );
    resultSlot!.querySelectorAll(".dl-post-thumbs li").forEach((li, j) => {
      li.animate(
        [
          { transform: "translateY(-14px)", opacity: 0 },
          { transform: "translateY(3px)", opacity: 1, offset: 0.7 },
          { transform: "none", opacity: 1 },
        ],
        {
          duration: 180,
          delay: 200 + j * 55,
          easing: "steps(3, end)",
          fill: "backwards",
        },
      );
    });
  }

  /** The distance at the line's head, ticking up as it runs. */
  function showTape(): void {
    const el = document.createElement("span");
    el.className = "dl-tape dl-px15";
    el.setAttribute("aria-hidden", "true");
    el.textContent = "0 km";
    labels!.append(el);
    tapeEl = el;
  }
  /**
   * Keep the tape by the line's head, to the side of the line away from the
   * pin's head, inside the part of the map on screen, in whole map pixels.
   */
  function placeTape(t: number): void {
    const a = ans;
    const el = tapeEl;
    if (!a || !el || !result) return;
    const head = Math.min(headAt(a.plan, a.frac, t - a.t0), a.frac);
    const text = `${count(tapeKm(result.km, head, a.frac))} km`;
    if (el.textContent !== text) el.textContent = text;
    const p = m.project(
      lerp(a.pin.lon, a.to.lon, head),
      lerp(a.pin.lat, a.to.lat, head),
    );
    const o = m.project(a.pin.lon, a.pin.lat);
    const q = m.project(a.to.lon, a.to.lat);
    const len = Math.hypot(q.x - o.x, q.y - o.y) || 1;
    const dx = (q.x - o.x) / len;
    const dy = (q.y - o.y) / len;
    // Square to the line, on its lower side: the pin stands up off its
    // point, so below the line is always clear of it. Its far end stops at
    // the head, so it never covers where the line meets the boundary.
    let nx = -dy;
    let ny = dx;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const across = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2);
    const along = Math.abs(dx) * (w / 2) + Math.abs(dy) * (h / 2);
    const gap = 8;
    const V = visNow();
    const u = 1 / (frame?.s ?? 0.25);
    const x = clamp(
      p.x + nx * (gap + across) - dx * along - w / 2,
      V.x0 + 4,
      V.x1 - 4 - w,
    );
    const y = clamp(
      p.y + ny * (gap + across) - dy * along - h / 2,
      V.y0 + 4,
      V.y1 - 4 - h,
    );
    el.style.transform = `translate(${snapTo(x, u)}px, ${snapTo(y, u)}px)`;
  }
  /** The tape takes the result's colour as the finder locks on. */
  function hitTape(tier: Tier): void {
    if (tapeEl) tapeEl.dataset.tier = String(tier);
  }
  /** The banner says the distance now, so the tape goes. */
  function dropTape(): void {
    const el = tapeEl;
    tapeEl = null;
    if (!el) return;
    if (reduced() || typeof el.animate !== "function") {
      el.remove();
      return;
    }
    const run = el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 160,
      easing: "steps(2, end)",
      fill: "forwards",
    });
    run.onfinish = () => el.remove();
    run.oncancel = () => el.remove();
  }

  /** The coordinates under the finder, printed a character at a time in red. */
  function showCoords(): void {
    let el = labels!.querySelector<HTMLElement>(".dl-coords");
    if (!el) {
      el = document.createElement("span");
      el.className = "dl-coords dl-px15";
      labels!.append(el);
    }
    const b = round.bbox;
    const text = coords({ lat: (b.s + b.n) / 2, lon: (b.w + b.e) / 2 });
    el.dataset.text = text;
    el.innerHTML = `<span class="dl-c-on"></span><span class="dl-c-off">${text}</span>`;
    el.hidden = false;
    answerShown = true;
    m.redraw();
  }
  function typeCoords(k: number): void {
    const el = labels!.querySelector<HTMLElement>(".dl-coords");
    if (!el) return;
    const text = el.dataset.text ?? "";
    const n = Math.round(text.length * clamp(k, 0, 1));
    (el.firstChild as HTMLElement).textContent = text.slice(0, n);
    (el.lastChild as HTMLElement).textContent = text.slice(n);
  }
  function showName(animate: boolean): void {
    let el = labels!.querySelector<HTMLElement>(".dl-place");
    if (!el) {
      el = document.createElement("span");
      el.className = "dl-place dl-px15";
      el.textContent = round.name;
      labels!.append(el);
    }
    if (animate && !reduced()) {
      el.animate(
        [
          { transform: "translateY(6px)", opacity: 0 },
          { transform: "translateY(-2px)", opacity: 1, offset: 0.6 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 160, easing: "steps(3, end)", composite: "add" },
      );
    }
  }

  function showBanner(r: Scored, animate: boolean): void {
    let el = ui!.querySelector<HTMLElement>(":scope > .dl-banner");
    if (!el) {
      el = document.createElement("div");
      el.className = "dl-banner";
      el.setAttribute("aria-hidden", "true");
      ui!.append(el);
    }
    const plan = revealPlan(r.km);
    el.dataset.tier = String(plan.tier);
    el.innerHTML = `<b class="dl-px25">${verdictFor(r.km)}</b><span class="dl-px15">${verdictLine(
      r,
    )}</span>`;
    blockVersion++;
    if (!animate || reduced()) return;
    if (!plan.stamp) {
      el.animate(
        [
          { transform: "translateY(-110%)" },
          { transform: "translateY(-55%)", offset: 0.3 },
          { transform: "translateY(12px)", offset: 0.62 },
          { transform: "translateY(-3px)", offset: 0.82 },
          { transform: "translateY(0)" },
        ],
        { duration: 320, easing: "steps(8, end)", fill: "backwards" },
      );
      return;
    }
    // A close one slams down harder, and the verdict itself lands on it
    // like a stamp, a beat later.
    el.animate(
      [
        { transform: "translateY(-110%)" },
        { transform: "translateY(16px)", offset: 0.4 },
        { transform: "translateY(-5px)", offset: 0.62 },
        { transform: "translateY(2px)", offset: 0.82 },
        { transform: "translateY(0)" },
      ],
      { duration: 300, easing: "steps(8, end)", fill: "backwards" },
    );
    el.querySelector("b")?.animate(
      [
        { transform: "scale(1.7)", opacity: 0 },
        { transform: "scale(0.9)", opacity: 1, offset: 0.5 },
        { transform: "scale(1.06)", opacity: 1, offset: 0.75 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 240, delay: 140, easing: "steps(6, end)", fill: "backwards" },
    );
  }

  /** The answer, as it stands once everything has landed. */
  function settledAnswer(): Answer {
    const pinAt = { ...pin! };
    const b = round.bbox;
    const place = { lat: (b.s + b.n) / 2, lon: (b.w + b.e) / 2 };
    // The short way round: a pin in Hawaii reaches Japan off one side of the
    // map and back in at the other. Not on a world with sea either side,
    // where nothing comes back in: there it crosses the world, as the
    // camera does.
    let toLon = place.lon;
    if (!narrowWorld()) {
      if (toLon - pinAt.lon > 180) toLon -= 360;
      else if (pinAt.lon - toLon > 180) toLon += 360;
    }
    const shift = toLon - place.lon;
    const box = { w: b.w + shift, e: b.e + shift, s: b.s, n: b.n };
    const to = { lon: toLon, lat: place.lat };
    return {
      pin: pinAt,
      to,
      frac: (result?.km ?? 0) > 0 ? entryFraction(pinAt, to, box) : 0,
      plan: revealPlan(result?.km ?? 0),
      t0: -1e9,
      lag: 0,
      settle: 0,
      boxT: 1,
      findT: 1,
      lockT: 1,
      dim: 0,
      hitAt: 0,
      finder: null,
    };
  }

  /**
   * Score the guess and play the answer onto the map. `animate` is false when
   * a finished round is restored, so nothing replays and nothing is counted.
   */
  async function finish(animate: boolean): Promise<void> {
    if (!pin || month === null) return;
    const mine = generation;
    done = true;
    const motion = animate && !reduced();
    const r = scoreGuess(round, { ...pin, month, lines });
    result = r;
    if (mode === "extra") extra.scores[String(round.placeId)] = r.score;
    persist();
    // A round just played (not one restored) counts in /admin's Analytics tab.
    if (animate) {
      window.dispatchEvent(
        new CustomEvent("tb:nn", { detail: { mode, score: r.score } }),
      );
    }
    openHow(false);
    hot = null;
    buildPost(r);
    root.classList.add("is-done");
    surface!.classList.add("is-done");
    // The title panel, the hand and the guess slide away for the verdict,
    // keys and all, and the hand keeps the cards it had as it goes.
    titlePanel!.inert = true;
    hand!.inert = true;
    guessPanel!.inert = true;
    resultSlot!.hidden = false;
    resultSlot!.style.visibility = "hidden";
    answerRoom = room();
    resultSlot!.hidden = true;
    resultSlot!.style.visibility = "";
    paintCredits();
    renderFullList();
    syncLock();
    blockVersion++;
    if (phone) {
      layoutAnswerPhone();
      // Let the map take its new size before the camera moves.
      await frames2();
      if (mine !== generation) return;
    }

    const landed = () => {
      surface!.setAttribute(
        "aria-label",
        `World map showing your pin and ${round.name}. Arrow keys look around once zoomed in.`,
      );
      if (announce && animate) {
        announce.textContent =
          `${verdictFor(r.km)}. ${round.name}, ${round.region}, in ${MONTHS[round.month - 1]}. ` +
          `${verdictLine(r)}. ${count(r.score)} points.`;
      }
    };

    if (!motion) {
      // A round restored as the page loads: let the map take its size first.
      if (!animate) await frames2();
      if (mine !== generation) return;
      await m.fit(answerBox(), { animate: false, room: answerRoom });
      if (mine !== generation) return;
      ans = settledAnswer();
      showCoords();
      typeCoords(1);
      showName(false);
      showBanner(r, false);
      stakesUp!.textContent = "Your score";
      worthEl!.dataset.value = String(r.score);
      worthEl!.textContent = count(r.score);
      showPost(false);
      landed();
      blockVersion++;
      m.redraw();
      syncMapControls(m);
      if (animate) {
        resultSlot!
          .querySelector<HTMLElement>("[data-daylist-place]")
          ?.focus({ preventScroll: true });
      }
      return;
    }

    revealing = true;
    syncMapControls(m);
    // How it plays depends on how close the guess was: a near one builds up
    // and lands harder (./day-list-reveal).
    const plan = revealPlan(r.km);
    // The pin presses into the map as the camera settles on it, and the
    // bullseye leaves as it comes back up.
    pins.press(220 + CAMERA_MS - PRESS_DOWN_MS);
    m.redraw();
    await wait(220);
    if (mine !== generation) return;
    blockVersion++;
    await m.fit(answerBox(), {
      animate: true,
      ms: CAMERA_MS,
      room: answerRoom,
    });
    if (mine !== generation) return;

    // The dotted line runs out from the pin with the distance ticking up at
    // its head, slowing into the last few km on a close guess. The rings
    // ride its head, then drift on into the place's middle.
    const a = settledAnswer();
    a.plan = plan;
    a.t0 = now();
    a.lag = 34;
    a.boxT = 0;
    a.findT = 0;
    a.lockT = 0;
    ans = a;
    if (a.frac > 0) {
      showTape();
      placeTape(now());
    }
    m.redraw();
    await wait(a.frac > 0 ? plan.run : 0);
    if (mine !== generation) return;

    const inkIn = (ms: number) =>
      tween(
        ms,
        (k) => {
          a.boxT = k;
          m.redraw();
        },
        (k) => Math.round(k * 12) / 12,
      );
    const closeIn = () =>
      tween(
        plan.slam,
        (k) => {
          a.findT = k;
          m.redraw();
        },
        (k) => k,
      );
    if (plan.hold > 0) {
      // Close: a held beat. The world darkens round the pin and the place
      // while the rings drift in, the boundary inks in from where the line
      // touched it, then the finder slams in.
      const ink = Math.min(320, plan.hold);
      await Promise.all([
        tween(
          plan.hold,
          (k) => {
            a.dim = plan.dim * k;
            m.redraw();
          },
          (k) => k * k,
        ),
        wait(plan.hold - ink).then(() =>
          mine === generation ? inkIn(ink) : undefined,
        ),
      ]);
      if (mine !== generation) return;
      await closeIn();
    } else {
      // Further off: the rings settle round the place, the boundary inks in
      // and the finder closes in on it in whole pixels.
      await wait(plan.glide + 5 * a.lag);
      if (mine !== generation) return;
      a.settle = now();
      await Promise.all([inkIn(300), closeIn()]);
    }
    if (mine !== generation) return;

    // It locks on: one pulse, the ticks grow, the coordinates print. On a
    // close guess the map flashes in the result's colour, ripples run out
    // from the pin, the rings shudder and the pin gives under it.
    a.hitAt = now();
    if (plan.flash) hitTape(plan.tier);
    if (plan.hold > 0) {
      a.settle = a.hitAt;
      pins.press(0);
      void tween(
        320,
        (k) => {
          a.dim = plan.dim * (1 - k);
          m.redraw();
        },
        (k) => Math.round(k * 4) / 4,
      );
    }
    m.redraw();
    showCoords();
    await tween(
      plan.stamp ? 280 : 220,
      (k) => {
        a.lockT = k;
        typeCoords(k);
        m.redraw();
      },
      (k) => k,
    );
    if (mine !== generation) return;
    typeCoords(1);

    // Now the map has said where, its name goes up, and the verdict drops in.
    showName(true);
    showBanner(r, true);
    dropTape();
    blockVersion++;
    m.redraw();
    landed();
    await wait(160);
    if (mine !== generation) return;
    stakesUp!.textContent = "Your score";
    // Most of the score at once, then the last digits slowly, longer for a
    // bigger score and a closer guess.
    const ms = Math.min(plan.count, 500 + r.score / 4);
    const ease = (k: number) => countEase(plan, k);
    const counting = countTo(worthEl!, r.score, ms, 0, ease);
    worthEl!.animate(
      [{ transform: "scale(1.12)" }, { transform: "scale(1)" }],
      {
        duration: 140,
        easing: "steps(2, end)",
      },
    );
    showPost(true);
    const total = resultSlot!.querySelector<HTMLElement>(
      "[data-daylist-score]",
    );
    if (total) void countTo(total, r.score, ms, 0, ease);
    revealing = false;
    syncMapControls(m);
    resultSlot!
      .querySelector<HTMLElement>("[data-daylist-place]")
      ?.focus({ preventScroll: true });
    await counting;
    if (mine !== generation) return;
    blockVersion++;
    m.redraw();
    worthEl!.animate(
      plan.stamp
        ? [
            { transform: "translateY(-10px) scale(1.22)", color: "#ffffff" },
            { transform: "translateY(2px) scale(0.98)", offset: 0.6 },
            { transform: "none" },
          ]
        : [
            { transform: "translateY(-6px) scale(1.12)" },
            { transform: "none" },
          ],
      { duration: plan.stamp ? 280 : 200, easing: "steps(4, end)" },
    );
  }

  lockBtn.addEventListener("click", () => {
    if (done || revealing || !pin || month === null) return;
    void finish(true);
  });

  /* --------------------------------------------------------- the full list */

  function paintCredits(): void {
    if (creditList)
      creditList.innerHTML = photoCredits(
        round.clues,
        done ? round.clues.length : lines,
      );
  }

  /** Everything about the six, now that the answer is out. */
  function renderFullList(): void {
    if (!rollSlot) return;
    const inMonth = MONTHS[round.month - 1];
    rollSlot.innerHTML = round.clues
      .map((clue, j) => {
        const name = escapeHtml(speciesName(clue.name));
        const status = [STANDING_LABEL[clue.standing], clue.rank]
          .filter(Boolean)
          .map(escapeHtml)
          .join(" &middot; ");
        const fact = clue.fact ? tidyFact(clue.fact, clue.sci) : "";
        const links = [
          clue.wiki
            ? `<a href="${escapeHtml(clue.wiki)}" target="_blank" rel="noopener noreferrer">Wikipedia</a>`
            : "",
          `<a href="https://www.inaturalist.org/taxa/${clue.id}" target="_blank" rel="noopener noreferrer">iNaturalist</a>`,
        ]
          .filter(Boolean)
          .join(" &middot; ");
        return `<li class="dl-entry" data-tint="${j}" style="--c: ${tintOf(j).hex}">
          <div class="dl-entry-pic"><img src="${escapeHtml(
            clue.photo,
          )}" alt="" width="500" height="500" loading="lazy" decoding="async" crossorigin="anonymous"><span class="dl-px25" aria-hidden="true">${
            j + 1
          }</span></div>
          <p class="dl-entry-name">${name}</p>
          <p class="dl-entry-sci"><i>${escapeHtml(clue.sci)}</i>${
            status
              ? ` &middot; <span class="dl-entry-status">${status}</span>`
              : ""
          }</p>
          <p class="dl-entry-meta">Seen here ${count(clue.local)} ${
            clue.local === 1 ? "time" : "times"
          } in ${inMonth} &middot; ${count(clue.global)} worldwide &middot; ${links}</p>
          ${fact ? `<p class="dl-entry-fact">${escapeHtml(fact)}</p>` : ""}
        </li>`;
      })
      .join("");
  }

  let sheetOpener: HTMLElement | null = null;
  function openSheet(opener: HTMLElement): void {
    if (!sheet || sheet.open) return;
    sheetOpener = opener;
    if (credits) credits.open = false;
    sheet.showModal();
    const body = sheet.querySelector(".dl-sheet-body");
    if (body) body.scrollTop = 0;
    sheetClose?.focus();
  }
  function closeSheet(): void {
    if (!sheet?.open) return;
    sheet.close();
  }
  sheet?.addEventListener("close", () => {
    sheetOpener?.focus({ preventScroll: true });
    sheetOpener = null;
  });
  sheetClose?.addEventListener("click", closeSheet);
  // A click on the backdrop, outside the sheet's own box, closes it too.
  sheet?.addEventListener("click", (e) => {
    if (e.target !== sheet) return;
    const r = sheet.getBoundingClientRect();
    const inside =
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom;
    if (!inside) closeSheet();
  });

  resultSlot.addEventListener("click", async (event) => {
    const target = event.target as Element | null;
    if (target?.closest("[data-daylist-to-extra]")) {
      void setMode("extra", true);
      return;
    }
    if (target?.closest("[data-daylist-to-daily]")) {
      void setMode("daily", true);
      return;
    }
    if (target?.closest("[data-daylist-next]")) {
      const keyboard = event.detail === 0;
      startExtra();
      if (keyboard) {
        setTimeout(
          () =>
            tray!.querySelector<HTMLElement>("[data-daylist-more]")?.focus(),
          reduced() ? 0 : 300,
        );
      }
      return;
    }
    const listKey = target?.closest<HTMLElement>("[data-daylist-list]");
    if (listKey) {
      openSheet(listKey);
      return;
    }
    const copy = target?.closest<HTMLButtonElement>("[data-daylist-copy]");
    if (!copy || !result) return;
    const shareLabel = sharesNatively() ? "Share result" : "Copy result";
    const text = shareText({
      list: (day % ROUNDS.length) + 1,
      date: new Date(),
      km: result.km,
      off: result.off,
      used: result.used,
      total: round.clues.length,
      score: result.score,
    });
    if (sharesNatively()) {
      try {
        await navigator.share({ text });
        return;
      } catch (error) {
        // Closing the share sheet is a choice, not a failure.
        if ((error as DOMException)?.name === "AbortError") return;
      }
    }
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = false;
    }
    copy.textContent = copied ? "Copied" : "Couldn't copy";
    window.setTimeout(() => {
      copy.textContent = shareLabel;
    }, 1800);
  });

  /* ------------------------------------------------------------ rounds */

  function syncMeta(): void {
    if (!metaEl) return;
    if (mode === "daily") {
      metaEl.textContent = DATE_LONG.format(new Date());
      return;
    }
    const n = Math.max(1, extra.played.indexOf(round.placeId) + 1);
    metaEl.textContent = `List ${n} of ${EXTRA_PER_DAY} today`;
  }

  /** Resolves once the hobby scene that opened the page has gone. */
  const uncovered = new Promise<void>((resolve) => {
    if (covered()) whenUncovered(resolve);
    else resolve();
  });

  /** Put a round on the board, as far along as `progress` says. */
  function loadRound(next: Round, progress: Progress | null): void {
    generation++;
    const mine = generation;
    revealing = false;
    pins.clear();
    round = next;
    lines = clamp(progress?.lines ?? 1, 1, next.clues.length);
    pin =
      progress && isNum(progress.lat) && isNum(progress.lon)
        ? { lat: progress.lat, lon: progress.lon }
        : null;
    month = progress && isNum(progress.month) ? progress.month : null;
    done = false;
    result = null;
    answerRoom = {};
    ans = null;
    answerShown = false;
    tints = null;
    pinfo = [];
    ready = false;
    hot = null;
    picked = null;
    breath = null;
    restAt = null;
    centre = null;
    lay = [];
    rings = round.clues.map((c, k) => ({
      km: c.reach ? reachKm(c.reach) : null,
      shown: k < lines,
      t0: -1e9,
      d: 0,
      from: 0,
      flying: false,
      landed: k < lines ? 1 : 0,
    }));

    root.classList.remove("is-done", "is-post-flow");
    surface!.classList.remove("is-done");
    titlePanel!.inert = false;
    hand!.inert = false;
    guessPanel!.inert = false;
    surface!.classList.toggle("is-placed", Boolean(pin));
    surface!.setAttribute("aria-label", MAP_LABEL);
    resultSlot!.hidden = true;
    resultSlot!.innerHTML = "";
    ui!.querySelector(":scope > .dl-banner")?.remove();
    labels!.innerHTML = "";
    labelEls.length = 0;
    tapeEl = null;
    hintEl = null;
    if (sheet?.open) sheet.close();
    if (rollSlot) rollSlot.innerHTML = "";
    // Left open, the credits would show the next round's names as they come.
    if (credits) credits.open = false;
    if (announce) announce.textContent = "";
    openHow(false);
    for (const c of round.clues) photo(c.photo);
    tray!.innerHTML = round.clues.map(() => "<li></li>").join("");
    round.clues.forEach((_, j) => slot(j));
    syncPick();
    hand!.classList.add("is-waiting");
    if (phone) layout();
    // A new round's ceiling is set, not counted down from the last one's.
    worthEl!.dataset.value = String(bestPossible(lines));
    worthEl!.textContent = count(bestPossible(lines));
    stakesUp!.textContent = "Up to";
    reachEl!.textContent = "?";
    syncMonths();
    syncLock();
    syncMeta();
    paintCredits();
    void m.reset(false);
    blockVersion++;
    m.redraw();

    const finished = Boolean(progress?.done && pin && month !== null);
    // Colour comes from the photos, once they're in, then the hand is dealt
    // and the first ring opens out round the lens.
    const loaded = Promise.all(round.clues.map((c) => photoInfo(c.photo))).then(
      (list) => {
        if (mine !== generation) return;
        pinfo = list;
        tints = assignTints(list.map((x) => x.hues));
        paintTints();
        syncPick();
        m.redraw();
      },
    );
    const dealt = Promise.race([
      loaded,
      new Promise((r) => setTimeout(r, 600)),
    ]);
    void Promise.all([dealt, uncovered]).then(() => {
      if (mine !== generation) return;
      ready = true;
      round.clues.forEach((_, j) => slot(j));
      hand!.classList.remove("is-waiting");
      if (!reduced() && !finished) {
        Array.from(tray!.children).forEach((li, j) => {
          li.animate(
            [
              { transform: "translateY(48px)", opacity: 0 },
              { transform: "translateY(-8px)", opacity: 1, offset: 0.6 },
              { transform: "translateY(2px)", opacity: 1, offset: 0.8 },
              { transform: "none", opacity: 1 },
            ],
            {
              duration: 240,
              delay: j * 45,
              easing: "steps(5, end)",
              fill: "backwards",
            },
          );
        });
        breath = { t0: now() + 60, d: 1100 };
        rings[0].landed = now() + 380;
      }
      blockVersion++;
      m.redraw();
    });

    if (finished) void finish(false);
  }

  /** Deal the next extra list, if today's ten aren't used up. */
  function startExtra(): void {
    if (!extraPool?.length) return;
    if (extra.played.length >= EXTRA_PER_DAY) return;
    const id = pickExtra(
      extraPool.map((r) => r.placeId),
      extra.seen,
    );
    extra.seen = [...extra.seen.filter((x) => x !== id), id];
    extra.played = [...extra.played, id];
    extra.current = { placeId: id, lines: 1, done: false };
    writeStore(EXTRA_KEY, extra);
    window.dispatchEvent(
      new CustomEvent("tb:nn", { detail: { mode: "more" } }),
    );
    const next = extraPool.find((r) => r.placeId === id);
    if (!next) return;
    loadRound(next, extra.current);
  }

  /** The tabs, the board's title and the URL say which list this is. */
  function showMode(next: Mode, fromUser: boolean): void {
    modes
      ?.querySelectorAll<HTMLElement>('[role="radio"]')
      .forEach((option) =>
        option.setAttribute(
          "aria-checked",
          String(option.dataset.value === next),
        ),
      );
    if (boardTitle) {
      boardTitle.textContent = next === "daily" ? "Today's list" : "More lists";
    }
    if (fromUser) {
      const url = `${location.pathname}${location.search}${
        next === "extra" ? "#more-lists" : ""
      }`;
      history.replaceState(history.state, "", url);
    }
  }

  /**
   * While More lists loads, the board can't be played. The round on it still
   * belongs to the old mode, so a tap or a lock-in then would be saved to
   * the wrong list.
   */
  function setBusy(busy: boolean): void {
    tray!.inert = busy;
    guessPanel!.inert = busy || done;
    surface!.inert = busy;
    root.classList.toggle("is-loading", busy);
  }

  // The mode asked for last. `mode` changes only once that mode's round is on
  // the board, so the two differ while More lists loads.
  let wanted: Mode = "daily";
  let switching = 0;

  async function setMode(next: Mode, fromUser: boolean): Promise<void> {
    const ticket = ++switching;
    wanted = next;
    showMode(next, fromUser);

    if (next === "daily") {
      setBusy(false);
      mode = "daily";
      loadRound(daily, readDaily(readStore(DAILY_KEY), day));
      return;
    }

    if (!extraPool) {
      setBusy(true);
      if (metaEl) metaEl.textContent = "Loading more lists...";
      try {
        const data = await import("./day-list-extra.json");
        extraPool = (data.default as { rounds: Round[] }).rounds;
      } catch {
        if (ticket !== switching) return;
        // Back to today's list, which is always there. A list that won't
        // load is usually a deploy that replaced it, so a reload fixes it.
        await setMode("daily", fromUser);
        if (metaEl) {
          metaEl.textContent =
            "More lists didn't load. Reload the page to try again.";
        }
        return;
      }
      if (ticket !== switching) return;
      setBusy(false);
    }

    mode = "extra";
    extra = readExtra(readStore(EXTRA_KEY), day);
    const current = extra.current
      ? extraPool.find((r) => r.placeId === extra.current!.placeId)
      : undefined;
    if (current && extra.current) {
      loadRound(current, extra.current);
    } else if (extra.played.length < EXTRA_PER_DAY) {
      startExtra();
    } else {
      // Ten played but none to show, which only a cleared or edited store
      // can cause. Today's list is still there to play.
      await setMode("daily", false);
      if (metaEl) metaEl.textContent = "That's all ten more lists for today";
    }
  }

  if (modes) {
    initUnderlineTabs(modes);
    modes.addEventListener("utabs:change", (event) => {
      const value = (event as CustomEvent<string>).detail;
      const next: Mode = value === "extra" ? "extra" : "daily";
      if (next !== wanted) void setMode(next, true);
    });
  }

  /* ---------------------------------------------------------------- boot */

  addEventListener("resize", () => {
    layout();
    if (done && pin && !revealing)
      void m.fit(answerBox(), { animate: false, room: answerRoom });
  });
  layout();
  void setMode(location.hash === "#more-lists" ? "extra" : "daily", false);
  document.fonts?.ready.then(() => {
    widths.clear();
    layout();
  });
}
