#!/usr/bin/env node
/**
 * Resolves the Day list locations to real iNaturalist place IDs and reports
 * how much data each one has, so the puzzle set can be chosen on evidence
 * rather than guesswork. Run it by hand when adding or changing a location:
 *
 *   node scripts/resolve-day-list-places.mjs           # daily candidates
 *   node scripts/resolve-day-list-places.mjs --extra   # "More lists" candidates
 *
 * It prints a table, including the month with the most research-grade records
 * (the month a round should use) and the size of the place's bounding box.
 * Paste the winners into PLACES (daily) or EXTRA_PLACES (More lists) in
 * build-day-list.mjs. The two sets must never share a place: an extra list
 * would otherwise spoil a future daily one.
 */
const UA = {
  "User-Agent": "trumanbrown.com day-list builder (+https://trumanbrown.com)",
  Accept: "application/json",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Candidates for the "More lists" pool. None of these are daily places. */
const EXTRA_CANDIDATES = [
  // North America
  "Acadia National Park",
  "Grand Canyon National Park",
  "Zion National Park",
  "Glacier National Park, US",
  "Rocky Mountain National Park",
  "Yosemite National Park",
  "Channel Islands National Park",
  "Death Valley National Park",
  "Shenandoah National Park",
  "Cape Cod National Seashore",
  "Hawaii Volcanoes National Park",
  "Kenai Fjords National Park",
  "Point Pelee National Park",
  "Pacific Rim National Park Reserve",
  "Jasper National Park",
  "Isle Royale National Park",
  "Okefenokee National Wildlife Refuge",
  "Santa Ana National Wildlife Refuge",
  "Padre Island National Seashore",
  // Latin America and the Caribbean
  "Monteverde Cloud Forest Reserve",
  "Corcovado National Park",
  "Sian Ka'an",
  "El Yunque National Forest",
  "Tikal National Park",
  "Iguazu National Park",
  "Tijuca National Park",
  "Itatiaia National Park",
  "Yasuni National Park",
  "Peninsula Valdes",
  "Pantanal Matogrossense National Park",
  // Europe
  "New Forest National Park",
  "Lake District National Park",
  "Hortobagy National Park",
  "Plitvice Lakes National Park",
  "Picos de Europa National Park",
  "Swiss National Park",
  "Gran Paradiso National Park",
  "Bavarian Forest National Park",
  "Biebrza National Park",
  "Lesbos",
  "Crete",
  "Tenerife",
  "Madeira",
  "Lofoten",
  "Abisko National Park",
  // Africa and the Middle East
  "Masai Mara National Reserve",
  "Bwindi Impenetrable National Park",
  "Lake Nakuru National Park",
  "Hluhluwe-iMfolozi Park",
  "Kgalagadi Transfrontier Park",
  "Addo Elephant National Park",
  "South Luangwa National Park",
  "Amboseli National Park",
  "Hwange National Park",
  "Ein Gedi",
  "Mauritius",
  // Asia
  "Kaziranga National Park",
  "Ranthambore National Park",
  "Chitwan National Park",
  "Yala National Park",
  "Khao Yai National Park",
  "Doi Inthanon National Park",
  "Taman Negara",
  "Danum Valley",
  "Yangmingshan National Park",
  "Taroko National Park",
  "Mai Po",
  "Jeju",
  "Iriomote",
  // Australia and the Pacific
  "Daintree National Park",
  "Lamington National Park",
  "Blue Mountains National Park",
  "Kangaroo Island",
  "Kosciuszko National Park",
  "Wilsons Promontory National Park",
  "K'gari",
  "Uluru-Kata Tjuta National Park",
  "Fiordland National Park",
  "Abel Tasman National Park",
  "Tongariro National Park",
  "Lord Howe Island",
];

const CANDIDATES = [
  "Monteverde Cloud Forest Reserve",
  "Tortuguero National Park",
  "Manu National Park",
  "Pantanal",
  "Iguazu National Park",
  "Torres del Paine",
  "Ranthambore National Park",
  "Kaziranga National Park",
  "Sinharaja Forest Reserve",
  "Khao Yai National Park",
  "Taman Negara",
  "Kinabalu Park",
  "Komodo National Park",
  "Ngorongoro Conservation Area",
  "Bwindi Impenetrable National Park",
  "Etosha National Park",
  "Table Mountain National Park",
  "Masai Mara National Reserve",
  "Danube Delta",
  "Bialowieza Forest",
  "Wadden Sea",
  "Hortobagy National Park",
  "New Forest",
  "Cairngorms National Park",
  "Vatnajokull National Park",
  "Plitvice Lakes National Park",
  "Great Smoky Mountains National Park",
  "Big Bend National Park",
  "Point Reyes National Seashore",
  "Monterey Bay",
  "Churchill",
  "Algonquin Provincial Park",
  "Banff National Park",
  "Haleakala National Park",
  "Fraser Island",
  "Great Otway National Park",
  "Fiordland",
  "Stewart Island",
  "Shiretoko",
  "Ogasawara",
];

/** One retry after a pause: a resolve run is a few hundred requests. */
async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return await res.json();
    } catch {
      /* dropped socket; try again */
    }
    await sleep(2500 * attempt);
  }
  return null;
}

async function resolve(name) {
  const data = await getJson(
    `https://api.inaturalist.org/v1/places/autocomplete?q=${encodeURIComponent(name)}`,
  );
  return (data?.results || [])[0] || null;
}

async function counts(placeId, params = {}) {
  const q = new URLSearchParams({
    place_id: String(placeId),
    quality_grade: "research",
    per_page: "1",
    ...params,
  });
  const data = await getJson(
    `https://api.inaturalist.org/v1/observations/species_counts?${q}`,
  );
  return data?.total_results || 0;
}

/** The month with the most research-grade records, and how many it has. */
async function busiestMonth(placeId) {
  const q = new URLSearchParams({
    place_id: String(placeId),
    quality_grade: "research",
    interval: "month_of_year",
    date_field: "observed",
  });
  const data = await getJson(
    `https://api.inaturalist.org/v1/observations/histogram?${q}`,
  );
  const months = data?.results?.month_of_year || {};
  let best = 0;
  let records = 0;
  for (const [month, n] of Object.entries(months)) {
    if (n > records) {
      best = Number(month);
      records = n;
    }
  }
  return { month: best, records };
}

function boxSize(place) {
  const ring = place.bounding_box_geojson?.coordinates?.[0];
  if (!ring || ring.length < 4) return "NO";
  const lons = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  const w = Math.max(...lons) - Math.min(...lons);
  const h = Math.max(...lats) - Math.min(...lats);
  return `${w.toFixed(1)}x${h.toFixed(1)}`;
}

const extra = process.argv.includes("--extra");
const names = extra ? EXTRA_CANDIDATES : CANDIDATES;

console.log(
  "place".padEnd(34) +
    "id".padEnd(8) +
    "species".padEnd(9) +
    "endemic".padEnd(9) +
    "intro".padEnd(7) +
    "month".padEnd(7) +
    "records".padEnd(9) +
    "bbox",
);
console.log("-".repeat(94));

for (const name of names) {
  const place = await resolve(name);
  await sleep(1100);
  if (!place) {
    console.log(`${name.padEnd(34)}NOT FOUND`);
    continue;
  }
  const total = await counts(place.id);
  await sleep(1100);
  const endemic = await counts(place.id, { endemic: "true" });
  await sleep(1100);
  const introduced = await counts(place.id, { introduced: "true" });
  await sleep(1100);
  const { month, records } = await busiestMonth(place.id);
  await sleep(1100);

  console.log(
    `${place.display_name.slice(0, 33).padEnd(34)}${String(place.id).padEnd(8)}${String(total).padEnd(9)}${String(endemic).padEnd(9)}${String(introduced).padEnd(7)}${String(month).padEnd(7)}${String(records).padEnd(9)}${boxSize(place)}`,
  );
}
