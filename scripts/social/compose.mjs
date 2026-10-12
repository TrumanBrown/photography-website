/**
 * Putting an Instagram post together from what's already known about the
 * photo:
 *
 *   - the first line and the reaction after it, in Truman's voice
 *     (scripts/photos/voice.mjs), with the fuller place; the website's plain
 *     first line (scripts/photos/lines.mjs) when there's no voiced one
 *   - one fact about the species, or the place when there's no species, from
 *     its Wikipedia article (scripts/photos/facts.mjs), rotated across posts
 *   - the IUCN line, only from iNaturalist's global IUCN status
 *   - the gear line, from EXIF
 *   - the link line, pointing at the site through the link in the bio
 *   - five hashtags (hashtags.mjs)
 */
import { allowedNames } from "../photos/website.mjs";

// Words that say how big a place is, not which: "Portland area" is Portland.
const PLACE_SIZE = new Set(["area", "region", "range", "around", "greater"]);

/** "Yellow Aster Butte, North Cascades, Washington": the most specific place, then the region. */
export function placeLine(session, first) {
  const parts = [first, ...String(session.location ?? "").split(",")]
    .map((s) => s?.trim())
    .filter(Boolean);
  const kept = [];
  const words = (p) =>
    p
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => !PLACE_SIZE.has(w))
      .map((w) => w.replace(/s$/, ""));
  for (const part of parts) {
    // "Washington" adds nothing after "Western Washington", nor "Portland
    // area" after "Portland", nor "Cascade Range" after "Cascades".
    if (kept.some((k) => words(part).every((w) => words(k).includes(w))))
      continue;
    kept.push(part);
  }
  return kept.join(", ");
}

/**
 * Assemble the caption from its parts; empty parts are left out. The first
 * paragraph is the first line, then the reaction; the fact gets its label
 * here, because the copy rules ban "Fun fact" everywhere else.
 */
export function assembleCaption({
  headline,
  comment = "",
  body,
  iucn,
  gear,
  pointer,
  hashtags,
}) {
  const text = [
    comment ? `${headline}. ${comment}` : headline,
    [
      body ? `Fun fact: ${body}` : "",
      iucn ? `Listed as ${iucn} on the IUCN Red List.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    [gear, pointer].filter(Boolean).join("\n"),
    hashtags.join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
  return text.length <= 2200 ? text : `${text.slice(0, 2190).trimEnd()}...`;
}

/** The extra place words a post may ground against (the session's own names). */
export function sessionNames(session) {
  return allowedNames(session).join(" ");
}
