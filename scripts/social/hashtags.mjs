/**
 * Hashtags: at most five, built from data rather than invented.
 *
 * Instagram caps posts at five hashtags (since December 2025) and treats them
 * as topic labels, so each slot has a job:
 *   1. subject   - the species (research-grade iNat ID only) or a named landmark
 *   2. community - where people who follow this kind of animal or scene look
 *   3. place     - the most searchable place word from your session
 *   4. genre     - macro / wildlife / bird / landscape / travel photography
 *   5. gear      - the camera body
 * The model may suggest a place or landmark, but only words that already
 * appear in your session title or location are accepted.
 */
import { cameraName } from "./exif.mjs";

export const MAX_HASHTAGS = 5;

export function tagify(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 40);
}

/** Community tag from iNat lineage (preferred) or the model's group label. */
export function communityTag({ taxon, group }) {
  const l = taxon?.lineage ?? {};
  const order = l.order?.name;
  const cls = l.class?.name;
  const phylum = l.phylum?.name;
  if (taxon) {
    if (order === "Anura") return "frogsofinstagram";
    if (order === "Caudata") return "salamanders";
    if (order === "Squamata")
      return l.suborder?.name === "Serpentes"
        ? "snakesofinstagram"
        : "reptiles";
    if (order === "Testudines") return "turtles";
    if (order === "Crocodylia") return "crocodilians";
    if (cls === "Aves") return "birdsofinstagram";
    if (cls === "Mammalia") return "mammals";
    if (order === "Lepidoptera") return "lepidoptera";
    if (order === "Odonata") return "dragonflies";
    if (order === "Coleoptera") return "beetles";
    if (cls === "Insecta") return "insectsofinstagram";
    if (order === "Araneae") return "spidersofinstagram";
    if (order === "Scorpiones") return "scorpions";
    if (cls === "Arachnida") return "arachnids";
    if (cls === "Malacostraca") return "crustaceans";
    if (order === "Nudibranchia") return "nudibranch";
    if (phylum === "Mollusca") return "mollusks";
    if (phylum === "Cnidaria" || phylum === "Echinodermata")
      return "marinelife";
    if (cls === "Actinopterygii" || cls === "Elasmobranchii") return "fish";
    if (taxon.kingdom === "Fungi") return "fungi";
    if (taxon.kingdom === "Plantae") return "botany";
    return "wildlife";
  }
  return GROUP_TAGS[group] ?? "";
}

const GROUP_TAGS = {
  frog: "frogsofinstagram",
  toad: "frogsofinstagram",
  salamander: "salamanders",
  snake: "snakesofinstagram",
  lizard: "reptiles",
  turtle: "turtles",
  bird: "birdsofinstagram",
  mammal: "mammals",
  insect: "insectsofinstagram",
  butterfly: "lepidoptera",
  moth: "lepidoptera",
  dragonfly: "dragonflies",
  beetle: "beetles",
  spider: "spidersofinstagram",
  scorpion: "scorpions",
  crab: "crustaceans",
  fish: "fish",
  "marine-invertebrate": "marinelife",
  fungus: "fungi",
  plant: "botany",
  flower: "wildflowers",
  mountain: "mountains",
  glacier: "mountains",
  lake: "lakes",
  river: "rivers",
  waterfall: "waterfalls",
  coast: "seascape",
  forest: "forest",
  desert: "desert",
  sky: "skyscape",
  city: "cityscape",
  temple: "architecture",
  village: "travel",
  people: "travel",
};

const ORGANISM_GROUPS = new Set([
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
const LANDSCAPE_GROUPS = new Set([
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

export function isOrganism({ taxon, group }) {
  return Boolean(taxon) || ORGANISM_GROUPS.has(group);
}

export function genreTag({ taxon, group, lens }) {
  const organism = isOrganism({ taxon, group });
  if (organism && /macro/i.test(lens ?? "")) return "macrophotography";
  if (taxon?.lineage?.class?.name === "Aves" || group === "bird")
    return "birdphotography";
  if (
    taxon?.kingdom === "Plantae" ||
    taxon?.kingdom === "Fungi" ||
    ["plant", "flower", "fungus"].includes(group)
  ) {
    return "naturephotography";
  }
  if (organism) return "wildlifephotography";
  if (LANDSCAPE_GROUPS.has(group)) return "landscapephotography";
  if (["city", "temple", "village", "people"].includes(group))
    return "travelphotography";
  return "naturephotography";
}

export function gearTag(facts) {
  const name = cameraName(facts ?? {});
  if (!name) return "";
  if (/^iphone/i.test(name)) return "shotoniphone";
  return tagify(name.replace(/\bEOS\s+/i, ""));
}

const ADMIN_WORDS =
  /\b(province|provincia|county|district|region|prefecture|municipality|canton|state)\b/i;
/** Regional communities that are bigger than the state name itself. */
const REGION_ALIASES = {
  washington: "pnw",
  oregon: "pnw",
  washingtonstate: "pnw",
};

/** Every tag that a run of 1-4 consecutive words in `text` would produce. */
export function allowedTags(text) {
  const words = String(text ?? "")
    .split(/[\s,·/()]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter(Boolean);
  const out = new Set();
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 4 && i + n <= words.length; n++) {
      const phrase = words.slice(i, i + n).join(" ");
      if (ADMIN_WORDS.test(phrase)) continue;
      const tag = tagify(phrase);
      if (tag.length >= 3 && !/^\d+$/.test(tag)) out.add(tag);
    }
  }
  return out;
}

/** The model's place idea if it's grounded in session text, else the broadest location part. */
export function placeTag({ proposed, title, location }) {
  const allowed = allowedTags(`${title ?? ""} ${location ?? ""}`);
  const wanted = tagify(proposed);
  if (wanted && allowed.has(wanted) && !MONTHS.has(wanted))
    return REGION_ALIASES[wanted] ?? wanted;
  const parts = String(location ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !ADMIN_WORDS.test(s));
  const broad = tagify(parts.at(-1) ?? "");
  return REGION_ALIASES[broad] ?? broad;
}

const MONTHS = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "spring",
  "summer",
  "autumn",
  "fall",
  "winter",
]);

export function landmarkTag({ landmark, title, location, description }) {
  const tag = tagify(landmark);
  if (!tag) return "";
  const allowed = allowedTags(
    `${title ?? ""} ${location ?? ""} ${description ?? ""}`,
  );
  return allowed.has(tag) && !MONTHS.has(tag) ? tag : "";
}

export function buildHashtags({
  taxon,
  speciesOk,
  group,
  facts,
  session,
  proposedPlace,
  landmark,
  hubTags = {},
}) {
  const community = communityTag({ taxon: speciesOk ? taxon : null, group });
  const subject = speciesOk
    ? tagify(taxon.common || taxon.name)
    : landmarkTag({ landmark, ...session });
  const genre = hubTags[community]
    ? tagify(hubTags[community])
    : genreTag({ taxon: speciesOk ? taxon : null, group, lens: facts?.lens });
  const place = placeTag({
    proposed: proposedPlace,
    title: session.title,
    location: session.location,
  });
  // The broad region (e.g. #costarica, #pnw) fills a slot the subject left empty.
  const region = placeTag({
    proposed: "",
    title: session.title,
    location: session.location,
  });
  const tags = [subject, community, place, genre, gearTag(facts), region];
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(`#${t}`);
    if (out.length === MAX_HASHTAGS) break;
  }
  return out;
}
