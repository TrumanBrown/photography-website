/**
 * Pacific Northwest herps for the "night drive" road-cruising game.
 *
 * Salamander-forward on purpose: the whole conceit is finding amphibians in the
 * dark by their eyeshine, the way you actually do on a wet PNW night. The roster
 * leads with the real salamanders the author has logged on iNaturalist (Ensatina,
 * Western Red-backed, Dunn's, Northwestern, Rough-skinned Newt, Pacific Giant),
 * then rounds out with the frogs, toads, and snakes you'd meet cruising a rainy
 * back road west of the Cascades.
 *
 * Facts are curated from standard references (Amphibians & Reptiles of the
 * Pacific Northwest / Corkran & Thoms, California Herps, and Wikipedia); a
 * representative sample was grounded with live research. They favor
 * well-established, interesting tidbits over obscure claims, but a review pass by
 * someone who knows these animals is recommended before treating any of it as
 * authoritative — it's a learning game, not a field guide. The doubtful ones were
 * checked again in October 2026, and species-facts.test.ts holds every fact to
 * the site's copy rules (.github/instructions/site-copy.instructions.md).
 *
 * Each species maps to a CATEGORY, which is what the pixel sprite renderer in
 * herping.ts draws (parameterized by color/size). `rarity` weights how often a
 * species turns up on the road; `eyeshine` is the tapetal glint color that gives
 * it away in the headlight beam before it's fully lit.
 */

export type HerpCategory =
  | "salamander"
  | "newt"
  | "frog"
  | "toad"
  | "snake"
  | "lizard";

export type Rarity = "common" | "uncommon" | "rare";

export interface HerpSpecies {
  id: string;
  common: string;
  scientific: string;
  category: HerpCategory;
  /** Primary sprite color (body). */
  color: string;
  /** Secondary sprite color (stripe, belly, markings). */
  accent: string;
  /** Relative on-screen size, ~0.7 (tiny) to ~1.4 (Pacific giant). */
  size: number;
  rarity: Rarity;
  /** Tapetal eyeshine color — the glint that shows in the beam before the reveal. */
  eyeshine: string;
  /** A couple of real facts; one is picked at random on each reveal. */
  facts: string[];
  /** True for introduced/invasive species (badged in the reveal card). */
  nonNative?: boolean;
  /** Optional real photo (CC-licensed). Shown in the reveal card when present. */
  photo?: string;
  /** Attribution line for `photo`, e.g. "© Name / iNaturalist (CC BY-NC)". */
  photoCredit?: string;
}

export const SPECIES: HerpSpecies[] = [
  // ---- salamanders (the stars) ----
  {
    id: "ensatina",
    common: "Ensatina",
    scientific: "Ensatina eschscholtzii",
    category: "salamander",
    color: "#a8622f",
    accent: "#e8b672",
    size: 0.92,
    rarity: "common",
    eyeshine: "#e6eef0",
    facts: [
      "Lungless, it breathes entirely through its moist skin and mouth, so it can only be out on wet nights.",
      "Threatened, it rears up stiff-legged and waves its tail, which can drop off and wriggle to distract a predator.",
      "Look for a tail pinched in at the base, a quick way to tell an Ensatina from other woodland salamanders.",
    ],
  },
  {
    id: "western-red-backed-salamander",
    common: "Western Red-backed Salamander",
    scientific: "Plethodon vehiculum",
    category: "salamander",
    color: "#3a3330",
    accent: "#b06a3a",
    size: 0.8,
    rarity: "common",
    eyeshine: "#dfe8ea",
    facts: [
      "A lungless salamander that lives entirely on land, laying its eggs there and skipping the water-dwelling larval stage.",
      "The reddish-to-tan stripe down its back varies a lot, and some have almost no stripe at all.",
      "You find them by rolling logs and bark in damp forest; always roll it back the way it was.",
    ],
  },
  {
    id: "dunns-salamander",
    common: "Dunn's Salamander",
    scientific: "Plethodon dunni",
    category: "salamander",
    color: "#3f4632",
    accent: "#c7c15a",
    size: 0.82,
    rarity: "uncommon",
    eyeshine: "#dfe8ea",
    facts: [
      "It sticks to wet, mossy rocks in the splash zone of shaded streams and seeps.",
      "Its greenish-yellow back stripe stops short of the tail tip, unlike the Western Red-backed it lives beside.",
      "Lungless like its Plethodon cousins, it never strays far from moisture.",
    ],
  },
  {
    id: "northwestern-salamander",
    common: "Northwestern Salamander",
    scientific: "Ambystoma gracile",
    category: "salamander",
    color: "#4a4038",
    accent: "#6f6258",
    size: 1.05,
    rarity: "uncommon",
    eyeshine: "#e6d8b0",
    facts: [
      "A stocky mole salamander with poison glands packed into swollen ridges behind its eyes and along its tail.",
      "Some never fully grow up: gilled, aquatic adults called neotenes breed while still looking like giant larvae.",
      "Squeeze one and it oozes a sticky white toxin; handle gently and wash up, then let it go.",
    ],
  },
  {
    id: "rough-skinned-newt",
    common: "Rough-skinned Newt",
    scientific: "Taricha granulosa",
    category: "newt",
    color: "#5a3a22",
    accent: "#e8892a",
    size: 0.95,
    rarity: "common",
    eyeshine: "#f0d68a",
    facts: [
      "Its skin carries tetrodotoxin, the same poison as a pufferfish, which makes it one of the most toxic animals in the Northwest.",
      'Alarmed, it arches into the "unken reflex," flashing its bright orange belly as a warning.',
      "Common garter snakes have evolved resistance to its toxin, in an arms race between predator and prey.",
    ],
  },
  {
    id: "pacific-giant-salamander",
    common: "Pacific Giant Salamander",
    scientific: "Dicamptodon tenebrosus",
    category: "salamander",
    color: "#524638",
    accent: "#8a7a5a",
    size: 1.4,
    rarity: "rare",
    eyeshine: "#e6e0c8",
    facts: [
      "Big adults push a foot long, making it one of the largest land salamanders on Earth.",
      "It can bark when alarmed, and it's big enough to eat mice, snakes, and other salamanders.",
      "Larvae live for years in cold, clear streams; some stay aquatic and breed without ever leaving the water.",
    ],
  },
  {
    id: "long-toed-salamander",
    common: "Long-toed Salamander",
    scientific: "Ambystoma macrodactylum",
    category: "salamander",
    color: "#2f2f2f",
    accent: "#c9d24a",
    size: 0.85,
    rarity: "uncommon",
    eyeshine: "#dfe8ea",
    facts: [
      "Named for its extra-long fourth toe on each hind foot.",
      "One of the first amphibians to breed each year, it migrates to ponds while snow still rings the edges.",
      "A yellow-to-green stripe runs from head to tail down the dark back of this mole salamander.",
    ],
  },
  {
    id: "coastal-giant-salamander",
    common: "Cope's Giant Salamander",
    scientific: "Dicamptodon copei",
    category: "salamander",
    color: "#4a4438",
    accent: "#7a6f52",
    size: 1.15,
    rarity: "rare",
    eyeshine: "#e6e0c8",
    facts: [
      "It rarely transforms, staying a gilled, aquatic 'larva' its whole life and breeding in that form.",
      "Mottled brown with a paddle-like tail, it lives in cold streams in the Olympics and Cascades.",
    ],
  },
  {
    id: "cascade-torrent-salamander",
    common: "Cascade Torrent Salamander",
    scientific: "Rhyacotriton cascadae",
    category: "salamander",
    color: "#5a5236",
    accent: "#e8c34a",
    size: 0.7,
    rarity: "rare",
    eyeshine: "#dfe8ea",
    facts: [
      "This tiny salamander dries out so fast that it never leaves the spray of ice-cold, splashing seeps.",
      "Bright yellow below with big eyes; males have squared-off glands behind the vent.",
      "It's so sensitive to warmth and silt that finding one is a sign of a clean, undisturbed stream.",
    ],
  },
  {
    id: "van-dykes-salamander",
    common: "Van Dyke's Salamander",
    scientific: "Plethodon vandykei",
    category: "salamander",
    color: "#3a3a30",
    accent: "#e0c24a",
    size: 0.8,
    rarity: "rare",
    eyeshine: "#dfe8ea",
    facts: [
      "Found nowhere but Washington, usually near seeps, streambanks, and mossy talus.",
      "Its yellow-to-rose dorsal band and pale throat set it apart from the red-backed salamanders it lives among.",
    ],
  },
  {
    id: "clouded-salamander",
    common: "Clouded Salamander",
    scientific: "Aneides ferreus",
    category: "salamander",
    color: "#4a4038",
    accent: "#9a9a86",
    size: 0.85,
    rarity: "uncommon",
    eyeshine: "#dfe8ea",
    facts: [
      "Square toes and a grasping tail make it a good climber on rotting logs and standing snags.",
      "Its greenish, cloud-like mottling breaks up its outline against lichen and bark.",
      "It nests inside decaying Douglas-fir logs, where a female may guard her eggs.",
    ],
  },
  {
    id: "western-tiger-salamander",
    common: "Western Tiger Salamander",
    scientific: "Ambystoma mavortium",
    category: "salamander",
    color: "#2a2620",
    accent: "#e8b02a",
    size: 1.2,
    rarity: "uncommon",
    eyeshine: "#e6d8b0",
    facts: [
      "The big, bold-blotched salamander of dry eastern Washington, often found crossing roads on wet nights.",
      "Larvae in fishless ponds sometimes become cannibal 'morphs' with wider heads and bigger teeth.",
      "One of North America's largest land salamanders, it can reach 13 or 14 inches long.",
    ],
  },

  // ---- frogs & toads ----
  {
    id: "pacific-chorus-frog",
    common: "Pacific Chorus Frog",
    scientific: "Pseudacris regilla",
    category: "frog",
    color: "#5a8a3a",
    accent: "#2f2f2f",
    size: 0.7,
    rarity: "common",
    eyeshine: "#cde86a",
    facts: [
      "The classic 'ribbit' of Hollywood soundtracks is this tiny frog, and most other frogs don't sound like that at all.",
      "It can turn from green to brown, or back, to match its surroundings, though a full change takes weeks.",
      "Sticky toe pads let this thumb-sized treefrog climb reeds and leaves.",
    ],
  },
  {
    id: "northern-red-legged-frog",
    common: "Northern Red-legged Frog",
    scientific: "Rana aurora",
    category: "frog",
    color: "#8a5a3a",
    accent: "#c4433a",
    size: 1.0,
    rarity: "uncommon",
    eyeshine: "#d8c06a",
    facts: [
      "A translucent red wash under the hind legs gives it its name.",
      "Startle one and it bolts for the water in long, zigzag leaps.",
      "It has declined where introduced bullfrogs move in and eat the young.",
    ],
  },
  {
    id: "western-toad",
    common: "Western Toad",
    scientific: "Anaxyrus boreas",
    category: "toad",
    color: "#6a6a4a",
    accent: "#c8c2a0",
    size: 1.05,
    rarity: "uncommon",
    eyeshine: "#e0c878",
    facts: [
      "It usually walks instead of hopping, plodding along on stubby legs.",
      "The pale stripe down its warty back is a giveaway, along with big parotoid glands behind the eyes.",
      "The big glands behind its eyes ooze a bitter toxin, so it's safe to admire but best not handled.",
    ],
  },
  {
    id: "american-bullfrog",
    common: "American Bullfrog",
    scientific: "Lithobates catesbeianus",
    category: "frog",
    color: "#4a6a3a",
    accent: "#d8d08a",
    size: 1.3,
    rarity: "common",
    nonNative: true,
    eyeshine: "#e8d060",
    facts: [
      "Introduced to the Northwest, bullfrogs eat native frogs, salamanders, and even snakes and ducklings.",
      "Its deep 'jug-o-rum' call carries across a pond on summer nights.",
      "The biggest frog in North America; a large female can top a pound.",
    ],
  },

  // ---- snakes & lizards ----
  {
    id: "northwestern-garter-snake",
    common: "Northwestern Garter Snake",
    scientific: "Thamnophis ordinoides",
    category: "snake",
    color: "#3a4a2f",
    accent: "#c8b24a",
    size: 1.0,
    rarity: "common",
    eyeshine: "#c99a3a",
    facts: [
      "The stripe down its back can be yellow, red, orange, blue, or barely there.",
      "A small, harmless snake that hunts slugs and earthworms in gardens and forest edges.",
      "The most terrestrial of our garter snakes, it rarely takes to the water.",
    ],
  },
  {
    id: "common-garter-snake",
    common: "Common Garter Snake",
    scientific: "Thamnophis sirtalis",
    category: "snake",
    color: "#2f3a2a",
    accent: "#d8c84a",
    size: 1.1,
    rarity: "common",
    eyeshine: "#c99a3a",
    facts: [
      "It can eat toxic rough-skinned newts, the result of an evolutionary arms race between the two over the newt's poison.",
      "Its mild saliva helps subdue prey but is harmless to people; it may musk you if grabbed.",
      "Three pale stripes on a dark body, often with red flecks between them.",
    ],
  },
  {
    id: "northern-alligator-lizard",
    common: "Northern Alligator Lizard",
    scientific: "Elgaria coerulea",
    category: "lizard",
    color: "#6a5a3a",
    accent: "#3a3128",
    size: 0.95,
    rarity: "uncommon",
    eyeshine: "#b8862a",
    facts: [
      "It gives birth to live young instead of laying eggs, an adaptation to cool northern summers.",
      "Grab it and the tail snaps off, thrashing on its own while the lizard escapes; it regrows a stubbier one.",
      "For its size it bites surprisingly hard, and it hangs on.",
    ],
  },
  {
    id: "rubber-boa",
    common: "Rubber Boa",
    scientific: "Charina bottae",
    category: "snake",
    color: "#7a6a4a",
    accent: "#9a8a66",
    size: 1.15,
    rarity: "rare",
    eyeshine: "#c99a3a",
    facts: [
      "One of the gentlest snakes around, it almost never bites and feels loose and rubbery in the hand.",
      "Its blunt tail mimics its head, a decoy it raises to take blows while raiding a nest of baby mice.",
      "A cold-tolerant boa, it stays active on cool, damp nights that send other snakes to cover.",
    ],
  },
];
