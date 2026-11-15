/**
 * Text helpers shared by every caption the pipeline writes: the site's voice
 * rules, mechanical tidying, banned-word checks, species display names, and
 * the guards that stop a caption naming something nobody verified.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { speciesName } from "../../src/lib/species-name.js";
import { ROOT } from "./settings.mjs";

const VOICE_FILE = join(ROOT, ".github/instructions/site-copy.instructions.md");
const VOICE_SECTIONS = [
  "Never sound like a language model",
  "Voice",
  "Sentences",
  "Do not write",
];

const TRUMAN_VOICE = join(ROOT, ".github/skills/truman-voice/SKILL.md");

/** How Truman writes, from the truman-voice skill: its "How he writes" section. */
export function loadTrumanVoice(path = TRUMAN_VOICE) {
  try {
    const text = readFileSync(path, "utf8");
    const start = text.indexOf("## How he writes");
    if (start < 0) return "";
    const end = text.indexOf("## Where it applies", start);
    return text.slice(start, end > start ? end : undefined).trim();
  } catch {
    return "";
  }
}

/** The parts of the site's copy rules that apply to captions (or the sections asked for). */
export function loadVoiceRules(sections = VOICE_SECTIONS) {
  try {
    const text = readFileSync(VOICE_FILE, "utf8");
    return text
      .split(/^## /m)
      .filter((s) => sections.some((h) => s.startsWith(h)))
      .map((s) => `## ${s.trim()}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

/**
 * iNat's "Northwestern Garter Snake" -> "Northwestern garter snake", keeping
 * proper nouns. The site uses the same helper, so the rules live in one place:
 * src/lib/species-name.js.
 */
export const displayName = speciesName;

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
