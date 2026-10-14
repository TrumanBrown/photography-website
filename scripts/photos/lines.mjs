/**
 * The first line of a caption: the photo's alt text and image-search text,
 * so it's specific about what's actually in the frame, in plain words:
 *
 *   "Red-eyed tree frog (Agalychnis callidryas) clinging to a stem at night"
 *   "Mount Baker reflected in a tarn"
 *   "Mount Baker above fall-colored huckleberry"
 *   "Shanghai skyline across the river at night"
 *
 * What a photographer would say and someone would search for: what it's
 * doing, what it's on, what's in front of the view. Never the pose or which
 * way it faces, the background blur or the framing: nobody searches for
 * those, and they're what made the captions read as machine-written.
 *
 * Written by one text-only call per batch of photos, from the notes the
 * vision analysis already stored, so no photo is looked at again. For an
 * identified species the model writes only the words after the name, which
 * code supplies.
 */
import { tidy } from "./text.mjs";
import { backdropIn, withoutPose } from "./website.mjs";

/** Bump when the prompt changes enough that every first line should be rewritten. */
export const LINE_VERSION = 5;

export function linesPrompt(items) {
  return `Each item below is notes on one photograph from Truman's photography site. Write the first line of its caption. It's the photo's alt text too, and what Google Images reads to decide which searches it shows up for, so be specific about what's in the photo, in the plain words people search with.

- When "named" is given (an identified species), write only what follows the name: what it's doing and what it's on or in ("feeding on a heliconia flower", "on barnacle-covered rock", "in a tide pool", "perched on a mossy branch", "swallowing a fish", "in flight"). Field "action".
- Otherwise write the whole line: what the photo is of, then what makes this one: what's in front of the view or around it, the season, the weather or light when it's the point ("Mount Baker reflected in a tarn", "Mount Baker above fall-colored shrubs", "Gunn Peak above a small tarn", "Waterfall dropping into a rocky gorge"). Field "line". Start with a capital.

Rules:
- An action is 2 to 8 words, a line 3 to 10. No full stop. Lowercase except names.
- The photos are from one outing, and ones with the same subject (the same peak, the same species) are listed together. Give each its own line from what really differs in its notes: what's in front, a reflection, the season, the light, the weather, what it's doing, what it's on. If two are truly the same, they can share a line.
- Never pose or orientation: which way it faces or looks, a head turned, a bill, tail or wings raised or lowered, perched upright, in profile. Nobody searches for those.
- Never the background blur or the framing: no "against", "background", "blurred", "frame", "foreground". For a view, what's behind the subject is the scene, so name it plainly ("Mount Baker beyond a ridge").
- Words people search: "tarn" for a small lake or pond in the mountains, "reflected in" for a reflection, "fall colors" for autumn foliage, "wildflowers", "at sunset", "in fog", "at night".
- People, objects and views: when the notes give a landmark and it's behind them, it's usually the point, so keep it ("a hiker below Everest"). Only a landmark from the notes.
- Body parts take "with" ("with its mouth open"), and only when that's what it's doing.
- Never vague words like "object", "item", "surface", "something".
- Never "illuminated", "majestic", "towering", "nestled", "lush", "vibrant", "stunning", "breathtaking".
- Use only names that are in the notes.

Examples:
- "perched on a stem facing right" (a hummingbird) -> action "perched on a flower stem"
- "clinging to a green stem against a dark background" -> action "clinging to a stem at night"
- "holding an insect in its bill on a mossy post" -> action "with an insect in its bill on a mossy post"
- "preening its feathers against a blurred green background" -> action "preening along the canal"
- "flying with its wings raised against a blue sky" -> action "in flight"
- "rising beyond a pond reflecting trees" (Mount Baker, from Yellow Aster Butte) -> line "Mount Baker reflected in a tarn"
- "rising above red and yellow shrubs" (Mount Baker) -> line "Mount Baker above fall-colored shrubs"
- "Gull facing right on wet stones" -> line "A gull on the stony shore"
- "Illuminated city skyline overlooking a river with a lit boat" (at night) -> line "The skyline across the river at night"
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
  // Just the name, on purpose: the photo is of it sitting there.
  if (named && typeof pick === "string" && !pick.trim()) return { action: "" };
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
  // Then the pose comes out: "standing with its head lowered" is "standing".
  text = withoutPose(text);
  // "perched", "standing": all that's left once the pose is gone says nothing.
  if (named && /^(?:perched|sitting|standing|resting|posing)$/i.test(text))
    return { action: "" };
  if (!text || text.length > 70 || NEVER.test(text) || backdropIn(text))
    return null;
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
