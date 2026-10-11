/**
 * Facts for Instagram posts: a few short, true, interesting things about the
 * species in a photo, or about the place when there's no species to talk
 * about. Written once per species or place from its Wikipedia article (wiki.mjs)
 * and kept privately, then rotated across that species' or place's posts.
 *
 * A fact is only kept if it can be traced to the article: the sentence it
 * came from has to be in it, and so does every number. Nothing in first
 * person, because Truman didn't write these and they shouldn't pretend he did.
 */
import { displayName, lint, tidy, unverifiedSpecies } from "./text.mjs";

/** Bump when the prompt changes enough that every stored fact should be rewritten. */
export const FACTS_VERSION = 3;

/** Which facts a photo's post draws on: its species, or else its place. */
export function factKey({ taxon = null, level = null, landmark = "", slug }) {
  if (level && taxon?.id) return `taxon:${taxon.id}`;
  if (landmark) return `landmark:${String(landmark).toLowerCase()}`;
  return `place:${slug}`;
}

const isGroup = (art) => art.about === "genus" || art.about === "family";

/** "Mushroom-tongued Salamanders" -> "mushroom-tongued salamanders": how a person says a group's name mid-sentence. */
export function groupName(art) {
  return displayName(art?.group ?? "", { midSentence: true });
}

/**
 * @param name    what the facts are about: the species, the group, or the place
 * @param species for a genus or family article, the species in the photo
 *                (facts stay true of the whole group, so other species share them)
 */
export function factsPrompt({
  name,
  kind,
  art,
  species = "",
  voiceRules = "",
}) {
  const place = kind === "place";
  const group = isGroup(art)
    ? `
This article is about ${groupName(art)}, the group the animal in the photo belongs to${species ? ` (the photo is of a ${species})` : ""}. The facts are shared by every photo of ${groupName(art)}, so:
- Only facts true of the whole group, and so of this animal too: body, behaviour, senses, life cycle, defences.
- Nothing only some of them do, nothing about where they live or their range, no taxonomy.
- Don't name the species. Call them "${groupName(art)}" (or a shorter everyday name) or "they". When the group's name wouldn't ring a bell next to the species', start with "Like other ${groupName(art)}, they ...". Never "like this one".
`
    : "";
  return `Below is the Wikipedia article "${art.title}". Write up to 4 facts about ${place ? art.title : name} to go under photographs of ${place ? "this place" : "it"} on Instagram.

Write them the way a naturalist guide says something cool on a walk: plain, friendly, specific.
- One or two sentences, 12 to 30 words.
- Start the way a person talks: with ${place ? `the place or a plain noun ("The pillars ...", "Locals ...")` : `the animal or part of it ("Red-eyed tree frogs ...", "Males ...", "Their eggs ...")`}, "they" or "it", or a short time or place ("At night, ...").
- Don't make an object or idea the subject just to put the interesting word first, and don't open with a short teaser that the next sentence explains.
  Not "Silk holds the nest together." but "They hold their nests together with silk."
  Not "Poison comes from dinner. The frog gets it from ants." but "Their poison comes from the ants they eat."
- Say it once and stop. No clause or sentence that sums it up, restates it or comments on it: not ", that's where they nest", "It's a handy trick.", "They're using their tails as bait."
- Contractions only where they come naturally. Never add words to fit one in.
- Something a person would stop scrolling for: ${place ? "how the place formed, a record, where the name comes from, a story, a surprising detail" : "how it hunts, hides, mates or survives, a surprising ability, where its name comes from, a field mark for spotting it"}. Not plain description, sizes or counts unless they're startling.
- Plain statements, no "I", "my", "we": the photographer didn't write these. No "Did you know", "Known for", "Fun fact".
- Not taxonomy (who described it, which family it's in), not lists of countries${place ? "" : ", nothing only true in one region"}.
- Keep it light: nothing about deaths, bodies, injuries, crime or poaching.
- Only about ${place ? art.title : name}, never about another place or species it's compared with.
- Only what the article says. Never add a number, name, claim or superlative that isn't in it.
- If the article only has one or two good ones, write one or two. Never pad.
${group}
Order them most surprising first. For each, quote the sentence from the article it comes from, exactly.

${voiceRules ? `Words and phrasings to avoid:\n${voiceRules}\n\n` : ""}Article:
"""
${art.text}
"""

Reply with JSON only: {"facts": [{"text": "...", "source": "..."}]}`;
}

const FIRST_PERSON = /\b(I|I'd|I'll|I've|I'm|my|me|we|we're|our|you'd)\b/;
// "Horse lubbers like this one ...": the framing that gave group facts away.
const LIKE_THIS_ONE = /\blike this one\b/i;
// ", that's where they nest." / "It's a handy trick.": a fact saying itself twice.
const TACKED_ON =
  /(?:[,;:]\s*|[.!?]\s+)(?:that's|that is|this is|it's|which is) (?:how|why|where|what|when|one|a|an|the|part|because)\b|[.!?]\s+(?:it's|that's|this is) [^.!?]{0,40}[.!?]?$/i;
// A group fact has to hold for the animal in the photo, so not "some of
// them" and not where the group lives.
const NOT_WHOLE_GROUP =
  /\b(?:some|several|certain|ranges?|native to|widespread|(?:occurs?|found|live|lives) (?:in|from|throughout|across))\b/i;
const norm = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Chirps can double as a thermometer. Many ..." opens on a teaser rather than the fact. */
function opensOnTeaser(text) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.length > 1 && sentences[0].split(/\s+/).length <= 6;
}

/**
 * The facts from a model reply that can be traced to the article, tidied.
 * `lexicon` (text.mjs compileLexicon) stops a fact naming a species the
 * article doesn't mention.
 */
export function checkFacts(raw, art, { lexicon = [] } = {}) {
  const body = norm(art.text);
  const group = isGroup(art) && art.group ? art.group : "";
  const kept = [];
  for (const f of raw?.facts ?? []) {
    let text = tidy(f?.text).replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    // iNaturalist's "Mushroom-tongued Salamanders", said the way a person would.
    if (group && group !== groupName(art))
      text = text.replace(
        new RegExp(`\\b${escapeRe(group)}\\b`, "g"),
        (m, at) =>
          at === 0 || /[.!?]\s*$/.test(text.slice(0, at))
            ? groupName(art).charAt(0).toUpperCase() + groupName(art).slice(1)
            : groupName(art),
      );
    const quote = norm(f?.source).slice(0, 60);
    if (!text || text.length < 30 || text.length > 260) continue;
    if (lint(text).length || FIRST_PERSON.test(text)) continue;
    if (LIKE_THIS_ONE.test(text) || opensOnTeaser(text)) continue;
    if (TACKED_ON.test(text)) continue;
    if (isGroup(art) && NOT_WHOLE_GROUP.test(text)) continue;
    if (!quote || !body.includes(quote)) continue;
    const numbers = text.match(/\d[\d,.]*\d|\d/g) ?? [];
    if (numbers.some((n) => !body.includes(n))) continue;
    if (unverifiedSpecies(text, lexicon, art.text).length) continue;
    if (kept.some((k) => k.toLowerCase() === text.toLowerCase())) continue;
    kept.push(text);
  }
  return kept;
}

/**
 * The fact a new post should use: the one used least so far (by any post,
 * since species that share an article share its facts), and the more
 * surprising one on a tie.
 */
export function pickFact(facts, used = []) {
  if (!facts?.length) return "";
  const count = (f) => used.filter((u) => u === f).length;
  return facts.reduce((best, f) => (count(f) < count(best) ? f : best));
}

/** Offline stand-in so the pipeline runs without a model. */
export function mockFacts(art) {
  const sentence =
    art.text.split(/(?<=\.)\s+/).find((s) => s.length > 40) ??
    art.text.slice(0, 80);
  return {
    facts: [
      {
        text: "Mock fact written without a model, long enough to pass the length check.",
        source: sentence,
      },
    ],
  };
}
