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
 * Puzzle data is built at release time by scripts/build-day-list.mjs. Photos
 * come from the iNaturalist CDNs already allow-listed in the site's CSP, so the
 * island makes no runtime API calls.
 *
 * Mounted by src/components/hobbies/DayList.astro via [data-daylist] hooks.
 */
import { LAND } from "../geo";
import { prefersReducedMotion, rollTo } from "../motion";
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
  /** Standing at this place, from iNaturalist's establishment means. */
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

interface Round {
  placeId: number;
  name: string;
  region: string;
  official: string;
  month: number;
  /** Published place boundary. A pin inside it is exactly right. */
  bbox: { w: number; e: number; s: number; n: number };
  clues: Clue[];
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

const STORE_KEY = "day-list-v2";

/**
 * After "Lock it in" the answer lands in one beat: the line runs from the pin
 * to the place while the distance counts up beside it, then the boundary
 * strokes in, then the species still hidden fill in one after another.
 */
const LINE_MS = 600;
const BOX_MS = 300;
const FILL_STAGGER_MS = 70;

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

interface Saved {
  day: number;
  lines: number;
  lat: number;
  lon: number;
  month: number;
}

function todayNumber(): number {
  const now = new Date();
  return Math.floor(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000,
  );
}

function load(day: number): Saved | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    return saved && saved.day === day ? saved : null;
  } catch {
    return null;
  }
}

function save(state: Saved): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* private browsing; the puzzle still plays, it just will not persist */
  }
}

function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
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
function nearestPoint(
  pin: { lat: number; lon: number },
  bbox: Round["bbox"],
): { lat: number; lon: number } {
  return {
    lat: Math.max(bbox.s, Math.min(bbox.n, pin.lat)),
    lon: Math.max(bbox.w, Math.min(bbox.e, pin.lon)),
  };
}

/**
 * Distance from a guess to the place itself, not to its centre. Madagascar is
 * 1,500 km long: a pin on its north coast is a correct answer, and scoring it
 * against a centroid would call that a 700 km miss.
 */
function distanceToPlace(
  pin: { lat: number; lon: number },
  bbox: Round["bbox"],
): number {
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

function formatPin(pin: { lat: number; lon: number }): string {
  return (
    `${Math.abs(pin.lat).toFixed(1)}\u00b0${pin.lat >= 0 ? "N" : "S"}, ` +
    `${Math.abs(pin.lon).toFixed(1)}\u00b0${pin.lon >= 0 ? "E" : "W"}`
  );
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
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

export function initDayList(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-daylist-map]");
  const mapWrap = root.querySelector<HTMLElement>("[data-daylist-mapwrap]");
  const tray = root.querySelector<HTMLElement>("[data-daylist-clues]");
  const lockBtn = root.querySelector<HTMLButtonElement>("[data-daylist-lock]");
  const guessPanel = root.querySelector<HTMLElement>("[data-daylist-guess]");
  const resultSlot = root.querySelector<HTMLElement>("[data-daylist-result]");
  const monthInputs = Array.from(
    root.querySelectorAll<HTMLInputElement>("[data-daylist-month]"),
  );
  if (
    !canvas ||
    !mapWrap ||
    !tray ||
    !lockBtn ||
    !guessPanel ||
    !resultSlot ||
    monthInputs.length !== MONTHS.length
  )
    return;

  const readout = root.querySelector<HTMLElement>("[data-daylist-readout]");
  const worthEl = root.querySelector<HTMLElement>("[data-daylist-worth]");
  const announce = root.querySelector<HTMLElement>("[data-daylist-announce]");
  const rollSlot = root.querySelector<HTMLElement>("[data-daylist-roll]");
  const dateEl = root.querySelector<HTMLElement>("[data-daylist-date]");

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const day = todayNumber();
  const round = ROUNDS[day % ROUNDS.length];
  const total = round.clues.length;
  const restored = load(day);

  let lines = restored ? Math.min(Math.max(restored.lines, 1), total) : 1;
  let pin: { lat: number; lon: number } | null = restored
    ? { lat: restored.lat, lon: restored.lon }
    : null;
  let month: number | null = restored ? restored.month : null;
  let done = Boolean(restored);
  // Slots showing a species. It matches `lines` except while the answer is
  // landing, when the species still hidden wait for the boundary.
  let shown = lines;

  // How much of the answer the map shows, 0 to 1: the line from the pin, then
  // the boundary. Both stay at 1 unless the reveal is playing.
  let lineT = 1;
  let boxT = 1;

  let width = 0;
  let height = 0;

  /* ---------------------------------------------------------------- map */

  const project = (lon: number, lat: number) => ({
    x: ((lon + 180) / 360) * width,
    y: ((90 - lat) / 180) * height,
  });
  const unproject = (x: number, y: number) => ({
    lon: (x / width) * 360 - 180,
    lat: 90 - (y / height) * 180,
  });

  function drawMap(): void {
    if (!ctx || !width || !height) return;
    const ink = cssVar("--ink", "#16150f");
    const trail = cssVar("--ink-2", "#706c63");
    const grid = cssVar("--globe-grid", "#eeebe3");
    // Ocean sits a step darker than paper so coastlines read at this size.
    const ocean = cssVar("--stack-1", "#d8d2c4");
    const landFill = cssVar("--paper", "#fbfaf8");
    const coast = cssVar("--globe-coast", "#bab4a6");

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    for (let lat = -60; lat <= 60; lat += 30) {
      const { y } = project(0, lat);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    for (let lon = -120; lon <= 120; lon += 60) {
      const { x } = project(lon, 0);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = landFill;
    ctx.strokeStyle = coast;
    ctx.lineWidth = 0.8;
    for (const ring of LAND) {
      ctx.beginPath();
      ring.forEach(([lon, lat], i) => {
        const p = project(lon, lat);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    const tl = project(round.bbox.w, round.bbox.n);
    const br = project(round.bbox.e, round.bbox.s);
    const boxW = Math.max(6, br.x - tl.x) + 2;
    const boxH = Math.max(6, br.y - tl.y) + 2;

    // The line runs to the nearest edge of the place, the point the distance
    // is measured to, and leaves from the rim of the pin rather than its
    // middle. It goes the short way round, like the distance: a pin in
    // Hawaii reaches Japan off one side of the map and back in the other.
    if (done && pin && lineT > 0) {
      const edge = nearestPoint(pin, round.bbox);
      let toLon = edge.lon;
      if (toLon - pin.lon > 180) toLon -= 360;
      else if (pin.lon - toLon > 180) toLon += 360;
      const from = project(pin.lon, pin.lat);
      const to = project(toLon, edge.lat);
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (length > 8) {
        const ux = (to.x - from.x) / length;
        const uy = (to.y - from.y) / length;
        const reach = 7 + (length - 7) * lineT;
        const ax = from.x + ux * 7;
        const bx = from.x + ux * reach;
        const shifts = [0];
        if (Math.min(ax, bx) < 0) shifts.push(width);
        if (Math.max(ax, bx) > width) shifts.push(-width);
        ctx.strokeStyle = trail;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (const shift of shifts) {
          ctx.moveTo(ax + shift, from.y + uy * 7);
          ctx.lineTo(bx + shift, from.y + uy * reach);
        }
        ctx.stroke();
        ctx.setLineDash([]);
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
      const p = project(pin.lon, pin.lat);
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

    // The name goes above the box, to its right, unless that runs off the
    // map. A rim in the land colour keeps it readable over coastlines.
    if (done && boxT >= 1) {
      ctx.font =
        '500 11px "Libre Franklin", ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = "left";
      const textW = ctx.measureText(round.name).width;
      let x = tl.x - 1 + boxW + 5;
      if (x + textW > width - 4) x = tl.x - 6 - textW;
      x = Math.max(4, Math.min(width - 4 - textW, x));
      const y = Math.max(13, tl.y - 6);
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = landFill;
      ctx.strokeText(round.name, x, y);
      ctx.fillStyle = ink;
      ctx.fillText(round.name, x, y);
    }
  }

  function resize(): void {
    const rect = canvas!.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas!.width = Math.round(width * dpr);
    canvas!.height = Math.round(height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap();
  }

  /* -------------------------------------------------------- the species */

  tray.textContent = "";
  const slots = round.clues.map(() => {
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
      li.className = fresh ? "dl-slot is-new" : "dl-slot";
      li.innerHTML = `<figure class="dl-slot__fig">
          <div class="dl-slot__pic"><img src="${escapeHtml(
            clue.photo,
          )}" alt="" width="500" height="500" decoding="async"></div>
          <figcaption class="dl-slot__body">
            <span class="dl-slot__name">${escapeHtml(displayName(clue.name))}</span>
            <span class="dl-slot__sci">${escapeHtml(clue.sci)}</span>
            <span class="dl-slot__count">${count(clue.global)} sightings worldwide</span>
            <span class="dl-slot__credit">&copy; ${escapeHtml(clue.by)} &middot; <span class="dl-nowrap">${escapeHtml(
              clue.licence,
            )}</span></span>
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

  /** Fetch the next photo while the visitor thinks, so the reveal is instant. */
  function preloadNext(): void {
    const next = round.clues[lines];
    if (!next || done) return;
    const fetchPhoto = () => {
      const image = new Image();
      image.decoding = "async";
      image.src = next.photo;
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(fetchPhoto, { timeout: 2000 });
    } else {
      setTimeout(fetchPhoto, 300);
    }
  }

  function reveal(fromKeyboard: boolean): void {
    if (done || lines >= total) return;
    lines += 1;
    shown = lines;
    paintSlot(lines - 1, true);
    if (lines < total) paintSlot(lines);
    syncWorth();
    preloadNext();

    const clue = round.clues[lines - 1];
    if (announce) {
      announce.textContent =
        `Species ${lines} of ${total}: ${displayName(clue.name)}, ` +
        `${count(clue.global)} sightings worldwide. ` +
        `Up to ${count(bestPossible(lines))} points now.`;
    }
    // The button that was pressed has been replaced, so keyboard focus
    // follows to the next one (or the map once all six are out).
    if (fromKeyboard) {
      const next = tray!.querySelector<HTMLElement>("[data-daylist-more]");
      (next ?? mapWrap!).focus();
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

  // Click rather than pointerdown: on a phone, a drag that starts on the map
  // is a scroll, and only a tap should drop the pin.
  mapWrap.addEventListener("click", (event) => {
    if (done) return;
    const rect = canvas.getBoundingClientRect();
    pin = unproject(event.clientX - rect.left, event.clientY - rect.top);
    mapWrap.classList.add("is-placed");
    describeGuess();
    syncLock();
    drawMap();
  });

  // Keyboard guessing: arrows nudge a pin that starts in the middle.
  mapWrap.addEventListener("keydown", (event) => {
    if (done) return;
    const step = event.shiftKey ? 15 : 4;
    if (!pin) {
      // Only an arrow or Enter drops the first pin. Anything else, Tab
      // included, has to pass through or keyboard users get stuck here.
      if (!event.key.startsWith("Arrow") && event.key !== "Enter") return;
      pin = { lat: 20, lon: 0 };
      mapWrap.classList.add("is-placed");
    } else if (event.key === "ArrowUp") pin.lat = Math.min(85, pin.lat + step);
    else if (event.key === "ArrowDown") pin.lat = Math.max(-85, pin.lat - step);
    else if (event.key === "ArrowLeft")
      pin.lon = Math.max(-180, pin.lon - step);
    else if (event.key === "ArrowRight")
      pin.lon = Math.min(180, pin.lon + step);
    else return;
    event.preventDefault();
    describeGuess();
    syncLock();
    drawMap();
  });

  monthInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (done || !input.checked) return;
      month = Number(input.value);
      describeGuess();
      syncLock();
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
    for (let i = 0; i < total; i++) {
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
      `Day list, ${DATE_SHORT.format(new Date())}\n${read}\n${distance}${season}\n` +
      `${where} \u00b7 ${used}/${total} species \u00b7 ${count(score)}`
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
  function playReveal(lineMs: number, landed: () => void): void {
    lineT = 0;
    boxT = 0;
    const start = performance.now();
    const clamp = (k: number) => Math.min(1, Math.max(0, k));
    const easeOut = (k: number) => 1 - Math.pow(1 - clamp(k), 3);
    const step = (now: number) => {
      const elapsed = now - start;
      lineT = lineMs > 0 ? easeOut(elapsed / lineMs) : 1;
      boxT = easeOut((elapsed - lineMs) / BOX_MS);
      drawMap();
      if (elapsed < lineMs + BOX_MS) requestAnimationFrame(step);
      else landed();
    };
    requestAnimationFrame(step);
  }

  /**
   * Score the guess and swap the guess panel for a receipt. `animate` is
   * false when a finished day is restored on load, so nothing replays.
   */
  function finish(animate: boolean): void {
    if (!pin || month === null) return;
    done = true;
    const motion = animate && !prefersReducedMotion();

    const km = distanceToPlace(pin, round.bbox);
    const used = Math.min(lines, total);
    const multiplier = CLUE_MULTIPLIER[used - 1];
    const placePoints = Math.round(
      MAX_PLACE_POINTS * Math.exp(-km / 1800) * multiplier,
    );
    const off = monthsApart(month, round.month - 1);
    const monthPoints = Math.max(
      0,
      Math.round(MAX_MONTH_POINTS * (1 - off / 6)),
    );
    const score = placePoints + monthPoints;

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
    const monthWhy =
      off === 0
        ? "Right month"
        : `You picked ${MONTHS[month]}, ${off} ${off === 1 ? "month" : "months"} out`;

    // The species still hidden stay numbered squares until the boundary is
    // down, then fill in. Their photos start loading now.
    for (let i = shown; i < total; i++) paintSlot(i);
    const fillIn = () => {
      const from = shown;
      shown = total;
      for (let i = from; i < total; i++) {
        paintSlot(i, animate, (i - from) * FILL_STAGGER_MS);
      }
    };
    if (motion) {
      for (const clue of round.clues.slice(used)) {
        const image = new Image();
        image.decoding = "async";
        image.src = clue.photo;
      }
    }

    mapWrap!.classList.add("is-done");
    mapWrap!.setAttribute(
      "aria-label",
      `World map showing your pin and ${round.name}.`,
    );
    syncLock();

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
          <dd class="dl-receipt__why">${distance}, with ${used} of ${total} species showing</dd>
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
        <button type="button" class="btn" data-daylist-copy>Copy result</button>
        <a class="btn" href="https://www.inaturalist.org/places/${
          round.placeId
        }" target="_blank" rel="noopener noreferrer">See the place</a>
      </div>
      <p class="dl-next">A new list turns up tomorrow</p>`;

    // The distance counts up as the line runs out to the place, and the total
    // lands with the boundary.
    if (motion) {
      const kmEl = resultSlot!.querySelector<HTMLElement>("[data-daylist-km]");
      if (kmEl) {
        kmEl.dataset.value = "0";
        rollTo(kmEl, kmShown, { ms: lineMs });
      }
      const scoreEl = resultSlot!.querySelector<HTMLElement>(
        "[data-daylist-score]",
      );
      if (scoreEl) {
        scoreEl.dataset.value = "0";
        rollTo(scoreEl, score, { ms: lineMs + BOX_MS });
      }
    }

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

    renderFullList();

    if (animate) {
      // Screen readers hear the place first. The map is kept in view so the
      // line can be watched; on a phone the result sits right under it.
      resultSlot!
        .querySelector<HTMLElement>("[data-daylist-place]")
        ?.focus({ preventScroll: true });
      mapWrap!.scrollIntoView({
        block: "nearest",
        behavior: motion ? "smooth" : "auto",
      });
    }

    if (motion) {
      playReveal(lineMs, fillIn);
    } else {
      lineT = 1;
      boxT = 1;
      fillIn();
      drawMap();
    }
  }

  lockBtn.addEventListener("click", () => {
    if (done || !pin || month === null) return;
    save({ day, lines, lat: pin.lat, lon: pin.lon, month });
    finish(true);
  });

  /* ---------------------------------------------------------------- boot */

  if (dateEl) dateEl.textContent = DATE_LONG.format(new Date());

  // Browsers can restore a radio's checked state on reload; the engine's
  // state is the one that counts.
  monthInputs.forEach((input) => {
    input.checked = month !== null && Number(input.value) === month;
  });
  if (pin) mapWrap.classList.add("is-placed");

  for (let i = 0; i < total; i++) paintSlot(i);
  describeGuess();
  syncLock();
  syncWorth();

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(mapWrap);
  } else {
    window.addEventListener("resize", resize);
  }
  resize();

  // Re-draw on theme change so the map follows the palette.
  new MutationObserver(drawMap).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  if (restored) finish(false);
  else preloadNext();
}
