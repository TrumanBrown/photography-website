/**
 * Day list - a daily puzzle that asks you to read a community rather than a
 * single organism.
 *
 * Six species were all recorded at one real place in one month. They arrive one
 * at a time, most widely recorded first, so the opening line could be almost
 * anywhere and the last one is nearly the answer. You pin the place on a world
 * map and choose the month; reading fewer lines scores more.
 *
 * Puzzle data is built at release time by scripts/build-day-list.mjs. Photos
 * come from the iNaturalist CDNs already allow-listed in the site's CSP, so the
 * island makes no runtime API calls.
 *
 * Mounted by src/components/hobbies/DayList.astro via [data-daylist] hooks.
 */
import { LAND } from "../geo";
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
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MONTHS_FULL = [
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

/** Reading further makes the answer easier, so it is worth less. */
const CLUE_MULTIPLIER = [1, 0.88, 0.76, 0.65, 0.55, 0.46];
const MAX_PLACE_POINTS = 5000;
const MAX_MONTH_POINTS = 1000;

const STORE_KEY = "day-list-v2";

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

/**
 * Distance from a guess to the place itself, not to its centre. Madagascar is
 * 1,500 km long: a pin on its north coast is a correct answer, and scoring it
 * against a centroid would call that a 700 km miss.
 */
function distanceToPlace(
  pin: { lat: number; lon: number },
  bbox: Round["bbox"],
): number {
  const lat = Math.max(bbox.s, Math.min(bbox.n, pin.lat));
  const lon = Math.max(bbox.w, Math.min(bbox.e, pin.lon));
  if (lat === pin.lat && lon === pin.lon) return 0; // inside the boundary
  return haversineKm(pin, { lat, lon });
}

function centreOf(bbox: Round["bbox"]): { lat: number; lon: number } {
  return { lat: (bbox.s + bbox.n) / 2, lon: (bbox.w + bbox.e) / 2 };
}

function monthsApart(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
}

/** How much a line narrows the world, as a 0-100 bar. Rarer means longer. */
function narrowing(globalCount: number): number {
  const t = 1 - Math.log10(Math.max(globalCount, 1)) / Math.log10(1_000_000);
  return Math.max(
    5,
    Math.min(100, Math.round(Math.pow(Math.max(t, 0), 0.75) * 100)),
  );
}

/** Deliberately about recording effort, never about range. */
function howOften(globalCount: number): string {
  if (globalCount > 200_000) return "logged just about everywhere";
  if (globalCount > 60_000) return "logged very widely";
  if (globalCount > 18_000) return "logged widely";
  if (globalCount > 5_000) return "mostly one region";
  if (globalCount > 1_200) return "not logged often";
  return "hardly ever logged";
}

const STANDING_LABEL: Record<Clue["standing"], string> = {
  native: "Native",
  introduced: "Introduced",
  endemic: "Found nowhere else",
};

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
  const clueList = root.querySelector<HTMLElement>("[data-daylist-clues]");
  const moreBtn = root.querySelector<HTMLButtonElement>("[data-daylist-more]");
  const lockBtn = root.querySelector<HTMLButtonElement>("[data-daylist-lock]");
  const monthWrap = root.querySelector<HTMLElement>("[data-daylist-months]");
  const readout = root.querySelector<HTMLElement>("[data-daylist-readout]");
  const counter = root.querySelector<HTMLElement>("[data-daylist-counter]");
  const resultSlot = root.querySelector<HTMLElement>("[data-daylist-result]");
  if (!canvas || !mapWrap || !clueList || !moreBtn || !lockBtn || !monthWrap)
    return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const day = todayNumber();
  const round = ROUNDS[day % ROUNDS.length];
  const restored = load(day);

  let lines = restored ? restored.lines : 1;
  let pin: { lat: number; lon: number } | null = restored
    ? { lat: restored.lat, lon: restored.lon }
    : null;
  let month: number | null = restored ? restored.month : null;
  let done = Boolean(restored);

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
    const dim = cssVar("--globe-dim", "#a9a397");
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

    if (done) {
      // Show the real boundary, not just a dot, so the scoring is legible.
      const tl = project(round.bbox.w, round.bbox.n);
      const br = project(round.bbox.e, round.bbox.s);
      const boxW = Math.max(6, br.x - tl.x);
      const boxH = Math.max(6, br.y - tl.y);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(tl.x - 1, tl.y - 1, boxW + 2, boxH + 2);

      const centre = centreOf(round.bbox);
      const target = project(centre.lon, centre.lat);
      if (pin) {
        const from = project(pin.lon, pin.lat);
        ctx.strokeStyle = dim;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.font =
        '500 11px "Libre Franklin", ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = ink;
      const right = target.x > width * 0.72;
      ctx.textAlign = right ? "right" : "left";
      ctx.fillText(
        round.name,
        (right ? tl.x : br.x) + (right ? -6 : 6),
        tl.y - 6,
      );
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

  /* -------------------------------------------------------------- clues */

  function renderClues(): void {
    const visible = done ? round.clues.length : lines;
    clueList!.innerHTML = round.clues
      .map((clue, i) => {
        if (i >= visible) {
          return `<li class="dl-clue dl-clue--hidden"><span class="dl-clue__num">${
            i + 1
          }</span><span class="dl-clue__wait">Still folded over</span></li>`;
        }
        // iNaturalist capitalises animal names but not plant ones, which is the
        // convention in the field. Lift the first letter so rows look even.
        const name = clue.name.charAt(0).toUpperCase() + clue.name.slice(1);
        // CC BY and CC BY-NC both require the photographer to be credited.
        const credit = `${escapeHtml(clue.by)} &middot; ${escapeHtml(clue.licence)}`;
        return `<li class="dl-clue">
          <span class="dl-clue__num">${i + 1}</span>
          <img class="dl-clue__photo" src="${escapeHtml(clue.photo)}" alt="${escapeHtml(
            name,
          )}" loading="lazy" decoding="async" width="72" height="72">
          <span class="dl-clue__body">
            <span class="dl-clue__name">${escapeHtml(name)}</span>
            <span class="dl-clue__sci">${escapeHtml(clue.sci)}</span>
            <span class="dl-clue__bar"><i style="width:${narrowing(clue.global)}%"></i></span>
            <span class="dl-clue__meta">${clue.global.toLocaleString()} worldwide &middot; ${howOften(
              clue.global,
            )}</span>
            <span class="dl-clue__credit">Photo ${credit}</span>
          </span>
        </li>`;
      })
      .join("");

    if (counter) {
      counter.textContent = done
        ? "That is all six"
        : `${lines} of ${round.clues.length}`;
    }
    moreBtn!.disabled = done || lines >= round.clues.length;
    moreBtn!.textContent =
      lines >= round.clues.length ? "That is the lot" : "Show me the next one";
  }

  /* ------------------------------------------------------------ guessing */

  function describeGuess(): void {
    if (!readout) return;
    if (!pin && month === null) {
      readout.textContent = "Drop a pin, then pick a month.";
      return;
    }
    const parts: string[] = [];
    if (pin) {
      parts.push(
        `${Math.abs(pin.lat).toFixed(1)}\u00b0${pin.lat >= 0 ? "N" : "S"}, ` +
          `${Math.abs(pin.lon).toFixed(1)}\u00b0${pin.lon >= 0 ? "E" : "W"}`,
      );
    } else {
      parts.push("No pin yet");
    }
    parts.push(month === null ? "no month yet" : MONTHS_FULL[month]);
    readout.textContent = parts.join(" \u00b7 ");
  }

  function syncLock(): void {
    lockBtn!.disabled = done || !pin || month === null;
  }

  function place(event: { clientX: number; clientY: number }): void {
    if (done) return;
    const rect = canvas!.getBoundingClientRect();
    pin = unproject(event.clientX - rect.left, event.clientY - rect.top);
    mapWrap!.classList.add("is-placed");
    describeGuess();
    syncLock();
    drawMap();
  }

  mapWrap.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    place(event);
  });

  // Keyboard guessing: arrows nudge a pin that starts in the middle.
  mapWrap.addEventListener("keydown", (event) => {
    if (done) return;
    const step = event.shiftKey ? 15 : 4;
    if (!pin) {
      if (event.key.startsWith("Arrow") || event.key === "Enter") {
        pin = { lat: 20, lon: 0 };
        mapWrap.classList.add("is-placed");
        event.preventDefault();
      }
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

  moreBtn.addEventListener("click", () => {
    if (done || lines >= round.clues.length) return;
    lines += 1;
    renderClues();
  });

  /* -------------------------------------------------------------- result */

  function shareGrid(km: number, off: number): string {
    let read = "";
    for (let i = 0; i < round.clues.length; i++) {
      read += i < lines ? "\u{1F4D6}" : "\u2B1C";
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
    return `${read}\n${distance}${season}`;
  }

  function finish(): void {
    if (!pin || month === null) return;
    done = true;
    save({ day, lines, lat: pin.lat, lon: pin.lon, month });

    const km = distanceToPlace(pin, round.bbox);
    const multiplier = CLUE_MULTIPLIER[Math.min(lines, 6) - 1];
    const placePoints = Math.round(
      MAX_PLACE_POINTS * Math.exp(-km / 1800) * multiplier,
    );
    const off = monthsApart(month, round.month - 1);
    const monthPoints = Math.max(
      0,
      Math.round(MAX_MONTH_POINTS * (1 - off / 6)),
    );
    const total = placePoints + monthPoints;

    const verdict =
      km === 0
        ? "You were standing in it"
        : km < 400
          ? "Near enough"
          : km < 1500
            ? "Right part of the world"
            : km < 5000
              ? "Not quite"
              : "Wrong side of the planet";

    renderClues();
    drawMap();
    syncLock();
    moreBtn!.disabled = true;

    if (!resultSlot) return;

    const roll = round.clues
      .map((clue) => {
        const name = clue.name.charAt(0).toUpperCase() + clue.name.slice(1);
        const standing =
          clue.standing === "native"
            ? ""
            : `<span class="dl-tag dl-tag--${clue.standing}">${STANDING_LABEL[clue.standing]}</span>`;
        const rank = clue.rank
          ? `<span class="dl-tag dl-tag--rank">${escapeHtml(clue.rank)}</span>`
          : "";
        const fact = clue.fact
          ? `<p class="dl-roll__fact">${escapeHtml(clue.fact)}</p>`
          : "";
        const link = clue.wiki
          ? `<a class="dl-roll__link" href="${escapeHtml(
              clue.wiki,
            )}" target="_blank" rel="noopener noreferrer">Wikipedia</a>`
          : "";
        const inat = `<a class="dl-roll__link" href="https://www.inaturalist.org/taxa/${
          clue.id
        }" target="_blank" rel="noopener noreferrer">iNaturalist</a>`;
        return `<li class="dl-roll">
          <img class="dl-roll__photo" src="${escapeHtml(clue.photo)}" alt="" loading="lazy" width="96" height="96">
          <div class="dl-roll__body">
            <p class="dl-roll__name">${escapeHtml(name)} ${standing} ${rank}</p>
            <p class="dl-roll__sci">${escapeHtml(clue.sci)}</p>
            ${fact}
            <p class="dl-roll__meta">
              Seen here ${clue.local.toLocaleString()} times that month &middot;
              ${clue.global.toLocaleString()} worldwide${link ? ` &middot; ${link}` : ""} &middot; ${inat}
            </p>
            <p class="dl-roll__credit">Photo ${escapeHtml(clue.by)} &middot; ${escapeHtml(
              clue.licence,
            )}</p>
          </div>
        </li>`;
      })
      .join("");

    resultSlot.innerHTML = `
      <div class="dl-result">
        <div class="dl-result__head">
          <div>
            <p class="u-label">${verdict}</p>
            <p class="dl-result__place">${escapeHtml(round.name)}</p>
            <p class="dl-result__region">${escapeHtml(round.region)} &middot; ${
              MONTHS_FULL[round.month - 1]
            }</p>
          </div>
          <div class="dl-result__score">
            <p class="u-label">Score</p>
            <p class="dl-result__total">${total.toLocaleString()}</p>
          </div>
        </div>
        <dl class="dl-breakdown">
          <div><dt>Off by</dt><dd>${
            km === 0 ? "nothing" : `${Math.round(km).toLocaleString()} km`
          }</dd></div>
          <div><dt>Species used</dt><dd>${Math.min(lines, 6)} of 6 &middot; &times;${multiplier.toFixed(
            2,
          )}</dd></div>
          <div><dt>Month</dt><dd>${
            off === 0 ? "exact" : `${off} ${off === 1 ? "month" : "months"} out`
          } &middot; ${monthPoints}</dd></div>
        </dl>
        <pre class="dl-share">${shareGrid(km, off)}</pre>
        <div class="dl-actions">
          <button type="button" class="dl-btn" data-daylist-copy>Copy result</button>
          <a class="dl-btn" href="https://www.inaturalist.org/places/${
            round.placeId
          }" target="_blank" rel="noopener noreferrer">See the place</a>
          <span class="dl-next">A new list turns up tomorrow</span>
        </div>
        <div class="dl-rollwrap">
          <p class="u-label dl-rollwrap__label">The full list</p>
          <ul class="dl-rolls">${roll}</ul>
        </div>
        <p class="dl-result__note dl-result__note--quiet">
          Working out a place from what lives there is a real skill. Ecologists call these
          indicator species, and it is how you read a habitat before you have measured anything
        </p>
      </div>`;

    const copy = resultSlot.querySelector<HTMLButtonElement>(
      "[data-daylist-copy]",
    );
    copy?.addEventListener("click", () => {
      const text = `Day list\n${shareGrid(km, off)}\n${
        km === 0
          ? "inside the boundary"
          : `${Math.round(km).toLocaleString()} km off`
      } \u00b7 ${Math.min(lines, 6)}/6 species \u00b7 ${total.toLocaleString()}`;
      navigator.clipboard?.writeText(text).catch(() => {});
      copy.textContent = "Copied";
      window.setTimeout(() => {
        copy.textContent = "Copy result";
      }, 1800);
    });
  }

  lockBtn.addEventListener("click", finish);

  /* ---------------------------------------------------------------- boot */

  monthWrap.innerHTML = MONTHS.map(
    (label, i) =>
      `<button type="button" class="dl-month" data-month="${i}" aria-pressed="false">
        <span aria-hidden="true">${label}</span>
        <span class="dl-sr">${MONTHS_FULL[i]}</span>
      </button>`,
  ).join("");

  monthWrap
    .querySelectorAll<HTMLButtonElement>("[data-month]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        if (done) return;
        month = Number(button.dataset.month);
        monthWrap
          .querySelectorAll<HTMLButtonElement>("[data-month]")
          .forEach((other) => {
            other.setAttribute("aria-pressed", String(other === button));
          });
        describeGuess();
        syncLock();
      });
    });

  if (month !== null) {
    monthWrap
      .querySelector<HTMLButtonElement>(`[data-month="${month}"]`)
      ?.setAttribute("aria-pressed", "true");
  }
  if (pin) mapWrap.classList.add("is-placed");

  renderClues();
  describeGuess();
  syncLock();

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

  if (restored) finish();
}
