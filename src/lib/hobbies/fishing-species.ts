/**
 * Fish species for the Fishing hobby map (Minnesota + Washington).
 *
 * The single source of truth for fish. Each entry maps to a sprite `category`
 * (the pixel renderer in fishing.ts draws ~8 silhouettes, parameterized by
 * color) so a long species list stays cheap. The SAME sprite is used on the map
 * and beside the corresponding caught-fish photo in the personal section.
 *
 * Each note is one fact, an ID tip or a behaviour, checked against Wikipedia
 * in November 2026 (the muskie's nickname against the Minnesota DNR).
 * species-facts.test.ts holds them to the site's copy rules
 * (.github/instructions/site-copy.instructions.md).
 */

export type FishCategory =
  | 'walleye'
  | 'bass'
  | 'pike'
  | 'panfish'
  | 'trout'
  | 'salmon'
  | 'sturgeon'
  | 'catfish'
  | 'minnow';

export interface FishSpecies {
  id: string;
  common: string;
  category: FishCategory;
  /** Body color. */
  color: string;
  /** Accent (fins/markings/belly). */
  accent: string;
  /** One fact, shown when the fish is tapped on the map. */
  note: string;
}

export const FISH: FishSpecies[] = [
  // ---- perch family (walleye/sauger) ----
  { id: 'walleye', common: 'Walleye', category: 'walleye', color: '#a8923f', accent: '#e8d9a0',
    note: "Minnesota's state fish, with big glassy eyes that let it feed in low light." },
  { id: 'sauger', common: 'Sauger', category: 'walleye', color: '#9c8a55', accent: '#cdbb86',
    note: "Spots on its dorsal fin and no white patch on the bottom of its tail tell it from a walleye." },
  { id: 'yellow-perch', common: 'Yellow perch', category: 'panfish', color: '#c8a23a', accent: '#3a5a2a',
    note: "Six to eight dark bars run down its yellow sides, and walleye and largemouth bass rely on it for food." },

  // ---- bass ----
  { id: 'smallmouth-bass', common: 'Smallmouth bass', category: 'bass', color: '#8a6a3a', accent: '#c8a86a',
    note: "Old fishing books called it pound for pound the gamest fish that swims, and it does fight hard for its size." },
  { id: 'largemouth-bass', common: 'Largemouth bass', category: 'bass', color: '#5f7a40', accent: '#aec27a',
    note: "Its upper jaw reaches back past the eye, the easiest way to tell it from a smallmouth." },
  { id: 'white-bass', common: 'White bass', category: 'bass', color: '#9aa0a8', accent: '#cfd6dd',
    note: "Thin dark stripes run along its silvery sides, and in spring it heads up tributary streams to spawn." },
  { id: 'rock-bass', common: 'Rock bass', category: 'panfish', color: '#6a6a4a', accent: '#c0b87a',
    note: "Nicknamed goggle-eye for its red eyes, it often hangs around rocky shorelines and under docks." },

  // ---- pike family ----
  { id: 'northern-pike', common: 'Northern pike', category: 'pike', color: '#5d7a4a', accent: '#cfe0a0',
    note: "It has pale spots on a dark body, the opposite of a muskie's dark marks on a light body." },
  { id: 'muskellunge', common: 'Muskellunge', category: 'pike', color: '#6a7355', accent: '#c8c89a',
    note: "Called the fish of 10,000 casts, since you can fish for one all day and never see it." },

  // ---- panfish ----
  { id: 'bluegill', common: 'Bluegill', category: 'panfish', color: '#4f7d86', accent: '#e08a3a',
    note: "Males scoop out nests side by side in the shallows, as many as 50 together, and chase off anything that comes near." },
  { id: 'black-crappie', common: 'Black crappie', category: 'panfish', color: '#6a7d6a', accent: '#cdd6c0',
    note: "Count the spines on its dorsal fin: seven or eight means a black crappie, and five or six a white one." },

  // ---- trout / char ----
  { id: 'lake-trout', common: 'Lake trout', category: 'trout', color: '#5f7a72', accent: '#c0ccc4',
    note: "The biggest of the char, it has pale spots all over and a deeply forked tail." },
  { id: 'brown-trout', common: 'Brown trout', category: 'trout', color: '#9a7a44', accent: '#e0c87a',
    note: "Its black and red spots, often ringed with pale halos, stop short of the tail." },
  { id: 'rainbow-trout', common: 'Rainbow trout', category: 'trout', color: '#7a8a8f', accent: '#d77a86',
    note: "A broad reddish stripe runs from its gills to its tail, brightest on breeding males." },
  { id: 'brook-trout', common: 'Brook trout', category: 'trout', color: '#5a6a55', accent: '#d88a5a',
    note: "Wormlike markings on its back and orange fins edged in white and black make it easy to pick out." },
  { id: 'cutthroat-trout', common: 'Cutthroat trout', category: 'trout', color: '#7a8a6a', accent: '#d0702a',
    note: "Check under its lower jaw for the red slash that gives the cutthroat its name." },
  { id: 'bull-trout', common: 'Bull trout', category: 'trout', color: '#5f7a7a', accent: '#e0c89a',
    note: "Unlike a brook trout, it has no spots on its dorsal fin, and it's listed as threatened, so let it go." },
  { id: 'steelhead', common: 'Steelhead', category: 'trout', color: '#8a9298', accent: '#c87a86',
    note: "A rainbow trout that heads out to the ocean, then comes back up the river to spawn." },
  { id: 'mountain-whitefish', common: 'Mountain whitefish', category: 'trout', color: '#8a8f95', accent: '#c8ccd0',
    note: "Look for a small mouth tucked under the snout, and in fall big schools of them gather to spawn." },

  // ---- salmon ----
  { id: 'chinook-salmon', common: 'Chinook salmon', category: 'salmon', color: '#5f7a78', accent: '#cfd8d2',
    note: "Also called king salmon, it's the biggest Pacific salmon, with a black gum line that sets it apart." },
  { id: 'coho-salmon', common: 'Coho salmon', category: 'salmon', color: '#7a8a6a', accent: '#d6b0a0',
    note: "Known as silver salmon, it has bright silver sides at sea and spots only on the upper half of its tail." },
  { id: 'chum-salmon', common: 'Chum salmon', category: 'salmon', color: '#7e8a82', accent: '#9c6f86',
    note: "Near spawning, purple blotchy streaks show up toward the tail, and males grow a hooked snout and big teeth." },
  { id: 'sockeye-salmon', common: 'Sockeye salmon', category: 'salmon', color: '#9a4a3a', accent: '#e0c060',
    note: "Sockeye turn bright red with green heads to spawn, and their young spend a year or two in a lake before going to sea." },
  { id: 'pink-salmon', common: 'Pink salmon', category: 'salmon', color: '#9a7a82', accent: '#d0c0c8',
    note: "In Puget Sound rivers they run in odd years, since every pink salmon lives exactly two years." },
  { id: 'kokanee', common: 'Kokanee', category: 'salmon', color: '#5f7a86', accent: '#c85a4a',
    note: "A sockeye that never goes to sea, it spends its whole life in fresh water and still turns red to spawn." },

  // ---- big / rough fish ----
  { id: 'lake-sturgeon', common: 'Lake sturgeon', category: 'sturgeon', color: '#5a5550', accent: '#8a8278',
    note: "Lake sturgeon can grow past 7 feet, and some are thought to live 150 years." },
  { id: 'white-sturgeon', common: 'White sturgeon', category: 'sturgeon', color: '#55524c', accent: '#8a8076',
    note: "It spends most of its life in the estuaries of big rivers, then swims up into fresh water to spawn." },
  { id: 'channel-catfish', common: 'Channel catfish', category: 'catfish', color: '#7a7468', accent: '#cfc8b6',
    note: "Taste buds cover its whole body, which helps it find food in dark or muddy water." },
  { id: 'flathead-catfish', common: 'Flathead catfish', category: 'catfish', color: '#6a6048', accent: '#bcae84',
    note: "A broad flat head and a lower jaw that juts past the upper one tell it apart from other catfish." },
  { id: 'burbot', common: 'Burbot', category: 'catfish', color: '#6a6450', accent: '#bcae7a',
    note: "The only freshwater member of the cod order, it spawns in mid to late winter, often under the ice." },
  { id: 'northern-pikeminnow', common: 'Northern pikeminnow', category: 'minnow', color: '#8a8458', accent: '#d8954a',
    note: "Young salmon make up a big part of its diet in the Columbia and Snake rivers, so anglers there get paid per fish." },
  { id: 'lingcod', common: 'Lingcod', category: 'bass', color: '#5f6a55', accent: '#b0a060',
    note: "About one in five lingcod has blue-green flesh, and nobody's quite sure why." },
];

export const FISH_BY_ID: Record<string, FishSpecies> = Object.fromEntries(
  FISH.map((f) => [f.id, f]),
);
