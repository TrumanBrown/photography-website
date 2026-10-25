---
name: design-mocks
description: "Exploring designs, features and game ideas as throwaway mocks before anything is built: the gitignored mocks/ folder and scripts-local/ prep scripts, Truman's mock spec (usable, real content, desktop and a true phone view), the banned default-AI design signature, serving mocks from WSL so he can open them on Windows, presenting rounds with a short list of decisions, and what he kept or rejected in earlier rounds. Use when: he asks for mocks, mockups, prototypes, concepts, a redesign, layout options or design directions; brainstorming a new tool, game or feature for the site; something looks too AI, generic, templated, slop or vibe-coded; or turning an approved mock into real pages."
argument-hint: 'the question to explore, e.g. "three directions for the prints page"'
---

# Design mocks

New directions get tried as mocks before they touch the site: self-contained HTML pages in `mocks/` that Truman can open and use. The folder is gitignored, as are the prep scripts in `scripts-local/`, so mocks live only on his own machines (git doesn't carry them; he copies the folder across) and never deploy. The house look they should start from is in [site-design.instructions.md](../../instructions/site-design.instructions.md) and the words in [site-copy.instructions.md](../../instructions/site-copy.instructions.md). Card art comes from the [stipple-plates](../stipple-plates/SKILL.md) skill, never from drawn icons.

## Truman's spec for a mock

- **A mock is the real experience without the real plumbing**: one file "I can open in a browser and actually use", real-looking data, empty, loading and error states, and good enough that someone shown it for ten seconds would think it was the finished feature. His reaction to text sketches: "these mocs are horrible, unusuable. I want actual mocks of what the end user experience would be" (2026-09-27).
- **Not default AI.** "NOT DEFAULT AI looking. This is so important... People automatically ignore websites if they have this" (2026-10-06). The list below is the spec.
- **Unique and useful.** "this is good but not unique, its the same idea as kriliion... inatguesser was unique and good" (2026-10-08). "are these really ones people would come back to?" (2026-09-28).
- **A flagship needn't be a game or about nature.** "it needs to be unique, solves an interesting use case, and a clean, profession UX. more fleshed out than the mini games" (2026-09-28), and it "isn't super basic like some of the hobbies we have done". Geography is an interest the site doesn't show yet. Ones he points to: iNatGuessr, The Pudding's 3D city, Krillion, and Magnitudle's "Size it up" ("people will come back to and it is learning as well").
- **Not held back by Azure cost.** Scope the idea at its best; the credit covers it (azure-ops).
- **Simple.** The first redesign round was "far too complicated, too much going on in the screen" (2026-10-06).
- **Portfolio looks must suit every session**, not only wildlife: "it's not just field photography, it's landscapes, cities, etc" (2026-10-06).
- **Desktop and a true phone view** in every mock, visible without resizing the window.
- **Built from the current site**: "remember to buidl it from the current ux not the old" (2026-10-08).
- **Some motion, not overboard**; the scroll-reveal era is over.

### The banned default-AI signature

From his 2026-10-06 brief. If a direction needs one of these, justify it in writing.

- Colour and surface: indigo-to-violet or blue-to-cyan gradients, gradient-filled headlines, glass (backdrop blur with faint white borders), a slate-900 dark mode with one glowing accent, blurred gradient blobs behind a hero, dot-grid, faint-grid or noise overlays, and opacity steps (`/80`, `/60`, `/40`) as the only contrast tool.
- Layout: the centred hero with a pill badge, a huge headline, a one-line subhead and two buttons; three-column feature grids of tinted rounded icons; bento grids; the same wide section with an eyebrow, heading, subhead and three cards repeated down the page; a testimonial or call-to-action band at the bottom.
- Detail: one big rounded radius and a large shadow on everything; cards that lift or grow on hover; bold tight Inter or Geist for every heading; emoji in headings; sparkle and rocket icons; staggered fade-up on scroll.
- Copy: "Elevate", "Seamlessly", "Crafted with care", "Discover", "Journey", "Dive into".

## Run a round

1. If he asks, rewrite his prompt first and hand it back for him to edit (he did this on 2026-09-27 and 2026-10-06), with the banned list, the deliverables, the checks, and "state assumptions and keep working". Ask clarifying questions before writing it, hand back only the prompt and stop: "you're supposed to give me the refined prompt that I Will pass back to you... not immediately do the actual work" (2026-09-27). Ask again when he sends it back.
2. Read the real site first (pages, components, tokens, copy rules, content) and write a five-to-eight-point critique of what's there. The critique drives the directions.
3. Build in `mocks/<topic>/` and never touch `src/`. An `index.html` links each direction with a one-paragraph thesis and what it refuses. Use real content (session titles and photos, hobby JSON) and copy that follows the copy rules. Give every mock a desktop and phone toggle and a dark mode.
4. Directions that should diverge get their own CSS. Mocks meant to look like the live site copy the tokens from `src/styles/global.css` and self-host Libre Franklin, as `mocks/things-to-try/mock.css` does. Game mocks make no network calls: data comes from `scripts-local/prep-*.mjs` and assets are inlined.
5. For each direction, say what it took from where, what it left out, and the trade-off. End with two or three decisions for him and your recommendation. In a brainstorm, add "a much much longer list of less / to no mocks but technically feasible other ideas" (2026-09-28), and for each top idea a 1-to-10 confidence that you can build it, naming any external data, new service, key, rate limit, licence or re-architecture it needs.
6. Check it yourself: serve it, open every page, no console errors or failed requests, screenshots at desktop and phone width, and a reread against the banned list naming anything that slipped through.
7. Present it the way he can open it from Windows: `cd mocks && python3 -m http.server <free port> --bind 127.0.0.1` as a background service, then `http://localhost:<port>/<path>` links, plus the `\\wsl.localhost\Ubuntu\...` path as a fallback (ship-and-ci). Keep earlier rounds collapsed at the bottom of the index.
8. Iterate on his verdicts. When he approves one, port it into `src/` ("port the look, not the mock's file structure"); helpers working in parallel should each own separate files. From there the normal ship rules apply.

## Rounds so far

| Local date | Mocks                                                                                                                     | Verdict                                                                                                     | What came of it                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 2026-09-27 | text sketches in an ideas report                                                                                          | "horrible, unusuable"                                                                                       | his mock spec, and the `mocks/` folder                                                         |
| 2026-09-28 | a blur-to-guess puzzle, a season map, a fixed-beach page; then tide and field tools, depth-of-field and light calculators | "too surface level"; the answer flashed on load; "still a bit too AI, basic geometry"; not the camera tools | the calculators were dropped ("a tool you need twice a year is a bookmark, not a destination") |
| 2026-10-06 | redesign round 1: Plate, Almanac, Unigrid, Contact, Headlamp                                                              | "frankly i dont think any of these work... far too complicated"                                             | kept one big photo on the landing page, session locations, a globe to spin                     |
| 2026-10-06 | round 2: quiet, globe, atlas                                                                                              | globe yes, but keep the sessions overview: "sessions side bar smaller on the left, the images bigger"       | round 3                                                                                        |
| 2026-10-06 | round 3: sessions with the globe, the admin rotation picker, hobby icons                                                  | "this is good, I like this"; cards must look like collections, fixed size; icons rejected                   | shipped overnight (`7620dcb`); icons later became stipple plates                               |
| 2026-10-08 | Deep cut (rarity) and Day list                                                                                            | Deep cut "the same idea as kriliion"; Day list kept                                                         | Narrow nature                                                                                  |
| 2026-10-11 | Things to try A to E, plate previews                                                                                      | the plates: "these are great, im impressed"                                                                 | stipple plates (`1d90166`, `3b646a4`)                                                          |
| 2026-10-12 | motion mock F, eight ideas                                                                                                | all but idea 2 ("i chose the header specifically")                                                          | `408328e`, `ba360e4`                                                                           |

Still unbuilt from mock F, waiting on his go-ahead since 2026-10-12: a redesigned contact button, a stipple-plate 404 page, filtering by animal kept in the URL, and arrows between sessions.

Still unbuilt from 2026-09-28, his own tide pool idea: pick any point on the Washington coast, see its tide chart, and the animals (no plants) iNaturalist has from there for a chosen span of months across all years. He turned down the fixed-beach page because "locked only to a few beaches is pointless I go to new tidepool spots all the time". He liked blur-to-guess, where each wrong guess makes the photo clearer. The notes from that brainstorm (a 40-idea list, the flagship report, data-source research) are in `mocks/notes/brainstorm-2026-09/`.

## Hard-won lessons

1. **Text isn't a mock.** Describing an experience got "horrible, unusuable"; a working page gets real feedback.
2. **The first frame can give the game away.** A puzzle image animated in from its untransformed state and showed the full answer for a moment. Set the start state before first paint.
3. **Old styles make old-looking mocks.** Mocks built on the original `mocks/shell.css` drew "build it from the current ux". Copy today's tokens.
4. **Drawn icons failed three rounds.** Stipple plates from his own photos worked the first time.
5. **One idea per screen.** Every first-round direction tried to show too much; what he kept were single strong pieces from several directions.
6. **A copy of a good idea is still a copy.** Unique matters more to him than polish.
7. **Say when a request contradicts an earlier verdict.** He rejected the card-photo-becomes-header idea in mock F, later asked for a cover zoom, and rejected that once he saw it.

## Gotchas

- `npm run lint` reads `mocks/` locally and fails on vendor files there; CI never sees them. Never import from `mocks/` or `scripts-local/` in committed code.
- `file://` pages aren't a secure context, so the clipboard is blocked; serve them. Windows paths into WSL can show a stale cached copy.
- Pick a free port; other sessions leave servers running.
- `scripts/photos/open.mjs` (`openCommand`) opens a file in his Windows browser from WSL, and `explorer.exe <file>` does too, exiting 1 even when it works.

Add new verdicts and lessons here, dated, in the commit that acts on them.
