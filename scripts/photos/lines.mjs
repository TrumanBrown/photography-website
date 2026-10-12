/**
 * The first line of a caption, said the way a person would: what the photo
 * is of and what it's doing, nothing about the background or the blur.
 *
 *   "Red-eyed tree frog (Agalychnis callidryas) clinging to a stem"
 *   "Mount Baker from Yellow Aster Butte"
 *   "Shanghai skyline across the river at night"
 *
 * Written by one text-only call per batch of photos, from the notes the
 * vision analysis already stored, so no photo is looked at again. For an
 * identified species the model writes only the words after the name, which
 * code supplies.
 */
import { tidy } from "./text.mjs";

/** Bump when the prompt changes enough that every first line should be rewritten. */
export const LINE_VERSION = 3;

export function linesPrompt(items) {
  return `Each item below is notes on one photograph. Write the first line of its caption, the way a person would say it.

- When "named" is given (an identified species), write only the words that follow that name: what it's doing, and what it's on. Field "action".
- Otherwise write the whole line: what the photo is of, and what it's doing or what makes the view. Field "line". Start with a capital.

Rules:
- 2 to 8 words, no full stop. Lowercase except names.
- The photos are from one outing, and ones with the same subject (the same peak, the same species) are listed together. Give each its own line from what's different in its notes: the light, the clouds, the season, what it's doing, what's in front. No two lines the same.
- Animals, plants and close-ups: never describe the background, the blur, the framing or the light: no "against", "background", "blurred", "frame", "foreground".
- People, objects and views: when the notes give a landmark and it's behind them, it's usually the point, so keep it ("a candy bar held up to Mount Rainier", "a hiker below Everest"). Only a landmark from the notes.
- Body parts take "with": "with its mouth open", "standing with its head lowered", not "mouth open".
- Never vague words like "object", "item", "surface", "something": say what it is if the notes do, or leave it out.
- Colours only when they're the point.
- Keep "at night", "in fog", "in the snow", "at sunrise" when the notes say so; they're part of the moment.
- Landscapes: the one thing that makes the view, or "from <place>" when the subject is a named peak seen from the place in the notes.
- Plain verbs: perched, clinging, preening, resting, hunting, basking, swimming, calling.
- Never "illuminated", "majestic", "towering", "nestled", "lush", "vibrant". Don't say the same word twice.
- Use only names that are in the notes.

Examples:
- "clinging to a green stem against a dark background" -> action "clinging to a stem"
- "preening its feathers against a blurred green background" -> action "preening its feathers"
- "perched on a diagonal branch against blurred greenery" -> action "perched on a branch"
- "on a broad green leaf against a dark background" (a frog, at night) -> action "on a leaf at night"
- "swallowing a fish among rocks" -> action "swallowing a fish"
- "rising above rocky meadows and tree-covered ridges" (Mount Baker, from Yellow Aster Butte) -> line "Mount Baker from Yellow Aster Butte"
- "Illuminated city skyline overlooking a river with a lit boat" (at night) -> line "The skyline across the river at night"
- "Moss-covered forest with hanging moss above a fern-covered floor" -> line "Hanging moss over a fern-covered floor"
- "Monkey sitting on a railing before forested rock pillars" -> line "A monkey on the railing"
- "Person standing on a ridge in front of a snow-covered peak" (landmark Mount Rainier) -> line "A hiker on a ridge below Mount Rainier"

Items:
${items.map((x) => `- id ${x.id}: ${x.named ? `named "${x.named}"; ` : ""}subject "${x.subject}"; scene "${x.scene}"; conditions "${x.conditions || "none"}"; ${x.landmark ? `landmark "${x.landmark}"; ` : ""}place "${x.place}"; description "${x.description}"`).join("\n")}

Reply with JSON only: {"items": [{"id": "...", "action": "..."}, {"id": "...", "line": "..."}]}`;
}

/** What the prompt forbids, caught in case the model slips. */
const BACKDROP =
  /\s*(?:,\s*)?(?:against|in front of|before)\s+(?:a|an|the)?\s*(?:[\w-]+\s+){0,3}(?:background|backdrop|sky|greenery|foliage|leaves|blur)\b.*$/i;
const NEVER =
  /\b(?:background|blurred|foreground|frame|illuminated|majestic|towering|nestled|lush|vibrant|object|objects|item|items|something)\b|\b(?:on|across) an? surface\b/i;
// "mouth open among grass" -> "with its mouth open among grass".
const BARE_BODY_PART =
  /(^|\s|,\s)(?<!\b(?:its|their|with|his|her)\s)(heads?|mouths?|wings|legs|tails?|tongues?|claws|eyes|necks?|jaws|beaks?|bills?|crests?|ears)\s+(lowered|raised|open|spread|extended|outstretched|out|up|down|closed|tucked|fanned|forward|back)\b/i;

/** A model reply's first-line parts, cleaned, or null when unusable. */
export function normaliseLine(raw, { named = false, plural = false } = {}) {
  const pick = named ? raw?.action : raw?.line;
  let text = tidy(pick ?? "")
    .replace(/[.]+$/, "")
    .replace(BACKDROP, "")
    .trim();
  // Only a body part that starts its own phrase in a line with no "with" yet:
  // "with its long curved bill tucked" and "head down with its legs spread"
  // read fine as they are.
  text = text.replace(BARE_BODY_PART, (m, lead, part, how) =>
    /\bwith\b/i.test(text)
      ? m
      : `${lead}with ${plural ? "their" : "its"} ${part} ${how}`,
  );
  if (!text || text.length > 70 || NEVER.test(text)) return null;
  if (named) text = text.replace(/^\p{Lu}(?!\p{Lu})/u, (c) => c.toLowerCase());
  else text = text.charAt(0).toUpperCase() + text.slice(1);
  return named ? { action: text } : { text };
}

/** Offline stand-in so the pipeline runs without a model. */
export function mockLines(items) {
  return {
    items: items.map((x) =>
      x.named ? { id: x.id, action: "resting" } : { id: x.id, line: x.subject },
    ),
  };
}
