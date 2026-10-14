/**
 * Website copy, rendered from the stored analysis. No photo is looked at here.
 *
 *   captionFor          one line per photo, built by code:
 *                       "<subject> <scene> <conditions>, <place>"
 *                       e.g. "Northwestern garter snake (Thamnophis ordinoides)
 *                       coiled on a mossy log, Sauk Mountain"
 *   sessionDigest       everything known about a session's photos, condensed
 *   descriptionPrompt   one text-only call per session turns the digest into
 *                       the session description, in Truman's own voice
 *                       (.github/skills/truman-voice)
 *   descriptionProblems the checks a description has to pass before it's used
 *
 * The caption is the photo's alt text, lightbox caption and structured-data
 * caption all at once, so it stays short, literal and free of hashtags: the
 * name, what it's doing when that's the point, and the place. Photos of the
 * same thing can share a caption; telling them apart by pose is what a
 * machine does, not a photographer.
 */
import { idLevel } from "./analyse.mjs";
import { fixPlaceWord } from "./placenames.mjs";
import {
  displayName,
  lint,
  tidy,
  ungroundedNames,
  unverifiedSpecies,
} from "./text.mjs";
import { OPINION, stockIn, unbackedClaim } from "./claims.mjs";

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
  /^(?:\d+|jan|feb|mar|apr|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december|january|february|march|april|spring|summer|fall|autumn|winter|trip|day|days|part|pt|pics|photos|pictures|nearby)$/i;
// US state codes, dropped from the end of a folder name: "napali-coast-hi" is "Napali Coast".
const STATE_CODE =
  /^(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)$/i;

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

/** "mt-baker-fall-2026" -> "Mount Baker": the place words in a folder name you chose, with swapped-letter typos in a state or country fixed ("oreogn" -> "Oregon"). */
export function slugPlace(slug) {
  const words = String(slug ?? "")
    .split(/[-_\s]+/)
    .filter((w) => w && !SLUG_NOISE.test(w))
    .map((w) =>
      /^mt$/i.test(w)
        ? "mount"
        : /^mtn$/i.test(w)
          ? "mountain"
          : (fixPlaceWord(w) ?? w),
    );
  // "fort-worden-and-nearby-wa": no state code or dangling "and" at the end.
  while (
    words.length > 1 &&
    (STATE_CODE.test(words.at(-1)) || /^(?:and|&)$/i.test(words.at(-1)))
  )
    words.pop();
  return words
    .map((w, i) =>
      i > 0 && /^and$/i.test(w)
        ? "and"
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
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

// What a session title says you did there rather than where: "Tortuguero
// night walk", "Eastern Washington macro".
const ACTIVITY_TAIL =
  /\s+(?:night walks?|walks?|macro|camping|hikes?|hiking|birding|wildlife|adventures?|weekend|trip|and nearby|and around)$/i;
// A habitat rather than a named place reads lowercase mid-sentence: "…, shrub-steppe, Eastern Washington".
export const HABITAT =
  /^(?:shrub-steppe|sagebrush steppe|steppe|desert|rainforest|cloud forest|tide ?pools?|wetlands?|grasslands?|old-growth forest)$/i;

/** The most specific place for a caption: "Yellow Aster Butte", "Tortuguero canals". */
export function placeLabel(session) {
  const first = (s) =>
    String(s ?? "")
      .split(",")[0]
      .trim();
  const fromTitle = hasRealTitle(session)
    ? first(String(session.title).replace(MONTH_TAIL, ""))
        .replace(ACTIVITY_TAIL, "")
        .trim()
    : "";
  if (HABITAT.test(fromTitle)) return fromTitle.toLowerCase();
  return fromTitle || first(session.location);
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

/**
 * "Northwestern garter snake (Thamnophis ordinoides)", "Two harbor seals (Phoca
 * vitulina)". A species with no English name is led by a plain word for what it
 * is, so people searching for it can find it: "Jumping spider (Corythalia opima)".
 */
export function speciesSubject(taxon, count = 1, plain = "") {
  const common = displayName(taxon.common);
  const name = common || plain;
  if (!name) return taxon.name;
  if (count >= 2) {
    const one = common
      ? displayName(taxon.common, { midSentence: true })
      : plain.charAt(0).toLowerCase() + plain.slice(1);
    const many = plural(one);
    const lead = count <= 10 ? `${NUMBER_WORDS[count]} ${many}` : many;
    return `${capitalise(lead)} (${taxon.name})`;
  }
  // iNaturalist has a few common names in lowercase ("rounded earthstar").
  return `${capitalise(name)} (${taxon.name})`;
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

/** "Under direct light" is just how a flash looks; it says nothing about the scene. */
export function telling(conditions) {
  return !/\b(?:direct|bright|harsh|strong|hard|artificial)\s+(?:direct\s+)?light\b|^(?:under|in) (?:bright )?light$/i.test(
    String(conditions ?? ""),
  );
}

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

const PLACE_GENERIC = new Set([
  "north",
  "south",
  "east",
  "west",
  "face",
  "canals",
  "night",
  "walk",
  "national",
  "park",
  "province",
  "valley",
  "mount",
  "mountain",
  "lake",
  "river",
  "forest",
]);

/**
 * The parts of a place a caption line hasn't already named: "Mount Everest
 * above the clouds" + "Everest north face, Tibet, China" -> "Tibet, China".
 * A part counts as named when the line has every telling word of it, or the
 * species name has the whole of it ("Tapir Valley tree frog"); a name that
 * only shares a word ("Baird's tapir", "Tibetan gazelle") doesn't count.
 */
export function placeAfter(phrase, place, subject = "") {
  const words = (s) =>
    norm(s)
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  const said = new Set(words(phrase));
  return String(place ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => {
      if (
        subject &&
        ` ${words(subject).join(" ")} `.includes(` ${words(p).join(" ")} `)
      )
        return false;
      const telling = words(p).filter(
        (w) => w.length > 3 && !PLACE_GENERIC.has(w),
      );
      return telling.length
        ? !telling.every((w) => said.has(w))
        : !norm(phrase).includes(norm(p));
    })
    .join(", ");
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
 * @param line     the written first line (lines.mjs), used when it passes
 *                 the same checks; otherwise the line is built from the notes.
 *                 An empty action means the name and place say enough:
 *                 "Snowcap (Microchera albocoronata), Bijagua"
 * @param strict   return "" instead of building from the notes when `line`
 *                 fails (Instagram then falls back to the plain line)
 */
export function captionFor({
  analysis,
  taxon = null,
  session,
  lexicon = [],
  place = placeLabel(session),
  max = CAPTION_MAX,
  line = null,
  strict = false,
}) {
  const a = analysis ?? {};
  const level = a.idCheck === "conflict" ? null : idLevel(taxon);
  const usedTaxon = level ? taxon : null;
  const allowed = groundingText(session, usedTaxon);
  const taxonText = usedTaxon ? groundingText({}, usedTaxon) : "";
  const ctx = { allowed, lexicon, taxonText };

  let subject;
  if (level === "species") {
    // The model's plain word for it ("Jumping spider") stands in for a missing
    // English name, unless it just repeats the scientific one.
    const plain =
      clean(a.subject, { ...ctx, first: true }) &&
      !norm(a.subject).includes(norm(taxon.name))
        ? a.subject
        : (FALLBACK[a.group] ?? "");
    subject = speciesSubject(taxon, a.count, plain);
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
  let phrase = "";
  let after = "";
  // A pose in a stored line comes out rather than costing the line.
  const lineAction =
    typeof line?.action === "string" ? withoutPose(line.action) : null;
  const lineText = line?.text ? withoutPose(line.text) : "";
  if (level && lineAction === "") {
    phrase = subject;
    after = placeAfter("", place, subject);
  } else if (
    level &&
    lineAction &&
    clean(lineAction, ctx) &&
    !backdropIn(lineAction)
  ) {
    // "Two otters resting with its forepaws" -> "with their forepaws".
    const action =
      (a.count ?? 1) > 1 ? lineAction.replace(/\bits\b/g, "their") : lineAction;
    phrase = `${subject} ${action}`;
    after = placeAfter(action, place, subject);
  } else if (
    !level &&
    lineText &&
    clean(lineText, { ...ctx, first: true }) &&
    !backdropIn(lineText)
  ) {
    phrase = lineText;
    after = placeAfter(lineText, place);
  }
  if (phrase) {
    // "Near Seattle" is a session title's opening; after a comma it's "near".
    after = after.replace(/^Near\b/, "near");
    const full = tidy(after ? `${phrase}, ${after}` : phrase);
    if (full.length <= max) return full;
    if (tidy(phrase).length <= max) return tidy(phrase);
  }
  if (strict) return "";

  // Built from the notes: their pose and background left out.
  const posed = clean(a.scene, ctx) ? withoutPose(a.scene) : "";
  const scene = posed && !backdropIn(posed) ? posed : "";
  const conditions =
    clean(a.conditions, ctx) && telling(a.conditions) ? a.conditions : "";
  const said = norm(`${subject} ${scene}`);
  const where =
    place && !said.includes(norm(place))
      ? place.replace(/^Near\b/, "near")
      : "";

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
 * Describing the photo rather than the moment: the background, the framing
 * or the light. "against a dark background", "blurred leaves", "a bright
 * foreground ridge", "facing left", "a shadow falling to the left", "under
 * direct flash".
 */
const BACKDROP_WORDS =
  /\b(?:backgrounds?|backdrops?|blurred|blurry|foreground|bokeh|out of focus)\b|\bagainst the dark\b|\b(?:behind|beyond) (?:it|them)\b|\b(?:faces|facing|turned|turning|pointing|extending|looking|leaning|angled|falling|stretched|stretching|curved|curving|curled|curling|coiled|bent|bending|tilted|tilting)\s+(?:to(?:ward)?s?\s+the\s+)?(?:left|right)\b|\bto the (?:left|right)\b|\b(?:under|in|with)\s+(?:the\s+|a\s+)?(?:direct\s+|bright\s+)?flash\b/i;

// Pose and orientation: what a camera notices and a person doesn't say.
// "with its bill raised", "head turned", "facing the camera", "perched upright".
const BODY =
  "heads?|bills?|beaks?|necks?|tails?|wings?|legs?|feet|foot|ears?|bod(?:y|ies)|crests?";
const POSED =
  "raised|lowered|turned|tilted|upright|curved|curled|bent|angled|lifted|cocked";
const POSE_WORDS = new RegExp(
  `\\b(?:its|their|his|her|one)\\s+(?:[\\w-]+\\s+)?(?:${BODY})\\s+(?:${POSED})\\b|\\b(?:its|their)\\s+(?:[\\w-]+\\s+){0,2}(?:tails?|bod(?:y|ies))\\s+(?:curls?|curling|curves?|curving|hangs?|hanging|bends?|bending)\\b|\\bhead turned\\b|\\b(?:faces|facing|turned|looking|pointing)\\s+(?:(?:to(?:ward)?s?\\s+)?(?:the\\s+)?(?:camera|viewer|lens|forward|away)|opposite directions|outward|sideways)\\b|\\bperched upright\\b|\\bin profile\\b`,
  "i",
);

/** The first phrase in `text` that describes the photo rather than the moment, or null. */
export function backdropIn(text) {
  const t = String(text ?? "");
  return BACKDROP_WORDS.exec(t)?.[0] ?? POSE_WORDS.exec(t)?.[0] ?? null;
}

/**
 * A phrase with its pose taken out: "perched on a stem facing right" ->
 * "perched on a stem", "standing with its head turned" -> "standing".
 */
export function withoutPose(phrase) {
  return String(phrase ?? "")
    .replace(
      new RegExp(
        `(?:^|,?\\s+)with\\s+(?:its|their|his|her|one)\\s+(?:[\\w-]+\\s+)?(?:${BODY})\\s+(?:${POSED})\\b(?:\\s+(?:to(?:ward)?s?\\s+)?(?:the\\s+)?(?:left|right|up|down|back|forward|sideways|away))?`,
        "gi",
      ),
      "",
    )
    .replace(
      /(?:^|,?\s+)(?:faces|facing|turned|turning|looking|pointing)\s+(?:(?:to(?:ward)?s?\s+)?(?:the\s+)?(?:left|right|camera|viewer|lens|forward|away)|opposite directions|outward|sideways)\b/gi,
      "",
    )
    .replace(/\s+to(?:ward)?s?\s+the\s+(?:left|right)\b/gi, "")
    .replace(/\bperched upright\b/gi, "perched")
    .replace(/,?\s+in profile\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * A photo's stored description with the background and the framing left
 * out, for the session description to draw on: "...on its neck, against
 * blurred green leaves." becomes "...on its neck."
 */
export function withoutBackdrop(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((s) =>
      withoutPose(s)
        .replace(/,?\s+(?:set\s+)?against\s+[^,.;]+/gi, "")
        .replace(/,?\s+with\s+[^,.;]*\b(?:behind|beyond)\s+(?:it|them)\b/gi, "")
        .replace(
          /\s+(?:faces|facing|turned|turning|pointing|extending|looking|leaning|angled|falling)\s+(?:to(?:ward)?s?\s+the\s+)?(?:left|right)\b/gi,
          "",
        )
        .replace(/\s+to(?:ward)?s?\s+the\s+(?:left|right)\b/gi, "")
        .trim(),
    )
    .filter((s) => s && !backdropIn(s))
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`))
    .join(" ");
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
      // From the taxon, never the model's subject, which could be too specific.
      bump(
        groups,
        `${displayName(taxon.common) || taxon.name} (${taxon.name})`,
      );
    } else if (a.group !== "other" && a.subject) {
      bump(unnamed, a.subject.toLowerCase());
    }
    if (telling(a.conditions)) bump(conditions, a.conditions);
    bump(settings, a.setting);
  }
  const top = (map, n) =>
    [...map.entries()]
      .sort((x, y) => y[1].count - x[1].count || x[0].localeCompare(y[0]))
      .slice(0, n);
  const highlights = [...analysed]
    .sort((x, y) => y.analysis.appeal - x.analysis.appeal)
    .slice(0, 14)
    .map((s) => withoutBackdrop(s.analysis.description))
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
 * Shapes a description can take. Each session gets one, picked from its slug,
 * so sixty descriptions don't all walk the same steps.
 */
export const SHAPES = [
  "Open with the animal or moment he liked most and what he thought of it, then say what else turned up.",
  "Open with what the place was like, then name two animals or sights he liked.",
  "Open with what there was the most of, then single out one favourite with a reaction.",
  "Two sentences only: one about the trip as a whole, one about a single highlight.",
  'Open with a short fragment about the place or the animals, three to six words ("Hummingbirds everywhere here.", "Mostly frogs, and a lot of them."), then one or two longer sentences.',
];

export function shapeFor(slug) {
  let h = 0;
  for (const ch of String(slug ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SHAPES[h % SHAPES.length];
}

const words = (text) =>
  norm(text)
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** A run of `n` words the draft shares with any of `others`, or null. */
export function sharedPhrase(text, others = [], n = 6) {
  const grams = new Set();
  for (const other of others) {
    const w = words(other);
    for (let i = 0; i + n <= w.length; i++)
      grams.add(w.slice(i, i + n).join(" "));
  }
  const w = words(text);
  for (let i = 0; i + n <= w.length; i++) {
    const gram = w.slice(i, i + n).join(" ");
    if (grams.has(gram)) return gram;
  }
  return null;
}

/**
 * One text-only call per session, from every photo's caption plus the
 * identifications and Truman's own notes about the trip, written in his
 * voice. `needTitle` / `needLocation` ask for those too, for a session nobody
 * has titled yet.
 */
export function descriptionPrompt({
  session,
  digest,
  voiceRules = "",
  voiceGuide = "",
  notes = "",
  avoidOpeners = [],
  others = [],
  needTitle = false,
  needLocation = false,
  feedback = null,
}) {
  const overused = HABITS_ACROSS.filter(
    ([habit, share]) =>
      others.length >= 3 &&
      others.filter((o) => habit.test(o)).length >= others.length * share,
  ).map(([, , said]) => `"${said}"`);
  const list = (items, fmt) =>
    items.length ? items.map(fmt).join("; ") : "(none)";
  const heading = [hasRealTitle(session) ? session.title : "", session.location]
    .filter(Boolean)
    .join(" · ");
  const facts = [
    `Identified on iNaturalist (the only species he may name): ${list(digest.species, (s) => `${s.name}${s.count > 1 ? ` x${s.count}` : ""}`)}`,
    `Identified only to a group: ${list(digest.groups, (g) => `${g.name}${g.count > 1 ? ` x${g.count}` : ""}`)}`,
    `Settings: ${list(digest.settings, (x) => x.name)}`,
    `Light and weather that stood out: ${list(digest.conditions, (c) => c.name)}`,
  ];
  const shape = [
    `"description": "2 to 4 sentences, under ${DESCRIPTION_MAX - 150} characters"`,
    needTitle
      ? `"title": "Place, Region, Month Year, e.g. \\"Sauk Mountain, Washington, June 2026\\". Take the place from the folder name (${session.slug}) and the month from ${monthYear(session.date) || "the photos"}."`
      : "",
    needLocation
      ? `"location": "the broader region, e.g. \\"North Cascades, Washington\\" or \\"Limón Province, Costa Rica\\""`
      : "",
  ].filter(Boolean);

  return `Write the short paragraph at the top of one trip's page on Truman's photography site, the way he'd write it himself. People leave a site the moment it reads like AI wrote it, so this has to sound like Truman telling a friend about the trip, not a description of photos.${heading ? ` The page shows "${heading}" right above it.` : ""}

What he photographed (${digest.photos} photos), as captioned:
${digest.captions.map((c) => `- ${c}`).join("\n")}

A few of the best ones in more detail:
${digest.highlights
  .slice(0, 6)
  .map((h) => `- ${h}`)
  .join("\n")}

${facts.join("\n")}
${notes ? `His own notes about this trip, the only source for what he was doing, who with, or how it went: "${notes}"` : "He hasn't left notes about this trip, so say nothing about what he was doing beyond what the trip name and the captions show."}

How to write it:
- In his voice (below): first person, casual, the way he talks. Start with "I", a verb ("Saw...", "Spent...", "Found..."), or the thing he liked most. Contractions, a comma splice, a dropped subject are all fine. Repeat words rather than reaching for synonyms.
- ${shapeFor(session.slug)} Don't walk through the photos one by one.
- What he saw and what he thought of it: the animals by common name and what they were up to, what the place was like, and at least one reaction of his, said plainly: what's cool or crazy about it ("they camouflage so well it's crazy"), what he loves about it, a simple guess at what an animal was up to ("looks like he just finished a big meal"), surprise ("I can't believe how..."), or a small thought about being out there ("some of the best wildlife experiences come when you're resting"). A hedge when he can't be sure ("likely (?)", "I think it was a mother and her baby"). One animal is "he" unless his notes say otherwise.
- Not a quip. Don't try to be witty or clever: no punchlines, no wordplay, no bits about an animal's attitude or plans, no "solid chunk of stone on top of even more stone". Most of it is just what was there and what he thought of it. "lol" at most once, only when something's funny. "Little" at most once.
- When one of his phrases is used up on other pages, don't swap in a fancier way to say it ("I dig", "I'm a fan of", "got a kick out of", "I was struck by"): react in a different way instead.${overused.length ? `\n- Already said on enough other trips' pages, so not here: ${overused.join(", ")}.` : ""}
- Don't talk about photos as photos: no "these photos", "this session", "frames", "shots", "images", "the rest". Never describe a picture: not the background, the blur, the framing, which way something faces, poses ("with its bill raised"), the flash or the light.
- Common names only, no scientific names in brackets (the caption under each photo has those). Mid-sentence they're lowercase except proper nouns: "a turquoise-browed motmot", "an Ecuadorian hermit crab". Name species only from the identified list. Anything else gets plain words ("a heron", "some little toad").
- One paragraph. No place line at the end like an Instagram post: the page already shows where it was.
- Only what the captions, the facts and his notes support. Don't invent events, companions, waiting, weather, how long he was there, numbers, or anything off camera. No "today" or "last week".
- No emoji, hashtags, exclamation marks, long dashes, questions (a hedging "(?)" is fine), or a last line that sums up.
- Don't open with: ${avoidOpeners.length ? avoidOpeners.map((o) => `"${o}"`).join(", ") : "(nothing yet)"}.
${
  others.length
    ? `\nOther trips' pages, newest last. Don't start like them or reuse their reactions:\n${others
        .slice(-10)
        .map((o) => `- ${o}`)
        .join("\n")}\n`
    : ""
}

Two examples of his voice, from made-up trips (don't copy their wording):
- "The frogs here were everywhere lol, red-eyed tree frogs under the leaves and a glass frog right over the stream. I love how the glass frogs just look like part of the leaf."
- "Mostly granite spires up here, with snow still hanging on in the gullies. Such a cool contrast with the dark rock, I'd go back just for that."

${voiceGuide ? `How Truman writes (follow it):\n${voiceGuide}\n\n` : ""}${voiceRules ? `The site's copy rules (follow them too):\n${voiceRules}\n\n` : ""}Reply with JSON only: { ${shape.join(", ")} }${feedback ? `\n\nYour previous draft was rejected: ${feedback} Fix that.` : ""}`;
}

// His habits, each on only some descriptions: [pattern, the most other
// sessions that may share it, how to name it in the feedback].
const HABITS_ACROSS = [
  // His own words, which he repeats: fine on a good share of pages.
  [/\bi love\b/i, 0.35, "I love"],
  [/\bsuch an?\b/i, 0.5, "such a"],
  [/\bi (?:really )?like\b/i, 0.3, "I like"],
  // The model's, which turn into a template.
  [/\bso cool\b/i, 0.2, "so cool"],
  [/\bmy favou?rite\b/i, 0.15, "my favorite"],
  [/\balso saw\b/i, 0.2, "Also saw"],
  [/\balmost looks? like\b/i, 0.2, "almost looks like"],
  [/\blittle\b/i, 0.25, "little"],
  [/\b(?:can'?t|couldn'?t) get over\b/i, 0.1, "can't get over"],
  [/\btoo\.(?:\s|$)/i, 0.25, "...too."],
];

// Talking about the pictures instead of the trip.
const PHOTO_TALK =
  /\b(?:these (?:photos|pictures|frames|shots|images)|this (?:session|set|gallery|collection)|(?:the|most) (?:frames|shots|images)|the rest (?:is|are))\b/i;

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
    others = [],
    notes = "",
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
  const backdrop = backdropIn(text);
  if (backdrop)
    problems.push(
      `It describes the photo rather than the moment ("${backdrop}"). Say what the animals are doing or what the place is like instead.`,
    );
  const opener = openerOf(text);
  if (opener && (openerCounts.get(opener) ?? 0) >= 3)
    problems.push(`Three other sessions already open with "${opener}".`);
  if (/!/.test(text)) problems.push("It has an exclamation mark.");
  if (/\?/.test(text.replace(/\(\?\)/g, "")))
    problems.push("It asks a question.");
  const stock = stockIn(text);
  if (stock) problems.push(`It says "${stock}", which reads as generated.`);
  const photoTalk = PHOTO_TALK.exec(text)?.[0];
  if (photoTalk)
    problems.push(
      `It talks about the photos ("${photoTalk}"). Talk about the trip: what he saw and what he thought.`,
    );
  if (!OPINION.test(text))
    problems.push(
      "It has no reaction of his. Add one: what he liked, or found funny or strange.",
    );
  const grounding = [
    session.title,
    session.location,
    String(session.slug ?? "").replace(/-/g, " "),
    ...digest.captions,
    ...digest.highlights,
    ...digest.settings.map((x) => x.name),
    ...digest.conditions.map((x) => x.name),
  ].join(" ");
  const claim = unbackedClaim(text, { grounding, notes });
  if (claim)
    problems.push(
      `It says "${claim}", which nothing about this trip backs up. Leave it out unless his notes say so.`,
    );
  if (/\n/.test(text))
    problems.push(
      "It has more than one paragraph. Write one, with no place line at the end.",
    );
  if (/\((?:[A-Z][a-z]+)(?: [a-z][a-z-]+){1,2}\)/.test(text))
    problems.push(
      "It has scientific names in brackets. Use common names only; the captions have the rest.",
    );
  // His habits, spread out across sessions like across posts.
  for (const [habit, share, said] of HABITS_ACROSS) {
    if (
      habit.test(text) &&
      others.length >= 3 &&
      others.filter((o) => habit.test(o)).length >= others.length * share
    )
      problems.push(
        `Enough other sessions already say "${said}". Say it another way.`,
      );
  }
  const littles = (text.match(/\blittle\b/gi) ?? []).length;
  if (littles > 1)
    problems.push(`It says "little" ${littles} times; once at most.`);
  const lols = (text.match(/\blol\b/gi) ?? []).length;
  if (lols > 1) problems.push(`It says "lol" ${lols} times; once at most.`);
  else if (
    lols &&
    others.length &&
    others.filter((o) => /\blol\b/i.test(o)).length >= others.length / 4
  )
    problems.push(
      'Enough other sessions already say "lol". Leave it out of this one.',
    );
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
  const repeated = sharedPhrase(text, others);
  if (repeated)
    problems.push(
      `It repeats "${repeated}" from another session's description. Word it differently.`,
    );
  if (needTitle && title && !TITLE_SHAPE.test(title))
    problems.push(
      'The title must follow "Place, Region, Month Year", for example "Sauk Mountain, Washington, June 2026".',
    );
  return problems;
}

/**
 * How a description starts, for keeping openers varied across sessions: its
 * first word, or the first two when that's "I" ("i saw", "i love").
 */
export function openerOf(text) {
  const [first = "", second = ""] = String(text ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z']/g, ""));
  return first === "i" && second ? `i ${second}` : first;
}
