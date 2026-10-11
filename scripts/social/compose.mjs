/**
 * Writing the Instagram post, from the photo's stored analysis. The photo
 * itself isn't looked at again: one vision call per photo already happened
 * (scripts/photos/analyse.mjs), and this is a cheap text-only call on top.
 *
 * What's decided by code (never by the model):
 *   - the first line: the same caption the website uses, with a fuller place
 *   - the species name, only from the iNaturalist observation matched to the photo
 *   - the IUCN line, only from iNat's global IUCN status
 *   - the gear line, from EXIF
 *   - the hashtags (see hashtags.mjs)
 * What the model writes: one to three sentences of body, from the stored facts
 * and, for an identified species, its reference summary.
 */
import { idLevel } from "../photos/analyse.mjs";
import {
  captureWhen,
  lint,
  speciesLabel,
  tidy,
  unverifiedSpecies,
} from "../photos/text.mjs";
import {
  allowedNames,
  groundingText,
  ungroundedInProse,
} from "../photos/website.mjs";

/** "Yellow Aster Butte, North Cascades, Washington": the most specific place, then the region. */
export function placeLine(session, first) {
  const parts = [first, ...String(session.location ?? "").split(",")]
    .map((s) => s?.trim())
    .filter(Boolean);
  const seen = new Set();
  return parts
    .filter((p) => {
      const k = p.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(", ");
}

export function bodyPrompt({
  owner,
  session,
  analysis,
  headline,
  clock,
  taxon,
  voiceRules,
  feedback,
}) {
  const level = analysis.idCheck === "conflict" ? null : idLevel(taxon);
  const when = captureWhen(clock);
  const facts = [
    `- First line of the post, already written (don't repeat it): "${headline}"`,
    `- What's in the frame: ${analysis.description}`,
    analysis.setting ? `- Setting: ${analysis.setting}` : "",
    analysis.conditions ? `- Light or weather: ${analysis.conditions}` : "",
    `- Session: "${session.title}"${session.location ? `, ${session.location}` : ""}${when ? `, ${when}` : ""}`,
  ].filter(Boolean);
  const id = level
    ? [
        `- Identified on iNaturalist as ${level === "species" ? speciesLabel(taxon) : `${taxon.rank} ${taxon.name}`}.`,
        taxon.summary
          ? `- Reference summary (Wikipedia, via iNaturalist). It may describe the genus or family rather than this species: "${taxon.summary}"`
          : "- No reference summary is available, so add no facts beyond what's above.",
      ]
    : [
        "- Nothing in the photo is identified. Don't name any species, genus or family; use plain group words.",
      ];

  return `You're writing the body of one Instagram post for a photograph by ${owner}. People find it by searching Instagram and Google for animals, places and camera gear, so it has to be accurate.

Facts (nothing else is known):
${facts.join("\n")}
${id.join("\n")}

Write 1 to 3 short sentences:
- Start with something specific in the frame: colour, posture, texture, light, what it's on. Not "This photo shows".
${level && taxon.summary ? '- Then at most one fact from the reference summary, reworded plainly. If the summary is about the genus or family, say so ("Leaf frogs like this one..."). Add no facts that aren\'t in it.' : "- Add no facts beyond the ones above."}
- Never state behaviour, rarity, seasons, habitat, distances, elevations or history that isn't given above.
- First person is fine when it fits, but don't invent what happened.
- No hashtags, no @mentions, no emoji, no exclamation marks, no em dashes, no questions to the reader.

${voiceRules ? `The photographer's voice rules (follow them):\n${voiceRules}\n\n` : ""}Reply with JSON only: {"body": "..."}${feedback ? `\n\nYour previous draft was rejected: ${feedback}. Fix that.` : ""}`;
}

/** Assemble the caption from checked parts. */
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

/** Turn a drafted body into the final post, or explain why it can't be used. */
export function finishPost({
  headline,
  body: drafted,
  alt,
  session,
  taxon,
  level,
  gear,
  hashtags,
  pointer,
  lexicon = [],
}) {
  const body = tidy(drafted);
  const usedTaxon = level ? taxon : null;
  // Names in the reference summary are fair game: the body may repeat its fact.
  const allowed = `${groundingText(session, usedTaxon)} ${usedTaxon?.summary ?? ""}`;
  const problems = [...lint(body)];
  const named = unverifiedSpecies(
    `${body} ${alt}`,
    lexicon,
    usedTaxon ? allowed : "",
  );
  if (named.length)
    problems.push(
      `names ${named.slice(0, 3).join(", ")} without an identification for this photo`,
    );
  const strangers = [...new Set(ungroundedInProse(body, allowed))];
  if (strangers.length)
    problems.push(
      `names ${strangers.slice(0, 3).join(", ")}, which the facts don't mention`,
    );
  if (!body) problems.push("empty body");
  if (problems.length) return { problem: problems.join("; ") };

  return {
    caption: assembleCaption({
      headline,
      body,
      iucn: level === "species" ? taxon.iucn : null,
      gear,
      pointer,
      hashtags,
    }),
    alt: tidy(alt).slice(0, 1000),
    headline,
  };
}

/** The extra place words a post may ground against (the session's own names). */
export function sessionNames(session) {
  return allowedNames(session).join(" ");
}

/** Offline stand-in so the whole pipeline can run without a model. */
export function mockBody() {
  return {
    body: "Mock body written without a model. Configure one to write real posts.",
  };
}
