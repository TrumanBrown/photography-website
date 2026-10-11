/**
 * Text helpers shared by every caption the pipeline writes: the site's voice
 * rules, mechanical tidying, banned-word checks, species display names, and
 * the guards that stop a caption naming something nobody verified.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./settings.mjs";

const VOICE_FILE = join(ROOT, ".github/instructions/site-copy.instructions.md");
const VOICE_SECTIONS = [
  "Never sound like a language model",
  "Voice",
  "Sentences",
  "Do not write",
];

/** The parts of the site's copy rules that apply to captions. */
export function loadVoiceRules() {
  try {
    const text = readFileSync(VOICE_FILE, "utf8");
    return text
      .split(/^## /m)
      .filter((s) => VOICE_SECTIONS.some((h) => s.startsWith(h)))
      .map((s) => `## ${s.trim()}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

const KEEP_CAPITALISED = new Set(
  (
    "American African Asian European Australian Chinese Japanese Tibetan Himalayan Indian Mexican " +
    "Canadian Californian California Oregon Washington Pacific Atlantic Caribbean Andean Amazonian " +
    "Costa Rican Panamanian Mediterranean Arctic Siberian Mongolian Korean Formosan Taiwanese " +
    "Malayan Bornean Sumatran Javan Philippine Brazilian Peruvian Hawaiian Alaskan Cascade Sierra " +
    "Nevada Rocky Appalachian Yunnan Sichuan"
  ).split(" "),
);

/** Place names inside species names, kept capitalised: "Puget Sound garter snake". */
const PROPER_PHRASE = Object.fromEntries(
  [
    "Puget Sound",
    "Great Basin",
    "Rocky Mountain",
    "Great Plains",
    "Gulf Coast",
  ].map((p) => [p.toLowerCase(), p]),
);
const PROPER_PHRASES = new RegExp(
  `\\b(?:${Object.keys(PROPER_PHRASE).join("|")})\\b`,
  "gi",
);

/**
 * iNat's "Northwestern Garter Snake" -> "Northwestern garter snake", keeping
 * proper nouns. With `midSentence`, the first word is lowercased too unless it's
 * a proper noun ("two northwestern garter snakes", "two Pacific chorus frogs").
 */
export function displayName(common, { midSentence = false } = {}) {
  if (!common) return "";
  const words = common.split(" ");
  return words
    .map((word, i) => {
      if (i === 0 && !midSentence) return word;
      if (
        /'s$/i.test(word) ||
        KEEP_CAPITALISED.has(word) ||
        /^[A-Z]{2,}$/.test(word) ||
        // Demonyms ahead of the noun: Ecuadorian, Caribbean, Chinese.
        (i < words.length - 1 &&
          /(?:ian|ean|ese)$/i.test(word) &&
          !/^ocean$/i.test(word))
      )
        return word;
      return word.toLowerCase();
    })
    .join(" ")
    .replace(PROPER_PHRASES, (m) => PROPER_PHRASE[m.toLowerCase()]);
}

/** "Sylvia's tree frog (Cruziohyla sylviae)", or just the scientific name if there's no common one. */
export function speciesLabel(taxon) {
  const common = displayName(taxon.common);
  return common ? `${common} (${taxon.name})` : taxon.name;
}

const BANNED = [
  "stunning",
  "breathtaking",
  "vibrant",
  "captivating",
  "majestic",
  "mesmerizing",
  "mesmerising",
  "awe-inspiring",
  "nestled",
  "tapestry",
  "testament",
  "delve",
  "embark",
  "unleash",
  "elevate",
  "immerse",
  "unlock",
  "discover",
  "seamless",
  "robust",
  "moreover",
  "furthermore",
  "additionally",
  "in conclusion",
  "did you know",
  "fun fact",
  "interestingly",
  "believe it or not",
  "not just",
  "more than just",
  "isn't just",
  "a reminder that",
  "showcasing",
  "showcases",
];

const EMOJI = /\p{Extended_Pictographic}/gu;

/** Mechanical fixes that never change meaning. */
export function tidy(text) {
  return String(text ?? "")
    .replace(EMOJI, "")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+–\s+/g, ", ")
    .replace(/!/g, ".")
    .replace(/(^|\s)[#@](\w+)/g, "$1$2")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\.{2,}/g, ".")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Problems a person would have to fix; empty when the text is fine. */
export function lint(text) {
  const problems = [];
  const lower = String(text ?? "").toLowerCase();
  for (const word of BANNED) {
    if (
      new RegExp(`(^|[^a-z])${word.replace(/[-']/g, "[-']")}([^a-z]|$)`).test(
        lower,
      )
    ) {
      problems.push(`uses "${word}"`);
    }
  }
  if (/[—]/.test(text)) problems.push("em dash");
  if (EMOJI.test(text)) problems.push("emoji");
  EMOJI.lastIndex = 0;
  return problems;
}

/** Everyday abbreviations that are capitalised without being names. */
const COMMON_CAPS = new Set(["SUV", "ATV", "UTV", "RV", "TV", "LED", "GPS"]);

/** Capitalised words in `phrase` that don't appear anywhere in the allowed session text. */
export function ungroundedNames(phrase, allowedText) {
  const allowed = norm(allowedText);
  return String(phrase ?? "")
    .split(/[\s,()/·]+/)
    .slice(1)
    .filter((w) => /^\p{Lu}/u.test(w))
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((w) => w && !COMMON_CAPS.has(w) && !allowed.includes(norm(w)));
}

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pre-compile species names (from your iNat list) for fast whole-word matching. */
export function compileLexicon(names = []) {
  return names
    .map((name) => ({ name, n: norm(name) }))
    .filter((x) => x.n.length >= 4)
    .map((x) => ({
      ...x,
      re: new RegExp(`(^|[^a-z0-9])${escapeRe(x.n)}([^a-z0-9]|$)`),
    }));
}

/** Species names in `text` that the post has no verified right to use. */
export function unverifiedSpecies(text, lexicon = [], allowedText = "") {
  const hay = norm(text);
  const allowed = norm(allowedText);
  return lexicon
    .filter((x) => x.re.test(hay) && !allowed.includes(x.n))
    .map((x) => x.name);
}

export function captureWhen(clock) {
  const m = /^(\d{4})-(\d{2})/.exec(clock ?? "");
  if (!m) return "";
  // Month and year only: camera clocks here drift by hours, so time of day isn't trustworthy.
  return new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
