/**
 * The kinds of subject a photo can have. The analysis picks one per photo; the
 * Instagram side uses it for hashtags and to vary what goes out day to day.
 */
export const ORGANISM_GROUPS = new Set([
  "frog",
  "toad",
  "salamander",
  "snake",
  "lizard",
  "turtle",
  "bird",
  "mammal",
  "insect",
  "butterfly",
  "moth",
  "dragonfly",
  "beetle",
  "spider",
  "scorpion",
  "crab",
  "fish",
  "marine-invertebrate",
  "fungus",
  "plant",
  "flower",
]);
export const LANDSCAPE_GROUPS = new Set([
  "mountain",
  "glacier",
  "lake",
  "river",
  "waterfall",
  "coast",
  "forest",
  "desert",
  "sky",
]);

export const GROUPS = [
  ...ORGANISM_GROUPS,
  ...LANDSCAPE_GROUPS,
  "city",
  "temple",
  "village",
  "people",
  "other",
];
