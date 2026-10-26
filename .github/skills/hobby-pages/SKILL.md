---
name: hobby-pages
description: "The Things to try section (/hobbies/): adding, reworking or renaming a hobby (src/content/hobbies/<slug>.json, its island in src/components/hobbies and src/lib/hobbies, src/pages/hobbies/[slug].astro, HobbyCard, HobbyBand, hobby-facts.ts), the island conventions, shared parts (SpecimenCard, FieldJournal, first-find stamps, pixel reveal), species data, facts and reveal photos, hobby galleries (hobby-media) and fishing catches, the herp and fishing maps, and the personal element every hobby needs (iNaturalist embed, life list, spark bird, herp map, catches). Use when: adding a hobby, minigame or toy; changing the aquarium, tide pooling, fishing, birding (selfie to bird), herping night drive or hiking trail studio; adding species, facts or reveal photos; uploading hobby gallery photos or catches; rebuilding herp or fishing map data; renaming a hobby or its URL; or checking Truman's verdicts on the hobby toys. Narrow nature has its own skill."
argument-hint: 'the hobby and the change, e.g. "herping: add the rough-skinned newt" or "new hobby: kayaking"'
---

# Hobby pages

"Things to try" is the hobbies section: seven hobbies Truman actually does, each a page with a small interactive toy (an "island") and something personal from his own records. Every hobby is one JSON file in `src/content/hobbies/<slug>.json`, a card with a stipple plate, an opening scene when the card is clicked, and the page `src/pages/hobbies/[slug].astro`, which renders the header, the island, the personal element and any gallery.

| Hobby              | Island                                                                                 | Data                                                            | Personal element                                                         |
| ------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `aquarium-keeping` | `AquariumTank.astro`; `aquarium.ts`, `aquarium-jump.ts`, `stocking.ts`                 | `aquarium-species.ts`                                           | the video of his tank (`video`, `HobbyVideo.astro`) and his tank gallery (`media`) |
| `tide-pooling`     | `TidePool.astro` + `FieldJournal` + `SpecimenCard`; `tidepool.ts`                      | `tidepool-species.ts`, `tidepool-photos.json`                   | his iNaturalist observations (`INatObservations.astro`)                  |
| `fishing`          | `Fishing.astro`; `fishing.ts`, `fishing-sprites.ts`                                    | `fishing-waters.json`, `fishing-species.ts`, `fishing-geo.json` | his catches (`fishing-catches.json`)                                     |
| `birding`          | `Birding.astro`; `birding.ts` (MediaPipe, on device), `birding-bird.ts`, `bird-ink.ts` | `public/birding/face_landmarker.task`                           | spark bird and life list (`BirdingSpark.astro`, `BirdingLifeList.astro`) |
| `herping`          | `HerpingNight.astro` + `FieldJournal` + `SpecimenCard`; `herping.ts`                   | `herping-species.ts`, `herping-photos.json`                     | his herp map (`INatHerpMap.astro`, `herp-geo.json`)                      |
| `hiking`           | `PixelHike.astro`; `hiking.ts`, `hiking-model.ts`, `hiking-renderer.ts`                | none                                                            | the copy                                                                 |
| `narrow-nature`    | `DayList.astro`                                                                        | see the [narrow-nature](../narrow-nature/SKILL.md) skill        | none, it's a puzzle                                                      |

Components are in `src/components/hobbies/`, engines and data in `src/lib/hobbies/`. Shared parts: `SpecimenCard.astro` (the reveal card), `FieldJournal.astro`, `specimen.ts` (`stampFind`, the "New, to your journal" stamp), `pixel-reveal.ts`, `src/lib/motion.ts` (`rollTo`, `setHair`, `stamp`, underline tabs), `src/lib/covered.ts` (`whenUncovered`), `inat-place.ts` (places rounded to 0.1°). The long reference, one section per hobby, is [docs/hobbies.md](../../../docs/hobbies.md).

Related skills: [stipple-plates](../stipple-plates/SKILL.md) for the card art, [hobby-scenes](../hobby-scenes/SKILL.md) for the click animation, [site-motion](../site-motion/SKILL.md) for stamps, jumps and other motion, [truman-voice](../truman-voice/SKILL.md) and [site-copy](../../instructions/site-copy.instructions.md) for every word on the page.

## Truman's rules for hobbies

- **Every hobby has a personal element** from his own life or records ("look at how i made the other hobbie sections personal", 2026-06-29).
- **Real and accurate.** Species, facts, places and photos must hold up in front of experts: "it has to be completely accurate and also images. that way i can give it to experts and hobbyists" (2026-10-09). Facts are checkable against field guides or Wikipedia, never invented numbers, and doubtful ones get looked up twice.
- **Animals first.** He wants the toys "more animal focused"; plants make dead-end clues. Reveal photos must be "clear and of the animal" (2026-07-08).
- **Real maps.** "make it a real map and make it a heat map of the actual true locations" (2026-07-08), and on a phone it must pinch and zoom (2026-07-09).
- **On device, no per-visitor AI spend.** He turned down a generative model for the selfie bird because "a couple users could spam that and immedaitely eat my credits" (2026-06-28). A selfie never leaves the device, and the page says so.
- **Privacy.** iNaturalist places show a town or region at most, on a 0.1° grid. Hidden fishing spots are never named, in copy, file names or URLs ("just say small river", 2026-10-13). Photographer credits sit in a closed footnote, because a name can give a place away.
- **Nothing covers the animal.** Stamps and badges go beside the photo, never over it ("don't put this directly over the animal image", 2026-10-15). The one exception is Narrow nature's small price stamp in the corner of a large clue photo: "its fine on the photo since the photo is large and this is small and in top right" (2026-10-25).
- **New toys start quiet.** He asked for the first version of the puzzle "not making it too visible yet" (2026-10-08). Ask before putting something new at the top of the section.
- Clean, "not overly animated slop" (2026-10-14).

## Add a hobby

1. Write `src/content/hobbies/<slug>.json`: `title`, `summary`, `intro`, `plateNote`, `order`, and an `interactive` value and/or a personal block (the schema is `hobbies` in `src/content/config.ts`). The intro goes personal history, then what the toy does, then one imperative, in his voice.
2. Plates: add a subject under the same slug in the stipple-plates skill's `subjects.json` (its `note` matches `plateNote`) and render all 12 files into `src/assets/plates/`. `src/lib/plates.test.ts` fails until they all exist.
3. A new island: add its value to the `interactive` enum in `config.ts`, put the markup in `src/components/hobbies/<Name>.astro` with a processed `<script>` (never `is:inline`), put the logic in `src/lib/hobbies/<name>.ts` bound through `data-*` hooks, and add a branch in `[slug].astro`. Follow the [island conventions](../../../docs/hobbies.md#interactive-island-conventions): no runtime API calls in the core toy, a keyboard frame with `role="application"`, a `ResizeObserver`, pause when offscreen, a reduced-motion path, and start loops through `whenUncovered()`.
4. Add a case to `src/lib/hobby-facts.ts`, or no facts line shows under the title.
5. Update `src/components/HobbyBand.astro`: a `VERBS` entry for the slug, the `repeat(7, ...)` column count and the band's label.
6. Give it an opening scene (hobby-scenes). Without one, a click falls back to the plain dive or sink.
7. Give it a personal element (below).
8. A new host the browser talks to needs the CSP in `staticwebapp.config.json`, [docs/security.md](../../../docs/security.md#the-csp-unpacked), and the /privacy/ page with its "Last updated" date.
9. Docs: a reference section in docs/hobbies.md, its status line, and the list of islands in the README.

## Give a hobby its personal element

Use one of the blocks that already exist before writing new plumbing: `media` (a gallery), `video` (one of his YouTube uploads in place of the hero photo, with `moments` the toy can link to; [docs/hobbies.md](../../../docs/hobbies.md#a-video-of-the-real-thing)), `inaturalist` (his observations, filtered with `iconicTaxa` or `taxonId`), `lifeList`, `spark`, `herpMap`, or a real-data gallery like the fishing catches. The iNaturalist ones load lazily near the viewport, fail quietly, and round places through `inat-place.ts`. His iNaturalist user id comes from the hobby JSON.

## Species, facts and reveal photos

- Tide pooling and herping: edit `tidepool-species.ts` or `herping-species.ts` (the sprite `category` must already exist; herping also needs `eyeshine`, and `nonNative` where it applies). Two or three facts each, one ID tip and one behaviour fact, one sentence, 8 to 28 words. Run `npx vitest run src/lib/hobbies/species-facts.test.ts`.
- Reveal photos: `npm run fetch:tidepool-photos -- --only <id> --wire inat`, or `npm run fetch:herping-photos -- --place 46 --wire inat` (46 is Washington). Review `staging/<hobby>/photos.json`, then commit the wired JSON.
- Aquarium: the `SPECIES` array in `aquarium-species.ts`. Fishing: `fishing-species.ts`, then the species ids on each water in `fishing-waters.json`. Moving or adding a water needs `node scripts/build-fishing-geo.mjs`, because markers come from `fishing-geo.json`.
- Bird families: `node scripts/fetch-bird-families.mjs`. The life list itself is live from iNaturalist.
- Record a fact check in docs/hobbies.md, as the October 2026 one was.

## Galleries, catches and maps

- Gallery: full-size files in `staging/hobby-<slug>/`, then `AZURE_STORAGE_ACCOUNT=<account> node scripts/upload-hobby-media.mjs <slug> --hero <file>`, which writes the `media` block. Add captions (otherwise the link reads "Open full-resolution photo"), commit and push. Full-size links work once the next build publishes `incoming/` to `hobby-media/` with GPS stripped.
- Catches: add the entry to `fishing-catches.json`, put the original in the main checkout's `staging/fishing/` (check it decodes, photo-sessions lesson 11), run `node scripts/upload-fishing-catches.mjs`, and commit the JSON with its copy in `src/assets/hobbies/fishing/`.
- Map data: `npm run build:herp-geo`, `node scripts/build-fishing-geo.mjs`. Each downloads its source into `.cache/` once.

## Rename a hobby or its URL

Day list became Narrow nature in two commits: the title and copy first (`dfca9e4`), then the slug (`a9c0572`). A slug move touches the JSON (`git mv`), the plates and the `subjects.json` key, the `HobbyBand` `VERBS` key, the `SCENES` key in `src/lib/scenes/table.ts` and its special case in `scenes.test.ts`, doc anchors, and two 301 routes in `staticwebapp.config.json` (the old path and the old path with `/*`). Keep code names, `data-*` hooks and localStorage keys as they are, so saved progress survives. Link `/hobbies/` with its trailing slash. Redirects only work in production (`npm run preview` ignores the SWA config), so check with `curl -I` after the deploy.

## Checks

`npx vitest run src/lib/hobbies src/lib/plates.test.ts`, then `npm test`, `npm run lint`, `npm run check`. Look at the page at 390×844 and 1440×900 in both themes, with the keyboard, and with reduced motion. Judge animation on `npm run build && npm run preview`, not the dev server.

## Truman's verdicts

- Cards: "a logo for each... not clearly AI generated" (2026-10-06); "the logos are really not good... your own created ones are bad" (2026-10-07). Stipple plates from his own photos stuck: "these are great, im impressed" (2026-10-11).
- Home page: "the hobby section to show up a bit more visible and definitily in mobile view as well" (2026-10-06). The `HobbyBand` stays visible on phones.
- Birding: "(persons face plus some minor bird aspects) and not the other way around"; "needs to look realisitic... not some cartoon" (2026-06-27). No cloud model (2026-06-28). "split the full list into families" (2026-06-29); "show my inaturalist pics... not just generic" (2026-06-30); the life list needed bigger photos on phones, plus search and sort (2026-07-01).
- Herping: "find amphibians in the dark... mainly only salamanders"; "eyeshine glint is a great idea"; "more salamander focused"; "why the flat squares of light and why do eyes completely dissapear in the light"; extend the map to other countries (all 2026-07-08). Faster road finds, and pinch zoom on phones (2026-07-09).
- Aquarium: a new fish "flies and transforms from the color sprite to the actual fish and jumps into the tank, with water droplets... if they spam, it should just have multiple jump in"; clearing the tank should "tip the tank over" (2026-10-14). For the video of his tank he picked a muted hero that starts at the time of day and "seen in my tank" links from the fish, and turned down self-hosting the footage: "can't use just embed youtube somehow" (2026-10-25).
- Fishing: "remove the chinook salmon entry entirely, and remove the river name from the coho... just say small river" (2026-10-13).
- Tide pooling and herping: the first-find stamp off the animal, and a pass over older facts with the new copy rules: "it's good to get a pass on these older components" (2026-10-15).

## Hard-won lessons

1. **Start with a real map.** The herp map was redone five times: a tile-grid choropleth he rejected, a heatmap on real geometry (`f777a73`), world and country views (`a47efc0`), zoom (`0e84ef4`), a 0.1° grid with town names for privacy (`79259d2`) and a CPU readback (`8492c7d`).
2. **Phones need their own map controls.** Clusters were unreadable until a zoom and pan layer with pinch, wheel and buttons, rendering throttled through rAF, and `touch-action: pan-y` that switches to `none` once zoomed (`0e84ef4`).
3. **Open on `click`, never `pointerdown`.** On phones the click from the same tap landed on the new scrim and closed the card it had just opened (`2124ef8`).
4. **Preload reveal photos at a sensible size.** Reveals were slow until species photos preloaded on `requestIdleCallback` at iNaturalist's `medium` (about 120 KB instead of 490 KB) (`be4b54e`).
5. **Full-size catches live in Blob.** Committed 1600 px copies capped the lightbox (`6657e80`), and hidden fishing spots came out of file names and URLs too (`eeaaf9c`).
6. **Birding was redone nine times in two days** (`5aa02e6` to `3dfcbe8`): pixel mascot, person first, bird first, species, photo hybrid, mesh warp. What decided it was the constraint, not the look: on device, no generative model, the selfie never leaves the phone.
7. **Card art took three tries:** emoji, then generated logos he rejected, then stipple plates from his own photos. Never hand-draw icons.
8. **The first-find stamp went across the picture** (`df1b5d7`) until it got its own grid row beside it (`bd89c84`).
9. **Herping eyeshine was backwards.** It vanished when the light hit the animal, and the beam was drawn as flat trapezoids. Eyeshine is brightest when lit, with a radial beam (`f777a73`).
10. **Facts read like AI and some were wrong** (the leather star and swimming anemone mix-up, a chorus frog's colour change taking weeks, a rubber boa's lifespan). A copy pass and a second fact check fixed them, and `species-facts.test.ts` checks the mechanics (`e705d25`).

## Gotchas

- Islands use a processed `<script>`; `is:inline` would need a CSP hash. DOM built at runtime needs a namespaced `<style is:global>` (`dl-`, `[data-pixel-hike]`), because scoped styles don't reach it.
- Tailwind's Preflight is off, so `[hidden]` loses to a `display` class. Add a scoped `[hidden] { display: none !important }` (`b01e3fa`).
- A literal `<script>` inside an `.astro` comment broke Vite's dev scanner (`f219864`).
- The SpecimenCard photo isn't lazy on purpose: a hidden lazy image is never fetched.
- Every new motion needs a reduced-motion path: stamps, jumps, nets and the tank tip all settle at once.
- `[slug].astro` must keep calling `settleDots()`, or a page reached through a scene stays covered for up to 8 seconds.
- `npm run check` needs at least one session JSON; CI runs `node scripts/generate-fixtures.mjs` first.
- The dev server uses `trailingSlash: 'always'`, so `/hobbies` without the slash 404s there. Restart it after changing `tailwind.config.mjs` or the content schema.
- The birding intro still says "pixel bird" although the island makes a photo hybrid. That copy is Truman's own, so ask before changing it.

Add new verdicts and lessons here, dated, in the commit that acts on them.
