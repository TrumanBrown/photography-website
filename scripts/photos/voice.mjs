/**
 * The opening of an Instagram post in Truman's voice, the way he'd type it on
 * his phone:
 *
 *   Saw this {name} munching on some insect in Bijagua. Such a unique bird,
 *   the beak goes so far up its head, almost looks like a horn lol 🦏
 *
 * Written once per planned post, text only, from what the one look at the
 * photo noted, the trip it's from, any notes Truman left for the trip or the
 * photo (`npm run social -- note`), and the post's fun fact. The prompt
 * carries the truman-voice and caption-voice skills (.github/skills/); edit
 * those to change how posts sound.
 *
 * `{name}` stands for the species with its scientific name. Code fills it in,
 * so the name is always the verified one. Code also picks the one emoji on the
 * end, and the place goes on its own line after it (compose.mjs).
 *
 * The website's captions don't use this; they stay plain, because they're
 * also the photos' alt text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./settings.mjs";
import {
  lint,
  loadTrumanVoice,
  tidy,
  ungroundedNames,
  unverifiedSpecies,
} from "./text.mjs";
import { backdropIn } from "./website.mjs";
import { OPINION, stockIn, unbackedClaim } from "./claims.mjs";

/** Bump when the prompt or the skills change enough that planned posts should be rewritten. */
export const VOICE_VERSION = 6;

const SKILLS = join(ROOT, ".github/skills");

function section(text, from, to) {
  const start = text.indexOf(from);
  if (start < 0) return "";
  const end = to ? text.indexOf(to, start + from.length) : -1;
  return text.slice(start, end > start ? end : undefined).trim();
}

/**
 * What the prompt carries: how Truman writes (truman-voice) and how a post is
 * put together, with his rewrites (caption-voice). Neither skill's procedure
 * or maintainer notes.
 */
export function loadVoiceGuide(root = SKILLS) {
  const read = (name) => {
    try {
      return readFileSync(join(root, name, "SKILL.md"), "utf8");
    } catch {
      return "";
    }
  };
  return [
    loadTrumanVoice(join(root, "truman-voice", "SKILL.md")),
    section(read("caption-voice"), "## How a post reads", "## Procedure"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * His own rewrites of the posts that went out before this voice, oldest
 * first. They're the recent posts the next ones mustn't echo, and the
 * examples no post may copy.
 */
export const HIS_STORIES = [
  "Saw this Groove-billed ani (Crotophaga sulcirostris) munching on some insect in Bijagua. Such a unique bird, the beak goes so far up its head, almost looks like a horn lol",
  "Spotted this katydid (Mimetica incisa) showing off its incredible leaf mimicry in Monteverde Cloud Forest at night. Luckily for me, this little guy chose the wrong color plant to land on lol, he stuck out like a sore thumb. Even still, I can't believe how they even mimic the punches and holes in natural leaves",
  "Pulled over on the side of the road to capture this canyon view in Kauai. I love how the low clouds cast such a distinct shadow on the cliffs",
  "While on a canal tour in Tortuguero, managed to capture this Green ibis (Mesembrinibis cayennensis) pretty close up. They are such unique looking birds, almost alien-like. The iridescent shade of the feathers is so cool too",
  "Was taking a break on a hike and captured this two-tailed swallowtail (Papilio multicaudata) perched on a purple flower, likely (?) sucking nectar from the petals. I feel like some of the best wildlife experiences come when you're resting, and nature just comes to you",
  "A fun pic of this waterfall near the Arenal Volcano in Costa Rica. I love the landscape pictures from Costa Rica because there's so much green everywhere, like you can see surrounding this waterfall",
];
/** The emoji on those six, in the same order. */
export const HIS_EMOJI = ["🦏", "🤯", "☁️", "👽", "🦋", "💚"];

export function voicePrompt(items, guide = "", { recent = [] } = {}) {
  const field = (label, value) => (value ? `; ${label} "${value}"` : "");
  return `You write the opening of Instagram posts for Truman's wildlife and landscape photos, in his voice. People scroll straight past anything that reads like AI wrote it, so this has to sound like Truman typed it on his phone. His guide is below, with his own rewrites of posts that sounded like AI. Write the way he does, but never copy his examples' wording.

For each photo, write "options": three different versions, best first. Each one has:
- "text": two or three sentences, 15 to 60 words in all.
  - First, what this is and how he came across it, said the way he'd tell a friend. He starts with "I" or a verb, like people do online: "I saw...", "I love how...", or the verb with the "I" dropped ("Saw this...", "Spotted this...", "Managed to capture this..."). Everyday verbs: saw, spotted, found, caught, got, captured, managed to capture, came across, ran into. Or start with what he was doing when his notes say so ("While on a canal tour in Tortuguero, ..."), or now and then "A fun pic of this...". Never bookish verbs like "came upon", "took in", "happened upon", "gazed at", "photographed" or "got a glimpse of". For a named animal or plant, write {name} exactly once, where the animal is first mentioned, right after "this" or "a" ("Saw this {name} munching on..."); code puts in the verified name. Never name it twice or tack it on after a comma ("this swan, a {name}", "a frog on a leaf, this {name}"). Say what it's doing in everyday words. Mention the place the casual way ("in Bijagua", "near the Arenal Volcano") when it fits.
  - Then his reaction, with some feeling in it: what he loves about it, a comparison ("almost looks like a horn", "almost alien-like"), something funny ("chose the wrong color plant to land on lol"), or a small thought about being out there ("some of the best wildlife experiences come when you're resting"). Opinions are good ("such a unique bird", "so cool", "I love how..."). Hedge when he couldn't know for sure ("likely (?) sucking nectar"). Not a list of colours, textures or body parts: that's alt text, not him.
  - Casual, not polished. He doesn't write perfect grammar like a robot: sentences run together with commas, the subject gets dropped ("Was taking a break..."), a thought starts with "Even still" or "Luckily for me". Spelling stays right.
  - He repeats words instead of reaching for synonyms, the way people do: "this waterfall" again rather than "the cascade", "Costa Rica" twice, "such a" and "so" more than once. Never swap in a fancier word to avoid saying something twice.
  - "lol" on roughly one post in four, wherever something's a bit funny or awkward (he uses it on a third of his); never twice in one.
  - Plain, not poetic. An animal can have a personality; scenery doesn't get feelings or a "softer version of itself".
- "emoji": the one emoji he'd put on the end. The animal itself (🦋 🐸 🦜), a face (😅 😂 🤯 😍 🥲), or the thing (🌋 ⛰️ ☁️ 🌊). Vary them: not the same one as any of the last few posts. Never ✨ 🌿 🍃 🔥 📸 🙌 💯 🚀 🌍 💫.

Only what's true:
- What he was doing, who he was with, the weather and the time of day: only when the trip name, the photo's notes or his own notes say so. "Pulled over on the side of the road" or "taking a break on a hike" are perfect when his notes say it, and made up when they don't. Without notes, keep the opening to what the photo and the trip name show.
- No waiting, no "finally", no "first time", nothing about luck paying off, unless his notes say so. No "today", "this morning" or "last week": posts go out months later.
- Only the names in the notes. No numbers. Don't say the fun fact; it's posted underneath.
- Never describe the photo itself: no background, blur, framing, angle or lighting.

These go out three a day, so across all the photos below no two may start with the same words or share a phrase, and none may start like the recent posts listed. "Such a" and "so" are his on about half his posts; spread "I love", "I like", "my favorite", "so cool", "pretty", "almost", "little" and "lol" out more, each on only some posts. When "I love" was used recently, don't swap in a fancier way to say it ("I dig", "I'm a fan of", "got a kick out of"): react in a different way instead, with a comparison, a joke or a surprise.

Don't write questions (a hedging "(?)" is fine), hashtags, exclamation marks, long dashes, quotation marks, sales words (stunning, breathtaking, vibrant, majestic, nestled), stock lines ("nature never disappoints", "living its best life", "stopped me in my tracks", "what a sight"), or a last line that sums up.
${recent.length ? `\nRecent posts, newest last. Don't start like these or reuse their phrases:\n${recent.map((r) => `- ${r}`).join("\n")}\n` : ""}
Guide:
"""
${guide}
"""

Photos:
${items.map((x) => `- id ${x.id}: ${x.named ? `named "${x.named}" (write {name})${x.count > 1 ? `, ${x.count} of them` : ""}; ` : ""}subject "${x.subject}"; doing "${x.scene}"${field("setting", x.setting)}${field("conditions", x.conditions)}${field("landmark", x.landmark)}; description "${x.description}"; place "${x.place}"${field("trip", x.trip)}${field("his notes", x.notes)}${field("fun fact", x.fact)}`).join("\n")}

Reply with JSON only: {"items": [{"id": "1", "options": [{"text": "...", "emoji": "..."}, {"text": "...", "emoji": "..."}, {"text": "...", "emoji": "..."}]}]}`;
}

// His habits: each is fine on some posts and a tell on every one. [pattern, how many posts back it may not appear]
const HABITS = [
  // His on about half his posts: just not two in a row, and mostly
  // mid-sentence ("cast such a distinct shadow"). Opening a sentence with it
  // on every other post is a rhythm people notice.
  [/\bsuch an?\b/i, 1],
  [/(?:^|[.!?]\s+)such an?\b/i, 3],
  [/\bi love\b/i, 2],
  [/\bi (?:really )?like\b/i, 2],
  [/\bmy favou?rite\b/i, 3],
  [/\blittle\b/i, 2],
  [/\bcan'?t get over\b/i, 4],
  [/\bso cool\b/i, 3],
  [/\bi feel like\b/i, 4],
  [/\bcan'?t believe\b/i, 3],
  [/\blittle guy\b/i, 4],
  [/\balmost\b/i, 2],
  [/\bpretty\b/i, 2],
  [/\bluck(?:y|ily)\b/i, 4],
  [/\bunique\b/i, 2],
  [/\binteresting\b/i, 3],
  [/\bincredible\b/i, 3],
  [/\bfun pic\b/i, 6],
];
const LOL = /\blol\b/i;
/** "lol" on one post in four at most. */
const LOL_GAP = 3;
/** No two of any five posts in a row start the same way. */
const OPENER_GAP = 4;

const STOP = new Set(
  "a an the of on in at to and or with its it's it their that this those these such so is are be was very really just".split(
    " ",
  ),
);
const words = (s, content = false) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !(content && STOP.has(w)));

/** True when `a` and `b` share a run of `n` words (only the words that carry meaning, with `content`). */
function shareRun(a, b, n = 5, content = false) {
  const runs = new Set();
  const wb = words(b, content);
  for (let i = 0; i + n <= wb.length; i++)
    runs.add(wb.slice(i, i + n).join(" "));
  const wa = words(a, content);
  for (let i = 0; i + n <= wa.length; i++)
    if (runs.has(wa.slice(i, i + n).join(" "))) return true;
  return false;
}

const SAME_WORD = new Set([
  "this",
  "these",
  "that",
  "those",
  "a",
  "an",
  "the",
  "some",
]);

/** How a post starts, for keeping openers apart: "saw this", "pulled over". */
export function storyOpener(text) {
  return words(String(text ?? "").replace(/\{name\}/g, "name"))
    .slice(0, 2)
    .map((w) => (SAME_WORD.has(w) ? "this" : w))
    .join(" ");
}

const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// "two harbor seals (...)": counted, so "this {name}" has to be "these".
const COUNTED =
  /^(?:two|three|four|five|six|seven|eight|nine|ten|several|many|some)\b/i;
// Starts with a vowel sound, so "a {name}" has to be "an": "an agami heron",
// but "a European robin", "a unicorn grasshopper".
const vowelSound = (name) =>
  /^[aeiou]/i.test(name) &&
  !/^(?:eu|ewe|one|once|uni|use|usu|ur[aeo]|uk)/i.test(name);
const keepCase = (word, like) =>
  /^\p{Lu}/u.test(like) ? capitalise(word) : word;

/**
 * The opening with the verified name in place of {name}, capitalised at the
 * start of a sentence, with the words in front of it agreeing with it: "these
 * two otters", "an agami heron". The model writes the sentence before it
 * knows the name, so it can't get those right itself.
 */
export function fillName(text, name) {
  const counted = COUNTED.test(name);
  return String(text ?? "")
    .replace(/\b(this|that)\s+\{name\}/gi, (m, w) =>
      counted
        ? `${keepCase(/^this$/i.test(w) ? "these" : "those", w)} {name}`
        : m,
    )
    .replace(/\b(an?)\s+\{name\}/gi, (m, w) =>
      counted
        ? "{name}"
        : `${keepCase(vowelSound(name) ? "an" : "a", w)} {name}`,
    )
    .replace(
      /(^|[.!?]\s+)\{name\}/g,
      (_, start) => `${start}${capitalise(name)}`,
    )
    .replace(/\{name\}/g, name);
}

/**
 * One opening, checked: { text } as a template with {name} in it, or
 * { problem } naming the first rule it breaks. `recent` holds the openings of
 * the posts just before this one, oldest first; `avoid` holds wording no post
 * may copy (his examples).
 */
export function checkStory(raw, opts = {}) {
  const {
    named = false,
    name = "",
    fact = "",
    lexicon = [],
    allowed = "",
    taxonText = "",
    grounding = "",
    notes = "",
    recent = [],
    avoid = [],
  } = opts;
  const no = (problem) => ({ problem });
  let text = tidy(raw ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/["“”]/g, "")
    .replace(/\{\s*name\s*\}/gi, "{name}")
    .replace(/[\s.]+$/, "")
    .trim();
  if (!text) return no("empty");
  const slots = (text.match(/\{name\}/g) ?? []).length;
  if (named ? slots !== 1 : slots !== 0)
    return no(named ? "needs {name} once" : "{name} on a photo with no name");
  // "Got this swan, a {name}", "a frog on a blade of grass, this {name}":
  // the name tacked on after a comma reads like a form being filled in.
  if (/,\s+(?:this|that|a|an|the)\s+\{name\}/i.test(text))
    return no("{name} tacked on after a comma");
  // "lol" on one post in four at most: it comes off rather than costing the post.
  if (recent.slice(-LOL_GAP).some((r) => LOL.test(r)))
    text = text
      .replace(/,?\s*\blol\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.])/g, "$1")
      .trim();
  if ((text.match(/\blol\b/gi) ?? []).length > 1) return no("lol twice");
  const filled = fillName(text, name || "it");

  const count = filled.split(/\s+/).length;
  if (count < 12 || count > 75) return no(`${count} words`);
  if (filled.split(/(?<=[.!?])\s+/).length > 4) return no("too many sentences");
  if (/\d/.test(text)) return no("a number");
  if (/[@#]/.test(text)) return no("a tag");
  if (/\?/.test(text.replace(/\(\?\)/g, ""))) return no("a question");
  const lintProblems = lint(filled);
  if (lintProblems.length) return no(lintProblems.join(", "));
  const stock = stockIn(text) ?? backdropIn(text);
  if (stock) return no(`"${stock}"`);
  if (!OPINION.test(text)) return no("no opinion of his");
  const claim = unbackedClaim(text, { grounding, notes });
  if (claim) return no(`"${claim}" with nothing to back it`);
  if (fact && shareRun(filled, fact)) return no("repeats the fun fact");
  const species = unverifiedSpecies(filled, lexicon, `${taxonText} ${name}`);
  if (species.length) return no(`names ${species[0]}`);
  // A capitalised word has to be a name he's written somewhere; sentence starts excepted.
  const names = `${allowed} ${taxonText} ${name} I I'm I've I'd I'll`;
  for (const sentence of text.replace(/\{name\}/g, "").split(/(?<=[.!?])\s+/)) {
    const unknown = ungroundedNames(sentence.trim(), names);
    if (unknown.length) return no(`unknown name "${unknown[0]}"`);
  }

  const opener = storyOpener(text);
  if (recent.slice(-OPENER_GAP).some((r) => storyOpener(r) === opener))
    return no(`starts like a recent post ("${opener}")`);
  for (const [habit, gap] of HABITS)
    if (habit.test(text) && recent.slice(-gap).some((r) => habit.test(r)))
      return no(`"${habit.exec(text)[0]}" again so soon`);
  if ([...avoid, ...recent].some((other) => shareRun(filled, other, 4, true)))
    return no("copies another post's wording");
  return { text: capitalise(text) };
}

/** checkStory's text, or "" when it breaks a rule. */
export function normaliseStory(raw, opts = {}) {
  return checkStory(raw, opts).text ?? "";
}

// Emoji that read as a bot, or as a template.
const NOT_HIS = [
  "✨",
  "🚀",
  "🌟",
  "⭐",
  "💫",
  "🔥",
  "💯",
  "🙌",
  "👇",
  "👉",
  "📸",
  "📷",
  "🎥",
  "🌿",
  "🍃",
  "🌱",
  "🌍",
  "🌎",
  "🌏",
  "🌈",
  "💥",
  "⚡",
  "🎉",
  "🏆",
  "✅",
  "📍",
  "🔗",
  "💡",
  "👏",
  "🙏",
  "💪",
  "🤳",
  "❗",
  "‼️",
];
const bare = (e) => String(e ?? "").replace(/\uFE0F/g, "");
const DENIED = new Set(NOT_HIS.map(bare));
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** One emoji he'd use, or "" for anything else (two of them, a word, a bot's favourite). */
export function cleanEmoji(raw) {
  const parts = [...graphemes.segment(String(raw ?? "").trim())]
    .map((g) => g.segment)
    .filter((g) => g.trim());
  if (parts.length !== 1) return "";
  const [one] = parts;
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(one)) return "";
  return DENIED.has(bare(one)) ? "" : one;
}

// When the model's emoji won't do: the animal, else a face.
const BY_GROUP = {
  frog: "🐸",
  toad: "🐸",
  salamander: "🦎",
  snake: "🐍",
  lizard: "🦎",
  turtle: "🐢",
  bird: "🐦",
  insect: "🐛",
  butterfly: "🦋",
  moth: "🦋",
  beetle: "🪲",
  spider: "🕷️",
  scorpion: "🦂",
  crab: "🦀",
  fish: "🐟",
  "marine-invertebrate": "🐙",
  fungus: "🍄",
  flower: "🌸",
  mountain: "⛰️",
  glacier: "🧊",
  lake: "🏞️",
  river: "🏞️",
  waterfall: "💦",
  coast: "🌊",
  forest: "🌲",
  desert: "🌵",
  sky: "☁️",
};
const FACES = ["😍", "😅", "🤩", "👀", "😮", "🥲", "😂"];

/** No emoji on two of any six posts in a row. */
const EMOJI_GAP = 5;

/**
 * The emoji for the end of a post: the model's when it's fine and not on any
 * of the last five posts, else one from its other options, else the animal's,
 * else a face.
 */
export function pickEmoji(
  raw,
  { group = "", recent = [], alternatives = [] } = {},
) {
  const lately = new Set(recent.slice(-EMOJI_GAP).map(bare));
  for (const e of [
    cleanEmoji(raw),
    ...alternatives.map(cleanEmoji),
    BY_GROUP[group],
    ...FACES,
  ])
    if (e && !lately.has(bare(e))) return e;
  return "";
}

/**
 * One photo's reply, checked: { text, emoji } from the first of its options
 * that passes, or {} when none does. `recentEmoji` holds the emoji on the
 * posts just before it.
 */
export function normaliseVoice(raw, opts = {}) {
  const options = Array.isArray(raw?.options)
    ? raw.options
    : raw?.text
      ? [raw]
      : [];
  for (const option of options) {
    const text = normaliseStory(option?.text, opts);
    if (!text) continue;
    const emoji = pickEmoji(option?.emoji, {
      group: opts.group,
      recent: opts.recentEmoji ?? [],
      alternatives: options
        .map((o) => o?.emoji)
        .filter((e) => e !== option?.emoji),
    });
    return { text, ...(emoji ? { emoji } : {}) };
  }
  return {};
}

/** Offline stand-in so the pipeline runs without a model. */
export function mockVoice(items) {
  const openers = [
    "Came across",
    "Spotted",
    "Saw",
    "Found",
    "Caught",
    "Got close to",
  ];
  const tails = [
    "Pretty cool to see it up close",
    "Such a funny face on it",
    "I love the colors on this one",
    "Kind of wild how still it stayed",
    "So neat seeing one in person",
    "Never gets boring seeing these",
  ];
  return {
    items: items.map((x, i) => ({
      id: x.id,
      options: [
        {
          text: `${openers[i % openers.length]} this ${x.named ? "{name}" : String(x.subject).toLowerCase()} ${x.scene}, written offline. ${tails[i % tails.length]}`,
          emoji: "🐸",
        },
      ],
    })),
  };
}
