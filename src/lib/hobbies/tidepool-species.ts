/**
 * Common Pacific Northwest tide-pool species for the "flip a rock" game.
 *
 * Facts are curated from standard references (Wikipedia and field guides such
 * as Between Pacific Tides / Walla Walla University's Rosario key); a
 * representative sample was grounded with live web research. They favor
 * well-established, interesting tidbits over obscure claims, but a quick review
 * pass by someone who knows these animals is recommended before treating any of
 * it as authoritative — it's a learning game, not a textbook. The doubtful ones
 * were checked again in October 2026, and species-facts.test.ts holds every
 * fact to the site's copy rules (.github/instructions/site-copy.instructions.md).
 *
 * Each species maps to a CATEGORY, which is what the pixel sprite renderer in
 * tidepool.ts draws (parameterized by color/size). That keeps the art bounded
 * while supporting a long, growable species list. `rarity` weights how often a
 * species turns up under a flipped rock.
 */

export type TidepoolCategory =
  | 'crab'
  | 'hermit'
  | 'star'
  | 'anemone'
  | 'nudibranch'
  | 'chiton'
  | 'snail'
  | 'limpet'
  | 'urchin'
  | 'barnacle'
  | 'mussel'
  | 'sculpin'
  | 'eel'
  | 'shrimp'
  | 'cucumber'
  | 'octopus';

export type Rarity = 'common' | 'uncommon' | 'rare';

export interface TidepoolSpecies {
  id: string;
  common: string;
  scientific: string;
  category: TidepoolCategory;
  /** Primary sprite color. */
  color: string;
  /** Secondary sprite color (accents, markings). */
  accent: string;
  /** Relative on-screen size, ~0.7 (tiny) to ~1.3 (big). */
  size: number;
  /** Arm count for the `star` category. */
  arms?: number;
  rarity: Rarity;
  /** A couple of real facts; one is picked at random on each reveal. */
  facts: string[];
  /** Optional real photo (CC-licensed). Shown in the reveal card when present; otherwise the pixel sprite is used. */
  photo?: string;
  /** Attribution line for `photo`, e.g. "© Name / iNaturalist (CC BY-NC)". */
  photoCredit?: string;
}

export const SPECIES: TidepoolSpecies[] = [
  // ---- crabs ----
  {
    id: 'purple-shore-crab', common: 'Purple shore crab', scientific: 'Hemigrapsus nudus',
    category: 'crab', color: '#6b4a7a', accent: '#e8dcc8', size: 0.95, rarity: 'common',
    facts: [
      'Check the claws: white tips speckled with purple-red dots set it apart from other shore crabs.',
      'A slow mover, it can sit out of water for hours while the tide is out.',
    ],
  },
  {
    id: 'green-shore-crab', common: 'Green shore crab', scientific: 'Hemigrapsus oregonensis',
    category: 'crab', color: '#6f7d4a', accent: '#c9b079', size: 0.85, rarity: 'common',
    facts: [
      'It can be yellow or grey as well as green, so check for hairy legs and claws with no purple spots.',
      'At home on mudflats, it digs burrows and copes with brackish water far less salty than most crabs can stand.',
    ],
  },
  {
    id: 'kelp-crab', common: 'Northern kelp crab', scientific: 'Pugettia producta',
    category: 'crab', color: '#5a6b3a', accent: '#c46a2a', size: 1.05, rarity: 'uncommon',
    facts: [
      'This spider crab climbs bull kelp on long hooked legs, eating algae in summer and hunting mussels in winter.',
      "Its pinch is surprisingly strong, and it's quick to use it.",
    ],
  },
  {
    id: 'red-rock-crab', common: 'Red rock crab', scientific: 'Cancer productus',
    category: 'crab', color: '#9c3b2a', accent: '#191919', size: 1.25, rarity: 'uncommon',
    facts: [
      'Adults are brick-red with black-tipped claws, but juveniles can be striped or zebra-patterned for camouflage.',
      "Nicknamed the 'Pearl of the Pacific Northwest,' it's a favorite meal of the giant Pacific octopus.",
    ],
  },
  {
    id: 'porcelain-crab', common: 'Flat porcelain crab', scientific: 'Petrolisthes cinctipes',
    category: 'crab', color: '#4a5566', accent: '#cfd6dd', size: 0.7, rarity: 'common',
    facts: [
      'It filter-feeds instead of hunting, sweeping plankton from the water with feathery mouthparts.',
      'Grabbed by a predator, it drops a claw to get away, then regrows it over several molts.',
    ],
  },
  // ---- hermit crabs ----
  {
    id: 'hairy-hermit-crab', common: 'Hairy hermit crab', scientific: 'Pagurus hirsutiusculus',
    category: 'hermit', color: '#5c5240', accent: '#6aa0c0', size: 0.8, rarity: 'common',
    facts: [
      'Its legs wear white and blue bands, and its whole body looks faintly hairy up close.',
      'Unlike most hermit crabs, it will leave its borrowed shell behind and run when threatened.',
    ],
  },
  {
    id: 'grainyhand-hermit-crab', common: 'Grainyhand hermit crab', scientific: 'Pagurus granosimanus',
    category: 'hermit', color: '#5a6a78', accent: '#e08a2a', size: 0.8, rarity: 'common',
    facts: [
      'Spot it by the blue-grey grains dotting its claws and its bright orange antennae.',
      'It borrows empty snail shells, trading up to roomier ones as it grows.',
    ],
  },
  // ---- sea stars ----
  {
    id: 'ochre-star', common: 'Ochre sea star', scientific: 'Pisaster ochraceus',
    category: 'star', color: '#6a4a86', accent: '#e0a040', size: 1.15, arms: 5, rarity: 'common',
    facts: [
      'A keystone species: in experiments that removed it, mussels took over and crowded out most other life on the rocks.',
      'It eats about 80 mussels a year, pushing its stomach out through its mouth and into each shell.',
    ],
  },
  {
    id: 'sunflower-star', common: 'Sunflower star', scientific: 'Pycnopodia helianthoides',
    category: 'star', color: '#c85a2a', accent: '#f0c040', size: 1.3, arms: 18, rarity: 'rare',
    facts: [
      'One of the largest sea stars in the world, with up to 24 arms, a 3-foot span, and about 15,000 tube feet.',
      "Sea star wasting disease has killed over 90% of them since 2013, and it's now listed as critically endangered.",
    ],
  },
  {
    id: 'six-rayed-star', common: 'Six-rayed star', scientific: 'Leptasterias hexactis',
    category: 'star', color: '#4a5d3a', accent: '#8a9a6a', size: 0.8, arms: 6, rarity: 'common',
    facts: [
      'Count the arms: this small star has six, where most sea stars have five.',
      'Most sea stars scatter their eggs into the sea, but this mother keeps hers under her body until the young can fend for themselves.',
    ],
  },
  {
    id: 'blood-star', common: 'Blood star', scientific: 'Henricia leviuscula',
    category: 'star', color: '#c0392b', accent: '#e8857a', size: 0.9, arms: 5, rarity: 'uncommon',
    facts: [
      'Slender bright red-orange arms make it look delicate next to the stout ochre star.',
      'It grazes sponges and sips up tiny particles instead of prying open mussels.',
    ],
  },
  {
    id: 'leather-star', common: 'Leather star', scientific: 'Dermasterias imbricata',
    category: 'star', color: '#6a6a8a', accent: '#b04a4a', size: 1.0, arms: 5, rarity: 'uncommon',
    facts: [
      'Smooth and slippery to the touch, it gives off a faint smell of garlic or sulfur.',
      'It hunts sea anemones, and the swimming anemone escapes one by letting go of the rock and swimming off.',
    ],
  },
  // ---- anemones ----
  {
    id: 'giant-green-anemone', common: 'Giant green anemone', scientific: 'Anthopleura xanthogrammica',
    category: 'anemone', color: '#2f8f4a', accent: '#6fd08a', size: 1.15, rarity: 'common',
    facts: [
      'Its green comes from its own pigment plus algae living in its tissues, so ones in the shade are paler.',
      'These anemones are thought to live for decades, and possibly more than a century.',
    ],
  },
  {
    id: 'aggregating-anemone', common: 'Aggregating anemone', scientific: 'Anthopleura elegantissima',
    category: 'anemone', color: '#7aa06a', accent: '#d06a8a', size: 0.85, rarity: 'common',
    facts: [
      'It clones itself by splitting in two, building colonies of identical twins that carpet the rock.',
      "Rival clones wage slow 'wars,' swatting non-relatives with special stinging tentacles along a bare no-man's-land.",
    ],
  },
  {
    id: 'painted-anemone', common: 'Painted anemone', scientific: 'Urticina crassicornis',
    category: 'anemone', color: '#b0432f', accent: '#4a9a5a', size: 1.05, rarity: 'uncommon',
    facts: [
      'Also called the Christmas anemone for its bold bands of red and green.',
      'Unlike its algae-fed cousins it relies on hunting, catching and swallowing small fish and crabs.',
    ],
  },
  // ---- nudibranchs ----
  {
    id: 'opalescent-nudibranch', common: 'Opalescent nudibranch', scientific: 'Hermissenda crassicornis',
    category: 'nudibranch', color: '#e0853a', accent: '#3a7bd5', size: 0.8, rarity: 'uncommon',
    facts: [
      'Look for a translucent body with electric-blue lines and orange-tipped frills called cerata.',
      'It eats stinging hydroids and recycles their sting cells into its own frills for defense.',
    ],
  },
  {
    id: 'sea-lemon', common: 'Sea lemon', scientific: 'Doris montereyensis',
    category: 'nudibranch', color: '#e8c33a', accent: '#6a5a2a', size: 0.85, rarity: 'uncommon',
    facts: [
      'A bumpy yellow sea slug that really does look like a lemon stuck to the rock.',
      'It breathes through a feathery flower of gills on its back and grazes on sponges.',
    ],
  },
  {
    id: 'clown-nudibranch', common: 'Clown nudibranch', scientific: 'Triopha catalinae',
    category: 'nudibranch', color: '#ece6dc', accent: '#e8731f', size: 0.8, rarity: 'rare',
    facts: [
      'A white body with bright orange tips on its frills and head makes it easy to spot.',
      "Like all nudibranchs it's a hermaphrodite: every individual is both male and female.",
    ],
  },
  {
    id: 'leopard-dorid', common: 'Leopard dorid', scientific: 'Diaulula sandiegensis',
    category: 'nudibranch', color: '#d8cdbb', accent: '#3a3a3a', size: 0.85, rarity: 'uncommon',
    facts: [
      'Pale with dark leopard rings, this sea slug grazes on sponges.',
      "'Nudibranch' means 'naked gills,' after the feathery tuft on its back that it breathes through.",
    ],
  },
  // ---- chitons ----
  {
    id: 'gumboot-chiton', common: 'Gumboot chiton', scientific: 'Cryptochiton stelleri',
    category: 'chiton', color: '#8a3a2a', accent: '#5a241a', size: 1.2, rarity: 'uncommon',
    facts: [
      "The world's largest chiton grows up to a foot long and is nicknamed the 'wandering meatloaf' for its leathery red-brown back.",
      'Its teeth are capped with magnetite, an iron mineral, which makes them some of the hardest material any animal builds.',
    ],
  },
  {
    id: 'black-katy-chiton', common: 'Black katy chiton', scientific: 'Katharina tunicata',
    category: 'chiton', color: '#26262a', accent: '#8a8a8a', size: 0.95, rarity: 'common',
    facts: [
      'A shiny black leathery girdle nearly swallows its eight white shell plates.',
      'It scrapes algae off rock with a tongue (radula) hardened with iron.',
    ],
  },
  {
    id: 'lined-chiton', common: 'Lined chiton', scientific: 'Tonicella lineata',
    category: 'chiton', color: '#c0563a', accent: '#3a5a8a', size: 0.8, rarity: 'uncommon',
    facts: [
      'One of the prettiest chitons, painted with zigzag blue, pink, and red lines.',
      'A chiton wears eight overlapping plates that let it curl into a ball if pried loose.',
    ],
  },
  // ---- snails ----
  {
    id: 'black-turban-snail', common: 'Black turban snail', scientific: 'Tegula funebralis',
    category: 'snail', color: '#3a3036', accent: '#cfa86a', size: 0.85, rarity: 'common',
    facts: [
      'Older shells are often worn pearly-white at the tip, rubbed down by years on the rocks.',
      'When a sea star looms it can "gallop" away surprisingly fast for a snail.',
    ],
  },
  {
    id: 'frilled-dogwinkle', common: 'Frilled dogwinkle', scientific: 'Nucella lamellosa',
    category: 'snail', color: '#c8b48a', accent: '#6a5238', size: 0.9, rarity: 'common',
    facts: [
      'A predatory snail that drills neat round holes through barnacle and mussel shells to eat the animal inside.',
      'Its shell is frilly in calm water but smooth and stout where the surf pounds.',
    ],
  },
  {
    id: 'checkered-periwinkle', common: 'Checkered periwinkle', scientific: 'Littorina scutulata',
    category: 'snail', color: '#4a3a2a', accent: '#c8b890', size: 0.65, rarity: 'common',
    facts: [
      'A tiny splash-zone snail that survives long stretches high and dry above the waves.',
      'It seals its shell with a trapdoor (operculum) to lock in moisture until the tide returns.',
    ],
  },
  {
    id: 'moon-snail', common: 'Lewis moon snail', scientific: 'Euspira lewisii',
    category: 'snail', color: '#c8b48a', accent: '#8a7050', size: 1.2, rarity: 'uncommon',
    facts: [
      'A huge sandy-flat snail with a foot so large it can barely cram back into its own shell.',
      "It drills tidy beveled holes in clams; its sand-and-mucus egg case forms a rubbery 'sand collar' on the beach.",
    ],
  },
  // ---- limpets ----
  {
    id: 'ribbed-limpet', common: 'Ribbed limpet', scientific: 'Lottia digitalis',
    category: 'limpet', color: '#8a7a5a', accent: '#5a4a32', size: 0.7, rarity: 'common',
    facts: [
      'A little volcano-shaped shell that clamps down like a vise when waves hit.',
      "Many have a 'home scar,' a spot they grind to fit their shell and return to after each grazing trip.",
    ],
  },
  {
    id: 'plate-limpet', common: 'Plate limpet', scientific: 'Lottia scutum',
    category: 'limpet', color: '#9a8a6a', accent: '#4a5a3a', size: 0.75, rarity: 'common',
    facts: [
      'A low, flat limpet that mows algae with an extremely tough tongue.',
      'Limpet teeth are reinforced with goethite fibers and rank among the strongest natural materials ever tested.',
    ],
  },
  // ---- urchins ----
  {
    id: 'purple-sea-urchin', common: 'Purple sea urchin', scientific: 'Strongylocentrotus purpuratus',
    category: 'urchin', color: '#6a4a86', accent: '#4a2a66', size: 0.95, rarity: 'common',
    facts: [
      "It grinds cup-shaped pits into solid rock with the five teeth of its jaw, called Aristotle's lantern.",
      "When the sea stars that eat them vanish, urchins multiply and mow kelp down into bare 'urchin barrens.'",
    ],
  },
  {
    id: 'green-sea-urchin', common: 'Green sea urchin', scientific: 'Strongylocentrotus droebachiensis',
    category: 'urchin', color: '#6a8a4a', accent: '#3a5a2a', size: 0.9, rarity: 'uncommon',
    facts: [
      'Between its spines hide tube feet and tiny pincers it uses to walk, grip, and keep itself clean.',
      'It scrapes algae and kelp and can live for decades in cold northern pools.',
    ],
  },
  {
    id: 'red-sea-urchin', common: 'Red sea urchin', scientific: 'Mesocentrotus franciscanus',
    category: 'urchin', color: '#9c2f2a', accent: '#5a1a16', size: 1.1, rarity: 'rare',
    facts: [
      'The biggest urchin on the coast, with long spines and a deep red color.',
      'Red urchins are among the longest-lived animals known, and some are estimated to be over 100 years old.',
    ],
  },
  // ---- barnacles ----
  {
    id: 'acorn-barnacle', common: 'Acorn barnacle', scientific: 'Balanus glandula',
    category: 'barnacle', color: '#d8d2c4', accent: '#8a8276', size: 0.6, rarity: 'common',
    facts: [
      'Cemented head-down to the rock, it kicks feathery legs out of its shell to comb plankton from the water.',
      'Barnacles are crustaceans like crabs, but they glue themselves to one spot for life.',
    ],
  },
  {
    id: 'gooseneck-barnacle', common: 'Gooseneck barnacle', scientific: 'Pollicipes polymerus',
    category: 'barnacle', color: '#c0b8a8', accent: '#b03a2a', size: 0.85, rarity: 'uncommon',
    facts: [
      'It clusters on wave-blasted rock atop a tough rubbery stalk, feeding in the crashing surf.',
      "Medieval folklore claimed geese hatched from these, which is how the 'goose' barnacle got its name.",
    ],
  },
  // ---- mussels ----
  {
    id: 'california-mussel', common: 'California mussel', scientific: 'Mytilus californianus',
    category: 'mussel', color: '#4a4452', accent: '#2a2630', size: 0.9, rarity: 'common',
    facts: [
      'It anchors to rock with super-strong protein threads (byssus) that have inspired waterproof glues.',
      'A mussel bed is a whole neighborhood, with hundreds of small creatures sheltering among the shells.',
    ],
  },
  // ---- fishes ----
  {
    id: 'tidepool-sculpin', common: 'Tidepool sculpin', scientific: 'Oligocottus maculosus',
    category: 'sculpin', color: '#5a6a4a', accent: '#c8a050', size: 0.85, rarity: 'common',
    facts: [
      'A thumb-sized fish that can find its way home to its own pool even after being moved hundreds of feet away.',
      'It changes color to match the rocks and can gulp air when its pool runs low on oxygen.',
    ],
  },
  {
    id: 'penpoint-gunnel', common: 'Penpoint gunnel', scientific: 'Apodichthys flavidus',
    category: 'eel', color: '#4a7a3a', accent: '#b03a2a', size: 1.0, rarity: 'uncommon',
    facts: [
      'An eel-like fish, often bright green or red to match the seaweed it threads through.',
      'It can breathe air and wait out the low tide tucked under a cool, wet rock.',
    ],
  },
  {
    id: 'high-cockscomb', common: 'High cockscomb', scientific: 'Anoplarchus purpurescens',
    category: 'eel', color: '#5a4a5a', accent: '#c87a4a', size: 0.9, rarity: 'common',
    facts: [
      'A slim prickleback named for the fleshy crest running along the top of its head.',
      'The mother coils around her eggs under a rock and guards them until they hatch.',
    ],
  },
  // ---- other ----
  {
    id: 'tidepool-shrimp', common: 'Tidepool shrimp', scientific: 'Heptacarpus sp.',
    category: 'shrimp', color: '#b04a4a', accent: '#e0d0c0', size: 0.7, rarity: 'common',
    facts: [
      'Often nearly transparent, these little shrimp snap their tails to dart backward in a blink.',
      'Many can shift color to vanish against the algae and eelgrass they shelter in.',
    ],
  },
  {
    id: 'california-sea-cucumber', common: 'California sea cucumber', scientific: 'Apostichopus californicus',
    category: 'cucumber', color: '#b0432f', accent: '#6a2a1a', size: 1.1, rarity: 'uncommon',
    facts: [
      'A relative of sea stars and urchins, this warty orange tube creeps along on rows of tube feet.',
      'Cornered, it can spill its sticky guts to distract a predator, then grow a new set.',
    ],
  },
  {
    id: 'giant-pacific-octopus', common: 'Giant Pacific octopus', scientific: 'Enteroctopus dofleini',
    category: 'octopus', color: '#9a4a5a', accent: '#d88a9a', size: 1.25, rarity: 'rare',
    facts: [
      'The largest octopus in the world, changing color and texture in an instant and squeezing through any gap bigger than its beak.',
      'Clever enough to open jars, it can also recognize individual people.',
    ],
  },
];
