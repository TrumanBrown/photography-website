---
description: 'Voice and style rules for every user-visible string on the site (page copy, hobby intros, button labels, empty states, errors, species facts).'
applyTo: 'src/**/*.astro,src/**/*.ts,src/content/**/*.json,api/**/*.js,site.config.ts,site.config.example.ts'
---

# Site copy style

Every string a visitor can read is written in Truman's voice. Match the patterns below rather than
inventing new phrasing. When in doubt, copy the shape of an existing string in the same file.

This applies to: page and section prose, hobby `intro`/`summary`/`blurb`/`heading` fields, button and
tab labels, `aria-label` text, placeholders, status/empty/error strings, toasts, species facts, session
titles/descriptions/captions. It does not apply to code comments, docs under `docs/`, or log messages.

## Voice

- First person, singular, plain. Say what the thing is, then how to use it.
  - `I grew up fishing various lakes and streams in Minnesota.`
  - `Tide pooling quickly became one of my favorite hobbies after moving to WA.`
- Hobby intros follow: personal history → what the toy does → one imperative on how to play.
  - `I keep returning to mountain trails, from the Cascades to China, Norway, and the Himalaya. Build a trail of your own, then turn the journey into a postcard.`
- Undersell. Use honest hedges instead of hype.
  - `The bioload meter is just for fun, not necessarily entirely accurate.`
  - `A playful estimate, not trail guidance.`
- Diminutives are the house joke: `silly little virtual experiences`, `a little pixel bird`, `Fun maps of where I spend most my time fishing.`
- State privacy plainly, in short sentences, and repeat it where it matters.
  - `Your photo stays on your device. Nothing is uploaded, so feel free to snap away`
- Add a stewardship aside wherever a visitor might go do the real thing.
  - `Just like IRL, put the rocks back where you found them.`
  - `always roll it back the way it was.`
  - `Please never handle real salamanders with bug-sprayed or lotioned hands`
- A casual closing sentence may drop its final period. Keep this; it is deliberate.
  - `Maybe they will inspire you to give them a shot IRL`

## Sentences

- Always use contractions: `it's`, `you've`, `doesn't`, `that's`, `I've`.
- One to three short sentences per block of microcopy. No paragraphs in UI chrome.
- Instructions are second-person imperatives: `Tap a rock or driftwood log to look underneath.`
- Say **Tap**, not Click, for anything on a canvas or touch surface. `Click` only for a
  desktop-only affordance (`Click to remove.`).
- Prefer concrete nouns from the hobby — rocks, driftwood, headlight beam, eyeshine, bull kelp —
  over abstractions like "experience", "content", "elements".
- Spaced em dash ` — ` is for a real aside, at most once per block. Dense one-line species facts are
  the exception and may use it to hinge trait → consequence.
- `·` separates metadata (`3 sessions · 41 photographs`, `Coho salmon · Sammamish River`).
- `&` is fine in short pairings (`trout & salmon`, `My reptiles & amphibians, mapped`).
- Use `...` (three dots) for in-progress status, not `…`. Use ASCII `'`, not `’`, in code strings.
- `←` / `→` for back and next links (`← All sessions`, `Next in archive →`).

## Labels and headings

- Sentence case everywhere, including buttons and headings. Never Title Case.
- Name buttons after the world, not the widget: `New beach`, `New road`, `Keep looking`,
  `Keep driving`, `Walk the trail`, `Develop postcard`, `Another selfie`, `Send message`.
- Dismiss buttons stay in the fiction (`Keep looking`) instead of `Close` / `OK` / `Got it`.
- Personal-data sections use possessive `My …`: `My spark bird`, `My birding life list`,
  `My tide pooling observations`, `My tank`, `Fish I've caught`.
- Eyebrow labels are two plain words: `Field journal`, `Trail studio`, `Your postcard`, `Keep exploring`.
- Counters are bare and tabular: `0 / 42 species`, `20 gal`, `5 / 10 moments`, `2,400 × 1,600`.
- `aria-label` describes the scene and the action in one sentence, same voice as visible copy:
  `A pixel beach at low tide. Tap rocks and driftwood logs to find the creatures hiding underneath.`

## Empty, status, and error strings

- Empty states are one short line, optionally with the next step:
  `Nothing here yet.` · `Empty tank. Add a species to get started.` · `No species logged yet.` ·
  `No pageviews in this period.`
- Errors are flat and blame-free. No apologies, no exclamation marks, no emoji, no stack detail.
  `Network error. Please try again.` · `Failed to trigger build.` · `Access denied.` ·
  `Too many messages from your network right now. Please try again later.`
- Validation is a noun plus the problem: `Name is required.` · `Email address looks invalid.`
- Success is short; the one warm exclamation is allowed here: `Message sent. Thank you!` ·
  `Postcard downloaded.` · `Build triggered. Site will update in ~5 minutes.`
- Progress strings end in `...`: `Sending...`, `Walking...`, `Drawing your bird...`, `Saving locally...`.

## Species facts and data blurbs

- Two or three facts per species, one picked at random. Give one ID/field-mark tip and one
  behavior or story fact.
- One sentence each, roughly 12–25 words, leading with the hook.
  - `Check the claws: white tips speckled with purple-red dots set it apart from other shore crabs.`
  - `Lungless — it breathes entirely through its moist skin and mouth, so it can only be out on wet nights.`
  - `Nicknamed the 'Pearl of the Pacific Northwest,' it's a favorite meal of the giant Pacific octopus.`
- Facts must be real and checkable against field guides or Wikipedia. Never invent numbers, ranges,
  or conservation status.
- Never open with `Did you know`, `Fun fact:`, `Interestingly`, or `Believe it or not`.

## Do not write

- Marketing verbs: discover, explore (outside the existing `Keep exploring`), dive in, embark,
  unleash, elevate, immerse, journey through, unlock.
- Inflated adjectives: stunning, breathtaking, vibrant, captivating, seamless, robust, rich, powerful.
- Essay connectors: moreover, furthermore, additionally, in conclusion, it's important to note,
  that said, ultimately.
- `not just X, but Y`, `isn't just about`, `more than just`.
- Decorative rules of three (`fast, simple, and beautiful`).
- Rhetorical openers (`Ever wondered what's under that rock?`).
- Exclamation marks outside the two established warm cases (`Message sent. Thank you!`,
  `I'll get back to you soon. Thanks for visiting!`).
- Emoji in prose or errors. Emoji only where already established: hobby `emoji` fields, the species
  palette, and the two Birding entry buttons (`📷 Take a selfie`, `🖼️ Upload a photo`).
- Address the reader as "users" or "folks". They are "you".

## Before finishing a string

1. Read it out loud. If it sounds like a product page, rewrite it shorter and more literal.
2. Check it against a neighboring string in the same file for casing, punctuation, and length.
3. Cut any clause that only adds enthusiasm.
