/**
 * Fish species for the Fishing hobby map (Minnesota + Washington).
 *
 * The single source of truth for fish. Each entry maps to a sprite `category`
 * (the pixel renderer in fishing.ts draws ~8 silhouettes, parameterized by
 * color) so a long species list stays cheap. The SAME sprite is used on the map
 * and beside the corresponding caught-fish photo in the personal section.
 *
 * Notes are short, real-fishing-oriented blurbs (curated from general angling
 * knowledge / state DNR-style info). They favor well-established facts; a quick
 * review pass is welcome before treating any single line as gospel.
 */

export type FishCategory =
  | 'walleye'
  | 'bass'
  | 'pike'
  | 'panfish'
  | 'trout'
  | 'salmon'
  | 'sturgeon'
  | 'catfish';

export interface FishSpecies {
  id: string;
  common: string;
  category: FishCategory;
  /** Body color. */
  color: string;
  /** Accent (fins/markings/belly). */
  accent: string;
  /** A short, real fishing note. */
  note: string;
}

export const FISH: FishSpecies[] = [
  // ---- perch family (walleye/sauger) ----
  { id: 'walleye', common: 'Walleye', category: 'walleye', color: '#a8923f', accent: '#e8d9a0',
    note: "Minnesota's state fish — golden, glassy-eyed, and the most prized eating fish up north." },
  { id: 'sauger', common: 'Sauger', category: 'walleye', color: '#9c8a55', accent: '#cdbb86',
    note: "Walleye's smaller, spotty-finned cousin; thrives in big, turbid rivers." },
  { id: 'yellow-perch', common: 'Yellow perch', category: 'panfish', color: '#c8a23a', accent: '#3a5a2a',
    note: 'Golden with dark bars — a winter staple and a favorite walleye snack.' },

  // ---- bass ----
  { id: 'smallmouth-bass', common: 'Smallmouth bass', category: 'bass', color: '#8a6a3a', accent: '#c8a86a',
    note: 'Bronze, rock-loving brawler — pound for pound the hardest-fighting freshwater fish.' },
  { id: 'largemouth-bass', common: 'Largemouth bass', category: 'bass', color: '#5f7a40', accent: '#aec27a',
    note: 'Green ambush predator of warm, weedy water; explodes on a topwater frog.' },
  { id: 'white-bass', common: 'White bass', category: 'bass', color: '#9aa0a8', accent: '#cfd6dd',
    note: 'Silver schooler that blitzes baitfish in big rivers — fast action when they’re on.' },
  { id: 'rock-bass', common: 'Rock bass', category: 'panfish', color: '#6a6a4a', accent: '#c0b87a',
    note: 'Red-eyed, rock-hugging panfish that hits far above its weight.' },

  // ---- pike family ----
  { id: 'northern-pike', common: 'Northern pike', category: 'pike', color: '#5d7a4a', accent: '#cfe0a0',
    note: "Toothy, aggressive 'water wolf' that ambushes from the weed edge." },
  { id: 'muskellunge', common: 'Muskellunge', category: 'pike', color: '#6a7355', accent: '#c8c89a',
    note: "The 'fish of 10,000 casts' — the giant apex predator of the north." },

  // ---- panfish ----
  { id: 'bluegill', common: 'Bluegill', category: 'panfish', color: '#4f7d86', accent: '#e08a3a',
    note: "Scrappy little sunfish — a kid's first catch and superb on the table." },
  { id: 'black-crappie', common: 'Black crappie', category: 'panfish', color: '#6a7d6a', accent: '#cdd6c0',
    note: 'Speckled, schooling panfish; a spring and hard-water favorite.' },

  // ---- trout / char ----
  { id: 'lake-trout', common: 'Lake trout', category: 'trout', color: '#5f7a72', accent: '#c0ccc4',
    note: 'Deep, cold-water char — the signature catch of Lake Superior.' },
  { id: 'brown-trout', common: 'Brown trout', category: 'trout', color: '#9a7a44', accent: '#e0c87a',
    note: 'Buttery-gold and wary; the prize of cold tailwaters and streams.' },
  { id: 'rainbow-trout', common: 'Rainbow trout', category: 'trout', color: '#7a8a8f', accent: '#d77a86',
    note: 'Pink-striped and acrobatic — stocked and wild across both states.' },
  { id: 'brook-trout', common: 'Brook trout', category: 'trout', color: '#5a6a55', accent: '#d88a5a',
    note: 'Native char with worm-track markings, found in the cleanest cold creeks.' },
  { id: 'cutthroat-trout', common: 'Cutthroat trout', category: 'trout', color: '#7a8a6a', accent: '#d0702a',
    note: 'Native trout with orange throat slashes; sea-run and resident forms.' },
  { id: 'bull-trout', common: 'Bull trout', category: 'trout', color: '#5f7a7a', accent: '#e0c89a',
    note: 'Big native char — catch-and-release only in most Washington water.' },
  { id: 'steelhead', common: 'Steelhead', category: 'trout', color: '#8a9298', accent: '#c87a86',
    note: 'Sea-run rainbow — the legendary winter river fish of the Northwest.' },
  { id: 'mountain-whitefish', common: 'Mountain whitefish', category: 'trout', color: '#8a8f95', accent: '#c8ccd0',
    note: 'Sleek, native, and abundant in cold Washington rivers.' },

  // ---- salmon ----
  { id: 'chinook-salmon', common: 'Chinook salmon', category: 'salmon', color: '#5f7a78', accent: '#cfd8d2',
    note: "The 'king' — Washington's biggest and most prized salmon." },
  { id: 'coho-salmon', common: 'Coho salmon', category: 'salmon', color: '#7a8a6a', accent: '#d6b0a0',
    note: "The 'silver' — chrome-bright and a hard, fast fighter in the rivers." },
  { id: 'sockeye-salmon', common: 'Sockeye salmon', category: 'salmon', color: '#9a4a3a', accent: '#e0c060',
    note: 'Turns deep red to spawn; the richest-eating of the salmon.' },
  { id: 'pink-salmon', common: 'Pink salmon', category: 'salmon', color: '#9a7a82', accent: '#d0c0c8',
    note: "The 'humpy' — returns in huge numbers to Puget Sound rivers in odd years." },
  { id: 'kokanee', common: 'Kokanee', category: 'salmon', color: '#5f7a86', accent: '#c85a4a',
    note: 'Landlocked sockeye — a sweet-eating, light-tackle lake favorite.' },

  // ---- big / rough fish ----
  { id: 'lake-sturgeon', common: 'Lake sturgeon', category: 'sturgeon', color: '#5a5550', accent: '#8a8278',
    note: 'Armored living fossil that can top 6 feet and live 100+ years.' },
  { id: 'white-sturgeon', common: 'White sturgeon', category: 'sturgeon', color: '#55524c', accent: '#8a8076',
    note: "North America's largest freshwater fish — Columbia River giants." },
  { id: 'channel-catfish', common: 'Channel catfish', category: 'catfish', color: '#7a7468', accent: '#cfc8b6',
    note: 'Whiskered river bruiser that bites best after dark.' },
  { id: 'flathead-catfish', common: 'Flathead catfish', category: 'catfish', color: '#6a6048', accent: '#bcae84',
    note: 'Big, solitary predator that hunts live prey in deep river holes.' },
  { id: 'burbot', common: 'Burbot', category: 'catfish', color: '#6a6450', accent: '#bcae7a',
    note: "Freshwater cod ('eelpout') — an ugly but excellent ice-fishing catch." },
  { id: 'lingcod', common: 'Lingcod', category: 'bass', color: '#5f6a55', accent: '#b0a060',
    note: 'Toothy Puget Sound bottomfish — fearsome looking, fantastic eating.' },
];

export const FISH_BY_ID: Record<string, FishSpecies> = Object.fromEntries(
  FISH.map((f) => [f.id, f]),
);
