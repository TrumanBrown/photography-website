---
name: caption-voice
description: "Truman's voice for Instagram captions: a lively first line that says what's special about the photo, one short first-person reaction, then a 'Fun fact:' line, with his own before-and-after examples. Use when writing, rewriting, reviewing or generating Instagram post captions, photo post copy, comments or fun facts; when a caption sounds like AI, alt text, a field guide or a press release; or when changing the post-writing prompts in scripts/photos/voice.mjs."
---

# Caption voice

How Truman wants his Instagram posts to read. It comes from his own rewrites of
posts the pipeline wrote. The pipeline's versions were accurate but read like
alt text; his read like a person who was there and liked what he saw.

The website's photo captions are not written this way. They stay plain and
literal because they're also the photos' alt text
([site-copy.instructions.md](../../instructions/site-copy.instructions.md)).

## How a post reads

```
<Name> <what it's doing, said with some life>, <place>. <One reaction in his words>

Fun fact: <one fact>

<camera and lens>
<link line>

<five hashtags>
```

The gear line, link line and hashtags are built by code. This file is about the
first paragraph and the label on the fact.

## The first line

- Keep the name first, with the scientific name for an identified species,
  because that's what people search for: `Groove-billed ani (Crotophaga sulcirostris)`.
- Then say what's special about this photo, not just the pose. "Standing on a
  leaf" says nothing; "showing off its incredible leaf mimicry" is why the photo
  was worth taking.
- Everyday, lively verbs: munching on, showing off, looming over, peeking out,
  soaking up, hanging off, staring down. Pick the one that fits what the notes
  describe. Don't invent behaviour the photo doesn't show.
- One adjective is fine when it carries something you can see: "incredible leaf
  mimicry", "a small, reflective alpine pond". Never marketing words: stunning,
  breathtaking, majestic, vibrant, nestled.
- Then the place, exactly as the pipeline gives it, and a full stop.

## The reaction

One short line right after the place, in his own words: what struck him about
this animal or this moment.

- First person is good: "I love when...", "I can't believe how...". So is a
  fragment: "Such an interesting, unique beak on it."
- Talk about something in the photo, or what he'd notice standing there: a
  detail of the animal, the light, the stillness, the scale.
- Real enthusiasm is welcome when it's about something specific. Keep it to one
  line, never a slogan or a sign-off ("Nature never disappoints.").
- Never invent a story: no waiting for hours, no "finally", no weather or
  companions the notes don't mention, nothing about how the photo was taken.
- No new facts, numbers or names. Facts go in the next paragraph.
- Don't repeat the first line or the fun fact. No questions, hashtags, emoji or
  exclamation marks.

## Fun fact

The fact paragraph starts with `Fun fact: `, then one fact from Wikipedia,
written and checked by the pipeline ([facts.mjs](../../../scripts/photos/facts.mjs)).
On Instagram the label is wanted; the website never uses it.

## His examples

Each pair is what the pipeline posted, then how Truman rewrote it.

**Katydid**

> Katydid (Mimetica incisa) standing on a leaf, Monteverde Cloud Forest, Puntarenas Province, Costa Rica
>
> Male katydids give females an edible mating gift that distracts them from eating the packet carrying the male's sperm.

> Katydid (Mimetica incisa) showing off its incredible leaf mimicry, Monteverde Cloud Forest, Puntarenas Province, Costa Rica. I can't believe how they even mimic the punches and holes in natural leaves as well.
>
> Fun fact: Male katydids give females an edible mating gift that distracts them from eating the packet carrying the male's sperm.

**Groove-billed ani**

> Groove-billed ani (Crotophaga sulcirostris) holding an insect on a mossy post, Bijagua, Alajuela Province, Costa Rica
>
> Groove-billed anis lay their eggs in one communal nest, and all group members incubate the eggs and care for the young.

> Groove-billed ani (Crotophaga sulcirostris) munching on an insect on a mossy post, Bijagua, Alajuela Province, Costa Rica. Such an interesting, unique beak on it.
>
> Fun fact: Groove-billed anis lay their eggs in one communal nest, and all group members incubate the eggs and care for the young.

**Mount Baker**

> Mount Baker beyond a pond reflecting trees, Yellow Aster Butte, North Cascades, Washington
>
> Mount Baker has an ice-filled crater called Carmelo hidden beneath its summit ice dome.

> Mount Baker looming over a small, reflective alpine pond, Yellow Aster Butte, North Cascades, Washington. I love when the wind dies down and allows these small ponds to reflect all that's around them.
>
> Fun fact: Mount Baker has an ice-filled crater called Carmelo hidden beneath its summit ice dome.

What changed, every time:

| The pipeline wrote | Truman wrote |
|---|---|
| standing on a leaf | showing off its incredible leaf mimicry |
| holding an insect | munching on an insect |
| beyond a pond reflecting trees | looming over a small, reflective alpine pond |
| (nothing after the place) | one line of his own reaction |
| the fact on its own | `Fun fact: ` before it |

## When unsure

Run the draft past the [humanizer](../humanizer/SKILL.md) skill (blader/humanizer,
MIT). For a two-sentence caption these are the patterns that matter most:

- not X but Y: "It's not just a frog, it's a work of art."
- a closing line that sums up or moralises: "Nature at its finest."
- sayings that sound deep: "the quiet language of the forest"
- a staged opener: "Honestly?", "Here's the thing:"
- forced lists of three: "colour, texture, and light"
- stock AI words: delve, testament, tapestry, showcasing, nestled, vibrant, boasts
- inflated significance: "a rare glimpse into", "a true symbol of"
- "-ing" riders that add nothing: ", reflecting the beauty of the wild"
- sales language: "nestled in the breathtaking cloud forest"
- curly quotes, em dashes, emoji, chatbot leftovers ("Hope you enjoy!")

One difference from humanizer's defaults: in his reactions, opinion and
enthusiasm are the point ("I love", "incredible"). Keep them, as long as
they're about something specific in the photo.

## Procedure

When writing or reviewing a caption by hand:

1. Read what's actually in the photo: the pipeline's notes for it
   (`npm run social -- preview` shows each planned post), or the photo itself.
2. Write the first line: name, then the most interesting thing about it in
   everyday words, then the place.
3. Add one reaction line in Truman's voice.
4. Put `Fun fact: ` before the fact paragraph.
5. Check it against "When unsure". Read it aloud; if it sounds like a product
   page or a field guide, say it the way you'd tell a friend.

## For maintainers

- [voice.mjs](../../../scripts/photos/voice.mjs) puts everything from "How a
  post reads" to "When unsure" into the prompt that writes each planned post's
  first line and reaction, and checks what comes back. Edit those sections to
  change how future posts sound; bump `VOICE_VERSION` there to rewrite posts
  already planned.
- Published posts can't be edited through Instagram's API (it only allows
  turning comments on or off and deleting). Edit those in the Instagram app.
