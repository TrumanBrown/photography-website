/**
 * Website copy, rendered from the stored analysis. No photo is looked at here.
 *
 *   captionFor          one line per photo, built by code:
 *                       "<subject> <scene> <conditions>, <place>"
 *                       e.g. "Northwestern garter snake (Thamnophis ordinoides)
 *                       coiled on a mossy log, Sauk Mountain"
 *   sessionDigest       everything known about a session's photos, condensed
 *   descriptionPrompt   one text-only call per session turns the digest into
 *                       the session description, in the site's voice
 *   descriptionProblems the checks a description has to pass before it's used
 *
 * The caption is the photo's alt text, lightbox caption and structured-data
 * caption all at once, so it stays short, literal and free of hashtags.
 */
import { idLevel } from "./analyse.mjs";
import {
  displayName,
  lint,
  tidy,
  ungroundedNames,
  unverifiedSpecies,
} from "./text.mjs";

/** Screen readers and image search both favour alt text around this length. */
export const CAPTION_MAX = 125;
export const DESCRIPTION_MAX = 700;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_TAIL = new RegExp(
  `,?\\s*(?:${MONTHS.join("|")})\\s+\\d{4}\\s*$`,
  "i",
);
export const TITLE_SHAPE = new RegExp(`, (?:${MONTHS.join("|")}) \\d{4}$`);
const SLUG_NOISE =
  /^(?:\d+|jan|feb|mar|apr|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december|january|february|march|april|spring|summer|fall|autumn|winter|trip|day|days|part|pt)$/i;

/** What the build shows when nobody has titled a session: the folder name, tidied. */
export function humanize(slug) {
  return String(slug ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function hasRealTitle(session) {
  const title = String(session.title ?? "").trim();
  return Boolean(title) && title !== humanize(session.slug);
}

/** "mt-baker-fall-2026" -> "Mount Baker": the place words in a folder name you chose. */
export function slugPlace(slug) {
  const words = String(slug ?? "")
    .split(/[-_\s]+/)
    .filter((w) => w && !SLUG_NOISE.test(w))
    .map((w) =>
      /^mt$/i.test(w) ? "mount" : /^mtn$/i.test(w) ? "mountain" : w,
    );
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** The place and landmark names a caption may use: only ones you've written somewhere. */
export function allowedNames(session) {
  const title = hasRealTitle(session)
    ? String(session.title).replace(MONTH_TAIL, "")
    : "";
  const parts = [
    ...title.split(","),
    ...String(session.location ?? "").split(","),
    slugPlace(session.slug),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  return parts.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The most specific place for a caption: "Yellow Aster Butte", "Tortuguero canals". */
export function placeLabel(session) {
  if (hasRealTitle(session)) {
    const first = String(session.title)
      .replace(MONTH_TAIL, "")
      .split(",")[0]
      .trim();
    if (first) return first;
  }
  return String(session.location ?? "")
    .split(",")[0]
    .trim();
}

const NUMBER_WORDS = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const IRREGULAR = {
  mouse: "mice",
  goose: "geese",
  louse: "lice",
  ox: "oxen",
  person: "people",
  child: "children",
  tooth: "teeth",
  foot: "feet",
};
const UNCHANGED =
  /(?:fish|sheep|deer|moose|bison|elk|salmon|trout|squid|shrimp|cod|swine|species|series|aircraft)$/i;

/** Plural of a name's last word: "garter snake" -> "garter snakes", "Canada goose" -> "Canada geese". */
export function plural(name) {
  const words = String(name).split(" ");
  const last = words.pop() ?? "";
  const lower = last.toLowerCase();
  let out;
  if (IRREGULAR[lower]) out = IRREGULAR[lower];
  else if (UNCHANGED.test(last)) out = last;
  else if (/[^aeiou]y$/i.test(last)) out = `${last.slice(0, -1)}ies`;
  else if (/(?:s|x|z|ch|sh)$/i.test(last)) out = `${last}es`;
  else out = `${last}s`;
  return [...words, out].join(" ");
}

const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "Northwestern garter snake (Thamnophis ordinoides)", or "Two harbor seals (Phoca vitulina)". */
export function speciesSubject(taxon, count = 1) {
  const common = displayName(taxon.common);
  if (!common) return taxon.name;
  if (count >= 2) {
    const many = plural(displayName(taxon.common, { midSentence: true }));
    const lead = count <= 10 ? `${NUMBER_WORDS[count]} ${many}` : many;
    return `${capitalise(lead)} (${taxon.name})`;
  }
  return `${common} (${taxon.name})`;
}

/** Ranks worth a scientific name in brackets; "Bird (Aves)" says nothing useful. */
const BRACKETED_RANKS = new Set([
  "genus",
  "subgenus",
  "section",
  "subtribe",
  "tribe",
  "subfamily",
  "family",
  "superfamily",
  "infraorder",
  "suborder",
  "order",
]);

const FALLBACK = {
  frog: "Frog",
  toad: "Toad",
  salamander: "Salamander",
  snake: "Snake",
  lizard: "Lizard",
  turtle: "Turtle",
  bird: "Bird",
  mammal: "Animal",
  insect: "Insect",
  butterfly: "Butterfly",
  moth: "Moth",
  dragonfly: "Dragonfly",
  beetle: "Beetle",
  spider: "Spider",
  scorpion: "Scorpion",
  crab: "Crab",
  fish: "Fish",
  "marine-invertebrate": "Sea creature",
  fungus: "Fungus",
  plant: "Plant",
  flower: "Flower",
  mountain: "Mountain view",
  glacier: "Glacier",
  lake: "Lake",
  river: "River",
  waterfall: "Waterfall",
  coast: "Coastline",
  forest: "Forest",
  desert: "Desert",
  sky: "Sky",
  city: "Street scene",
  temple: "Temple",
  village: "Village",
  people: "People",
};

/** Every name the photo has a right to use: your session text plus the matched taxon. */
export function groundingText(session, taxon) {
  return [
    ...allowedNames(session),
    taxon?.name,
    taxon?.common,
    ...Object.values(taxon?.lineage ?? {}).flatMap((l) => [l.name, l.common]),
  ]
    .filter(Boolean)
    .join(" ");
}

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** True when a fragment names nothing it isn't entitled to and passes the copy rules. */
function clean(fragment, { allowed, lexicon, taxonText, first = false }) {
  if (!fragment) return false;
  const probe = first ? fragment : `x ${fragment}`;
  return (
    !ungroundedNames(probe, allowed).length &&
    !unverifiedSpecies(fragment, lexicon, taxonText).length &&
    !lint(fragment).length
  );
}

/**
 * The website caption for one photo.
 *
 * @param analysis the stored analysis (analyse.mjs)
 * @param taxon    the matched iNaturalist taxon, or null
 * @param session  { slug, title, location }
 * @param lexicon  compiled species names (text.mjs compileLexicon), so a
 *                 caption can't name a species nobody identified
 * @param place    the place to end on; Instagram passes a fuller one
 * @param max      longest the line may be
 */
export function captionFor({
  analysis,
  taxon = null,
  session,
  lexicon = [],
  place = placeLabel(session),
  max = CAPTION_MAX,
}) {
  const a = analysis ?? {};
  const level = a.idCheck === "conflict" ? null : idLevel(taxon);
  const usedTaxon = level ? taxon : null;
  const allowed = groundingText(session, usedTaxon);
  const taxonText = usedTaxon ? groundingText({}, usedTaxon) : "";
  const ctx = { allowed, lexicon, taxonText };

  let subject;
  if (level === "species") {
    subject = speciesSubject(taxon, a.count);
  } else {
    subject = clean(a.subject, { ...ctx, first: true })
      ? a.subject
      : (FALLBACK[a.group] ?? "Photograph");
    if (
      level === "group" &&
      BRACKETED_RANKS.has(taxon.rank) &&
      !subject.includes(taxon.name)
    ) {
      subject = `${subject} (${taxon.name})`;
    }
  }
  const scene = clean(a.scene, ctx) ? a.scene : "";
  const conditions = clean(a.conditions, ctx) ? a.conditions : "";
  const said = norm(`${subject} ${scene}`);
  const where = place && !said.includes(norm(place)) ? place : "";

  const build = (parts) =>
    tidy(
      [[subject, ...parts.slice(0, -1)].filter(Boolean).join(" "), parts.at(-1)]
        .filter(Boolean)
        .join(", "),
    );
  const tries = [
    [scene, conditions, where],
    [scene, "", where],
    [scene, "", ""],
    ["", "", where],
    ["", "", ""],
  ];
  for (const parts of tries) {
    const text = build(parts);
    if (text.length <= max) return text;
  }
  return build(["", "", ""])
    .slice(0, max)
    .replace(/\s+\S*$/, "");
}

/**
 * Everything the session description may draw on, condensed from its photos.
 * `shots` are catalog shots with analysis; `taxa` is the taxon cache.
 */
export function sessionDigest({ session, shots, taxa = {}, captions = [] }) {
  const species = new Map();
  const groups = new Map();
  const unnamed = new Map();
  const conditions = new Map();
  const settings = new Map();
  const bump = (map, key, extra) => {
    if (!key) return;
    const cur = map.get(key) ?? { count: 0, ...extra };
    cur.count++;
    map.set(key, cur);
  };
  const analysed = shots.filter((s) => s.analysis);
  for (const s of analysed) {
    const a = s.analysis;
    const taxon = s.inat ? taxa[s.inat.taxon] : null;
    const level = a.idCheck === "conflict" ? null : idLevel(taxon);
    if (level === "species") {
      bump(species, displayName(taxon.common) || taxon.name, {
        scientific: taxon.name,
        kind: taxon.lineage?.class?.common ?? taxon.iconic ?? "",
      });
    } else if (level === "group") {
      bump(groups, `${a.subject || taxon.name} (${taxon.name})`);
    } else if (a.group !== "other" && a.subject) {
      bump(unnamed, a.subject.toLowerCase());
    }
    bump(conditions, a.conditions);
    bump(settings, a.setting);
  }
  const top = (map, n) =>
    [...map.entries()]
      .sort((x, y) => y[1].count - x[1].count || x[0].localeCompare(y[0]))
      .slice(0, n);
  const highlights = [...analysed]
    .sort((x, y) => y.analysis.appeal - x.analysis.appeal)
    .slice(0, 14)
    .map((s) => s.analysis.description)
    .filter(Boolean);
  const place = placeLabel(session);
  const tail = place ? `, ${place}` : null;
  const lines = [
    ...new Set(
      captions.map((c) =>
        tail && c.endsWith(tail) ? c.slice(0, -tail.length) : c,
      ),
    ),
  ];
  return {
    title: session.title,
    location: session.location,
    date: session.date,
    photos: shots.length,
    captions: lines.slice(0, 80),
    species: top(species, 25).map(([name, v]) => ({ name, ...v })),
    groups: top(groups, 12).map(([name, v]) => ({ name, count: v.count })),
    unnamed: top(unnamed, 15).map(([name, v]) => ({ name, count: v.count })),
    conditions: top(conditions, 6).map(([name, v]) => ({
      name,
      count: v.count,
    })),
    settings: top(settings, 8).map(([name, v]) => ({ name, count: v.count })),
    highlights,
  };
}

const monthYear = (date) => {
  const m = /^(\d{4})-(\d{2})/.exec(date ?? "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
};

/**
 * One text-only call per session, from every photo's caption plus the
 * identifications. `needTitle` / `needLocation` ask for those too, for a
 * session nobody has titled yet.
 */
export function descriptionPrompt({
  session,
  digest,
  voiceRules = "",
  avoidOpeners = [],
  needTitle = false,
  needLocation = false,
  feedback = null,
}) {
  const list = (items, fmt) =>
    items.length ? items.map(fmt).join("; ") : "(none)";
  const heading = [hasRealTitle(session) ? session.title : "", session.location]
    .filter(Boolean)
    .join(" · ");
  const facts = [
    `Identified on iNaturalist (the only species you may name): ${list(digest.species, (s) => `${s.name}${s.count > 1 ? ` x${s.count}` : ""}`)}`,
    `Identified only to a group: ${list(digest.groups, (g) => `${g.name}${g.count > 1 ? ` x${g.count}` : ""}`)}`,
    `Settings: ${list(digest.settings, (x) => x.name)}`,
    `Light and weather that stood out: ${list(digest.conditions, (c) => c.name)}`,
  ];
  const shape = [
    `"description": "2 to 4 sentences, under ${DESCRIPTION_MAX - 100} characters"`,
    needTitle
      ? `"title": "Place, Region, Month Year, e.g. \\"Sauk Mountain, Washington, June 2026\\". Take the place from the folder name (${session.slug}) and the month from ${monthYear(session.date) || "the photos"}."`
      : "",
    needLocation
      ? `"location": "the broader region, e.g. \\"North Cascades, Washington\\" or \\"Limón Province, Costa Rica\\""`
      : "",
  ].filter(Boolean);

  return `Write the short description at the top of one photo session page on Truman's photography site, in his voice. ${heading ? `The page already shows "${heading}" right above it, so don't repeat the place name or the date.` : ""}

Every photo in the session, as captioned (${digest.photos} photos):
${digest.captions.map((c) => `- ${c}`).join("\n")}

A few of the best frames in more detail:
${digest.highlights
  .slice(0, 6)
  .map((h) => `- ${h}`)
  .join("\n")}

${facts.join("\n")}

How to write it:
- Say what the session is mostly of, then single out two or three subjects worth a second look. Don't walk through the photos one by one.
- No filler: not "I also photographed", "There's also", "these frames", "this session".
- First person where it fits. Plain, specific words, sentences of different lengths.
- Common names mid-sentence are lowercase except proper nouns: "a turquoise-browed motmot", "an Ecuadorian hermit crab".
- Name species only from the identified list, by common name. Anything else gets plain words ("a heron", "a small toad").
- Only what the captions and facts support. Don't invent events, feelings, companions, weather, numbers or anything that happened off camera.
- Don't open with any of these words: ${avoidOpeners.length ? avoidOpeners.join(", ") : "(none yet)"}.

Two examples of the shape, from made-up sessions (don't copy their wording):
- "Frogs, and most of them at night. Red-eyed tree frogs on the undersides of leaves, a glass frog over the stream, and one very wet toad."
- "Granite spires and not much else. Snow still sits in the gullies, and the light is flat and gray in most of them."

${voiceRules ? `Truman's voice rules (follow them):\n${voiceRules}\n\n` : ""}Reply with JSON only: { ${shape.join(", ")} }${feedback ? `\n\nYour previous draft was rejected: ${feedback} Fix that.` : ""}`;
}

const EXTRA_BANNED =
  /\b(?:boasts?|nestled|dive in|serene|picturesque|myriad|plethora|teeming|bustling|a testament)\b/i;

/** Capitalised words that aren't sentence starts and aren't in `allowedText`. */
export function ungroundedInProse(text, allowedText) {
  const allowed = `${allowedText} ${MONTHS.join(" ")} I I'm I've I'd I'll`;
  return String(text ?? "")
    .split(/(?<=[.?!])\s+/)
    .flatMap((sentence) =>
      ungroundedNames(sentence.replace(/'s\b/g, ""), allowed),
    );
}

/**
 * Why a drafted description can't be used, as feedback the model can act on.
 * Empty means it passes.
 */
export function descriptionProblems(
  { description = "", title = "" },
  {
    session,
    digest,
    lexicon = [],
    openerCounts = new Map(),
    needTitle = false,
  },
) {
  const problems = [];
  const text = String(description ?? "").trim();
  if (text.length < 60) problems.push("It's too short.");
  if (text.length > DESCRIPTION_MAX)
    problems.push(`It's over ${DESCRIPTION_MAX} characters.`);
  const found = lint(text);
  if (found.length) problems.push(`It ${found.join(", ")}.`);
  if (EXTRA_BANNED.test(text))
    problems.push(`It uses "${EXTRA_BANNED.exec(text)[0]}".`);
  const opener = text
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z']/g, "");
  if (opener && (openerCounts.get(opener) ?? 0) >= 3)
    problems.push(`Three other sessions already open with "${opener}".`);
  const speciesNames = digest.species
    .flatMap((s) => [s.name, s.scientific])
    .concat(digest.groups.map((g) => g.name))
    .join(" ");
  const named = unverifiedSpecies(text, lexicon, speciesNames);
  if (named.length)
    problems.push(
      `It names ${named.slice(0, 3).join(", ")}, which isn't identified in this session.`,
    );
  const allowed = [
    session.title,
    session.location,
    slugPlace(session.slug),
    speciesNames,
    title,
  ].join(" ");
  const strangers = [...new Set(ungroundedInProse(text, allowed))];
  if (strangers.length)
    problems.push(
      `It names ${strangers.slice(0, 4).join(", ")}, which the facts don't mention.`,
    );
  if (needTitle && title && !TITLE_SHAPE.test(title))
    problems.push(
      'The title must follow "Place, Region, Month Year", for example "Sauk Mountain, Washington, June 2026".',
    );
  return problems;
}

/** First word of a description, for keeping openers varied across sessions. */
export function openerOf(text) {
  return (
    String(text ?? "")
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z']/g, "") ?? ""
  );
}
