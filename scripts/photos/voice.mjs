/**
 * The first paragraph of an Instagram post in Truman's voice: a livelier
 * first line than the website's ("munching on an insect" rather than
 * "holding an insect") and one short reaction of his ("Such an interesting,
 * unique beak on it."). Written once per planned post, text only, from the
 * notes the one look at the photo stored and the post's fun fact, by a prompt
 * that carries the caption-voice skill (.github/skills/caption-voice). Edit
 * that file to change how posts sound.
 *
 * The website's captions don't use this; they stay plain, because they're
 * also the photos' alt text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./settings.mjs";
import { normaliseLine } from "./lines.mjs";
import { lint, tidy, ungroundedNames, unverifiedSpecies } from "./text.mjs";
import { backdropIn } from "./website.mjs";

/** Bump when the prompt or the skill changes enough that planned posts should be rewritten. */
export const VOICE_VERSION = 1;

const SKILL = join(ROOT, ".github/skills/caption-voice/SKILL.md");

/** The caption-voice skill from "How a post reads" up to its procedure, for the prompt. */
export function loadVoiceGuide(path = SKILL) {
  try {
    const text = readFileSync(path, "utf8");
    const start = text.indexOf("## How a post reads");
    const end = text.indexOf("## Procedure");
    if (start < 0) return "";
    return text.slice(start, end > start ? end : undefined).trim();
  } catch {
    return "";
  }
}

export function voicePrompt(items, guide = "", { recent = [] } = {}) {
  return `You write the first paragraph of Instagram posts for Truman's wildlife and landscape photographs, in his voice. His style guide is below, with his own rewrites of posts that sounded like AI. Match his tone; don't reuse his examples' wording.

For each photo:
- When "named" is given (an identified species), write "action": only the words that come after the name. The single most interesting thing about this photo, in 3 to 9 words. Lowercase, no full stop. Like "munching on an insect on a mossy post" or "showing off its incredible leaf mimicry".
- Otherwise write "line": the whole first line, starting with what the photo is of, in 4 to 12 words. No full stop. Like "Mount Baker looming over a small, reflective alpine pond".
- Write "comments": three options for his one-line reaction, which goes after the place, best first. A reaction to the animal or the place, not a description of the photo. First person is fine, and so is a fragment. 4 to 22 words each, ending with a full stop.

Rules:
- Only what the notes say is in the photo. Don't invent behaviour, weather, companions, waiting, luck or how it was photographed.
- Use only the names in the notes. No numbers in the comments.
- A comment mustn't repeat words from the first line or say the fun fact.
- These posts go out over a few weeks. Across all the photos, no two comments may start the same way or use the same phrase, and "showing off", "looming over" and "munching on" are each for one photo at most. Don't lean on stock phrases like "stands out against", "catches my eye", "hard to look past", "can't stop looking", "worth a closer look" or "funny little detail".
- Never describe the background, the blur or the framing.
${recent.length ? `\nReactions already used on recent posts. Don't reuse their wording or their shape:\n${recent.map((r) => `- ${r}`).join("\n")}\n` : ""}
Style guide:
"""
${guide}
"""

Photos:
${items.map((x) => `- id ${x.id}: ${x.named ? `named "${x.named}"; ` : ""}subject "${x.subject}"; scene "${x.scene}"; conditions "${x.conditions || "none"}"; ${x.landmark ? `landmark "${x.landmark}"; ` : ""}place "${x.place}"; description "${x.description}"${x.fact ? `; fun fact "${x.fact}"` : ""}`).join("\n")}

Reply with JSON only: {"items": [{"id": "...", "action": "...", "comments": ["...", "...", "..."]}, {"id": "...", "line": "...", "comments": ["...", "...", "..."]}]}`;
}

// A reaction that tells a story the notes can't back up.
const STORY =
  /\b(?:waited|waiting|finally|lucky|luckily|hours?|minutes|this morning|tonight|today|yesterday|last (?:night|week|year)|we|we're|we've|our|us)\b/i;
// Phrases a model reaches for on every photo, or to sound like a person.
const STOCK =
  /\b(?:stands? out against|catch(?:es)? my eye|hard to look past|can't stop looking|worth a closer look|funny little detail|any day|thoroughly|wins? me over|my own)\b|\bto me\.$/i;
// What makes a line a reaction rather than a description: his own view of it.
const REACTION =
  /\b(?:i|i'm|i've|i'd|i'll|my|love|loving|can't|couldn't|believe|such|so|quite|really|pretty|what an?|wild|cool|crazy|interesting|unique|incredible|impressive|amazing|amazed|fascinating|favou?rite|neat|fun|wish|never|always)\b/i;
// His own reactions, which the writer sees as examples and mustn't copy.
export const HIS_REACTIONS = [
  "I can't believe how they even mimic the punches and holes in natural leaves as well.",
  "Such an interesting, unique beak on it.",
  "I love when the wind dies down and allows these small ponds to reflect all that's around them.",
];
// Praise that reads as a tic once it's on every other post.
const PRAISE =
  /\b(?:incredible|impressive|impressed|amazing|amazed|striking|spectacular|appealing|lovely|gorgeous|beautiful|fascinating)\b/gi;
const STOP = new Set(
  "a an the of on in at to and or with its it's it their that this those these such so is are be was very really just".split(
    " ",
  ),
);
const words = (s, content = false) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !(content && STOP.has(w)));

/** True when `a` and `b` share a run of `n` words (only the words that carry meaning, with `content`). */
function shareRun(a, b, n = 5, content = false) {
  const runs = new Set();
  const wb = words(b, content);
  for (let i = 0; i + n <= wb.length; i++)
    runs.add(wb.slice(i, i + n).join(" "));
  const wa = words(a, content);
  for (let i = 0; i + n <= wa.length; i++)
    if (runs.has(wa.slice(i, i + n).join(" "))) return true;
  return false;
}

/**
 * His reaction, cleaned, or "" when it breaks a rule. `avoid` holds the
 * reactions on other posts, so the same phrase doesn't come round twice.
 */
export function normaliseComment(
  raw,
  {
    fact = "",
    line = "",
    lexicon = [],
    allowed = "",
    taxonText = "",
    avoid = [],
  } = {},
) {
  let c = tidy(raw ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\.{2,}$/, ".")
    .trim();
  if (!c) return "";
  if (!/[.!?]$/.test(c)) c += ".";
  if (c.length < 12 || c.length > 180) return "";
  if (/[?#@\d]/.test(c) || STORY.test(c) || STOCK.test(c)) return "";
  if (!REACTION.test(c) || backdropIn(c)) return "";
  if (lint(c).length) return "";
  if (fact && shareRun(c, fact)) return "";
  if (line && shareRun(c, line, 2, true)) return "";
  if (avoid.some((other) => shareRun(c, other, 3, true))) return "";
  const praise = (c.match(PRAISE) ?? []).map((w) => w.toLowerCase());
  if (
    praise.some(
      (w) =>
        avoid.filter((other) => other.toLowerCase().includes(w)).length >= 2,
    )
  )
    return "";
  if (unverifiedSpecies(c, lexicon, taxonText).length) return "";
  if (ungroundedNames(c, `${allowed} I I'm I've I'd I'll`).length) return "";
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/**
 * One photo's reply, checked: { action } or { text }, plus { comment }, the
 * first of its reactions that passes, each left out when nothing does. The
 * first line gets the same checks as the website's (lines.mjs), and again
 * when the caption is built.
 */
export function normaliseVoice(raw, opts = {}) {
  const { named = false, plural = false } = opts;
  const checked = normaliseLine(
    named ? { action: raw?.action } : { line: raw?.line },
    { named, plural },
  );
  // Which way it faces or the light on it is the photo, not the moment.
  const first =
    checked && !backdropIn(checked.action ?? checked.text) ? checked : null;
  const line = first?.action ?? first?.text ?? "";
  const options = Array.isArray(raw?.comments) ? raw.comments : [raw?.comment];
  const comment =
    options.map((c) => normaliseComment(c, { ...opts, line })).find(Boolean) ??
    "";
  return { ...(first ?? {}), ...(comment ? { comment } : {}) };
}

/** Offline stand-in so the pipeline runs without a model. */
export function mockVoice(items) {
  return {
    items: items.map((x) => ({
      id: x.id,
      ...(x.named ? { action: "resting" } : { line: x.subject }),
      comments: [`Mock reaction for photo ${x.id}, written offline.`],
    })),
  };
}
