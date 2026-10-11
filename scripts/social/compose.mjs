/**
 * Putting an Instagram post together. Every part is decided by code from
 * what's already known about the photo, so writing a post needs no model:
 *
 *   - the first line: the photo's caption (scripts/photos/lines.mjs), with
 *     the fuller place
 *   - one fact about the species, or the place when there's no species, from
 *     its Wikipedia article (scripts/photos/facts.mjs), rotated across posts
 *   - the IUCN line, only from iNaturalist's global IUCN status
 *   - the gear line, from EXIF
 *   - the link line, pointing at the site through the link in the bio
 *   - five hashtags (hashtags.mjs)
 */
import { allowedNames } from "../photos/website.mjs";

/** "Yellow Aster Butte, North Cascades, Washington": the most specific place, then the region. */
export function placeLine(session, first) {
  const parts = [first, ...String(session.location ?? "").split(",")]
    .map((s) => s?.trim())
    .filter(Boolean);
  const kept = [];
  const words = (p) => p.toLowerCase().split(/\s+/);
  for (const part of parts) {
    // "Washington" adds nothing after "Western Washington".
    if (kept.some((k) => words(part).every((w) => words(k).includes(w))))
      continue;
    kept.push(part);
  }
  return kept.join(", ");
}

/** Assemble the caption from its parts; empty parts are left out. */
export function assembleCaption({
  headline,
  body,
  iucn,
  gear,
  pointer,
  hashtags,
}) {
  const text = [
    headline,
    [body, iucn ? `Listed as ${iucn} on the IUCN Red List.` : ""]
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
