/**
 * Writing the post: prompts for the vision model, caption assembly, and the
 * checks that keep captions accurate and in the site's voice.
 *
 * What's decided by code (never by the model):
 *   - the species name, only from a research-grade iNat observation of the shot
 *   - the IUCN line, only from iNat's global IUCN status
 *   - the gear line, from EXIF
 *   - the hashtags (see hashtags.mjs)
 *   - any place name, which must already appear in the session title or location
 * What the model writes: what's visible in the frame, the alt text, a short
 * description in the photographer's voice, and an appeal score used for ordering.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./settings.mjs";
import { GROUPS } from "./hashtags.mjs";

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

/** iNat's "Northwestern Garter Snake" -> "Northwestern garter snake", keeping proper nouns. */
export function displayName(common) {
  if (!common) return "";
  return common
    .split(" ")
    .map((word, i) => {
      if (i === 0) return word;
      if (
        /'s$/i.test(word) ||
        KEEP_CAPITALISED.has(word) ||
        /^[A-Z]{2,}$/.test(word)
      )
        return word;
      return word.toLowerCase();
    })
    .join(" ");
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

/** Capitalised words in `phrase` that don't appear anywhere in the allowed session text. */
export function ungroundedNames(phrase, allowedText) {
  const allowed = norm(allowedText);
  return String(phrase ?? "")
    .split(/[\s,()/·]+/)
    .slice(1)
    .filter((w) => /^\p{Lu}/u.test(w))
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((w) => w && !allowed.includes(norm(w)));
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

function captureWhen(clock) {
  const m = /^(\d{4})-(\d{2})/.exec(clock ?? "");
  if (!m) return "";
  // Month and year only: camera clocks here drift by hours, so time of day isn't trustworthy.
  return new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function postPrompt({
  owner,
  session,
  facts,
  gear,
  taxon,
  speciesOk,
  voiceRules,
  feedback,
}) {
  const known = [
    `- Session title: "${session.title}"`,
    `- Session location: "${session.location || "(none)"}"`,
    session.description
      ? `- The photographer's own description of the session: "${session.description}"`
      : "",
    facts?.clock ? `- Captured: ${captureWhen(facts.clock)}` : "",
    gear ? `- Camera and settings: ${gear}` : "",
  ].filter(Boolean);

  const id = speciesOk
    ? [
        `- Identified on iNaturalist from this exact photo (research grade, confirmed by other naturalists): ${speciesLabel(taxon)}.`,
        `  Lineage: ${["class", "order", "family"]
          .map(
            (r) =>
              taxon.lineage?.[r] &&
              `${r} ${taxon.lineage[r].name}${taxon.lineage[r].common ? ` (${taxon.lineage[r].common})` : ""}`,
          )
          .filter(Boolean)
          .join(", ")}.`,
        taxon.summary
          ? `- Reference summary (Wikipedia, via iNaturalist). It may describe the genus or family rather than this species: "${taxon.summary}"`
          : "- No reference summary is available, so add no facts beyond what's visible.",
      ]
    : [
        "- There is no verified identification for this photo. Do not name any species, genus or family.",
        '  Use plain group words instead ("a tree frog", "a heron", "a jumping spider").',
      ];

  return `You are writing one Instagram post for a photograph by ${owner}, who photographs wildlife, macro subjects and landscapes. It's published under his name to people who search Instagram and Google for animals, places and camera gear, so it has to be accurate and findable.

What is known (treat these as facts; nothing else is):
${known.join("\n")}
${id.join("\n")}

Look carefully at the photograph and reply with JSON only, no code fence:
{
  "group": one of ${JSON.stringify(GROUPS)},
  "subject": "generic noun phrase for the main subject, sentence case, no proper nouns${speciesOk ? " (ignored here, the verified name is used)" : ""}",
  "detail": "a few words for what it's doing or where it sits, no place names, e.g. 'on a thin twig at night'",
  "place_line": "most specific place first, then region, using ONLY names from the session title or location, e.g. 'Guayacán, Limón Province, Costa Rica'",
  "body": "1 to 3 short sentences, see rules",
  "alt_text": "one or two plain sentences describing the image for someone who can't see it, under 300 characters",
  "place_tag": "the single place word or phrase from the session title or location that people would search, e.g. 'Tortuguero' or 'Costa Rica'",
  "landmark": "a named peak, lake or landmark visible in the photo ONLY if the session title, location or description names it, else empty",
  "appeal": integer 1-10 for how strongly this frame would stop someone scrolling (sharp subject, light, composition, interest),
  "skip": null, or "blurry" if the main subject is out of focus, or "people" if an identifiable person is the main subject, or "unclear" if there's no clear subject
}

Rules for body:
- Start with something specific you can see in this frame: colour, posture, texture, light, what it's on. Not "This photo shows".
${speciesOk ? '- Then at most one fact taken from the reference summary, reworded plainly. If the summary is about the genus or family, say so ("Leaf frogs like this one..."). Add no facts that aren\'t in it.' : "- Add no facts about the animal or place beyond what's visible and what the session description says."}
- Never state behaviour, rarity, seasons, habitat, distances, elevations or history that isn't given above.
- First person is fine when it fits ("I found...") but don't invent what happened.
- No hashtags, no @mentions, no emoji, no exclamation marks, no em dashes, no questions to the reader.
- Plain words. Prefer one real detail over a list of adjectives.

${voiceRules ? `The photographer's voice rules (follow them):\n${voiceRules}\n` : ""}${feedback ? `\nYour previous draft was rejected: ${feedback}. Fix that.` : ""}`;
}

export function comparePrompt(labels) {
  return `Image 1 is a photograph. Images 2 to ${labels.length + 1} are photos from iNaturalist observations the same photographer made within a few minutes of it:
${labels.map((l, i) => `- Image ${i + 2}: observation of ${l}`).join("\n")}

Does any of them show the same animal or plant as image 1 (the same individual, or at least clearly the same species with matching markings)? Reply with JSON only:
{"match": <image number 2-${labels.length + 1}, or null>, "confidence": "high" | "medium" | "low"}
Answer null if image 1's main subject isn't an organism or if none clearly match.`;
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

/** Turn a model draft into the final post, or explain why it can't be used. */
export function finishPost({
  draft,
  session,
  gear,
  taxon,
  speciesOk,
  hashtags,
  pointer,
  lexicon = [],
}) {
  const allowedText = `${session.title} ${session.location}`;
  let detail = tidy(draft.detail).replace(/[.]$/, "");
  // "on a Heliconia leaf" would name an unverified plant; drop names the session doesn't support.
  if (ungroundedNames(`x ${detail}`, allowedText).length) detail = "";
  let place = tidy(draft.place_line);
  if (!place || ungroundedNames(`x ${place}`, allowedText).length)
    place = session.location || "";

  let subject;
  if (speciesOk) {
    subject = speciesLabel(taxon);
  } else {
    subject = tidy(draft.subject).replace(/[.]$/, "");
    const bad = ungroundedNames(
      subject,
      `${allowedText} ${session.description ?? ""}`,
    );
    if (bad.length)
      return {
        problem: `subject names something not in the session text (${bad.join(", ")})`,
      };
    subject = subject.charAt(0).toUpperCase() + subject.slice(1);
  }
  const headline = [subject + (detail ? ` ${detail}` : ""), place]
    .filter(Boolean)
    .join(", ");
  const body = tidy(draft.body);
  const alt = tidy(draft.alt_text).slice(0, 1000);
  const problems = [...lint(headline), ...lint(body), ...lint(alt)];
  // Only the verified species (and names in its reference summary) may appear.
  const allowedNames = speciesOk
    ? [
        taxon.common,
        taxon.name,
        taxon.summary,
        ...Object.values(taxon.lineage ?? {}).flatMap((l) => [
          l.name,
          l.common,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const named = unverifiedSpecies(
    `${headline} ${body} ${alt}`,
    lexicon,
    allowedNames,
  );
  if (named.length) {
    problems.push(
      `names ${named.slice(0, 3).join(", ")} without a verified ID for this photo`,
    );
  }
  if (!body) problems.push("empty body");
  if (problems.length) return { problem: problems.join("; ") };

  return {
    caption: assembleCaption({
      headline,
      body,
      iucn: speciesOk ? taxon.iucn : null,
      gear,
      pointer,
      hashtags,
    }),
    alt,
    headline,
  };
}

/** Offline stand-in so the whole pipeline can run without an API key. */
export function mockDraft({ session, speciesOk, taxon }) {
  return {
    group:
      speciesOk && taxon?.lineage?.order?.name === "Anura" ? "frog" : "other",
    subject: "Subject",
    detail: "in the frame",
    place_line: session.location || "",
    body: "Mock description written without a model. Add a model API key to draft real captions.",
    alt_text: `Photograph from ${session.title}`,
    place_tag: "",
    landmark: "",
    appeal: 5,
    skip: null,
  };
}
