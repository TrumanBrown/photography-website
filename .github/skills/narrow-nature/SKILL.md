---
name: narrow-nature
description: "Narrow nature (formerly Day list), the daily place-guessing puzzle at /hobbies/narrow-nature/: DayList.astro, src/lib/hobbies/day-list.ts, day-list-map.ts and day-list-borders.ts, the round data built from iNaturalist by scripts/build-day-list.mjs (accuracy rules, --extra, --retag), resolve-day-list-places.mjs, the relief tiles and borders, map zoom, scoring, the reveal and its stamps, More lists (ten more a day), photo credits and the share text. Use when: changing the puzzle, its rules, scoring, instructions or layout; adding or vetting places or rebuilding the rounds; a species, a native, introduced or endemic label, or a fact is wrong; the map, zoom, relief or borders need work, especially on phones; changing the reveal or the points stamps; or renaming anything players' saved progress depends on."
argument-hint: 'the change, e.g. "add Madagascar to More lists" or "the borders draw across a bay"'
---

# Narrow nature

A daily puzzle that asks you to read a community instead of one organism. Six species were all recorded at one real iNaturalist place in one month. They're revealed most widely recorded first, so the first line narrows almost nothing and the last one often names the valley. You drop a pin on a world map, pick a month, and score on distance, month and how few species you needed. Today's list is the same round for everyone; More lists deals up to ten more a day per browser from a separate set of places. It sits first in Things to try because it's the one people come back to. It was built after Truman turned down a rarity game as "the same idea as kriliion" and pointed at iNatGuessr as the bar: "inatguesser was unique and good" (2026-10-08).

| Path                                                              | Role                                                                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/hobbies/DayList.astro`                            | markup and styles (a namespaced `<style is:global>`, everything prefixed `dl-`): how to play, the board, the species tray, the map and its controls, the guess panel |
| `src/lib/hobbies/day-list.ts`                                     | the engine: both modes and their saved state, the reveal, scoring (`scoreGuess`, `bestPossible`), stamps, the result, share text, credits. `EXTRA_PER_DAY` is 10     |
| `src/lib/hobbies/day-list-map.ts`                                 | zoom (1x to 64x) and pan, gestures, relief tiles and their palette, camera moves for the reveal                                                                      |
| `src/lib/hobbies/day-list-borders.ts` + `day-list-borders/`       | country and state borders (generated)                                                                                                                                |
| `src/lib/hobbies/day-list.json`, `day-list-extra.json`            | the daily set and the More lists set (generated)                                                                                                                     |
| `public/day-list/relief/v1/` + `day-list-relief.json`             | relief tiles (about 2,900 files, served immutable) and the list of which exist                                                                                       |
| `scripts/build-day-list.mjs`, `resolve-day-list-places.mjs`       | build the sets from iNaturalist and Wikipedia; vet candidate places                                                                                                  |
| `scripts/build-day-list-relief.mjs`, `build-day-list-borders.mjs` | cut the tiles; build the borders from Natural Earth                                                                                                                  |

The long version, including every accuracy rule, is [docs/hobbies.md](../../../docs/hobbies.md#reference-implementation-narrow-nature-daily-puzzle). The page follows [hobby-pages](../hobby-pages/SKILL.md) for everything a hobby shares, and [site-motion](../site-motion/SKILL.md) for the stamps and roll-ups.

## Truman's rules for the puzzle

- **Completely accurate, so experts can play it**: "it has to be completely accurate and also images. that way i can give it to experts and hobbyists who want to play" (2026-10-09). Every clue is a research-grade record from that place and month, with at least two local records.
- **Animals over plants.** "slightly more animal focused" (2026-10-09). Plants are dead-end clues for almost everyone.
- **The premise and the instructions come first and are the biggest thing on the page.** "everyone who has tried this is so confused the premise of the game"; "heres the premise of the game and here are the instructions (make this the biggest part)" (2026-10-12). No filler.
- **The map has to work on a phone**: zoom to see how close you were, more detail than flat continents, state and country borders (2026-10-12).
- **Photographer names stay off the board.** Credits go in a closed footnote, because a name can give the place away (2026-10-13).
- **More lists is capped at ten a day**, so places don't repeat and it doesn't cost much (2026-10-12).
- **Feedback lands by what it's about, not in the middle of the screen**: the "-X points" stamp "slamming first like a stamp and slowly drifting down and away" (2026-10-14). It lands on the top-right corner of the clue photo it bought, since the score is often off screen on a phone, and he's fine with that: "its fine on the photo since the photo is large and this is small and in top right" (2026-10-25).

## Add places or rebuild the rounds

1. Vet candidates: `node scripts/resolve-day-list-places.mjs` (add `--extra` for More lists). It resolves each to an iNaturalist place id and reports how much data it has, its busiest month and the size of its boundary.
2. Paste the keepers into `PLACES` or `EXTRA_PLACES` in `scripts/build-day-list.mjs`.
3. Build: `npm run build:day-list` (the daily set) or `npm run build:day-list -- --extra`. About an hour per set: it throttles to roughly one request a second, retries with a widening pause, and refuses to write a set with fewer than ten rounds.
4. Rebuild the daily set near midnight. Today's round is `todayNumber() % ROUNDS.length` by the visitor's local date, so adding or removing daily rounds changes everyone's "today", including people partway through.
5. `npm run build:day-list -- --retag [--extra]` relabels native, introduced and endemic without changing any species (about ten minutes for both sets), and is safe any time.
6. Run `npx vitest run src/lib/hobbies/day-list.test.ts`. It reads the built data: the real sets must never share a place, every round needs six species and a boundary, and there must be enough extras for a week.
7. Record any fact check in the docs, as the October 2026 one was.

## Map data

- Relief: `npm run build:day-list-relief`, and bump `VERSION` (`"v1"`) in the script whenever the tiles change, because `/day-list/relief/*` is served immutable. Static Web Apps allows 15,000 files per deploy, and the tiles are about 2,900 of them. They stay same-origin because the map reads their pixels to recolour them.
- Borders: `npm run build:day-list-borders`. It deletes files it no longer makes, so restart `npm run dev` if it was running.
- Both download Natural Earth into `.cache/` once.

## Truman's verdicts

- 2026-10-08: "this is good but not unique, its the same idea as kriliion... inatguesser was unique and good." Then: "include pictures int he species. and the description is ocnfusing for new players... not making it too visible yet."
- 2026-10-09: "push it to actual website and make it pul correct facts, real region data"; "make it bigger, a full hobby / game on it's own. additionally, make it slightly more animal focused... make it sound a little less AI Like."
- 2026-10-12: "the 'what they found' is way too small, the world map is good, but i think the ux could be made more professional and clean"; the instructions were "horrible" with "slop filler". He pointed at a cleaner game (Originle) as a model, which gave the board of big squares and the price on the reveal button.
- 2026-10-12: "need to be able to zoom in on the map so i can see how close I was... especially important for mobile... maybe satellite or topographic"; an unlimited mode "maybe cap at 10 a day"; "add state and country borders to the map."
- 2026-10-13: "Put day list hobby at top of the things to try section... name it something other than day list. the name shoudl explain what it is. like narrow nature maybe"; "hide the cc information for each image, the names sometimes give away the location"; "make the images bigger."
- 2026-10-14: the URL had to change to match the name (`a9c0572`); a points stamp by the score that slams and drifts.
- 2026-10-25: the points stamp on the corner of the clue photo stays: "its fine on the photo since the photo is large and this is small and in top right."

## Hard-won lessons

1. **Plants made dead-end clues**: 9 of 21 giveaway lines were plants. Animals now sort first in every band, a round allows at most two botanical clues, and the last band is animals only. Plants went from 31% of clues to 1% (`bb02074`).
2. **Labels need a majority, not one listing.** A user-made iNaturalist place tagged Mallards as introduced across six rounds, and Grey Wagtail was called endemic on Madeira. A label now follows the majority of the place's own flagged records, and "endemic" needs at least half of the species' records worldwide flagged endemic (`3bf8d22`).
3. **A round needs a truly common opener** (at least 120,000 records worldwide), or it starts half-solved. Wikipedia links from iNaturalist arrive with raw spaces and have to be normalized (`283694e`).
4. **A photographer's name gave the place away** (Cyrillic on a Białowieża photo). Credits moved to a closed footnote (`887f540`).
5. **On a phone the map was "a strip of flat continents with no way in".** It got zoom to 64x, double-tap, Ctrl or Cmd plus scroll (plain scroll scrolls the page and shows a hint), relief tiles and a scale bar (`3bf8d22`). The pin drops only on a click that didn't move, so a scroll that starts on the map can't drop one (`ba360e4`).
6. **Borders from Natural Earth needed work**: its zoom limits left Mexico blank beside a fully drawn US, and state lines ran across bays such as the Chesapeake. Each country's zoom now comes from its states' sizes, and lines that cross water are dropped (`27fdb80`).
7. **The reveal reads better in beats**: the line draws from the pin to the place over about 600 ms while the distance rolls up, then the boundary strokes in. Under reduced motion it all shows at once.
8. **The rename went in two commits**, title and copy first (`dfca9e4`), then the URL with 301s from the old paths (`a9c0572`). The code kept the old name on purpose.

## Gotchas

- Keep the `day-list-*` localStorage keys, the `dayList` block and the `data-daylist-*` hooks. Saved progress depends on them.
- `day-list.test.ts` and `day-list-borders.test.ts` read the built data, so a bad rebuild fails `npm test`.
- Everything built at runtime is styled through the namespaced global style block; scoped styles don't reach it.
- The share string uses emoji squares because it goes to the clipboard; on-page copy never uses emoji.
- The docs still say the photo credits render under each photo on the board; the code puts them in a footnote.
- Puzzle data ships as JSON and photos load from the iNaturalist CDNs, so playing costs nothing per visit and works if the API is down. Keep it that way.

Add new verdicts and lessons here, dated, in the commit that acts on them.
