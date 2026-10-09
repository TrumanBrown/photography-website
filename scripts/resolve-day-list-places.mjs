#!/usr/bin/env node
/**
 * Resolves the Day list locations to real iNaturalist place IDs and reports
 * how much data each one has, so the puzzle set can be chosen on evidence
 * rather than guesswork. Run it by hand when adding or changing a location:
 *
 *   node scripts/resolve-day-list-places.mjs
 *
 * It prints a table; paste the winners into PLACES in build-day-list.mjs.
 */
const UA = {
  "User-Agent": "trumanbrown.com day-list builder (+https://trumanbrown.com)",
  Accept: "application/json",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  "Olympic National Park",
  "Mount Rainier National Park",
  "North Cascades National Park",
  "Saguaro National Park",
  "Everglades National Park",
  "Yellowstone National Park",
  "Joshua Tree National Park",
  "Acadia National Park",
  "Denali National Park",
  "Serengeti National Park",
  "Kruger National Park",
  "Cradle Mountain-Lake St Clair",
  "Monteverde",
  "Corcovado National Park",
  "Galapagos",
  "Svalbard",
  "Lofoten",
  "Kakadu National Park",
  "Fiordland National Park",
  "Doñana",
  "Camargue",
  "Sundarbans",
  "Borneo",
  "Madagascar",
  "Iceland",
  "Yakushima",
  "Hokkaido",
  "Tierra del Fuego",
  "Okavango Delta",
  "Great Barrier Reef",
];

async function resolve(name) {
  const res = await fetch(
    `https://api.inaturalist.org/v1/places/autocomplete?q=${encodeURIComponent(name)}`,
    { headers: UA },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return (data.results || [])[0] || null;
}

async function counts(placeId, params = {}) {
  const q = new URLSearchParams({
    place_id: String(placeId),
    quality_grade: "research",
    per_page: "1",
    ...params,
  });
  const res = await fetch(
    `https://api.inaturalist.org/v1/observations/species_counts?${q}`,
    { headers: UA },
  );
  if (!res.ok) return 0;
  const data = await res.json();
  return data.total_results || 0;
}

console.log(
  "place".padEnd(34) +
    "id".padEnd(8) +
    "species".padEnd(9) +
    "endemic".padEnd(9) +
    "intro".padEnd(7) +
    "bbox",
);
console.log("-".repeat(78));

for (const name of CANDIDATES) {
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

  const bbox = place.bounding_box_geojson ? "yes" : "NO";
  console.log(
    `${place.display_name.slice(0, 33).padEnd(34)}${String(place.id).padEnd(8)}${String(total).padEnd(9)}${String(endemic).padEnd(9)}${String(introduced).padEnd(7)}${bbox}`,
  );
}
