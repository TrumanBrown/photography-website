/**
 * The one look a vision model takes at each photograph.
 *
 * It returns neutral facts (what's in the frame, what it's doing, the light),
 * never finished copy and never an identification: when the photo matches one
 * of your iNaturalist observations, that identification is handed to the model
 * as fact, and it only checks the photo isn't plainly something else.
 *
 * Everything public is rendered from this record later, by code or by cheap
 * text-only calls (website.mjs, ../social/compose.mjs), so a rule change for
 * captions never means paying to look at every photo again.
 */
import { GROUPS } from "./groups.mjs";
import { captureWhen, displayName, lint, tidy } from "./text.mjs";

/** Bump when the prompt or fields change enough that old analyses should be redone. */
export const ANALYSIS_VERSION = 1;

const SPECIES_RANKS = new Set([
  "species",
  "subspecies",
  "variety",
  "form",
  "hybrid",
]);

/**
 * How a matched observation may name the photo:
 *   "species"  the full name, e.g. Northwestern garter snake (Thamnophis ordinoides)
 *   "group"    a coarser rank, e.g. spiny lizard (Sceloporus)
 *   null       nothing usable
 * iNaturalist is the source of truth at whatever rank it has, including your
 * own identifications that haven't reached research grade yet.
 */
export function idLevel(taxon) {
  if (!taxon?.name) return null;
  return SPECIES_RANKS.has(taxon.rank) ? "species" : "group";
}

const GRADE = {
  research: "research grade, confirmed by other naturalists",
  needs_id: "the photographer's own identification",
  casual: "the photographer's own identification",
};

function idLines(taxon, quality) {
  const level = idLevel(taxon);
  if (!level) {
    return [
      "- No identification exists for anything in this photo. Never name a species, genus or family.",
      '  Use plain group words for organisms: "Heron", "Tree frog", "Jumping spider", "Mushroom", "Fern".',
    ];
  }
  const common = displayName(taxon.common);
  const lineage = ["class", "order", "family"]
    .map((r) => taxon.lineage?.[r])
    .filter(Boolean)
    .map((l) => (l.common ? `${l.name} (${l.common})` : l.name))
    .join(" > ");
  const grade = GRADE[quality] ?? "identified on iNaturalist";
  if (level === "species") {
    return [
      `- The main organism is identified on iNaturalist as ${common ? `${common} (${taxon.name})` : taxon.name}, ${grade}.${lineage ? ` Lineage: ${lineage}.` : ""}`,
      "  Treat that as fact. Code puts the name in the caption, so `subject` only needs a plain word for it.",
    ];
  }
  return [
    `- The main organism is identified on iNaturalist only to ${taxon.rank} ${taxon.name}${common ? ` (${common})` : ""}, ${grade}.${lineage ? ` Lineage: ${lineage}.` : ""}`,
    `  Treat that as fact, and never be more specific than it: \`subject\` is a singular plain name that fits it, e.g. "Spiny lizard" for genus Sceloporus.`,
  ];
}

/**
 * @param session      { title, location }
 * @param clock        camera clock reading, for the month and year
 * @param taxon        the iNaturalist taxon matched to this photo, or null
 * @param quality      that observation's quality grade
 * @param allowedNames the only place and landmark names the model may use
 */
export function analysisPrompt({
  session,
  clock,
  taxon = null,
  quality = null,
  allowedNames = [],
}) {
  const when = captureWhen(clock);
  const known = [
    `- Photographed for the session "${session.title}"${session.location ? ` (${session.location})` : ""}${when ? `, ${when}` : ""}.`,
    ...idLines(taxon, quality),
  ];
  const names = allowedNames.length
    ? allowedNames.map((n) => `"${n}"`).join(", ")
    : "(none)";

  return `You're writing a factual record of one photograph. Nothing you write is published as-is: code builds captions out of your fields, so keep every field literal, plain and accurate.

What's known (treat as fact):
${known.join("\n")}

Place and landmark names you may use, and no others: ${names}

Reply with JSON only, no code fence:
{
  "group": one of ${JSON.stringify(GROUPS)},
  "subject": "...",
  "count": 1,
  "scene": "...",
  "conditions": "...",
  "setting": "...",
  "description": "...",
  "landmark": "...",
  "place_tag": "...",
  "appeal": 5,
  "skip": null,
  "id_check": "..."
}

Fields:
- group: the closest kind of main subject.
- subject: the main subject as a short noun phrase in sentence case, singular unless several are visible: "Heron", "Tree frog", "Two harbor seals", "Snow-covered peak", "Waterfall", "Prayer flags". A landmark name only if it's in the list above and is clearly the main subject.
- count: how many individuals of the main organism are clearly visible; 0 for landscapes and objects.
- scene: what the subject is doing and what it's on or in, as a lowercase phrase of 2 to 10 words that reads straight after the subject: "coiled on a mossy log", "perched on a bare branch", "reflected in a still tarn", "held up in front of a rocky peak". Include whatever sets this frame apart from similar ones: the backdrop, a second subject, snow on the slopes, a trail, a stream. No place names.
- conditions: only light or weather that stands out, as a short lowercase phrase that can follow the scene: "in fog", "at sunset", "at night", "under fresh snow", "in light rain", "under storm clouds". Ordinary daylight, sunshine, shade and blue sky don't count: use "" for those. Never guess at weather you can't see.
- setting: the kind of place in 1 to 4 words: "tide pool", "rainforest floor", "alpine meadow", "canal bank", "city street".
- description: 1 or 2 plain sentences, under 250 characters, describing the frame for someone who can't see it: the subject, its posture and colour, the light, the background.
- landmark: a named peak, lake, river or landmark that is clearly in the photo AND in the list above, else "".
- place_tag: the one name from the list above that people would most likely search for this photo, else "".
- appeal: integer 1 to 10, how strongly this frame would stop someone scrolling: sharpness, light, composition, how interesting the subject is. Be critical; most frames are 4 to 7.
- skip: "blurry" if the main subject is out of focus, "people" if an identifiable person is the main subject, "unclear" if there's no clear subject, else null.
- id_check: "fits" if the photo plausibly shows the identified organism, "conflict" only if the main subject is plainly a different kind of thing (a bird when the identification is a frog, or no organism at all), "n/a" when there's no identification. Don't second-guess the species itself.

Rules for every field:
- Only what you can see, plus the facts above. No behaviour, habitat, rarity, season, distance or history you can't see.
- Plain words. Never: stunning, breathtaking, vibrant, majestic, captivating, nestled, serene, picturesque, showcasing.
- No em dashes, no emoji, no exclamation marks, no hashtags.`;
}

/** Confirm a same-moment observation shows the same organism (tier 2 matching). */
export function comparePrompt(labels) {
  return `Image 1 is a photograph. Images 2 to ${labels.length + 1} are photos from iNaturalist observations the same photographer made within a few minutes of it:
${labels.map((l, i) => `- Image ${i + 2}: observation of ${l}`).join("\n")}

Does any of them show the same animal or plant as image 1 (the same individual, or at least clearly the same species with matching markings)? Reply with JSON only:
{"match": <image number 2-${labels.length + 1}, or null>, "confidence": "high" | "medium" | "low"}
Answer null if image 1's main subject isn't an organism or if none clearly match.`;
}

const SKIPS = new Set(["blurry", "people", "unclear"]);
const ID_CHECKS = new Set(["fits", "conflict", "n/a"]);

const phrase = (text, max) =>
  tidy(text)
    .replace(/[.]+$/, "")
    .replace(/^(?:and|while)\s+/i, "")
    .slice(0, max)
    .trim();

/**
 * Turn a model reply into the stored record. Never throws; fields that break
 * the rules are blanked rather than kept, and listed in `problems`.
 */
export function normaliseAnalysis(raw, { taxon = null } = {}) {
  const problems = [];
  const out = {
    group: GROUPS.includes(raw?.group) ? raw.group : "other",
    subject: phrase(raw?.subject, 80),
    count: Math.max(0, Math.min(99, Math.round(Number(raw?.count) || 0))),
    scene: phrase(raw?.scene, 90).replace(/^\p{Lu}(?!\p{Lu})/u, (c) =>
      c.toLowerCase(),
    ),
    conditions: phrase(raw?.conditions, 40).toLowerCase(),
    setting: phrase(raw?.setting, 40).toLowerCase(),
    description: tidy(raw?.description).slice(0, 400),
    landmark: phrase(raw?.landmark, 60),
    placeTag: phrase(raw?.place_tag, 60),
    appeal: Math.min(10, Math.max(1, Math.round(Number(raw?.appeal) || 5))),
    skip: SKIPS.has(raw?.skip) ? raw.skip : null,
    idCheck: ID_CHECKS.has(raw?.id_check)
      ? raw.id_check
      : idLevel(taxon)
        ? "fits"
        : "n/a",
  };
  if (out.subject)
    out.subject = out.subject.charAt(0).toUpperCase() + out.subject.slice(1);
  for (const field of ["subject", "scene", "conditions", "description"]) {
    const found = lint(out[field]);
    if (found.length) {
      problems.push(`${field} ${found.join(", ")}`);
      out[field] = "";
    }
  }
  if (!out.subject) problems.push("no subject");
  if (!out.description) problems.push("no description");
  return { analysis: out, problems };
}

/** Offline stand-in so the pipeline runs end to end without a model. */
export function mockAnalysis() {
  return {
    group: "other",
    subject: "Subject",
    count: 1,
    scene: "in the frame",
    conditions: "",
    setting: "outdoors",
    description:
      "Mock description written without a model. Configure one to analyse photos for real.",
    landmark: "",
    place_tag: "",
    appeal: 5,
    skip: null,
    id_check: "n/a",
  };
}
