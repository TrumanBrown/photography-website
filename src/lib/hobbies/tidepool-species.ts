/**
 * Common Pacific Northwest tide-pool species for the "flip a rock" game.
 *
 * Facts are curated from standard references (Wikipedia and field guides such
 * as Between Pacific Tides / Walla Walla University's Rosario key); a
 * representative sample was grounded with live web research. They favor
 * well-established, interesting tidbits over obscure claims, but a quick review
 * pass by someone who knows these animals is recommended before treating any of
 * it as authoritative — it's a learning game, not a textbook.
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
      'A slow mover that often plays dead, it can sit out of water for up to 8 hours while the tide is out.',
    ],
  },
  {
    id: 'green-shore-crab', common: 'Green shore crab', scientific: 'Hemigrapsus oregonensis',
    category: 'crab', color: '#6f7d4a', accent: '#c9b079', size: 0.85, rarity: 'common',
    facts: [
      'Despite the name it can be green, yellow, or grey — but its legs are hairy and its claws lack purple spots.',
      'A mudflat champion, it digs burrows and shrugs off brackish water far less salty than most crabs tolerate.',
    ],
  },
  {
    id: 'kelp-crab', common: 'Northern kelp crab', scientific: 'Pugettia producta',
    category: 'crab', color: '#5a6b3a', accent: '#c46a2a', size: 1.05, rarity: 'uncommon',
    facts: [
      'This spider crab climbs bull kelp on long hooked legs, eating algae in summer and hunting mussels in winter.',
      'Small but feisty — it has a surprisingly strong, aggressive pinch.',
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
      "It doesn't hunt with its claws — it filter-feeds, sweeping plankton from the water with feathery mouthparts.",
      'Famous for hair-trigger escape: it pops off a claw to flee a predator, then regrows it over several molts.',
    ],
  },
  // ---- hermit crabs ----
  {
    id: 'hairy-hermit-crab', common: 'Hairy hermit crab', scientific: 'Pagurus hirsutiusculus',
    category: 'hermit', color: '#5c5240', accent: '#6aa0c0', size: 0.8, rarity: 'common',
    facts: [
      'Its legs wear white and blue bands, and its whole body looks faintly hairy up close.',
      'Unlike most hermit crabs, it will boldly abandon its borrowed shell and dash away when threatened.',
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
      'A keystone species: famous experiments showed that removing it lets mussels take over and crash tide-pool diversity.',
      'It digests a mussel by pushing its stomach out through its mouth into the shell — about 80 mussels a year.',
    ],
  },
  {
    id: 'sunflower-star', common: 'Sunflower star', scientific: 'Pycnopodia helianthoides',
    category: 'star', color: '#c85a2a', accent: '#f0c040', size: 1.3, arms: 18, rarity: 'rare',
    facts: [
      'One of the largest sea stars on Earth — up to 24 arms and a 3-foot span — gliding on about 15,000 tube feet.',
      'Sea star wasting disease has killed over 90% since 2013, and it is now listed as critically endangered.',
    ],
  },
  {
    id: 'six-rayed-star', common: 'Six-rayed star', scientific: 'Leptasterias hexactis',
    category: 'star', color: '#4a5d3a', accent: '#8a9a6a', size: 0.8, arms: 6, rarity: 'common',
    facts: [
      'A small star with six arms — unusual in a group that mostly sticks to five.',
      'Rather than scatter eggs to sea, the mother broods her young beneath her body until they can fend for themselves.',
    ],
  },
  {
    id: 'blood-star', common: 'Blood star', scientific: 'Henricia leviuscula',
    category: 'star', color: '#c0392b', accent: '#e8857a', size: 0.9, arms: 5, rarity: 'uncommon',
    facts: [
      'Slender bright red-orange arms make it look delicate next to the stout ochre star.',
      'It sips tiny particles and grazes sponges instead of prying open mussels — a gentle tide-pool neighbor.',
    ],
  },
  {
    id: 'leather-star', common: 'Leather star', scientific: 'Dermasterias imbricata',
    category: 'star', color: '#6a6a8a', accent: '#b04a4a', size: 1.0, arms: 5, rarity: 'uncommon',
    facts: [
      'Smooth and slippery to the touch, it gives off a faint smell of garlic or sulfur.',
      'It preys on the giant green anemone, which will detach and slowly "walk" away to escape it.',
    ],
  },
  // ---- anemones ----
  {
    id: 'giant-green-anemone', common: 'Giant green anemone', scientific: 'Anthopleura xanthogrammica',
    category: 'anemone', color: '#2f8f4a', accent: '#6fd08a', size: 1.15, rarity: 'common',
    facts: [
      'Its brilliant green comes from algae living inside it — the sunnier the pool, the greener it glows.',
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
      'Unlike its algae-fed cousins it is a hunter, able to swallow small fish, crabs, and even other anemones.',
    ],
  },
  // ---- nudibranchs ----
  {
    id: 'opalescent-nudibranch', common: 'Opalescent nudibranch', scientific: 'Hermissenda crassicornis',
    category: 'nudibranch', color: '#e0853a', accent: '#3a7bd5', size: 0.8, rarity: 'uncommon',
    facts: [
      'A living jewel: translucent with electric-blue lines and orange-tipped frills called cerata.',
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
      'White-bodied with brilliant orange tips on its frills and head — a true tide-pool showstopper.',
      'Like all nudibranchs it is a hermaphrodite: every individual is both male and female.',
    ],
  },
  {
    id: 'leopard-dorid', common: 'Leopard dorid', scientific: 'Diaulula sandiegensis',
    category: 'nudibranch', color: '#d8cdbb', accent: '#3a3a3a', size: 0.85, rarity: 'uncommon',
    facts: [
      'Pale with dark leopard rings, this sea slug grazes on sponges.',
      "'Nudibranch' means 'naked gills' — the feathery tuft on its back is how it breathes.",
    ],
  },
  // ---- chitons ----
  {
    id: 'gumboot-chiton', common: 'Gumboot chiton', scientific: 'Cryptochiton stelleri',
    category: 'chiton', color: '#8a3a2a', accent: '#5a241a', size: 1.2, rarity: 'uncommon',
    facts: [
      "The world's largest chiton — up to a foot long — nicknamed the 'wandering meatloaf' for its leathery red-brown back.",
      'Its teeth are capped with magnetite, real iron, making them some of the hardest material any animal builds.',
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
      'Its dark turban shell is often worn pearly-white at the tip from years of grazing.',
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
      "Many have a 'home scar' — a spot they grind to fit their shell and return to after each grazing trip.",
    ],
  },
  {
    id: 'plate-limpet', common: 'Plate limpet', scientific: 'Lottia scutum',
    category: 'limpet', color: '#9a8a6a', accent: '#4a5a3a', size: 0.75, rarity: 'common',
    facts: [
      'A low, flat limpet that mows algae with an astonishingly tough tongue.',
      'Limpet teeth are reinforced with goethite fibers — ranked among the strongest natural materials ever tested.',
    ],
  },
  // ---- urchins ----
  {
    id: 'purple-sea-urchin', common: 'Purple sea urchin', scientific: 'Strongylocentrotus purpuratus',
    category: 'urchin', color: '#6a4a86', accent: '#4a2a66', size: 0.95, rarity: 'common',
    facts: [
      "It grinds cup-shaped pits into solid rock with five teeth called Aristotle's lantern.",
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
      'Red urchins are among the longest-lived animals known — some are estimated at over 100 years old.',
    ],
  },
  // ---- barnacles ----
  {
    id: 'acorn-barnacle', common: 'Acorn barnacle', scientific: 'Balanus glandula',
    category: 'barnacle', color: '#d8d2c4', accent: '#8a8276', size: 0.6, rarity: 'common',
    facts: [
      'Cemented head-down to the rock, it kicks feathery legs out of its shell to comb plankton from the water.',
      'Barnacles are crustaceans — relatives of crabs — that gave up walking to glue themselves in place for life.',
    ],
  },
  {
    id: 'gooseneck-barnacle', common: 'Gooseneck barnacle', scientific: 'Pollicipes polymerus',
    category: 'barnacle', color: '#c0b8a8', accent: '#b03a2a', size: 0.85, rarity: 'uncommon',
    facts: [
      'It clusters on wave-blasted rock atop a tough rubbery stalk, feeding in the crashing surf.',
      "Medieval folklore claimed geese hatched from these — which is how the 'goose' barnacle got its name.",
    ],
  },
  // ---- mussels ----
  {
    id: 'california-mussel', common: 'California mussel', scientific: 'Mytilus californianus',
    category: 'mussel', color: '#4a4452', accent: '#2a2630', size: 0.9, rarity: 'common',
    facts: [
      'It anchors to rock with super-strong protein threads (byssus) that have inspired waterproof glues.',
      'A mussel bed is a whole neighborhood — hundreds of small creatures shelter among the shells.',
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
      'A guarding mother coils around her egg cluster under a rock until the young hatch.',
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
      'Cornered, it can spill its sticky guts to distract a predator — then simply grow a new set.',
    ],
  },
  {
    id: 'giant-pacific-octopus', common: 'Giant Pacific octopus', scientific: 'Enteroctopus dofleini',
    category: 'octopus', color: '#9a4a5a', accent: '#d88a9a', size: 1.25, rarity: 'rare',
    facts: [
      'The largest octopus in the world, changing color and texture in an instant and squeezing through any gap bigger than its beak.',
      'Famously clever, it can open jars, use tools, and even recognize individual people.',
    ],
  },
];
