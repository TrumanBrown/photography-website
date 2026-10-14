---
name: caption-voice
description: "Truman's Instagram captions: a story-style opening in his voice ('Saw this {name} munching on some insect in Bijagua. Such a unique bird...'), exactly one emoji at the end, the place on its own line, then 'Fun fact:', gear, link and hashtags, with his own before-and-after rewrites. Use when writing, rewriting, reviewing or generating Instagram post captions, photo post copy or fun facts; when a caption sounds like AI, alt text, a field guide or a press release; when changing the post-writing prompt in scripts/photos/voice.mjs; or when adding trip notes for captions."
---

# Caption voice

How Truman's Instagram posts read, from his own rewrites of the first posts
the pipeline wrote. How he writes in general (openers, intensifiers, hedges,
humour) is in [truman-voice](../truman-voice/SKILL.md); this file is the post
itself and the rules the generator follows.

## How a post reads

```
<his opening: two or three sentences> <one emoji>
<Place, Region, Country>.

Fun fact: <one fact>

<camera and lens>
<link line>

<five hashtags>
```

The opening and its emoji are written for each post
([voice.mjs](../../../scripts/photos/voice.mjs)). Everything else is built by
code: the place line from the trip, the fact from Wikipedia, the gear line
from EXIF, the link line and the hashtags.

## The opening

- Start the way he does, with "I" or a verb: what he was doing or how he came
  across it, often with the "I" dropped ("Saw this...", "Spotted this...",
  "Came across this...", "While on a canal tour in Tortuguero, managed to
  capture this...", "I love how..."). Then "this" and the name.
- An identified species is written `{name}`, once, where the animal first
  comes up, right after "this" or "a". Code puts in the verified name with its
  scientific name, and fixes the words in front of it: "this {name}" becomes
  "this groove-billed ani (Crotophaga sulcirostris)", or "these two North
  American river otters (...)", and "a {name}" becomes "an agami heron (...)".
  The generator never types a species name itself, and never tacks it on
  after a comma ("Got this swan, a {name}").
- Say what it's doing in everyday words: munching on, perched on, peeking out
  of, hanging off. Only what the notes say is in the photo.
- Then his reaction: one specific thing he likes, or finds funny or strange,
  about this animal or this place. A hedge when he can't be sure ("likely (?)",
  "almost looks like"). A small joke when something's actually funny.
- Mention the place casually if it fits ("in Bijagua", "near the Arenal
  Volcano"). The full place goes on the next line anyway.
- Two or three sentences, 15 to 60 words.

### Only what's true

Backstory is the best part of his openings and the easiest to fake.
"Pulled over on the side of the road" and "taking a break on a hike" came from
him. A model that writes them from a guess is making things up, and he'd be
the one posting the lie. So:

- What he was doing, who he was with, the weather and the time of day appear
  only when the trip's name, the photo's notes or his trip notes say so. A trip
  called "Tortuguero canal" can say "on a canal tour"; nothing can say "after
  hours of waiting" unless his notes do.
- His notes come from `npm run social -- note <trip> "..."`. They're private
  and never posted as they are; the opening may draw on them.
- No "today", "this morning" or "last week": posts go out months after the
  photo was taken.
- No numbers, and no facts: the fun fact is underneath, and the opening
  doesn't repeat it.

### Spread out his habits

Three posts go out a day, so anything on every post becomes a tell:

- No two of any five posts in a row start with the same words ("Saw this"
  twice). Starting with "I" is fine as often as not, with different words
  after it.
- "lol" on one post in four at most, and never twice in one.
- "such a" on about half the posts (never two in a row), mostly
  mid-sentence like his "cast such a distinct shadow"; a sentence starting
  "Such a..." on one post in four. "I love", "I like", "my favorite",
  "pretty", "almost", "little", "so cool", "unique" only every few posts.
- When "I love" was used recently, react a different way (a comparison, a
  joke, a surprise) rather than with a fancier word for it: "I dig", "I'm a
  fan of", "got a kick out of", "I was struck by" are a model dodging a
  repeat, not him.
- Inside one caption, repeat words rather than swapping in synonyms: "this
  waterfall" twice is him, "the cascade" isn't.
- Never copy a phrase from his rewrites or from a recent post.

## The emoji

- Exactly one, at the very end of the opening, in place of the last full stop.
  One emoji reads like a person; a row of them reads like a bot.
- The animal itself (🦋 🐸 🦜), a face (😅 😂 🤯 😍 🥲) or the thing (🌋 ⛰️ ☁️
  🌊).
- Never ✨ 🌿 🍃 🔥 📸 🙌 💯 🚀 🌍 💫: these are what bot-written posts use.
- Not one used on any of the five posts before it, so the grid isn't a row of ⛰️.

## The place line

On its own line straight after the opening, most specific first, with a full
stop: "Bijagua, Alajuela Province, Costa Rica." Code builds it from the trip.
Places only, said so anyone can place them: no habitat words, and Washington
always ends "Washington state, USA" (his swallowtail rewrite changed
"shrub-steppe, Eastern Washington" to "Eastern Washington state, USA").

## Fun fact

The fact paragraph starts with `Fun fact: `, then one fact from Wikipedia,
written and checked by the pipeline ([facts.mjs](../../../scripts/photos/facts.mjs)).
On Instagram the label is wanted; the website never uses it.

## His rewrites

What was on each post, then how Truman rewrote it. Some of the "before"
versions were already his first edits; the second round moved further from a
label towards a story. Typos are corrected; the emoji were added when he asked
for one at the end of every caption.

**Waterfall, Arenal**

> Waterfall plunging between plant-covered cliffs into a pool, Arenal Volcano, Alajuela Province, Costa Rica. So much greenery right beside that falling water.

> A fun pic of this waterfall near the Arenal Volcano in Costa Rica. I love the landscape pictures from Costa Rica because there's so much green everywhere, like you can see surrounding this waterfall 💚
> Arenal Volcano, Alajuela Province, Costa Rica.

**Two-tailed swallowtail**

> Two-tailed swallowtail (Papilio multicaudata) clinging to a purple flower spike, shrub-steppe, Eastern Washington. Black stripes look so good on yellow.

> Was taking a break on a hike and captured this two-tailed swallowtail (Papilio multicaudata) perched on a purple flower, likely (?) sucking nectar from the petals. I feel like some of the best wildlife experiences come when you're resting, and nature just comes to you 🦋
> Eastern Washington state, USA.

**Green ibis**

> Green ibis (Mesembrinibis cayennensis) preening with its curved bill tucked into feathers, Tortuguero canals, Limón Province, Costa Rica. That green-blue sheen is my favourite thing about this bird.

> While on a canal tour in Tortuguero, managed to capture this Green ibis (Mesembrinibis cayennensis) pretty close up. They are such unique looking birds, almost alien-like. The iridescent shade of the feathers is so cool too 👽
> Tortuguero canals, Limón Province, Costa Rica.

**Canyon, Kauai**

> Layered canyon cliffs rising above a green valley, Napali Coast, Kauai, Hawaii. That reddish-brown rock is what I'd remember most.

> Pulled over on the side of the road to capture this canyon view in Kauai. I love how the low clouds cast such a distinct shadow on the cliffs ☁️
> Napali Coast, Kauai, Hawaii.

**Katydid**

> Katydid (Mimetica incisa) showing off its incredible leaf mimicry, Monteverde Cloud Forest, Puntarenas Province, Costa Rica. I can't believe how they even mimic the punches and holes in natural leaves as well.

> Spotted this katydid (Mimetica incisa) showing off its incredible leaf mimicry in Monteverde Cloud Forest at night. Luckily for me, this little guy chose the wrong color plant to land on lol, he stuck out like a sore thumb. Even still, I can't believe how they even mimic the punches and holes in natural leaves 🤯
> Monteverde Cloud Forest, Puntarenas Province, Costa Rica.

**Groove-billed ani**

> Groove-billed ani (Crotophaga sulcirostris) munching on an insect on a mossy post, Bijagua, Alajuela Province, Costa Rica. Such an interesting, unique beak on it.

> Saw this Groove-billed ani (Crotophaga sulcirostris) munching on some insect in Bijagua. Such a unique bird, the beak goes so far up its head, almost looks like a horn lol 🦏
> Bijagua, Alajuela Province, Costa Rica.

What changed, every time:

| The pipeline wrote | Truman wrote |
|---|---|
| a label: name, pose, place | a story: what he was doing, then "this" and the name |
| "clinging to a purple flower spike" | "perched on a purple flower, likely (?) sucking nectar" |
| a comment on colours or rock | an opinion about the animal or the place, with "such a", "so", "I love" |
| everything certain | hedges where he can't know: "likely (?)", "almost" |
| place in the middle of the first sentence | place in passing, then in full on its own line |
| no emoji | one emoji at the end |

## When unsure

Run the draft past the [humanizer](../humanizer/SKILL.md) skill (blader/humanizer,
MIT). For a short caption these are the patterns that matter most:

- a label where a story should be: "Waterfall plunging between cliffs into a pool"
- the photo described as a photo: background, blur, framing, light
- not X but Y: "It's not just a frog, it's a work of art."
- a closing line that sums up or moralises: "Nature at its finest."
- sayings that sound deep: "the quiet language of the forest"
- a staged opener: "Honestly?", "Here's the thing:"
- forced lists of three: "colour, texture, and light"
- stock AI words: delve, testament, tapestry, showcasing, nestled, vibrant, boasts
- inflated significance: "a rare glimpse into", "a true symbol of"
- sales language: "nestled in the breathtaking cloud forest"
- curly quotes, em dashes, more than one emoji, chatbot leftovers ("Hope you enjoy!")

One difference from humanizer's defaults: his enthusiasm and intensifiers are
the point ("I love", "so cool", "such a unique bird"). Keep them, as long as
they're about something specific.

## Procedure

When writing or reviewing a caption by hand:

1. Read what's actually in the photo: the pipeline's notes for it
   (`npm run social -- preview` shows each planned post), or the photo itself,
   and anything he's said about the trip (`npm run social -- notes`).
2. Write the opening: how he came across it, "this" and the name, what it's
   doing, then one reaction. Only backstory he gave.
3. End it with one emoji instead of a full stop.
4. Put the place on the next line, then the `Fun fact: ` paragraph.
5. Check it against "When unsure". Read it aloud; if it sounds like a product
   page or a field guide, say it the way you'd tell a friend.

## For maintainers

- [voice.mjs](../../../scripts/photos/voice.mjs) puts everything from "How a
  post reads" to "When unsure", plus "How he writes" from truman-voice, into
  the prompt that writes each planned post's opening, and checks what comes
  back: `{name}` exactly once, no invented backstory, no repeated openers or
  habits, one emoji he'd use. Bump `VOICE_VERSION` there to rewrite posts
  already planned.
- A post whose opening fails every check isn't posted with a fallback; it waits
  and is tried again on the next run.
- `HIS_STORIES` in voice.mjs holds his rewrites in posting order: the posts
  just before the first generated ones, and wording no post may copy. Add new
  rewrites there and above.
- Trip notes: `npm run social -- note <trip> "canal boat tour"`, listed with
  `npm run social -- notes`. They're kept privately in `metadata/social/notes.json`.
- Published posts can't be edited through Instagram's API (it only allows
  turning comments on or off and deleting). Edit those in the Instagram app.
