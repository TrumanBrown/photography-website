#!/usr/bin/env node
/**
 * Builds the puzzle data for the Day list island.
 *
 *   npm run build:day-list
 *
 * The game asks you to read a *community* rather than a single organism: six
 * species that were all recorded at one real place in one month, revealed from
 * the most widely recorded in the world to the most local, so each line narrows
 * the map further.
 *
 * Accuracy rules, because this is aimed at people who know the species:
 *
 *  - Locations are real iNaturalist places with published boundaries, not
 *    arbitrary circles. The answer names the place and links to it.
 *  - Every clue is a research-grade record from that place in that month.
 *  - Each species is labelled native / introduced / endemic *for that place*,
 *    taken from iNaturalist's own establishment means. This matters: a
 *    Buff-tailed Bumble Bee in Tasmania is introduced, and presenting it as a
 *    native indicator would be wrong. iNaturalist flags each record against
 *    every place that contains it, and a stray listing somewhere (a user-made
 *    place that calls Mallards introduced) shouldn't outvote the rest. So the
 *    label goes with the majority of the place's own flagged records.
 *  - Facts come from the taxon's Wikipedia summary and ship with the article
 *    link so a player can check them.
 *  - Photos are openly licensed only, and the licence and photographer travel
 *    with the photo so the UI can credit them. CC BY and CC BY-NC both require
 *    attribution.
 *  - Clue ordering uses worldwide iNaturalist observation counts. That is a
 *    measure of how often a species is *recorded*, not how widespread it is,
 *    and the UI says so rather than implying range.
 *
 * Two sets come out of this. PLACES is the daily rotation, one list a day for
 * everyone. EXTRA_PLACES feeds "More lists", up to ten a day per player. They
 * never share a place, so playing extras can't spoil a future daily list.
 *
 *   npm run build:day-list                      daily set -> day-list.json
 *   npm run build:day-list -- --extra           extras -> day-list-extra.json
 *   npm run build:day-list -- --retag [--extra] refresh the native/introduced
 *                                               labels only, same species
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTRA = process.argv.includes("--extra");
const RETAG = process.argv.includes("--retag");
const OUT = join(
  root,
  EXTRA
    ? "src/lib/hobbies/day-list-extra.json"
    : "src/lib/hobbies/day-list.json",
);

const UA = {
  "User-Agent": "trumanbrown.com day-list builder (+https://trumanbrown.com)",
  Accept: "application/json",
};

/** iNaturalist asks for no more than one request a second. */
const THROTTLE = 1150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Photo hosts allowed by the site's Content-Security-Policy. */
const PHOTO_HOSTS = [
  "https://inaturalist-open-data.s3.amazonaws.com/",
  "https://static.inaturalist.org/",
];

/** Licences that permit republication with credit. No rights-reserved photos. */
const OPEN_LICENCES = new Map([
  ["cc0", "CC0"],
  ["cc-by", "CC BY"],
  ["cc-by-sa", "CC BY-SA"],
  ["cc-by-nc", "CC BY-NC"],
  ["cc-by-nc-sa", "CC BY-NC-SA"],
  ["cc-by-nd", "CC BY-ND"],
  ["cc-by-nc-nd", "CC BY-NC-ND"],
]);

/**
 * Real iNaturalist place IDs, resolved and data-checked with
 * scripts/resolve-day-list-places.mjs. The month is chosen for when that place
 * is busiest with records, which is also when somebody would realistically have
 * been out keeping a list.
 *
 * `label` and `region` are set here rather than taken from the API because some
 * official place names are unusable in a reveal ("RB ESP 04. Reserva de la
 * Biosfera Donana. Andalucia. Espana."). The place id still anchors every
 * query, so the data stays exactly as authoritative.
 */
const PLACES = [
  // North America
  {
    id: 69094,
    month: 7,
    label: "Olympic National Park",
    region: "Washington, United States",
  },
  {
    id: 8838,
    month: 8,
    label: "Mount Rainier National Park",
    region: "Washington, United States",
  },
  {
    id: 65739,
    month: 4,
    label: "Saguaro National Park",
    region: "Arizona, United States",
  },
  {
    id: 53957,
    month: 1,
    label: "Everglades National Park",
    region: "Florida, United States",
  },
  {
    id: 10211,
    month: 6,
    label: "Yellowstone National Park",
    region: "Wyoming, United States",
  },
  {
    id: 3680,
    month: 3,
    label: "Joshua Tree National Park",
    region: "California, United States",
  },
  {
    id: 71077,
    month: 7,
    label: "Denali National Park",
    region: "Alaska, United States",
  },
  {
    id: 72645,
    month: 5,
    label: "Great Smoky Mountains",
    region: "Tennessee, United States",
  },
  {
    id: 55071,
    month: 4,
    label: "Big Bend National Park",
    region: "Texas, United States",
  },
  {
    id: 5781,
    month: 10,
    label: "Point Reyes",
    region: "California, United States",
  },
  { id: 56788, month: 6, label: "Haleakala", region: "Hawaii, United States" },
  {
    id: 90295,
    month: 6,
    label: "Algonquin Provincial Park",
    region: "Ontario, Canada",
  },
  {
    id: 66300,
    month: 7,
    label: "Banff National Park",
    region: "Alberta, Canada",
  },

  // Central and South America
  {
    id: 10110,
    month: 8,
    label: "Tortuguero National Park",
    region: "Costa Rica",
  },
  { id: 54414, month: 9, label: "Manu National Park", region: "Peru" },
  {
    id: 130690,
    month: 1,
    label: "Torres del Paine",
    region: "Patagonia, Chile",
  },
  { id: 12990, month: 2, label: "The Galapagos", region: "Ecuador" },
  { id: 9120, month: 1, label: "Tierra del Fuego", region: "Argentina" },

  // Africa
  { id: 69054, month: 2, label: "Serengeti National Park", region: "Tanzania" },
  { id: 188740, month: 8, label: "Ngorongoro", region: "Tanzania" },
  {
    id: 69020,
    month: 9,
    label: "Kruger National Park",
    region: "South Africa",
  },
  {
    id: 71668,
    month: 10,
    label: "Table Mountain",
    region: "Western Cape, South Africa",
  },
  { id: 69030, month: 6, label: "Etosha National Park", region: "Namibia" },
  { id: 131526, month: 8, label: "The Okavango Delta", region: "Botswana" },
  { id: 7783, month: 11, label: "Madagascar", region: "Indian Ocean" },

  // Europe and the Arctic
  { id: 7353, month: 7, label: "Svalbard", region: "Arctic Norway" },
  { id: 7278, month: 6, label: "Iceland", region: "North Atlantic" },
  { id: 200477, month: 4, label: "Donana", region: "Andalusia, Spain" },
  { id: 198736, month: 5, label: "The Camargue", region: "Provence, France" },
  { id: 117827, month: 5, label: "The Danube Delta", region: "Romania" },
  {
    id: 138717,
    month: 6,
    label: "Bialowieza Forest",
    region: "Poland and Belarus",
  },
  { id: 138716, month: 9, label: "The Wadden Sea", region: "North Sea coast" },
  { id: 162899, month: 7, label: "The Cairngorms", region: "Scotland" },

  // Asia
  { id: 13078, month: 6, label: "Hokkaido", region: "Japan" },
  { id: 34090, month: 5, label: "Yakushima", region: "Kagoshima, Japan" },
  { id: 186468, month: 4, label: "The Ogasawara Islands", region: "Japan" },
  { id: 150778, month: 2, label: "Sinharaja Forest", region: "Sri Lanka" },
  { id: 131079, month: 3, label: "Kinabalu Park", region: "Sabah, Borneo" },
  { id: 69564, month: 6, label: "Crocker Range", region: "Sabah, Borneo" },
  { id: 131063, month: 7, label: "Komodo National Park", region: "Indonesia" },

  // Australia and the Pacific
  {
    id: 131697,
    month: 7,
    label: "Kakadu National Park",
    region: "Northern Territory, Australia",
  },
  {
    id: 71841,
    month: 12,
    label: "Cradle Mountain",
    region: "Tasmania, Australia",
  },
  {
    id: 141083,
    month: 11,
    label: "The Great Otway",
    region: "Victoria, Australia",
  },
];

/**
 * The "More lists" pool, resolved with
 * `node scripts/resolve-day-list-places.mjs --extra`. Same rules as PLACES:
 * the month is the place's busiest for research-grade records. Places right
 * next to a daily one (Jasper beside Banff, Hawaii Volcanoes beside Haleakala)
 * are left out, because their lists would give that daily away.
 */
const EXTRA_PLACES = [
  // North America
  {
    id: 49610,
    month: 7,
    label: "Acadia National Park",
    region: "Maine, United States",
  },
  {
    id: 69216,
    month: 5,
    label: "Grand Canyon National Park",
    region: "Arizona, United States",
  },
  {
    id: 50634,
    month: 5,
    label: "Zion National Park",
    region: "Utah, United States",
  },
  {
    id: 49676,
    month: 7,
    label: "Rocky Mountain National Park",
    region: "Colorado, United States",
  },
  {
    id: 68542,
    month: 6,
    label: "Yosemite National Park",
    region: "California, United States",
  },
  {
    id: 3157,
    month: 4,
    label: "Channel Islands National Park",
    region: "California, United States",
  },
  {
    id: 4504,
    month: 3,
    label: "Death Valley National Park",
    region: "California, United States",
  },
  {
    id: 9012,
    month: 7,
    label: "Shenandoah National Park",
    region: "Virginia, United States",
  },
  {
    id: 95121,
    month: 8,
    label: "Cape Cod National Seashore",
    region: "Massachusetts, United States",
  },
  {
    id: 72841,
    month: 7,
    label: "Glacier National Park",
    region: "Montana, United States",
  },
  {
    id: 112932,
    month: 5,
    label: "Point Pelee National Park",
    region: "Ontario, Canada",
  },
  {
    id: 68850,
    month: 5,
    label: "Pacific Rim National Park",
    region: "British Columbia, Canada",
  },
  {
    id: 95245,
    month: 6,
    label: "Isle Royale",
    region: "Michigan, United States",
  },
  {
    id: 119523,
    month: 3,
    label: "The Okefenokee Swamp",
    region: "Georgia, United States",
  },
  {
    id: 119590,
    month: 11,
    label: "Santa Ana Wildlife Refuge",
    region: "Texas, United States",
  },
  {
    id: 95300,
    month: 5,
    label: "Padre Island",
    region: "Texas, United States",
  },

  // Latin America
  { id: 118509, month: 7, label: "Monteverde", region: "Costa Rica" },
  {
    id: 68640,
    month: 1,
    label: "Corcovado National Park",
    region: "Costa Rica",
  },
  { id: 54190, month: 2, label: "Sian Ka'an", region: "Quintana Roo, Mexico" },
  { id: 68655, month: 1, label: "Tikal", region: "Guatemala" },
  {
    id: 68566,
    month: 10,
    label: "Iguazú National Park",
    region: "Misiones, Argentina",
  },
  {
    id: 126436,
    month: 2,
    label: "Tijuca National Park",
    region: "Rio de Janeiro, Brazil",
  },
  {
    id: 233255,
    month: 10,
    label: "Itatiaia National Park",
    region: "Rio de Janeiro, Brazil",
  },
  { id: 68650, month: 3, label: "Yasuní National Park", region: "Ecuador" },
  { id: 64055, month: 8, label: "The Pantanal", region: "Brazil" },
  {
    id: 131713,
    month: 11,
    label: "Península Valdés",
    region: "Patagonia, Argentina",
  },

  // Europe
  {
    id: 81743,
    month: 8,
    label: "The New Forest",
    region: "Hampshire, England",
  },
  {
    id: 163159,
    month: 7,
    label: "The Lake District",
    region: "Cumbria, England",
  },
  { id: 174739, month: 7, label: "Picos de Europa", region: "Spain" },
  {
    id: 108268,
    month: 3,
    label: "The western Canary Islands",
    region: "Spain",
  },
  { id: 7291, month: 4, label: "Madeira", region: "Portugal" },
  {
    id: 184355,
    month: 7,
    label: "The Swiss National Park",
    region: "Switzerland",
  },
  {
    id: 153340,
    month: 7,
    label: "Gran Paradiso",
    region: "Aosta Valley, Italy",
  },
  { id: 68877, month: 9, label: "The Bavarian Forest", region: "Germany" },
  { id: 119785, month: 5, label: "The Biebrza Marshes", region: "Poland" },
  { id: 68886, month: 6, label: "Hortobágy", region: "Hungary" },
  { id: 163585, month: 4, label: "Lesbos", region: "Greece" },
  { id: 7095, month: 4, label: "Crete", region: "Greece" },
  { id: 195476, month: 7, label: "Lofoten", region: "Norway" },
  { id: 69050, month: 7, label: "Abisko", region: "Swedish Lapland" },

  // Africa
  {
    id: 69891,
    month: 7,
    label: "Bwindi Impenetrable Forest",
    region: "Uganda",
  },
  { id: 68929, month: 8, label: "Amboseli", region: "Kenya" },
  { id: 219297, month: 8, label: "Lake Nakuru", region: "Kenya" },
  { id: 69134, month: 7, label: "South Luangwa", region: "Zambia" },
  { id: 69215, month: 8, label: "Hwange National Park", region: "Zimbabwe" },
  {
    id: 71275,
    month: 7,
    label: "Hluhluwe-iMfolozi Park",
    region: "KwaZulu-Natal, South Africa",
  },
  {
    id: 69021,
    month: 9,
    label: "Kgalagadi Transfrontier Park",
    region: "South Africa and Botswana",
  },
  { id: 8357, month: 4, label: "Mauritius", region: "Indian Ocean" },

  // Asia
  { id: 69667, month: 3, label: "Chitwan National Park", region: "Nepal" },
  { id: 68897, month: 11, label: "Kaziranga", region: "Assam, India" },
  { id: 69064, month: 1, label: "Khao Yai", region: "Thailand" },
  { id: 69072, month: 2, label: "Doi Inthanon", region: "Thailand" },
  { id: 68946, month: 3, label: "Taman Negara", region: "Malaysia" },
  {
    id: 131153,
    month: 8,
    label: "Bako National Park",
    region: "Sarawak, Borneo",
  },
  { id: 191493, month: 10, label: "Danum Valley", region: "Sabah, Borneo" },
  { id: 69569, month: 5, label: "Yangmingshan", region: "Taiwan" },
  { id: 69587, month: 7, label: "Taroko Gorge", region: "Taiwan" },
  { id: 11003, month: 7, label: "Jeju Island", region: "South Korea" },

  // Australia and the Pacific
  {
    id: 68745,
    month: 9,
    label: "The Daintree",
    region: "Queensland, Australia",
  },
  {
    id: 51506,
    month: 10,
    label: "Lamington National Park",
    region: "Queensland, Australia",
  },
  { id: 131698, month: 6, label: "K'gari", region: "Queensland, Australia" },
  {
    id: 48996,
    month: 10,
    label: "The Blue Mountains",
    region: "New South Wales, Australia",
  },
  {
    id: 196253,
    month: 1,
    label: "Kosciuszko National Park",
    region: "New South Wales, Australia",
  },
  { id: 19271, month: 10, label: "Kangaroo Island", region: "South Australia" },
  {
    id: 72050,
    month: 9,
    label: "Uluru-Kata Tjuta",
    region: "Northern Territory, Australia",
  },
  {
    id: 18651,
    month: 2,
    label: "Lord Howe Island",
    region: "Tasman Sea, Australia",
  },
  {
    id: 131030,
    month: 1,
    label: "Tongariro National Park",
    region: "New Zealand",
  },
  { id: 89730, month: 1, label: "Fiordland", region: "New Zealand" },
];

{
  const daily = new Set(PLACES.map((p) => p.id));
  const shared = EXTRA_PLACES.filter((p) => daily.has(p.id));
  if (shared.length) {
    throw new Error(
      `Daily and extra sets share ${shared.map((p) => p.label).join(", ")}; an extra list would spoil a daily one.`,
    );
  }
}

/**
 * A full build is well over a thousand requests, so a dropped socket or a
 * momentary 503 is a matter of when, not if. Retry with a widening pause rather
 * than throwing away twenty minutes of work.
 */
async function api(path, params = {}, attempt = 1) {
  const q = new URLSearchParams(params);
  const url = `https://api.inaturalist.org/v1/${path}${q.toString() ? `?${q}` : ""}`;
  try {
    const res = await fetch(url, { headers: UA });
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`${path} HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    if (attempt >= 4) throw error;
    await sleep(THROTTLE * attempt * 3);
    return api(path, params, attempt + 1);
  }
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Trim a Wikipedia summary to whole sentences so it never ends mid-word. */
function firstSentences(text, limit = 230) {
  const clean = stripHtml(text);
  if (!clean) return "";
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const stop = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
  );
  return stop > 60 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}...`;
}

/**
 * iNaturalist returns Wikipedia URLs with raw spaces in the title, which do not
 * resolve. Normalise to underscores and force https.
 */
function wikiUrl(raw) {
  if (!raw) return "";
  const url = String(raw)
    .trim()
    .replace(/^http:/, "https:");
  const cut = url.indexOf("/wiki/");
  if (cut === -1) return url.includes(" ") ? url.replace(/ /g, "_") : url;
  const base = url.slice(0, cut + "/wiki/".length);
  const title = url.slice(cut + "/wiki/".length).replace(/ /g, "_");
  return base + title;
}

function usablePhoto(taxon) {
  // Prefer the taxon's default photo, but fall back through its other photos:
  // the best-known species often have an all-rights-reserved lead image, and
  // dropping the clue over that would gut the puzzle set.
  const candidates = [
    taxon.default_photo,
    ...(taxon.taxon_photos || []).map((tp) => tp.photo),
  ].filter(Boolean);

  for (const photo of candidates) {
    if (!photo.url) continue;
    const licence = OPEN_LICENCES.get(
      String(photo.license_code || "").toLowerCase(),
    );
    if (!licence) continue;
    // square -> medium is roughly 500px on the long edge.
    const url = photo.url.replace("/square.", "/medium.");
    if (!PHOTO_HOSTS.some((host) => url.startsWith(host))) continue;

    // iNaturalist's attribution string is wordy; keep the photographer's name.
    const raw = stripHtml(photo.attribution);
    const name = raw
      .replace(/^\(c\)\s*/i, "")
      .replace(/,?\s*(all|some) rights reserved.*$/i, "")
      .replace(/,?\s*uploaded by.*$/i, "")
      .trim();

    return {
      url,
      licence,
      by: name || "Unknown",
      source: photo.id ? `https://www.inaturalist.org/photos/${photo.id}` : "",
    };
  }
  return null;
}

function bboxOf(place) {
  const ring =
    place.bounding_box_geojson &&
    place.bounding_box_geojson.coordinates &&
    place.bounding_box_geojson.coordinates[0];
  if (!ring || ring.length < 4) return null;
  const lons = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  return {
    w: Math.min(...lons),
    e: Math.max(...lons),
    s: Math.min(...lats),
    n: Math.max(...lats),
  };
}

/** Research-grade records of these taxa in a place that carry `flag`. */
async function flaggedCounts(placeId, ids, flag) {
  const data = await api("observations/species_counts", {
    place_id: String(placeId),
    taxon_id: ids.join(","),
    quality_grade: "research",
    per_page: String(Math.max(ids.length * 2, 20)),
    [flag]: "true",
  });
  await sleep(THROTTLE);
  const counts = new Map();
  for (const row of data.results || []) counts.set(row.taxon.id, row.count);
  return counts;
}

/**
 * Share of a taxon's research-grade records, worldwide, flagged endemic.
 * A listing on one island can call a widespread species endemic because of a
 * local subspecies: Grey Wagtail on Madeira, Eurasian Kestrel on the Canaries.
 * Their worldwide share is 1-2%. Real endemics sit between 66% (Red-necked
 * Wallaby, which has been introduced abroad) and 100% (Olympic Marmot).
 */
async function endemicShare(id) {
  const all = await api("observations", {
    taxon_id: String(id),
    quality_grade: "research",
    per_page: "0",
  });
  await sleep(THROTTLE);
  const flagged = await api("observations", {
    taxon_id: String(id),
    quality_grade: "research",
    endemic: "true",
    per_page: "0",
  });
  await sleep(THROTTLE);
  return all.total_results ? flagged.total_results / all.total_results : 0;
}

/**
 * Native, introduced or endemic for each taxon, by majority of the place's
 * own flagged records. 175 native Mallard records in the Danube Delta outvote
 * the 3 that a stray listing calls introduced; all 11 Kookaburra records at
 * Cradle Mountain are introduced, because Tasmania lists them that way. An
 * endemic label also has to hold worldwide (see endemicShare).
 */
async function standings(placeId, ids) {
  const introduced = await flaggedCounts(placeId, ids, "introduced");
  const native = await flaggedCounts(placeId, ids, "native");
  const endemic = await flaggedCounts(placeId, ids, "endemic");
  const out = new Map();
  for (const id of ids) {
    const i = introduced.get(id) || 0;
    const n = native.get(id) || 0;
    const e = endemic.get(id) || 0;
    let label = i > n ? "introduced" : "native";
    if (label === "native" && e > 0 && e * 2 >= n) {
      label = (await endemicShare(id)) >= 0.5 ? "endemic" : "native";
    }
    out.set(id, label);
  }
  return out;
}

/**
 * Six clues stepping from "recorded almost everywhere" down to "this is the
 * spot", one from each logarithmic band of worldwide observation count.
 */
const BANDS = [
  [150000, Infinity],
  [55000, 150000],
  [16000, 55000],
  [4500, 16000],
  [1100, 4500],
  [0, 1100],
];

/** Up to this many candidates are tried per band before giving up on it. */
const TRIES_PER_BAND = 8;

/**
 * Animals make better clues than plants. A birder can picture a kookaburra and
 * reason about where it lives; "Parry's Townsend-daisy" is a dead end for all
 * but a handful of botanists. So the puzzle is animal-first: plants and fungi
 * are allowed, but only where they actually say something about the place, and
 * never more than two in a list.
 */
const BOTANICAL = new Set(["Plantae", "Fungi", "Chromista", "Protozoa"]);
const MAX_BOTANICAL_PER_ROUND = 2;

/** Animals sort ahead of plants inside a band, so they are tried first. */
function animalFirst(a, b) {
  const ab = BOTANICAL.has(a.group) ? 1 : 0;
  const bb = BOTANICAL.has(b.group) ? 1 : 0;
  if (ab !== bb) return ab - bb;
  return b.global - a.global;
}

/**
 * Fetches the fact, citation and credited photo for a species. Returns null
 * when the species has no openly-licensed photo, so the caller can try the
 * next candidate in the same band. Standing is filled in once all six are
 * picked (see standings()).
 */
async function enrich(clue) {
  let taxon;
  try {
    const data = await api(`taxa/${clue.id}`, { locale: "en" });
    taxon = (data.results || [])[0];
  } catch {
    taxon = null;
  }
  await sleep(THROTTLE);
  if (!taxon) return null;

  const photo = usablePhoto(taxon);
  if (!photo) return null;

  return {
    id: clue.id,
    name: clue.name,
    sci: clue.sci,
    group: clue.group,
    global: clue.global,
    local: clue.local,
    standing: "native",
    fact: firstSentences(taxon.wikipedia_summary),
    wiki: wikiUrl(taxon.wikipedia_url),
    rank: taxon.conservation_status
      ? taxon.conservation_status.status_name || ""
      : "",
    photo: photo.url,
    by: photo.by,
    licence: photo.licence,
    photoSource: photo.source,
  };
}

/**
 * Walks each abundance band, enriching candidates until one sticks. Doing the
 * enrichment inside the pick (rather than picking first and enriching after)
 * means a species with no usable photo costs a request, not a whole round.
 */
async function buildClues(list) {
  const sorted = list.slice().sort((a, b) => b.global - a.global);
  const used = new Set();
  const picked = [];
  let botanical = 0;

  for (let band = 0; band < BANDS.length; band++) {
    const [lo, hi] = BANDS[band];
    // The last band is the line that gives the place away, so it has to be an
    // animal: somebody can reason from a honeyeater, not from a sedge.
    const giveaway = band === BANDS.length - 1;
    const inBand = sorted
      .filter((s) => s.global >= lo && s.global < hi && !used.has(s.id))
      .sort(animalFirst)
      .filter((s) => {
        if (!BOTANICAL.has(s.group)) return true;
        return !giveaway && botanical < MAX_BOTANICAL_PER_ROUND;
      });

    for (const candidate of inBand.slice(0, TRIES_PER_BAND)) {
      const clue = await enrich(candidate);
      if (clue) {
        used.add(candidate.id);
        picked.push(clue);
        if (BOTANICAL.has(candidate.group)) botanical += 1;
        break;
      }
    }
  }

  // Backfill from the most local end if a band came up empty, still animals first.
  const backfill = sorted
    .slice()
    .reverse()
    .sort((a, b) => {
      const ab = BOTANICAL.has(a.group) ? 1 : 0;
      const bb = BOTANICAL.has(b.group) ? 1 : 0;
      if (ab !== bb) return ab - bb;
      return a.global - b.global;
    });
  for (const candidate of backfill) {
    if (picked.length >= 6) break;
    if (used.has(candidate.id)) continue;
    if (BOTANICAL.has(candidate.group) && botanical >= MAX_BOTANICAL_PER_ROUND)
      continue;
    const clue = await enrich(candidate);
    if (clue) {
      used.add(candidate.id);
      picked.push(clue);
      if (BOTANICAL.has(candidate.group)) botanical += 1;
    }
  }

  picked.sort((a, b) => b.global - a.global);
  return picked.length === 6 ? picked : null;
}

/**
 * --retag: keep every round's species, refresh only the native / introduced /
 * endemic labels. Safe to run on the live set mid-day, because nothing a
 * player has already guessed against changes.
 */
if (RETAG) {
  const set = JSON.parse(readFileSync(OUT, "utf8"));
  let changed = 0;
  for (const round of set.rounds) {
    const ids = round.clues.map((c) => c.id);
    const labels = await standings(round.placeId, ids);
    for (const clue of round.clues) {
      const next = labels.get(clue.id) || "native";
      if (next !== clue.standing) {
        console.log(`${round.name}: ${clue.name} ${clue.standing} -> ${next}`);
        clue.standing = next;
        changed++;
      }
    }
  }
  writeFileSync(OUT, `${JSON.stringify(set, null, 2)}\n`);
  console.log(`\nRelabelled ${changed} species in ${OUT}.`);
  process.exit(0);
}

const rounds = [];
const problems = [];

for (const entry of EXTRA ? EXTRA_PLACES : PLACES) {
  let place;
  try {
    const data = await api(`places/${entry.id}`);
    place = (data.results || [])[0];
  } catch (error) {
    problems.push(`${entry.label}: place lookup failed (${error.message})`);
    await sleep(THROTTLE);
    continue;
  }
  await sleep(THROTTLE);

  if (!place) {
    problems.push(`${entry.label}: place ${entry.id} not found`);
    continue;
  }

  const bbox = bboxOf(place);
  if (!bbox) {
    problems.push(`${entry.label}: no bounding box`);
    continue;
  }

  // Candidate species actually recorded there that month.
  let candidates = [];
  try {
    const data = await api("observations/species_counts", {
      place_id: String(entry.id),
      month: String(entry.month),
      quality_grade: "research",
      per_page: "200",
      locale: "en",
    });
    candidates = (data.results || [])
      .filter(
        (r) => r.taxon.rank === "species" && r.taxon.observations_count > 0,
      )
      .map((r) => ({
        id: r.taxon.id,
        local: r.count,
        global: r.taxon.observations_count,
        name: r.taxon.preferred_common_name || r.taxon.name,
        sci: r.taxon.name,
        group: r.taxon.iconic_taxon_name || "",
      }))
      // Two or more local records: a single record is often a vagrant,
      // an escape, or a misidentification, none of which belong in a puzzle
      // that claims to describe a place.
      .filter((s) => s.local >= 2);
  } catch (error) {
    problems.push(`${entry.label}: species_counts failed (${error.message})`);
    await sleep(THROTTLE);
    continue;
  }
  await sleep(THROTTLE);

  const enriched = await buildClues(candidates);
  if (enriched && enriched[0].global < 120000) {
    // Without a genuinely cosmopolitan opener the puzzle starts half-solved.
    problems.push(
      `${entry.label}: opening clue only ${enriched[0].global} records, too local to open with`,
    );
    continue;
  }
  if (!enriched) {
    problems.push(
      `${entry.label}: could not assemble 6 clues from ${candidates.length} species in month ${entry.month}`,
    );
    continue;
  }
  const labels = await standings(
    entry.id,
    enriched.map((c) => c.id),
  );
  for (const clue of enriched) clue.standing = labels.get(clue.id) || "native";

  rounds.push({
    placeId: entry.id,
    name: entry.label,
    region: entry.region,
    official: place.display_name,
    month: entry.month,
    bbox,
    clues: enriched,
  });

  const summary = enriched
    .map(
      (c) =>
        `${Math.round(c.global / 1000)}k${c.standing === "native" ? "" : c.standing[0]}`,
    )
    .join(" > ");
  console.log(
    `${entry.label.slice(0, 30).padEnd(31)}m${String(entry.month).padStart(2)}  ${summary}`,
  );
}

if (problems.length) {
  console.log("\nSkipped:");
  for (const p of problems) console.log(`  - ${p}`);
}

if (rounds.length < 10) {
  console.error(
    `\nOnly ${rounds.length} rounds built; refusing to write a thin puzzle set.`,
  );
  process.exit(1);
}

const payload = {
  built: new Date().toISOString().slice(0, 10),
  source: "iNaturalist research-grade observations",
  rounds,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`\nWrote ${OUT} with ${rounds.length} rounds.`);
