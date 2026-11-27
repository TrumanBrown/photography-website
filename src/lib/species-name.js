/**
 * Species names in sentence case, the way the whole site writes them
 * ("Western red-backed salamander", "Steller's jay"), whatever iNaturalist or a
 * field guide sends ("Western Red-backed Salamander"). Proper nouns keep their
 * capitals: people's names, places and the adjectives made from them.
 *
 * Plain JavaScript with no imports, so the site (pages and browser code) and
 * the photo captions pipeline (scripts/photos/text.mjs) share this one copy.
 * A proper noun that turns up mid-name and gets lowercased belongs in one of
 * the lists below, with a case in species-name.test.ts.
 */

const KEEP_CAPITALISED = new Set(
  (
    "American African Asian Asiatic European Australian Chinese Japanese Tibetan Himalayan Indian " +
    "Mexican Canadian Canada Californian California Oregon Washington Pacific Atlantic Caribbean " +
    "Andean Amazonian Amazon Costa Rican Panamanian Panamic Nicaraguan Cuban Tico Mediterranean " +
    "Arctic Siberian Mongolian Korean Formosan Taiwanese Malayan Bornean Sumatran Javan Philippine " +
    "Brazilian Peruvian Hawaiian Alaskan Alaska Cascade Cascades Olympic Columbia Sierra Nevada " +
    "Rocky Appalachian Yunnan Yulong Sichuan Bering Chinook Dungeness Monterey Carolina Virginia " +
    "Texas Florida Arizona Louisiana Kentucky Tennessee Connecticut Nashville Mississippi Missouri " +
    "Idaho Utah Montana Colorado Sonoran Mojave Baja Chihuahuan Galapagos Galápagos Cocos Gulf " +
    "Oriental Moorish Spanish Montezuma Roosevelt Halloween Isabella Paris Thoas Peralta Sabinal " +
    "Pere Père Sally-Lightfoot Mormon Malagasy Magellanic Papuan Australo Indo Sino Steller Gila " +
    "Taiwan Yucatan"
  ).split(" "),
);

/** Words that start a place name, so they and the word after them keep capitals: "Santa Ana", "New Zealand". */
const PLACE_PREFIX = new Set([
  "La",
  "El",
  "Los",
  "Las",
  "San",
  "Santa",
  "Mount",
  "Rio",
  "Río",
  "St.",
  "Saint",
  "New",
  "Puerto",
  "Sri",
  "Hong",
]);

/** Titles that stay capitalised ahead of a person's name: "Prince Henry's", "Van Dyke's". */
const TITLES = new Set([
  "Prince",
  "Princess",
  "Queen",
  "King",
  "Lady",
  "Lord",
  "Sir",
  "Van",
  "Von",
  "Mr.",
  "Mrs.",
  "Dr.",
]);

/** Place names inside species names, kept capitalised: "Puget Sound garter snake". */
const PROPER_PHRASE = Object.fromEntries(
  [
    "Puget Sound",
    "Tapir Valley",
    "Great Basin",
    "Rocky Mountain",
    "Great Plains",
    "Gulf Coast",
    "North American",
    "South American",
    "Central American",
    "West Indian",
    "Old World",
    "Cape May",
    "Death Valley",
    "Salish Sea",
    "Banff Springs",
  ].map((p) => [p.toLowerCase(), p]),
);
const PROPER_PHRASES = new RegExp(
  `\\b(?:${Object.keys(PROPER_PHRASE).join("|")})\\b`,
  "gi",
);

const possessive = (/** @type {string} */ word) => /['\u2019]s?$/i.test(word);

/** Lowercases each part of a hyphenated word that isn't a proper noun: "Fire-Bellied" -> "fire-bellied", "Indo-Pacific" stays. */
const caseParts = (/** @type {string} */ word, keepFirst = false) =>
  word
    .split("-")
    .map((part, i) =>
      (i === 0 && keepFirst) || KEEP_CAPITALISED.has(part)
        ? part
        : part.toLowerCase(),
    )
    .join("-");

/**
 * "Western Red-backed Salamander" -> "Western red-backed salamander", keeping
 * proper nouns. The first letter is lifted, so iNaturalist's lowercase plant
 * names start with a capital too ("common yarrow" -> "Common yarrow"). With
 * `midSentence`, the first word is lowercased as well unless it's a proper
 * noun ("two northwestern garter snakes", "two Pacific chorus frogs").
 * Scientific names pass through unchanged.
 *
 * @param {string | null | undefined} common
 * @param {{ midSentence?: boolean }} [options]
 * @returns {string}
 */
export function speciesName(common, { midSentence = false } = {}) {
  if (!common) return "";
  const words = common.split(" ");
  const proper = (/** @type {string} */ word, /** @type {number} */ i) =>
    possessive(word) ||
    KEEP_CAPITALISED.has(word) ||
    /^[A-Z]{2,}$/.test(word) ||
    (PLACE_PREFIX.has(word) && i < words.length - 1) ||
    (i > 0 && PLACE_PREFIX.has(words[i - 1])) ||
    (TITLES.has(word) && i < words.length - 1 && possessive(words[i + 1])) ||
    // Demonyms ahead of the noun: Ecuadorian, Caribbean, Chinese.
    (i < words.length - 1 &&
      /(?:ian|ean|ese)$/i.test(word) &&
      !/^ocean$/i.test(word));
  return words
    .map((word, i) => {
      const lead = i === 0 && !midSentence;
      const w = lead ? word.charAt(0).toUpperCase() + word.slice(1) : word;
      return proper(w, i) ? w : caseParts(w, lead);
    })
    .join(" ")
    .replace(PROPER_PHRASES, (m) => PROPER_PHRASE[m.toLowerCase()]);
}
