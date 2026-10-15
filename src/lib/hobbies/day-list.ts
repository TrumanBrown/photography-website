/**
 * Day list - a daily puzzle that asks you to read a community rather than a
 * single organism.
 *
 * Six species were all recorded at one real place in one month. They arrive one
 * at a time, most widely recorded first, so the first one could be almost
 * anywhere and the last one is nearly the answer. You pin the place on a world
 * map and choose the month, once. Every species you ask for lowers the most you
 * can score, and the board shows both that ceiling ("Up to 5,400 points") and
 * what the next species costs, so the trade is visible before you make it.
 *
 * Two modes share the board. Today's list is the same round for everyone,
 * picked by date from day-list.json. More lists deals up to ten a day per
 * browser from day-list-extra.json, a separate set of places, so an extra list
 * can never spoil a future daily one. Both modes remember a round in progress,
 * so reloading can't reset how many species you've seen.
 *
 * Puzzle data is built at release time by scripts/build-day-list.mjs. Photos
 * come from the iNaturalist CDNs already allow-listed in the site's CSP, so the
 * island makes no runtime API calls. The map (zoom, terrain, gestures) is
 * ./day-list-map.
 *
 * Mounted by src/components/hobbies/DayList.astro via [data-daylist] hooks.
 */
import {
  initUnderlineTabs,
  prefersReducedMotion,
  rollTo,
  stamp,
} from "../motion";
import {
  MAX_ZOOM,
  answerView,
  createWorldMap,
  scaleBar,
  type Box,
  type LonLat,
  type Point,
  type WorldMap,
} from "./day-list-map";
import puzzles from "./day-list.json";

interface Clue {
  id: number;
  name: string;
  sci: string;
  group: string;
  /** Worldwide iNaturalist observations: how often it is recorded, not range. */
  global: number;
  /** Observations at this place in this month. */
  local: number;
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

/**
 * After "Lock it in" the answer lands in one beat: the map glides to frame the
 * pin and the place, the line runs from one to the other while the distance
 * counts up beside it, the boundary strokes in as the total lands, then the
 * species still hidden fill in one after another.
 */
const CAMERA_MS = 650;
const LINE_MS = 600;
const BOX_MS = 300;
const FILL_STAGGER_MS = 70;

const MAP_LABEL =
  "World map. Tap where you think the six species were seen. Arrow keys move the pin, plus and minus zoom.";

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
const count = (value: number): string => value.toLocaleString("en-US");
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

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

/**
 * Wikipedia's opening sentence repeats the Latin name in brackets and often
 * carries a pronunciation. Both sit right under a name that's already shown,
 * so they come out. A bracket needs an IPA letter to count as a
 * pronunciation, so "(25 mi/h)" survives.
 */
export function tidyFact(fact: string, sci: string): string {
  const latin = new RegExp(
    `\\s*\\(\\s*${sci.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`,
    "g",
  );
  return fact
    .replace(LISTEN, "")
    .replace(IPA_IN_BRACKETS, "")
    .replace(IPA_BARE, "")
    .replace(latin, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

/**
 * iNaturalist capitalises animal names but not plant ones, which is the
 * convention in the field. Lift the first letter so the slots look even.
 */
function displayName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatPin(pin: LonLat): string {
  return (
    `${Math.abs(pin.lat).toFixed(1)}\u00b0${pin.lat >= 0 ? "N" : "S"}, ` +
    `${Math.abs(pin.lon).toFixed(1)}\u00b0${pin.lon >= 0 ? "E" : "W"}`
  );
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
 * The lines of the photo credits footnote, in board order. Only photos already
 * on the board are listed, because a photographer's name can give the place
 * away.
 */
export function photoCredits(clues: Round["clues"], shown: number): string {
  return clues
    .slice(0, Math.max(0, shown))
    .map(
      (clue) =>
        `<li>${escapeHtml(displayName(clue.name))} &middot; &copy; ${escapeHtml(
          clue.by,
        )} &middot; <span class="dl-nowrap">${escapeHtml(clue.licence)}</span></li>`,
    )
    .join("");
}

/**
 * The squares are up to 360px across, more than iNaturalist's medium size
 * holds on a sharp screen, so the browser can swap in large. The widths given
 * are each size's short side for a 4:3 photo, since the square crops to it.
 */
const PHOTO_SIZES =
  "(min-width: 1152px) 360px, (min-width: 640px) calc((100vw - 72px) / 3), calc((100vw - 48px) / 3)";

export function photoSrcset(photo: string): string {
  if (!photo.includes("/medium.")) return "";
  return `${photo} 375w, ${photo.replace("/medium.", "/large.")} 768w`;
}

/** Fetch a photo at the size its square will ask for, so it shows at once. */
function preloadPhoto(photo: string): void {
  const image = new Image();
  image.decoding = "async";
  const srcset = photoSrcset(photo);
  if (srcset) {
    image.sizes = PHOTO_SIZES;
    image.srcset = srcset;
  }
  image.src = photo;
}

const isMac = () =>
  /Mac|iPhone|iPad/.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.userAgent,
  );

export function initDayList(root: HTMLElement): void {
  const q = <T extends Element>(selector: string) =>
    root.querySelector<T>(selector);
  const canvas = q<HTMLCanvasElement>("[data-daylist-map]");
  const surface = q<HTMLElement>("[data-daylist-mapwrap]");
  const tray = q<HTMLElement>("[data-daylist-clues]");
  const lockBtn = q<HTMLButtonElement>("[data-daylist-lock]");
  const guessPanel = q<HTMLElement>("[data-daylist-guess]");
  const resultSlot = q<HTMLElement>("[data-daylist-result]");
  const monthInputs = Array.from(
    root.querySelectorAll<HTMLInputElement>("[data-daylist-month]"),
  );
  if (
    !canvas ||
    !surface ||
    !tray ||
    !lockBtn ||
    !guessPanel ||
    !resultSlot ||
    monthInputs.length !== MONTHS.length
  )
    return;

  const readout = q<HTMLElement>("[data-daylist-readout]");
  const worthEl = q<HTMLElement>("[data-daylist-worth]");
  const announce = q<HTMLElement>("[data-daylist-announce]");
  const rollSlot = q<HTMLElement>("[data-daylist-roll]");
  const metaEl = q<HTMLElement>("[data-daylist-meta]");
  const titleEl = q<HTMLElement>("[data-daylist-title]");
  const board = q<HTMLElement>("[data-daylist-board]");
  const playArea = q<HTMLElement>("[data-daylist-play]");
  const modes = q<HTMLElement>("[data-daylist-modes]");
  const zoomInBtn = q<HTMLButtonElement>('[data-daylist-zoom="in"]');
  const zoomOutBtn = q<HTMLButtonElement>('[data-daylist-zoom="out"]');
  const viewBtn = q<HTMLButtonElement>("[data-daylist-view]");
  const scaleEl = q<HTMLElement>("[data-daylist-scale]");
  const wheelHint = q<HTMLElement>("[data-daylist-wheelhint]");
  const credits = q<HTMLDetailsElement>("[data-daylist-credits]");
  const creditList = q<HTMLElement>("[data-daylist-credit-list]");

  const day = todayNumber();
  const daily = ROUNDS[day % ROUNDS.length];

  let mode: Mode = "daily";
  let round = daily;
  let lines = 1;
  // Slots showing a species. It matches `lines` except while the answer is
  // landing, when the species still hidden wait for the boundary.
  let shown = 1;
  let pin: LonLat | null = null;
  let month: number | null = null;
  let done = false;
  // How much of the answer the map shows, 0 to 1: the line from the pin, then
  // the boundary. Both stay at 1 unless the reveal is playing.
  let lineT = 1;
  let boxT = 1;
  // Bumped whenever a round loads, so a reveal still playing for the last
  // round stops touching the board.
  let generation = 0;
  // True from "Lock it in" until the answer has landed on the map.
  let revealing = false;
  // The verdict stamped on the map once the answer is down.
  let verdictStamp: HTMLElement | null = null;
  let extraPool: Round[] | null = null;
  let extra = readExtra(readStore(EXTRA_KEY), day);

  /* ---------------------------------------------------------------- map */

  const map = createWorldMap({
    canvas,
    surface,
    onTap: placePin,
    focusPoint: () => pin,
    drawOverlay: drawGame,
    onView: syncMapControls,
    onWheelHint: showWheelHint,
  });
  if (!map) return;

  /** The pin and the place together, which the reveal frames. */
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

  function drawGame(ctx: CanvasRenderingContext2D, m: WorldMap): void {
    const { ink, ink2, paper } = m.palette;
    const tl = m.project(round.bbox.w, round.bbox.n);
    const br = m.project(round.bbox.e, round.bbox.s);
    const boxW = Math.max(6, br.x - tl.x) + 2;
    const boxH = Math.max(6, br.y - tl.y) + 2;
    let middle: Point | null = null;
    let lineLength = 0;

    // The line runs to the nearest edge of the place, the point the distance
    // is measured to, and leaves from the rim of the pin rather than its
    // middle. It goes the short way round, like the distance: a pin in Hawaii
    // reaches Japan off one side of the map and back in at the other.
    if (done && pin && lineT > 0) {
      const edge = nearestPoint(pin, round.bbox);
      let toLon = edge.lon;
      if (toLon - pin.lon > 180) toLon -= 360;
      else if (pin.lon - toLon > 180) toLon += 360;
      const from = m.project(pin.lon, pin.lat);
      const to = m.project(toLon, edge.lat);
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (length > 8) {
        const ux = (to.x - from.x) / length;
        const uy = (to.y - from.y) / length;
        const reach = 7 + (length - 7) * lineT;
        const a = { x: from.x + ux * 7, y: from.y + uy * 7 };
        const b = { x: from.x + ux * reach, y: from.y + uy * reach };
        const shifts = [0];
        if (toLon < -180) shifts.push(m.worldWidth);
        if (toLon > 180) shifts.push(-m.worldWidth);
        ctx.strokeStyle = ink2;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (const shift of shifts) {
          ctx.moveTo(a.x + shift, a.y);
          ctx.lineTo(b.x + shift, b.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        lineLength = length;
      }
    }

    // Show the real boundary, not just a dot, so the scoring is legible. While
    // the reveal plays it strokes in from its top-left corner.
    if (done && boxT > 0) {
      const perimeter = 2 * (boxW + boxH);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      if (boxT < 1) ctx.setLineDash([perimeter * boxT, perimeter]);
      ctx.strokeRect(tl.x - 1, tl.y - 1, boxW, boxH);
      ctx.setLineDash([]);
    }

    if (pin) {
      const p = m.project(pin.lon, pin.lat);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 11, p.y);
      ctx.lineTo(p.x - 3, p.y);
      ctx.moveTo(p.x + 3, p.y);
      ctx.lineTo(p.x + 11, p.y);
      ctx.moveTo(p.x, p.y - 11);
      ctx.lineTo(p.x, p.y - 3);
      ctx.moveTo(p.x, p.y + 3);
      ctx.lineTo(p.x, p.y + 11);
      ctx.stroke();
    }

    if (!done || boxT < 1) return;

    // Labels sit on a rim of paper so they read over coastlines and relief.
    ctx.font =
      '500 11px "Libre Franklin", ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = "left";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    const label = (text: string, x: number, y: number) => {
      ctx.strokeStyle = paper;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = ink;
      ctx.fillText(text, x, y);
    };

    // The name goes above the box, to its right, unless that runs off the map.
    const nameW = ctx.measureText(round.name).width;
    let nx = tl.x - 1 + boxW + 5;
    if (nx + nameW > m.width - 4) nx = tl.x - 6 - nameW;
    nx = clamp(nx, 4, m.width - 4 - nameW);
    const ny = Math.max(13, tl.y - 6);
    label(round.name, nx, ny);

    // How far, written on the line itself once it's long enough to carry it.
    if (pin && middle && lineLength > 110) {
      const km = distanceToPlace(pin, round.bbox);
      const text = `${count(Math.round(km))} km`;
      const tw = ctx.measureText(text).width;
      const lx = clamp(middle.x - tw / 2, 4, m.width - 4 - tw);
      const ly = clamp(middle.y - 8, 13, m.height - 6);
      const clear =
        Math.abs(ly - ny) > 16 || lx + tw < nx - 8 || lx > nx + nameW + 8;
      if (km > 0 && clear) label(text, lx, ly);
    }
  }

  function isFramed(m: WorldMap): boolean {
    if (!done || !pin) return false;
    const want = answerView(answerBox(), m.width, m.height);
    const v = m.view;
    return (
      Math.abs(Math.log(v.k / want.k)) < 0.08 &&
      Math.abs(v.cu - want.cu) < 0.05 / v.k &&
      Math.abs(v.cv - want.cv) < 0.05 / v.k
    );
  }

  function syncMapControls(m: WorldMap): void {
    const k = m.view.k;
    if (zoomInBtn) zoomInBtn.disabled = k >= MAX_ZOOM - 0.01;
    if (zoomOutBtn) zoomOutBtn.disabled = k <= 1.001;
    if (viewBtn) {
      // Zoomed in: a way back out. After the answer, a way back to it. Not
      // while the answer is landing, when the view moves by itself.
      const framed = isFramed(m);
      if (revealing) {
        viewBtn.hidden = true;
      } else if (done && !framed) {
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
    }
    if (scaleEl) {
      const show = k > 1.5;
      scaleEl.hidden = !show;
      if (show) {
        const { km, px } = scaleBar(m.kmPerPx());
        const bar = scaleEl.querySelector<HTMLElement>("i");
        const text = scaleEl.querySelector<HTMLElement>("span");
        if (bar) bar.style.width = `${Math.round(px)}px`;
        if (text) text.textContent = `${count(km)} km`;
      }
    }
  }

  zoomInBtn?.addEventListener("click", () => {
    map.zoomBy(2, pin ? map.project(pin.lon, pin.lat) : undefined);
  });
  zoomOutBtn?.addEventListener("click", () => map.zoomBy(0.5));
  viewBtn?.addEventListener("click", () => {
    if (viewBtn.dataset.action === "answer") void map.fit(answerBox());
    else void map.reset();
  });

  let hintTimer = 0;
  function showWheelHint(): void {
    if (!wheelHint) return;
    wheelHint.textContent = isMac()
      ? "Hold \u2318 and scroll to zoom"
      : "Hold Ctrl and scroll to zoom";
    wheelHint.classList.add("is-on");
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(
      () => wheelHint.classList.remove("is-on"),
      1200,
    );
  }

  /* -------------------------------------------------------- the species */

  tray.textContent = "";
  const slots = Array.from({ length: 6 }, () => {
    const li = document.createElement("li");
    li.className = "dl-slot";
    tray.append(li);
    return li;
  });

  /**
   * One square per species. Shown ones carry the photo and name; the next one
   * is the button and says what it costs; the rest wait with their number.
   * `fresh` plays the reveal for a species that has just come out, starting
   * `delay` ms late so a row of them can fill in one after another.
   */
  function paintSlot(i: number, fresh = false, delay = 0): void {
    const li = slots[i];
    if (fresh && delay > 0) li.style.setProperty("--dl-delay", `${delay}ms`);
    else li.style.removeProperty("--dl-delay");
    if (i < shown) {
      const clue = round.clues[i];
      const srcset = photoSrcset(clue.photo);
      li.className = fresh ? "dl-slot is-new" : "dl-slot";
      li.innerHTML = `<figure class="dl-slot__fig">
          <div class="dl-slot__pic"><img src="${escapeHtml(clue.photo)}"${
            srcset
              ? ` srcset="${escapeHtml(srcset)}" sizes="${PHOTO_SIZES}"`
              : ""
          } alt="" width="500" height="500" decoding="async"></div>
          <figcaption class="dl-slot__body">
            <span class="dl-slot__name">${escapeHtml(displayName(clue.name))}</span>
            <span class="dl-slot__sci">${escapeHtml(clue.sci)}</span>
            <span class="dl-slot__count">${count(clue.global)} sightings worldwide</span>
          </figcaption>
        </figure>`;
      const img = li.querySelector("img");
      if (!img) return;
      const show = () => img.classList.add("is-loaded");
      if (img.complete && img.naturalWidth > 0) {
        // Already cached: wait a frame on a fresh reveal so the fade runs.
        if (fresh) requestAnimationFrame(() => requestAnimationFrame(show));
        else show();
      } else {
        img.addEventListener("load", show, { once: true });
        img.addEventListener("error", show, { once: true });
      }
      return;
    }

    li.className = "dl-slot";
    if (!done && i === lines) {
      const cost = bestPossible(lines) - bestPossible(lines + 1);
      li.innerHTML = `<button type="button" class="dl-slot__next" data-daylist-more>
          <span class="dl-slot__cta">Show the next one</span>
          <span class="dl-slot__cost">&minus;${count(cost)} points</span>
        </button>`;
      return;
    }
    li.innerHTML = `<span class="dl-slot__blank" aria-hidden="true">${
      i + 1
    }</span><span class="dl-sr">Species ${i + 1}, not shown yet</span>`;
  }

  function syncWorth(): void {
    if (worthEl) rollTo(worthEl, bestPossible(lines));
  }

  function paintCredits(): void {
    if (creditList) creditList.innerHTML = photoCredits(round.clues, shown);
  }

  /** Fetch the next photo while the visitor thinks, so the reveal is instant. */
  function preloadNext(): void {
    const next = round.clues[lines];
    if (!next || done) return;
    const fetchPhoto = () => preloadPhoto(next.photo);
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(fetchPhoto, { timeout: 2000 });
    } else {
      setTimeout(fetchPhoto, 300);
    }
  }

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

  function reveal(fromKeyboard: boolean): void {
    if (done || lines >= round.clues.length) return;
    const cost = bestPossible(lines) - bestPossible(lines + 1);
    lines += 1;
    shown = lines;
    paintSlot(lines - 1, true);
    // The price lands on the species it bought: that's where the eye is, and
    // the points total is usually down the page under the map.
    stamp(slots[lines - 1], `\u2212${count(cost)}`, { unit: "points" });
    if (lines < round.clues.length) paintSlot(lines);
    paintCredits();
    syncWorth();
    preloadNext();
    persist();

    const clue = round.clues[lines - 1];
    if (announce) {
      announce.textContent =
        `Species ${lines} of ${round.clues.length}: ${displayName(clue.name)}, ` +
        `${count(clue.global)} sightings worldwide. ` +
        `Up to ${count(bestPossible(lines))} points now.`;
    }
    // The button that was pressed has been replaced, so keyboard focus
    // follows to the next one (or the map once all six are out).
    if (fromKeyboard) {
      const next = tray!.querySelector<HTMLElement>("[data-daylist-more]");
      (next ?? surface!).focus();
    }
  }

  tray.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    if (!target?.closest("[data-daylist-more]")) return;
    // A click fired by Enter or Space has no pointer, so detail is 0.
    reveal(event.detail === 0);
  });

  /* ------------------------------------------------------------ guessing */

  function describeGuess(): void {
    if (!readout) return;
    if (pin && month !== null) {
      readout.textContent = `Pin at ${formatPin(pin)} in ${MONTHS[month]}.`;
    } else if (pin) {
      readout.textContent = `Pin at ${formatPin(pin)}. Now pick a month.`;
    } else if (month !== null) {
      readout.textContent = `${MONTHS[month]}. Now drop a pin on the map.`;
    } else {
      readout.textContent = "Drop a pin, then pick a month.";
    }
  }

  function syncLock(): void {
    lockBtn!.disabled = done || !pin || month === null;
  }

  function placePin(at: LonLat): void {
    if (done) return;
    pin = { lat: clamp(at.lat, -85, 85), lon: clamp(at.lon, -180, 180) };
    surface!.classList.add("is-placed");
    describeGuess();
    syncLock();
    persist();
    map!.redraw();
  }

  // Keyboard guessing: the pin starts in the middle of the view and arrows
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
      if (!dir || map.view.k <= 1.001) return;
      event.preventDefault();
      const by = (event.shiftKey ? 0.5 : 0.15) * map.width;
      map.panBy(dir[0] * by, dir[1] * by);
      return;
    }
    const step = Math.max(0.01, (event.shiftKey ? 15 : 4) / map.view.k);
    let next = pin;
    if (!next) {
      if (!event.key.startsWith("Arrow") && event.key !== "Enter") return;
      next = map.unproject(map.width / 2, map.height / 2);
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
    placePin(next);
    if (pin) map.show(pin);
  });

  monthInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (done || !input.checked) return;
      month = Number(input.value);
      describeGuess();
      syncLock();
      persist();
    });
  });

  /* -------------------------------------------------------------- result */

  function shareText(
    km: number,
    off: number,
    used: number,
    score: number,
  ): string {
    let read = "";
    for (let i = 0; i < round.clues.length; i++) {
      read += i < used ? "\u{1F4D6}" : "\u2B1C";
    }
    const distance =
      km === 0
        ? "\u{1F3AF}"
        : km < 400
          ? "\u{1F7E9}"
          : km < 1500
            ? "\u{1F7E8}"
            : km < 5000
              ? "\u{1F7E7}"
              : "\u{1F7E5}";
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
    return (
      `Narrow nature, ${DATE_SHORT.format(new Date())}\n${read}\n${distance}${season}\n` +
      `${where} \u00b7 ${used}/${round.clues.length} species \u00b7 ${count(score)}`
    );
  }

  /** Everything about the six, now that the answer is out. */
  function renderFullList(): void {
    if (!rollSlot) return;
    const inMonth = MONTHS[round.month - 1];
    const entries = round.clues
      .map((clue) => {
        const status = [STANDING_LABEL[clue.standing], clue.rank]
          .filter(Boolean)
          .map(escapeHtml)
          .join(" &middot; ");
        const fact = clue.fact ? tidyFact(clue.fact, clue.sci) : "";
        const links = [
          clue.wiki
            ? `<a href="${escapeHtml(
                clue.wiki,
              )}" target="_blank" rel="noopener noreferrer">Wikipedia</a>`
            : "",
          `<a href="https://www.inaturalist.org/taxa/${clue.id}" target="_blank" rel="noopener noreferrer">iNaturalist</a>`,
        ]
          .filter(Boolean)
          .join(" &middot; ");
        return `<li class="dl-entry">
          <p class="dl-entry__name">${escapeHtml(displayName(clue.name))}</p>
          <p class="dl-entry__sci"><i>${escapeHtml(clue.sci)}</i>${
            status
              ? ` &middot; <span class="dl-entry__status">${status}</span>`
              : ""
          }</p>
          ${fact ? `<p class="dl-entry__fact">${escapeHtml(fact)}</p>` : ""}
          <p class="dl-entry__meta">Seen here ${count(clue.local)} ${
            clue.local === 1 ? "time" : "times"
          } in ${inMonth} &middot; ${count(clue.global)} worldwide &middot; ${links}</p>
        </li>`;
      })
      .join("");
    rollSlot.innerHTML = `<section class="dl-roll" aria-labelledby="dl-roll-title">
        <h3 id="dl-roll-title">The full list</h3>
        <ol class="dl-entries" role="list">${entries}</ol>
      </section>`;
  }

  /**
   * Play the answer onto the map: the line for `lineMs`, then the boundary
   * for BOX_MS, redrawing every frame. `landed` runs once both are down.
   */
  function playReveal(lineMs: number, mine: number, landed: () => void): void {
    lineT = 0;
    boxT = 0;
    const start = performance.now();
    const easeOut = (k: number) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
    const step = (now: number) => {
      if (mine !== generation) return;
      const elapsed = now - start;
      lineT = lineMs > 0 ? easeOut(elapsed / lineMs) : 1;
      boxT = easeOut((elapsed - lineMs) / BOX_MS);
      map!.redraw();
      if (elapsed < lineMs + BOX_MS) requestAnimationFrame(step);
      else landed();
    };
    requestAnimationFrame(step);
  }

  function extraRow(): string {
    const played = extra.played.length;
    const points = Object.values(extra.scores).reduce((a, b) => a + b, 0);
    return played >= EXTRA_PER_DAY
      ? `That's all ten for today, ${count(points)} points. Ten more turn up tomorrow`
      : `${played} of ${EXTRA_PER_DAY} played today &middot; ${count(points)} points`;
  }

  /**
   * Score the guess and swap the guess panel for a receipt. `animate` is
   * false when a finished round is restored, so nothing replays.
   */
  async function finish(animate: boolean): Promise<void> {
    if (!pin || month === null) return;
    const mine = generation;
    done = true;
    const motion = animate && !prefersReducedMotion();
    const { km, off, used, placePoints, monthPoints, score } = scoreGuess(
      round,
      { ...pin, month, lines },
    );
    if (mode === "extra") extra.scores[String(round.placeId)] = score;
    persist();

    const verdict =
      km === 0
        ? "Spot on"
        : km < 400
          ? "Near enough"
          : km < 1500
            ? "Right part of the world"
            : km < 5000
              ? "Not quite"
              : "Wrong side of the planet";
    const lineMs = km === 0 ? 0 : LINE_MS;
    const kmShown = Math.round(km);
    const distance =
      km === 0
        ? "Inside the boundary"
        : `<span class="dl-num" data-daylist-km>${
            motion ? "0" : count(kmShown)
          }</span> km off`;
    // The verdict lands on the map as the boundary closes, and stays.
    const stampVerdict = (slam: boolean) => {
      verdictStamp?.remove();
      const box = surface!.parentElement;
      if (!box) return;
      verdictStamp = stamp(box, verdict, {
        unit: km === 0 ? "inside the boundary" : `${count(kmShown)} km off`,
        className: "stamp-ink dl-verdict-stamp",
        stay: true,
        animate: slam,
        tilt: -6,
      });
    };
    const monthWhy =
      off === 0
        ? "Right month"
        : `You picked ${MONTHS[month]}, ${off} ${off === 1 ? "month" : "months"} out`;

    // The species still hidden stay numbered squares until the boundary is
    // down, then fill in. Their photos start loading now.
    for (let i = shown; i < round.clues.length; i++) paintSlot(i);
    const fillIn = () => {
      const from = shown;
      shown = round.clues.length;
      for (let i = from; i < round.clues.length; i++) {
        paintSlot(i, animate, (i - from) * FILL_STAGGER_MS);
      }
      paintCredits();
    };
    if (motion) {
      for (const clue of round.clues.slice(used)) preloadPhoto(clue.photo);
    }

    surface!.classList.add("is-done");
    surface!.setAttribute(
      "aria-label",
      `World map showing your pin and ${round.name}.`,
    );
    syncLock();

    const canNext = mode === "extra" && extra.played.length < EXTRA_PER_DAY;
    const actions =
      mode === "daily"
        ? `<button type="button" class="btn btn-ink" data-daylist-to-extra>Play more lists</button>
           <button type="button" class="btn" data-daylist-copy>Copy result</button>`
        : canNext
          ? `<button type="button" class="btn btn-ink" data-daylist-next>Next list</button>`
          : "";
    guessPanel!.hidden = true;
    resultSlot!.hidden = false;
    resultSlot!.innerHTML = `
      <div>
        <p class="dl-verdict">${verdict}</p>
        <h3 class="dl-place" tabindex="-1" data-daylist-place>${escapeHtml(round.name)}</h3>
        <p class="dl-region">${escapeHtml(round.region)} &middot; ${
          MONTHS[round.month - 1]
        }</p>
      </div>
      <dl class="dl-receipt">
        <div>
          <dt>Place</dt>
          <dd class="dl-receipt__pts">${count(placePoints)}</dd>
          <dd class="dl-receipt__why">${distance}, with ${used} of ${round.clues.length} species showing</dd>
        </div>
        <div>
          <dt>Month</dt>
          <dd class="dl-receipt__pts">${count(monthPoints)}</dd>
          <dd class="dl-receipt__why">${monthWhy}</dd>
        </div>
        <div class="dl-receipt__total">
          <dt>Total</dt>
          <dd class="dl-receipt__pts"><span class="dl-score" data-daylist-score>${
            motion ? "0" : count(score)
          }</span></dd>
        </div>
      </dl>
      <div class="dl-actions">
        ${actions}
        <a class="btn" href="https://www.inaturalist.org/places/${
          round.placeId
        }" target="_blank" rel="noopener noreferrer">See the place</a>
      </div>
      <p class="dl-next">${
        mode === "daily" ? "A new list turns up tomorrow" : extraRow()
      }</p>`;

    const copy = resultSlot!.querySelector<HTMLButtonElement>(
      "[data-daylist-copy]",
    );
    copy?.addEventListener("click", async () => {
      let copied = false;
      try {
        await navigator.clipboard.writeText(shareText(km, off, used, score));
        copied = true;
      } catch {
        copied = false;
      }
      copy.textContent = copied ? "Copied" : "Couldn't copy";
      window.setTimeout(() => {
        copy.textContent = "Copy result";
      }, 1800);
    });
    resultSlot!
      .querySelector("[data-daylist-to-extra]")
      ?.addEventListener("click", () => void setMode("extra", true));
    resultSlot!
      .querySelector("[data-daylist-next]")
      ?.addEventListener("click", () => startExtra(true));

    renderFullList();

    if (animate) {
      // Screen readers hear the place first. The map is kept in view so the
      // answer can be watched landing; on a phone the result sits under it.
      resultSlot!
        .querySelector<HTMLElement>("[data-daylist-place]")
        ?.focus({ preventScroll: true });
      surface!.scrollIntoView({
        block: "nearest",
        behavior: motion ? "smooth" : "auto",
      });
    }

    if (!motion) {
      lineT = 1;
      boxT = 1;
      fillIn();
      stampVerdict(false);
      await map!.fit(answerBox(), { animate: false });
      return;
    }

    // The numbers start straight away, so nothing sits at zero. The distance
    // reaches its value as the line reaches the place, and the total as the
    // boundary closes.
    revealing = true;
    const kmEl = resultSlot!.querySelector<HTMLElement>("[data-daylist-km]");
    if (kmEl) {
      kmEl.dataset.value = "0";
      rollTo(kmEl, kmShown, { ms: CAMERA_MS + lineMs });
    }
    const scoreEl = resultSlot!.querySelector<HTMLElement>(
      "[data-daylist-score]",
    );
    if (scoreEl) {
      scoreEl.dataset.value = "0";
      rollTo(scoreEl, score, { ms: CAMERA_MS + lineMs + BOX_MS });
    }

    lineT = 0;
    boxT = 0;
    map!.redraw();
    syncMapControls(map!);
    await map!.fit(answerBox(), { animate: true, ms: CAMERA_MS });
    if (mine !== generation) return;

    playReveal(lineMs, mine, () => {
      revealing = false;
      fillIn();
      stampVerdict(true);
      map!.redraw();
      syncMapControls(map!);
    });
  }

  lockBtn.addEventListener("click", () => {
    if (done || !pin || month === null) return;
    void finish(true);
  });

  /* ------------------------------------------------------------ rounds */

  function syncMeta(): void {
    if (!metaEl) return;
    if (mode === "daily") {
      metaEl.textContent = DATE_LONG.format(new Date());
      return;
    }
    const at = Math.max(1, extra.played.indexOf(round.placeId) + 1);
    metaEl.textContent = `List ${at} of ${EXTRA_PER_DAY} today`;
  }

  /** Put a round on the board, as far along as `progress` says. */
  function loadRound(next: Round, progress: Progress | null): void {
    generation++;
    revealing = false;
    verdictStamp?.remove();
    verdictStamp = null;
    round = next;
    lines = clamp(progress?.lines ?? 1, 1, next.clues.length);
    shown = lines;
    pin =
      progress && isNum(progress.lat) && isNum(progress.lon)
        ? { lat: progress.lat, lon: progress.lon }
        : null;
    month = progress && isNum(progress.month) ? progress.month : null;
    done = false;
    lineT = 1;
    boxT = 1;

    surface!.classList.remove("is-done");
    surface!.classList.toggle("is-placed", Boolean(pin));
    surface!.setAttribute("aria-label", MAP_LABEL);
    monthInputs.forEach((input) => {
      input.checked = month !== null && Number(input.value) === month;
    });
    guessPanel!.hidden = false;
    resultSlot!.hidden = true;
    resultSlot!.innerHTML = "";
    if (rollSlot) rollSlot.innerHTML = "";
    // Left open, the footnote would show the next round's names as they come.
    if (credits) credits.open = false;
    if (announce) announce.textContent = "";
    // A new round's ceiling is set, not counted down from the last one's.
    if (worthEl) delete worthEl.dataset.value;
    for (let i = 0; i < slots.length; i++) paintSlot(i);
    paintCredits();
    describeGuess();
    syncLock();
    syncWorth();
    syncMeta();
    void map!.reset(false);

    if (progress?.done && pin && month !== null) void finish(false);
    else preloadNext();
  }

  /** Deal the next extra list, if today's ten aren't used up. */
  function startExtra(scroll: boolean): void {
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
    const next = extraPool.find((r) => r.placeId === id);
    if (!next) return;
    loadRound(next, extra.current);
    if (scroll) {
      board?.scrollIntoView({
        block: "start",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
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
    if (titleEl) {
      titleEl.textContent = next === "daily" ? "Today's list" : "More lists";
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
    if (playArea) playArea.inert = busy;
    board?.classList.toggle("is-loading", busy);
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
      startExtra(false);
    } else {
      // Ten played but none to show, which only a cleared or edited store
      // can cause. Today's list is still there to play.
      await setMode("daily", false);
      if (metaEl) metaEl.textContent = "That's all ten more lists for today";
      return;
    }
    if (fromUser) {
      board?.scrollIntoView({
        block: "start",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
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

  void setMode(location.hash === "#more-lists" ? "extra" : "daily", false);
}
