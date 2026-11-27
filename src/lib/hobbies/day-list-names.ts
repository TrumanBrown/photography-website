/**
 * Narrow nature hides the place in a species' name until the answer is in.
 * A quarter of the cards named one: "American robin" gave the continent away
 * on the free first card, and "Yosemite toad" named the answer on the last
 * (2026-11-26). The card shows the rest of the name around a bar the same
 * width whatever the word, so its length gives nothing away either.
 *
 * Pure: day-list.ts turns the parts into the card, the phone's strip and what
 * a screen reader hears. The full list after the answer shows the whole name.
 * day-list.test.ts runs every list through it and fails on a place word this
 * file doesn't know, so a rebuild that brings one in says so.
 */

/** Places written as more than one word, matched before single words. */
const PLACE_PHRASES = [
  "Banff Springs",
  "Baja California",
  "Canary Islands",
  "Cape May",
  "Central American",
  "Costa Rican",
  "Death Valley",
  "Great Basin",
  "Great Plains",
  "Gulf Coast",
  "Hong Kong",
  "Lord Howe",
  "New Caledonian",
  "New Guinea",
  "New Holland",
  "New Zealand",
  "North American",
  "Old World",
  "Puerto Rican",
  "Puget Sound",
  "Rocky Mountain",
  "Salish Sea",
  "Santa Catarina",
  "Sierra Madre",
  "Sierra Nevada",
  "South African",
  "South American",
  "Sri Lanka",
  "Sri Lankan",
  "West Indian",
].map((p) => p.toLowerCase().split(" "));

/**
 * Places and the words made from them, as species names use them: continents,
 * oceans, countries, regions, islands, ranges and parks. Not compass words
 * ("Eastern", "Austral") or habitats ("Alpine", "Island", "Desert"), which
 * say what kind of place, not which.
 */
const PLACE_WORDS = new Set(
  // Continents, oceans and big regions.
  (
    "African Afrotropical American Amazon Amazonian Andean Antarctic Arabian Arctic Asian " +
    "Asiatic Atlantic Australasian Australian Balkan Caribbean Caspian Eurasian European " +
    "Himalayan Holarctic Indian Indo-Pacific Mediterranean Nearctic Neotropic Neotropical " +
    "Oriental Pacific Palearctic Saharan Siberian Tibetan " +
    // Europe.
    "Aegean Andalusian Balearic Corsican Cretan Cyprus Cypriot Dalmatian Danube Iberian " +
    "Icelandic Italian Lapland Madeira Manx Mytilene Pyrenean Roman Sardinian Scottish " +
    "Sicilian Spanish Swedish Swiss Tenerife Canarian " +
    // Africa and the Indian Ocean.
    "Abyssinian Angolan Barbary Cape Congo Damara Egyptian Ethiopian Gaboon Kalahari Karoo " +
    "Karasburg Kenyan Maasai Madagascar Malagasy Mascarene Mozambique Mwanza Namaqua Namib " +
    "Namibian Natal Nile Nubian Okavango Rwenzori Ruwenzori Senegal Somali Taveta Ugandan " +
    "Uganda Usambara Zanzibar " +
    // Asia.
    "Andaman Bengal Bonin Bornean Borneo Burmese Ceylon Chinese Ezo Formosan Hainan " +
    "Hokkaido Japanese Java Javan Jeju Kashmir Korean Lanna Malabar Malayan Mongolian " +
    "Nepal Nilgiri Okinawa Philippine Ryukyu Sichuan Solor Sulawesi Sumatran Taiwan " +
    "Taiwanese Terai Yunnan " +
    // Australia and the Pacific.
    "Centralian Fijian Hawaiian Otway Papuan Queensland Samoan Tasmanian Tongan " +
    // North America.
    "Alaska Alaskan Aleutian Appalachian Arizona Bahama Banff Bering Bermuda California " +
    "Californian Canada Canadian Carolina Cascade Cascades Chihuahuan Colorado Columbia " +
    "Columbian Cuban Dungeness Florida Gila Gulf Hispaniolan Hudsonian Idaho Jamaican " +
    "Labrador Louisiana Mexican Mojave Monterey Newfoundland Olympic Oregon Ozark Panamint " +
    "Salish Shenandoah Sinaloa Sonoran Texas Uinta Utah Virginia Washington Wyoming " +
    "Yosemite Yucatan " +
    // Central and South America.
    "Argentine Argentinian Bolivian Brazilian Chilean Cocos Colombian Ecuador Ecuadorian " +
    "Fuegian Galapagos Galápagos Guianan Itatiaia Magellanic Nicaraguan Panamanian Panamic " +
    "Patagonian Peruvian Puna Venezuelan"
  )
    .toLowerCase()
    .split(" "),
);

export interface NamePart {
  text: string;
  /** A place, shown as a bar until the answer is in. */
  hidden: boolean;
}

/** A word as the lists hold it: lowercase, without the punctuation around it. */
const bare = (word: string) =>
  word.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}-]+$/gu, "");

const isPlace = (word: string) => {
  const w = bare(word);
  return (
    PLACE_WORDS.has(w) || w.split("-").some((part) => PLACE_WORDS.has(part))
  );
};

/**
 * "Australian magpie" -> a hidden "Australian" and " magpie". Neighbouring
 * places become one part ("South American coati"). The last word is the kind
 * of animal and always shows, even where it's a place too, as with an amazon
 * parrot. Someone's name ("Steller's jay") is never a place.
 */
export function nameParts(name: string): NamePart[] {
  const words = name.split(" ");
  const hide = words.map(() => false);
  const last = words.length - 1;
  for (let i = 0; i < last; i++) {
    for (const phrase of PLACE_PHRASES) {
      const end = i + phrase.length;
      if (end > last) continue;
      if (phrase.every((p, k) => bare(words[i + k]) === p)) {
        for (let k = i; k < end; k++) hide[k] = true;
      }
    }
    if (!/['\u2019]s?$/.test(words[i]) && isPlace(words[i])) hide[i] = true;
  }
  const parts: NamePart[] = [];
  words.forEach((word, i) => {
    const prev = parts[parts.length - 1];
    if (prev && prev.hidden === hide[i]) prev.text += ` ${word}`;
    else if (prev) {
      // The space between parts goes with the shown one.
      if (hide[i]) {
        prev.text += " ";
        parts.push({ text: word, hidden: true });
      } else parts.push({ text: ` ${word}`, hidden: false });
    } else parts.push({ text: word, hidden: hide[i] });
  });
  return parts;
}
