/**
 * The opening of an Instagram post in Truman's voice, the way he'd type it on
 * his phone. Code picks each post's shape so the feed doesn't repeat one:
 *
 *   short   Edinburgh at night
 *   line    I love how green everything gets around Arenal
 *   story   Saw this {name} munching on some insect in Bijagua. Such a unique
 *           bird, the beak goes so far up its head, almost looks like a horn lol 🐦
 *
 * Written once per planned post, text only, from what the one look at the
 * photo noted, the trip it's from, any notes Truman left for the trip or the
 * photo (`npm run social -- note`), and the post's fun fact. The prompt
 * carries the truman-voice and caption-voice skills (.github/skills/); edit
 * those to change how posts sound.
 *
 * `{name}` stands for the species with its scientific name. Code fills it in,
 * so the name is always the verified one. Code also decides which posts end
 * on an emoji (about half) and picks it, and the place goes on its own line
 * after the opening (compose.mjs).
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
export const VOICE_VERSION = 8;

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
/** The emoji on those six, in the same order: the animal or the scene. */
export const HIS_EMOJI = ["🐦", "🦗", "☁️", "🐦", "🦋", "🏞️"];

// A stable number in [0, 1) for a photo, so its shape and emoji stay put from
// run to run (and change when he asks for a redraft).
function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10007) / 10007;
}

/**
 * How long an opening is: "short" (a few words, "Edinburgh at night"),
 * "line" (one sentence) or "story" (two or three). Read from the text, for
 * posts written before shapes were recorded and for his own words.
 */
export function shapeOf(text) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  if (t.split(/(?<=[.!?])\s+/).filter(Boolean).length > 1) return "story";
  const count = t
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return count <= 9 ? "short" : "line";
}

// "Saw this...", "I got...", "Managed to capture...", "A fun pic of this...":
// how he came across it. His favourite start, and on every post a template.
const CAME =
  /^(?:i\s+)?(?:(?:just|finally)\s+)?(?:saw|spotted|found|caught|got|captured|snapped|grabbed|took|noticed|came across|ran into|ran across|stumbled (?:on|upon|across)|checking out|checked out|looking at|managed to|a fun pic)\b/i;
const DOING =
  /^(?:was|were|while|during|pulled|stopped|walking|hiking|driving|drove|after|on (?:a|the|my|our))\b/i;
const REACTS =
  /^(?:i\s+(?:really\s+)?(?:love|loved|like|liked|think|feel|wish|hope)|love|loved|such|so|pretty|really|crazy|wild|cool|funny|kind of|kinda|can't|couldn't|never|always|wish|hope|one of|glad)\b/i;

/** How a post starts: "came" (how he came across it), "doing", "reaction" or "subject". */
export function openerFamily(text) {
  const t = String(text ?? "").trim();
  if (CAME.test(t)) return "came";
  if (DOING.test(t)) return "doing";
  if (REACTS.test(t)) return "reaction";
  return "subject";
}

// About one in three short, one in four a single sentence, the rest stories,
// with an emoji on about half (his OK on 2026-11-12).
const MIX = { short: 0.33, line: 0.25, story: 0.42 };
const EMOJI_ODDS = { short: 0.3, line: 0.5, story: 0.65 };

/**
 * The shape of a post's opening, given the shapes of the posts before it
 * (oldest first). Less striking photos lean short, the best ones and any his
 * notes say something about lean to a story, and a photo with a person in it
 * leans short so it's about the place. Never two short ones in a row, nor
 * three of anything.
 */
export function pickShape(
  {
    seed = "",
    appeal = 6,
    notes = false,
    person = false,
    scene = false,
    named = false,
  } = {},
  recent = [],
) {
  const w = { ...MIX };
  const a = Number(appeal) || 6;
  if (a >= 8) {
    w.short *= 0.4;
    w.story *= 1.4;
  } else if (a <= 5) {
    w.short *= 2;
    w.story *= 0.6;
  } else if (a === 6) w.short *= 1.4;
  if (notes) {
    w.story *= 2.5;
    w.short *= 0.3;
  }
  if (person) {
    w.short *= 2;
    w.story *= 0.5;
  }
  // A view says enough in a few words; an animal's name in brackets on its
  // own reads like a field guide's label, so those are short less often.
  if (scene) w.short *= 1.6;
  // A good wildlife photo deserves more than its name: "the pygmy lizard its
  // a really good pic so don't necessarily shorten that one" (2026-11-13).
  const goodAnimal = named && a >= 7;
  if (named) w.short *= goodAnimal ? 0 : 0.6;
  const last = recent.at(-1);
  if (recent.length >= 5 && !recent.slice(-5).includes("short") && !goodAnimal)
    w.short *= 3;
  if (last === "short") w.short = 0;
  if (last && recent.at(-2) === last && last in w) w[last] = 0;
  const total = w.short + w.line + w.story;
  let r = seeded(`${seed}:shape`) * total;
  for (const shape of ["short", "line", "story"])
    if ((r -= w[shape]) < 0) return shape;
  return "story";
}

/**
 * How a line or a story starts, given how the posts before it started:
 * "came" at most one post in three, "doing" only from his notes.
 */
export function pickStart(
  { seed = "", shape = "story", notes = false } = {},
  recent = [],
) {
  if (shape === "short") return "";
  const w = {
    came: 0.3,
    reaction: 0.35,
    subject: 0.35,
    doing: notes ? 0.6 : 0,
  };
  // "Spotted this {name} at El Zota, his eye is so cool" is the old two
  // sentences with the full stop taken out.
  if (shape === "line" || recent.slice(-2).includes("came")) w.came = 0;
  const last = recent.at(-1);
  if (last in w && last !== "doing") w[last] *= 0.4;
  const order = ["came", "reaction", "subject", "doing"];
  const total = order.reduce((sum, k) => sum + w[k], 0);
  let r = seeded(`${seed}:start`) * total;
  for (const k of order) if ((r -= w[k]) < 0) return k;
  return "subject";
}

/**
 * Whether a post ends on an emoji, given whether the posts before it did:
 * about half, never three in a row, and never more than three without one.
 */
export function wantsEmoji({ seed = "", shape = "story" } = {}, recent = []) {
  if (recent.length >= 2 && recent.slice(-2).every(Boolean)) return false;
  if (recent.length >= 3 && !recent.slice(-3).some(Boolean)) return true;
  return seeded(`${seed}:emoji`) < (EMOJI_ODDS[shape] ?? 0.5);
}

// Someone in the frame, by what the one look at the photo noted.
const SOMEONE =
  /\b(?:man|men|woman|women|person|people|hikers?|climbers?|tourists?|visitors?|backpackers?|skiers?|surfers?|swimmers?|fisherm[ae]n|photographers?|silhouett\w*|child|children|kids?|boys?|girls?|couple(?!\s+of)|someone|somebody|crowds?)\b/i;

/** True when the photo has a person in it, as its subject or anywhere in the frame. */
export function personIn(analysis = {}) {
  if (analysis?.group === "people") return true;
  return SOMEONE.test(
    [analysis?.subject, analysis?.scene, analysis?.description]
      .filter(Boolean)
      .join(" "),
  );
}

// How a line or a story starts, so they don't all open "Saw this...".
const STARTS = {
  came: 'how he came across it or got the shot, in everyday verbs: "Saw this...", "Got this view of...", "Managed to capture...", "Ran into..." (never bookish ones like "came upon", "happened upon", "gazed at", "photographed" or "got a glimpse of")',
  reaction:
    'his reaction first, then what it is: "I love how...", "Such a cool...", "Pretty wild seeing...", "So glad I got..."',
  subject:
    'the thing itself, with no verb in front of it: "This {name} was...", "Mount Baker from...", "These peaks...", "The fog in..."',
  doing:
    'what he was doing, from his notes: "While on a canal tour...", "Was taking a break on a hike..."',
};

export function voicePrompt(items, guide = "", { recent = [] } = {}) {
  const field = (label, value) => (value ? `; ${label} "${value}"` : "");
  return `You write the opening of Instagram posts for Truman's wildlife and landscape photos, in his voice. People scroll straight past anything that reads like AI wrote it, and a feed where every post has the same shape gives it away even when each post sounds fine on its own: a hundred posts that all go "Saw this ridge rising above a snowy basin. It has such a jagged top..." with an emoji on the end read like a bot. His guide is below, with his own rewrites of posts that sounded like AI. Write the way he does, but never copy his examples' wording.

For each photo, write "options": three different versions, best first, all in the shape it comes with. The shapes are picked so the feed has a mix:
- short: a few words, the way people caption a photo that speaks for itself: the place, the thing, or the thing and the place, maybe with the time of day or the weather when the notes say so. 2 to 8 words, not a full sentence, no "I", no reaction, no "lol". Like "Edinburgh at night", "Gunn Peak from the lake", "Snow on Mount Baker". For an animal, not a field guide's label every time ("{name} in Puget Sound"): "{name} up close", "A {name} from the night walk", "Just a {name}".
- line: one sentence, 6 to 20 words, with his reaction in it. Like "I love how green everything gets around Arenal" or "Such a weird looking {name}, the eyes are almost too big for his head".
- story: two short sentences, 15 to 45 words, three only when his notes give more to tell: what it is or how he came across it, then his reaction, or what it was like from his notes.
A line or a story also comes with a start, for how its first sentence begins:
${Object.entries(STARTS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

In every shape:
- Name it, don't describe it. The photo already shows what's in it, and narrating it is what makes a caption read like a machine describing an image. Say "this ridge in the Olympics", "Mount Baker from Yellow Aster Butte", "these mountains in Tiger Leaping Gorge": never how it sits or what's around it ("rising above a snowy basin", "running along the ridge toward a rocky headland", "beside a winding footpath", "with the trees growing right down to the water"). The subject, scene and description are there so you get it right, not to be repeated.
- An animal can be doing something, in a few everyday words, when that's the interesting part ("munching on some insect", "peeking out of the water"). Mention the place the casual way ("in Bijagua", "near the Arenal Volcano") when it fits; the full place goes on the next line anyway.
- His reaction is about one thing, said plainly: what he thinks of the animal or the place ("such a unique bird", "I love the landscapes in Costa Rica", "they camouflage so well it's crazy"), a hope ("hope to climb that one day"), a hedged guess ("likely (?) sucking nectar", "I think he was eating"), or what it was like being there, from his notes only. Say what it is about it, the way he does ("the beak goes so far up its head, almost looks like a horn"), not a list of its colours, markings or body parts (that's alt text), not a part of it called cool or good ("his antennae are so cool", "the markings on his feathers are so good", "that orange is my favorite part"), and nothing that would fit any photo ("so much to like about this place", "my kind of place", "there's always something interesting here"). Not how its fur, feathers or skin look or feel ("that fur looks really soft", "he looks so fluffy"): he doesn't talk like that. Not how big or small one thing looks next to another, or how steep something is, and not a quip: no witty comparisons, no wordplay, no bits about an animal's attitude, posture or plans. A light "lol" or "hahaha" on some lines and stories is the most of it.
- For a named animal or plant, write {name} exactly once, where it first comes up, right after "this" or "a" ("Saw this {name} munching on..."), or at the start of a short one; code puts in the verified name. Never name it twice or tack it on after a comma ("this swan, a {name}").
- Never mention people, in any photo: no man, woman, guy, hiker, person, people, everyone, crowd, hands or fingers, even when someone is in the frame. When a photo has a person in it, also no he, she or me: write about the place, like "At the falls on a sunny day", and nothing about who's there.
- Casual, not polished. He doesn't write perfect grammar like a robot: sentences run together with commas, the subject gets dropped ("Was taking a break..."), a thought starts with "Even still" or "Luckily for me". Spelling stays right.
- He repeats words instead of reaching for synonyms: "this waterfall" again rather than "the cascade", "such a" and "so" more than once. Never swap in a fancier word to avoid saying something twice.
- Plain, not poetic. One animal is "he" ("He looks taken aback", "gunk on his jaws"), unless his notes say it's female; several are "they". Scenery doesn't get feelings.

Only what's true:
- What he was doing, who he was with, the weather and the time of day: only when the trip name, the photo's notes or his own notes say so. "Pulled over on the side of the road" or "taking a break on a hike" are perfect when his notes say it, and made up when they don't. Without notes, keep to what the photo and the trip name show.
- No waiting, no "finally", no "first time", nothing about luck paying off, unless his notes say so. No "today", "this morning" or "last week": posts go out months later.
- Only the names in the notes. No numbers. Don't say the fun fact; it's posted underneath.
- Never describe the photo itself: no background, blur, framing, angle or lighting.

These go out three a day, so across all the photos below no two may start with the same words or share a phrase, and none may start like the recent posts listed. "Such a" and "so" are his on about half his posts; spread "I love", "I like", "my favorite", "so cool", "pretty", "almost", "little", "hard to" and "lol" out more, each on only some posts. A wish ("I'd love to", "would like to", "makes me want to", "hope to") is for about one post in ten, and "crazy", "wild" or "pretty wild" for one in five or six: he doesn't talk like that much. When "I love" was used recently, don't swap in a fancier way to say it ("I dig", "I'm a fan of", "got a kick out of"): react in a different way instead.

Don't write questions (a hedging "(?)" is fine), hashtags, exclamation marks, long dashes, quotation marks, sales words (stunning, breathtaking, vibrant, majestic, nestled), stock lines ("nature never disappoints", "living its best life", "stopped me in my tracks", "what a sight"), or a last line that sums up.

"emoji": the one emoji he'd end it on, for the posts code gives one (about half): the animal itself (🐊 🐦 🐍 🦦 🦋 🐸) or the scene or thing (⛰️ 🌊 ☁️ 🌋 🚗 🏙️). Never a face, heart or hand (no 😍 😅 😂 🤔 🤯 💚 🙌), and never ✨ 🌿 🍃 🔥 📸 💯 🚀 🌍 💫.
${recent.length ? `\nRecent posts, newest last. Don't start like these or reuse their phrases:\n${recent.map((r) => `- ${r}`).join("\n")}\n` : ""}
Guide:
"""
${guide}
"""

Photos:
${items.map((x) => `- id ${x.id}: shape ${x.shape || "story"}${x.start ? `, start ${x.start}` : ""}${x.person ? "; a person is in this photo (never mention them)" : ""}; ${x.named ? `named "${x.named}" (write {name})${x.count > 1 ? `, ${x.count} of them` : ""}; ` : ""}subject "${x.subject}"; scene "${x.scene}"${field("setting", x.setting)}${field("conditions", x.conditions)}${field("landmark", x.landmark)}; description "${x.description}"; place "${x.place}"${field("trip", x.trip)}${field("his notes", x.notes)}${field("fun fact", x.fact)}`).join("\n")}

Reply with JSON only: {"items": [{"id": "1", "options": [{"text": "...", "emoji": "..."}, {"text": "...", "emoji": "..."}, {"text": "...", "emoji": "..."}]}]}`;
}

// His habits: each is fine on some posts and a tell on every one. [pattern, how many posts back it may not appear]
const HABITS = [
  // How a quip is usually built: a guess at the animal's thoughts, or what
  // he'd do in its place. Fine now and then, a template on every post.
  [
    /\b(?:looks?|seems?) like (?:it|he|she|they)(?:'s| is| was|'re| are| were| has| had| wants?| needs?)\b/i,
    2,
  ],
  [/\bi'd\b/i, 3],
  // His word, on two of his twelve rewrites; the model used it on every
  // other post. "I don't necessarily talk so much like that" (2026-11-13).
  [/\bcrazy\b/i, 5],
  [/\b(?:wild|nuts|insane|unreal)\b/i, 4],
  // His on about half his posts: just not two in a row, and mostly
  // mid-sentence ("cast such a distinct shadow"). Opening a sentence with it
  // on every other post is a rhythm people notice, and so is the model's
  // "That's such a steep..." frame.
  [/\bsuch an?\b/i, 1],
  [/(?:^|[.!?]\s+)such an?\b/i, 3],
  [/\b(?:that's|there's|it's|they're|he's) such an?\b/i, 3],
  [/\bi love\b/i, 2],
  [/\bi (?:really )?like\b/i, 2],
  [/\bmy favou?rite\b/i, 4],
  [/\blittle\b/i, 2],
  [/\bcan'?t get over\b/i, 4],
  [/\bso cool\b/i, 3],
  [/\bcool\b/i, 1],
  [/\bi feel like\b/i, 4],
  [/\bcan'?t believe\b/i, 3],
  [/\blittle guy\b/i, 4],
  [/\balmost\b/i, 2],
  [/\bpretty\b/i, 2],
  [/\bluck(?:y|ily)\b/i, 4],
  [/\bunique\b/i, 2],
  [/\binteresting\b/i, 3],
  [/\bunusual\b/i, 3],
  [/\b(?:strange|odd|weird|bizarre)\b/i, 3],
  [/\bincredible\b/i, 3],
  [/\bfun pic\b/i, 6],
  // The model's ways of describing a view while sounding like a reaction
  // (the first 100 posts): how one thing looks next to another, how steep
  // or how much snow, what's "hard to" do up there, what he "wasn't expecting".
  [/\b(?:compared to|next to)\b/i, 4],
  [/\blooks? (?:so )?(?:tiny|small|huge|massive)\b/i, 6],
  [/\bsteep\b/i, 2],
  [/\bthere's so much\b/i, 4],
  [/\bhard to\b/i, 3],
  [/\bup there\b/i, 3],
  [
    /\b(?:wasn't expecting|didn't expect|wouldn't have expected|didn't realize|than i (?:would have|'d have) thought|not something i)\b/i,
    3,
  ],
  // And the ones it swapped in once those were spread out (the first trial
  // of the mixed shapes): a body part called cool, "my favorite part", colours.
  [
    /\b(?:my favou?rite (?:part|thing|bit|view)|what i like (?:most|best)|i like (?:most|best)|(?:is|are) my favou?rite)\b/i,
    8,
  ],
  [/\b(?:is|are|looks?) so (?:cool|good|nice)\b/i, 4],
  [/\bso good\b/i, 3],
  [/\bcolou?rs?\b/i, 2],
  [/\bmix of\b/i, 8],
  [/\b(?:get|gets|getting|got) a (?:look|view) at\b/i, 6],
  [/\bspend (?:so much |more |some )?time\b/i, 6],
  // ...and in the second: "Crazy how", "Pretty wild getting to see", "So
  // cool seeing" three posts running, and a wish on every few posts, which
  // he said he doesn't do much (2026-11-13). His one wish in twelve rewrites
  // was "hope to climb that one day".
  [
    /(?:^|[.!?]\s+)(?:it's |that's )?(?:so |pretty |kind of |really )?(?:crazy|wild|cool|funny|neat|weird|nuts|interesting|amazing|strange|surprising) (?:how|that|seeing|to see|getting)\b/i,
    6,
  ],
  [
    /\b(?:would (?:like|love) to|i'd (?:like|love|want) to|want to \w+|makes? me want|hope to|go back)\b/i,
    10,
  ],
  // How fur or feathers look or feel: "that fur looks really soft", "he
  // looks so fluffy" (same day, same words).
  [
    /\b(?:soft|softer|fluffy|fuzzy|fuzz|furry|hairy|feathery|velvety|scruffy|bristly|bristles|silky)\b/i,
    8,
  ],
  [/\blooks? (?:so|really)\b/i, 3],
  [/\bclimb\w*\b/i, 4],
  [/\bstands? out\b/i, 6],
];
const LOL = /\blol\b/i;
/** "lol" on one post in four at most. */
const LOL_GAP = 3;
/** No two of any five posts in a row start the same way. */
const OPENER_GAP = 4;
/** "Saw this...", "Got this view of...": at most one post in three. */
const CAME_GAP = 2;
/** Words in each shape, with the name as one: [fewest, most]. */
const SIZES = { short: [2, 9], line: [5, 24], story: [12, 55] };

// How a view is laid out, which is what the photo already shows: "rising
// above a snowy basin", "running along the ridge toward a headland". The
// tell in the first hundred posts. ("Cascades" the range is fine.)
const SCENERY =
  /\b(?:ris(?:es|ing)|tower(?:ing|s (?:over|above))|loom(?:s|ing)|stretch(?:es|ing)|sprawl(?:s|ing)|cascad(?:es|ing)|tumbl(?:es|ing)|snaking|fram(?:ed|es|ing)|overlook(?:s|ing)|dotted|blanketed|carpeted|draped|set against|tucked (?:into|between|below|beneath|behind|under)|lead(?:s|ing) (?:up|down|toward|towards|into|to)|run(?:s|ning) (?:along|toward|towards|through|down|up|across)|wind(?:s|ing) (?:through|along|up|down|toward|towards|across|around)|sweep(?:s|ing) (?:across|over|down|up)|drop(?:s|ping)? (?:straight |right )?(?:down|off|away) (?:to|toward|towards|into)|(?:go|goes|come|comes|grow|grows|run|runs) right (?:down |up |out )?to the)\b/i;
// People never come up: anyone who knows him knows he wouldn't caption a
// photo "man at the falls" (2026-11-12). Not the person, not the crowd, not
// the hands holding a frog.
const PEOPLE =
  /\b(?:man(?!-made)|men|woman|women|person|persons|people|everyone|everybody|someone|somebody|hikers?|climbers?|tourists?|visitors?|backpackers?|crowds?|silhouett\w*|lady|ladies|girls?|boys?|kids?|child|children|couple(?!\s+of)|hands?|fingers?)\b/i;
// With a person in the frame, "he" or "me" would be about them.
const THEM = /\b(?:he|him|his|she|her|hers|guy|guys|me|myself)\b/i;
// What a short one may start with besides a name: "Fog over...", "A {name}...".
const PLAIN_START =
  "a an the this these that those some another one just up out back down over under view views snowy foggy misty rainy cloudy sunny stormy sunset sunrise night evening fall autumn winter spring summer fog mist snow clouds rain golden late early last top close";

const MONTHS =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;

// "Edinburgh at night" and "Iceland at sunset" are one caption with the name
// swapped: the same few words around a name, a species' name included
// ("Northern leopard frog (Lithobates pipiens) in Puget Sound").
const SPECIES_NAME =
  /(?:\b(?!(?:a|an|the|this|these|that|those|some|of|in|on|at|from|off|over|near|up)\s)[\w'-]+\s+){0,5}\([A-Z][a-z-]+(?:\s[a-z-]+){0,3}\)/gi;
function skeleton(text) {
  const plain = new Set(PLAIN_START.split(" "));
  return String(text ?? "")
    .replace(SPECIES_NAME, " X ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\{name\}/g, "X")
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const bare = w.toLowerCase().replace(/[^a-z']/g, "");
      if (w === "X") return "X";
      if (i === 0 && plain.has(bare)) return bare;
      return /^\p{Lu}/u.test(w) ? "X" : bare;
    })
    .filter((w, i, all) => !(w === "X" && all[i - 1] === "X"))
    .slice(0, 2)
    .join(" ");
}

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
export function fillName(text, name, { plural = false } = {}) {
  // "bharals (Pseudois nayaur)" for a whole herd has no number in front.
  const counted = plural || COUNTED.test(name);
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
    plural = false,
    fact = "",
    lexicon = [],
    allowed = "",
    taxonText = "",
    grounding = "",
    notes = "",
    recent = [],
    avoid = [],
    shape = "story",
    person = false,
  } = opts;
  const no = (problem) => ({ problem });
  let text = tidy(raw ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/["“”]/g, "")
    .replace(/\{\s*name\s*\}/gi, "{name}")
    .replace(/[\s.]+$/, "")
    // "such a awkward thing": a slip he wouldn't make.
    .replace(/\b([Aa]) (?=([a-z][\w'-]*))/g, (m, a, next) =>
      vowelSound(next) ? `${a}n ` : m,
    )
    .trim();
  if (!text) return no("empty");
  const slots = (text.match(/\{name\}/g) ?? []).length;
  if (named ? slots !== 1 : slots !== 0)
    return no(named ? "needs {name} once" : "{name} on a photo with no name");
  // "Got this swan, a {name}", "a frog on a blade of grass, this {name}":
  // the name tacked on after a comma reads like a form being filled in.
  if (/,\s+(?:this|that|a|an|the)\s+\{name\}/i.test(text))
    return no("{name} tacked on after a comma");
  // "a cool looking two otters": code can only fix the word right in front.
  if (plural && /\ban?\s+(?:[\w'-]+\s+){1,3}\{name\}/i.test(text))
    return no("a or an in front of several");
  // "these three shaggy manes (Coprinus comatus) looks like..."
  if (
    plural &&
    /\{name\}\s+(?:\w+ly\s+)?(?:is|was|has|looks|seems|sits|stands|makes|goes|gets|does)\b/i.test(
      text,
    )
  )
    return no("one verb for several");
  // "lemur leaf frog (Agalychnis lemur)'s face", "these bharals (Pseudois
  // nayaur) herd": the brackets can't take an 's or a noun after them.
  if (/\{name\}'/.test(text)) return no("'s on the name");
  if (
    /\{name\}\s+(?:herd|flock|group|pair|family|pod|colony|troop|bunch|school|pack|nest|web)\b/i.test(
      text,
    )
  )
    return no("the name in front of another noun");
  // "lol" on one post in four at most, and never on a short one: it comes
  // off rather than costing the post.
  if (shape === "short" || recent.slice(-LOL_GAP).some((r) => LOL.test(r)))
    text = text
      .replace(/,?\s*\blol\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.])/g, "$1")
      .trim();
  if ((text.match(/\blol\b/gi) ?? []).length > 1) return no("lol twice");
  const filled = fillName(text, name || "it", { plural });

  // The size its shape asks for, counting the name as one word.
  const count = text.replace(/\{name\}/g, "X").split(/\s+/).length;
  const sentences = text.split(/(?<=[.!?])\s+/).length;
  const [least, most] = SIZES[shape] ?? SIZES.story;
  if (count < least || count > most) return no(`${count} words for a ${shape}`);
  if (shape === "story" ? sentences < 2 || sentences > 3 : sentences > 1)
    return no(`${sentences} sentences for a ${shape}`);
  if (/\d/.test(text)) return no("a number");
  if (/[@#]/.test(text)) return no("a tag");
  if (/\?/.test(text.replace(/\(\?\)/g, ""))) return no("a question");
  const lintProblems = lint(filled);
  if (lintProblems.length) return no(lintProblems.join(", "));
  const stock = stockIn(text) ?? backdropIn(text);
  if (stock) return no(`"${stock}"`);
  const scenery = SCENERY.exec(text.replace(/\bCascades\b/g, ""));
  if (scenery) return no(`"${scenery[0]}" describes the view`);
  const someone = PEOPLE.exec(text) ?? (person ? THEM.exec(text) : null);
  if (someone) return no(`"${someone[0]}": people never come up`);
  if (shape === "short") {
    if (/\b(?:i|i'm|i've|i'd|my|me)\b/i.test(text))
      return no("I in a short one");
    if (openerFamily(text) === "came")
      return no("a short one that starts with how he got it");
  } else if (!OPINION.test(text)) return no("no opinion of his");
  if (shape === "line" && openerFamily(text) === "came")
    return no("one sentence that starts with how he came across it");
  const claim = unbackedClaim(text, { grounding, notes });
  if (claim) return no(`"${claim}" with nothing to back it`);
  if (fact && shareRun(filled, fact)) return no("repeats the fun fact");
  const species = unverifiedSpecies(filled, lexicon, `${taxonText} ${name}`);
  if (species.length) return no(`names ${species[0]}`);
  // A capitalised word has to be a name he's written somewhere; sentence
  // starts excepted, except on a short one, which usually starts with one.
  // A month in the trip's name counts ("North Cascades July 2026").
  const months = grounding.match(MONTHS) ?? [];
  const names = `${allowed} ${taxonText} ${name} ${months.join(" ")} I I'm I've I'd I'll`;
  const bare = text.replace(/\{name\}/g, "");
  for (const sentence of bare.split(/(?<=[.!?])\s+/)) {
    const unknown = ungroundedNames(sentence.trim(), names);
    if (unknown.length) return no(`unknown name "${unknown[0]}"`);
  }
  if (shape === "short") {
    const unknown = ungroundedNames(
      `x ${bare.trim()}`,
      `${names} ${grounding} ${PLAIN_START}`,
    );
    if (unknown.length) return no(`unknown name "${unknown[0]}"`);
    const frame = skeleton(filled);
    if (
      recent
        .slice(-6)
        .some((r) => shapeOf(r) === "short" && skeleton(r) === frame)
    )
      return no(`a short one put like a recent one ("${frame}")`);
  }

  const opener = storyOpener(text);
  if (recent.slice(-OPENER_GAP).some((r) => storyOpener(r) === opener))
    return no(`starts like a recent post ("${opener}")`);
  if (
    openerFamily(text) === "came" &&
    recent.slice(-CAME_GAP).some((r) => openerFamily(r) === "came")
  )
    return no("starts with how he came across it, like a post just before");
  // A species' own name is neither a habit nor copied wording: "shaggy
  // manes (Coprinus comatus)" isn't him saying shaggy, and the same animal
  // comes round again.
  const unnamed = (t) => String(t ?? "").replace(SPECIES_NAME, " X ");
  for (const [habit, gap] of HABITS)
    if (
      habit.test(text) &&
      recent.slice(-gap).some((r) => habit.test(unnamed(r)))
    )
      return no(`"${habit.exec(text)[0]}" again so soon`);
  if (
    [...avoid, ...recent].some((other) =>
      shareRun(unnamed(filled), unnamed(other), 4, true),
    )
  )
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
// Faces, hearts, hands, people, aliens and skulls: he only puts the animal
// or the scene at the end ("stick to emojis of the animals or scenes").
const NOT_A_SCENE =
  /[\u{1F600}-\u{1F64F}\u{1F910}-\u{1F92F}\u{1F970}-\u{1F97A}\u{1F9D0}-\u{1F9DF}\u{1FAE0}-\u{1FAEF}\u{1FAF0}-\u{1FAF8}\u{2639}\u{263A}\u{2763}\u{2764}\u{1F493}-\u{1F49F}\u{1F5A4}\u{1F90D}-\u{1F90F}\u{1F9E1}\u{1FA75}-\u{1FA77}\u{1F440}-\u{1F450}\u{1F466}-\u{1F487}\u{1F918}-\u{1F91F}\u{1F930}-\u{1F93E}\u{1F47B}-\u{1F480}\u{1F4A9}\u{1F4AA}\u{1F590}\u{1F595}\u{1F596}\u{270A}-\u{270D}\u{1F9E0}\u{1F4AB}\u{1F4A2}\u{1F4A4}\u{1F4A6}]/u;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** One emoji he'd use, or "" for anything else (two of them, a word, a face, a bot's favourite). */
export function cleanEmoji(raw) {
  const parts = [...graphemes.segment(String(raw ?? "").trim())]
    .map((g) => g.segment)
    .filter((g) => g.trim());
  if (parts.length !== 1) return "";
  const [one] = parts;
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(one)) return "";
  return DENIED.has(bare(one)) || NOT_A_SCENE.test(one) ? "" : one;
}

// When the model's emoji won't do: the animal or the scene.
const BY_GROUP = {
  mammal: "🐾",
  dragonfly: "🪰",
  plant: "🪴",
  city: "🏙️",
  temple: "🛕",
  village: "🏘️",
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
  waterfall: "🏞️",
  coast: "🌊",
  forest: "🌲",
  desert: "🌵",
  sky: "☁️",
};
/**
 * The emoji for the end of a post: the model's when it's the animal or the
 * scene, else one from its other options, else the animal's own. A different
 * one from the post before when there's a choice; the same animal twice in a
 * row is fine (two birds are two birds), a face never is.
 */
export function pickEmoji(
  raw,
  { group = "", recent = [], alternatives = [] } = {},
) {
  const fitting = [
    cleanEmoji(raw),
    ...alternatives.map(cleanEmoji),
    BY_GROUP[group] ?? "",
  ].filter(Boolean);
  const last = bare(recent.at(-1));
  return fitting.find((e) => bare(e) !== last) ?? fitting[0] ?? "";
}

/**
 * His own words for a post (`npm run social -- opening`), split into the text
 * and the emoji he ended it with, if any. A full stop right before that emoji
 * goes, since the emoji takes its place; without one, his words stay exactly
 * as he typed them, and no emoji is added.
 */
export function ownOpening(raw) {
  const text = String(raw ?? "").trim();
  const parts = [...graphemes.segment(text)].map((g) => g.segment);
  let end = parts.length;
  while (end > 0 && !parts[end - 1].trim()) end--;
  const last = parts[end - 1] ?? "";
  const emoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(last)
    ? last
    : "";
  const words = parts
    .slice(0, emoji ? end - 1 : end)
    .join("")
    .trim();
  return { text: emoji ? words.replace(/\.$/, "").trim() : words, emoji };
}

/**
 * One photo's reply, checked: { text, emoji } from the first of its options
 * that passes, or { problems } (why each failed) when none does. `emoji:
 * false` when code has decided this post ends without one; `recentEmoji`
 * holds the emoji on the posts just before it.
 */
export function normaliseVoice(raw, opts = {}) {
  const options = Array.isArray(raw?.options)
    ? raw.options
    : raw?.text
      ? [raw]
      : [];
  const problems = [];
  for (const option of options) {
    const { text, problem } = checkStory(option?.text, opts);
    if (!text) {
      problems.push(problem);
      continue;
    }
    if (opts.emoji === false) return { text };
    const emoji = pickEmoji(option?.emoji, {
      group: opts.group,
      recent: opts.recentEmoji ?? [],
      alternatives: options
        .map((o) => o?.emoji)
        .filter((e) => e !== option?.emoji),
    });
    return { text, ...(emoji ? { emoji } : {}) };
  }
  return problems.length ? { problems } : {};
}

/** Offline stand-in so the pipeline runs without a model, in each photo's shape. */
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
  const thing = (x) =>
    x.named ? "{name}" : String(x.subject ?? "").toLowerCase();
  const write = (x, i) => {
    if (x.shape === "short")
      return x.named
        ? "{name} up close, offline"
        : `${x.subject} up close, offline`;
    if (x.shape === "line")
      return `${tails[i % tails.length]}, this ${thing(x)} written offline`;
    if (x.start === "subject" || x.start === "reaction")
      return `This ${thing(x)} was written offline, without a model. ${tails[i % tails.length]}`;
    return `${openers[i % openers.length]} this ${thing(x)} ${x.scene}, written offline. ${tails[i % tails.length]}`;
  };
  return {
    items: items.map((x, i) => ({
      id: x.id,
      options: [{ text: write(x, i), emoji: "🐸" }],
    })),
  };
}
