---
name: site-motion
description: "Motion and interaction on the public pages, apart from the hobby opening scenes and the globe: src/lib/motion.ts (rollTo, setHair, stamp, underline tabs), the parts in global.css, the session page change (open.ts, landing.ts, a cross-document view transition), the lead photo rotator, card skim, rail peek, plate boil, lightbox motion, aquarium jumps and the tank tip, Narrow nature stamps, keyboard play, reduced motion and rapid clicks, and porting patterns from Cult UI, Watermelon UI, Magic UI or Skiper UI into plain TypeScript under the CSP. Use when: adding or changing an animation, micro-interaction, transition, hover effect, stamp, points pop, rolling counter, tabs or progress rule; something feels janky, laggy, jumpy or not smooth; rapid clicks break it; checking reduced motion or touch; changing how a session opens; or Truman points at a component library, a reel or another site's animation."
argument-hint: 'the interaction, e.g. "stamp the bioload when a fish is added" or "lead photo swipe feels sticky"'
---

# Site motion

The site moves only in answer to the visitor, briefly, and in its own ink-and-paper terms: a stamp slams and drifts, a number rolls, a 1px rule fills, a fish jumps into the tank. The house rules are in [site-design.instructions.md](../../instructions/site-design.instructions.md#motion), and the shared parts with their sources are in [docs/hobbies.md](../../../docs/hobbies.md#shared-parts-and-the-look) and [docs/product-experience.md](../../../docs/product-experience.md#motion-that-answers-what-you-do). Truman's bar: "maybe some animations but not overboard. I think that trend has sailed" (2026-10-06), "still a clean, not overly animated slop website" (2026-10-14), and "smooth like professional website ux animations" (2026-10-14).

Hobby card scenes are in [hobby-scenes](../hobby-scenes/SKILL.md), the globe in [session-globe](../session-globe/SKILL.md), and the lightbox's sizes in [image-delivery](../image-delivery/SKILL.md).

## Building blocks

| Path                                                           | What's there                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/motion.ts`                                            | `prefersReducedMotion()`; `rollTo(node, to, { format, ms })`, a rolling number that cancels any older roll on the same node; `setHair(fill, fraction)` for the `.hair` progress rule; `stamp(host, text, { unit, tilt, className, stay, animate })` with `stampFrames`, `stampLandFrames`, `STAMP_MS` (1700) and `STAMP_LAND_MS` (260); `initUnderlineTabs` and `initAllUnderlineTabs` for `[data-utabs]` radio groups |
| `src/styles/global.css`                                        | `--ease`, `--stamp` (the one red, kept for a cost in a game), `.btn`, `.btn-ink`, `.linkbtn`, `.draw`, `.hair`, `.utabs`, `.shead`, `.stamp`, `.stamp-ink`, and a reduced-motion block at the end                                                                                                                                                                                                                      |
| `src/lib/open.ts`, `src/lib/landing.ts`                        | opening a session: a one-time cross-document view transition (200 ms fade, the page rising 8 px with a 40 ms stagger) and warming the page on hover                                                                                                                                                                                                                                                                    |
| `src/components/LeadPhoto.astro`                               | the rotator: 900 ms crossfade every 6 s, a 1px timer, Pause, swipe (horizontal only), pausing on caption hover with a mouse, on focus, in a hidden tab or offscreen                                                                                                                                                                                                                                                    |
| `src/components/SessionCard.astro`                             | paper sheets that spread on hover, and a skim through the first eight photos on fine pointers                                                                                                                                                                                                                                                                                                                          |
| `src/components/ArchiveRail.astro`                             | the rail peek, a small print beside the row on mouse hover or keyboard focus, 900 px and wider                                                                                                                                                                                                                                                                                                                         |
| `src/components/PlateArt.astro`                                | the plate boil, three inkings every 125 ms, on fine pointers or focus                                                                                                                                                                                                                                                                                                                                                  |
| `src/components/Lightbox.astro`, `src/lib/lightbox-caption.ts` | PhotoSwipe zooms out of the thumbnail (300 ms in, 250 out); the caption fades while a photo is zoomed                                                                                                                                                                                                                                                                                                                  |
| `src/components/ThemeToggle.astro`                             | a crossfade between themes (inline and CSP-hashed)                                                                                                                                                                                                                                                                                                                                                                     |
| Hobby parts                                                    | `specimen.ts` (`stampFind`), `aquarium-jump.ts` (`jumpArc`, `createJumps`), `aquarium.ts` (`netPath`, `tipLean`), `pixel-reveal.ts`, `bird-ink.ts` (`inkIn`), the price and verdict stamps in `day-list.ts`                                                                                                                                                                                                            |

Where the patterns came from: Cult UI (rolling number, direction-aware tabs, the hover video player behind the boil and skim), Watermelon UI (labeled progress, discrete tabs, preview link card behind the rail peek, copy confirm), Skiper UI (the drawn underline), Magic UI (pixel image, the theme toggle crossfade, and blur-fade without the blur for the session page), Krillion's floating score for the points stamp, and Vercel's Web Interface Guidelines for the audit. What was left out of each is listed in the docs table: pills, glass, gradients, shimmer, springs, confetti, scroll reveals, circle wipes.

## Rules

- **Only in answer to the visitor.** The lead photo is the one thing that changes by itself, and it has a pause.
- **150 to 320 ms on `var(--ease)`, `transform` and `opacity` only, properties listed.** The stamp, the developing postcard and the lead crossfade run longer on purpose; don't cite them as precedent.
- **Never morph one photograph into a different one** across a page change; the cover and the banner are almost always different photos (2026-10-16).
- **Nothing lands on a photograph or an animal**, and feedback sits by the thing it's about, never in the middle of the screen: "not in middle of screen, but subtly and noticeably by the score" (2026-10-14).
- **Decide what rapid clicks do** before building (below). "if they spam, it should just have multiple jump in, keep it smooth" (2026-10-14).
- **Hover is a bonus for a mouse.** Nothing a phone needs sits behind hover.
- **Reduced motion keeps the information and drops the movement.**
- **If a request contradicts an earlier verdict, say so before building.** He turned down the card-to-header morph on 2026-10-12, suggested something like it himself two days later, and rejected it once he saw it.

## Add a micro-interaction

1. Pin the brief to his words: where it sits, how it should feel, what spam does. Look at how others do it when he asks ("find how others do it. krillion has some similar").
2. Put it on the thing it's about. A price lands on the slot it bought, because the total is often off screen. A result that stays uses `stay: true` in ink (`stamp-ink`); a cost uses the red `--stamp`.
3. Split it into a pure function of time (keyframes like `stampFrames`, a path like `jumpArc`, `netPath`, `tipLean`) and a thin driver. Shared pieces go in `motion.ts` and `global.css`; hobby-only ones in `src/lib/hobbies/<x>.ts`.
4. Drive it with the Web Animations API (`el.animate(frames, { duration, fill })`, cleaned up on `onfinish` and `oncancel`) or one rAF loop on a canvas that exists only while something moves, as the aquarium's jumping fish do.
5. Mark it decorative (`aria-hidden`) and say the change in words a screen reader hears.
6. Test the pure part with vitest: starts and ends unseen, offsets increase, only allowed keys, lands within its time, never jumps between frames, a still reduced variant (`motion.test.ts`, `aquarium-jump.test.ts`, `hobby-motion.test.ts`).
7. Add a row to the shared-parts table in docs/hobbies.md and a line in docs/product-experience.md.
8. Look at it at 390×844 and 1440×900, in both themes, with reduced motion, with the keyboard, and with rapid clicks.

## Rapid clicks and reduced motion

Pick one model for repeated presses and say which:

1. Every press is its own instance that removes itself: drifting stamps, a run of fish jumping in.
2. The newest replaces the last: `stampFind` clears its stamp, `rollTo` cancels a running roll.
3. Re-aim instead of stacking: a pressed-again globe spin re-plans from where it is.
4. Block re-entry while a page change is under way (`busy` in `open.ts`).

Count work in flight against limits (`fish.length + jumps.pending`), and give "Start over" a way to clear what's in the air. Never animate the first frame: place things before first paint (`.utabs.no-anim` with a double rAF). Use a clock with capped steps rather than `setInterval`, and stop on `visibilitychange` or offscreen. Under reduced motion a stamp appears and fades in place, fish appear at once, the lead photo stops (its timer and Pause hide), the lightbox fades, and a session opens with a plain load. In JS, call `prefersReducedMotion()` when the event happens; in CSS, give each component a reduced-motion block. Gate JS hover on `pointerType === "mouse"` or `(hover: hover) and (pointer: fine)`, and give keyboards the same through focus.

## Port a pattern from a component library

1. Read the component's registry JSON (Cult UI `https://www.cult-ui.com/r/<name>.json`, Magic UI `https://magicui.design/r/<name>.json`, Skiper UI `https://skiper-ui.com/r/skiperNN.json`). Don't install React or the library: eight original components measured about 150 KB of gzipped JS against 2.4 KB for the ports.
2. Write down the mechanic (properties, from and to, duration, easing, stagger, enter and exit) and drop the look: pills, rounded boxes, blur, gradients, shimmer, springs, icon sets, `transition-all`, playing on mount, third-party calls.
3. Build it as a bundled `<script>` or a module in `src/lib/`, never an inline script (that would need a CSP hash), on the tokens and parts that exist.
4. Credit the source in a code comment and in the docs table. Skiper's free items need attribution.
5. If no library fits, use the platform. Nothing in those libraries handled a change between pages, so the session page change uses a cross-document view transition.

## Truman's verdicts

- 2026-10-07: the rotator "seems to be broken and doesn't automatically slide... on mobile, allow user to slide with their finger"; the lead meta line "switches position. that looks bad and not smooth when scrolling."
- 2026-10-12: "what about all those components like watermelon UI, cult UI, etc etc for animations and such within the site?" Of the eight ideas in mock F: "idea 1 is good. idea 2 is alright but i don't think it should become the header, i chose the header specifically, so dont do that. 3 is good. 4 is good. 5 is good. 6 is good. 7 and 8 is good."
- 2026-10-14: the globe flight, "i like that alot". For Narrow nature, a "-X points" stamp "slamming first like a stamp and slowly drifting down and away"; for the aquarium, a fish that "jumps into the tank, with water droplets"; "maybe tip the tank over" on Start over. On sessions, "or simply zooms into the cover image", which shipped and was later rejected.
- 2026-10-15: the first-find stamp, "don't put this directly over the animal image, put it elsewhere."
- 2026-10-16: "the session load animation is bad. it cuts poorly from the cover image to the header image (which are almost always different)... just a smooth website animation nothing to do with the images themselves" (`fe3d302`).

## Hard-won lessons

1. **The rotator looked broken** because hovering anywhere on the photo paused it, and on touch a tap fires `pointerenter` with no `pointerleave`. It pauses only over the caption, for a mouse, and swipes on touch (`15bf55e`).
2. **The home page always opened on the same lead photo.** Picking in a module script ran after the first `src` was fetched, costing a second photo and the LCP. An inline, CSP-hashed script picks while the page parses (`60376d9`).
3. **Pause, then Play didn't play** while the pointer still sat on the caption. Play now clears the pause ("Play means play", `408328e`).
4. **A tap re-closed the card it had just opened**, because opening on `pointerdown` let the click land on the new scrim. Open on `click` (`2124ef8`).
5. **Rows built at runtime came out unstyled**: Astro's scoped styles don't reach them. Use a namespaced global style block.
6. **A game mock flashed the answer**: an image animated out of its untransformed first frame. Commit the start state before first paint.
7. **The first-find stamp covered the animal** until it got its own row beside the photo (`bd89c84`).
8. **A phone caption covered a third of the photo.** The lightbox now reserves room under each photo (`2775351`).
9. **The cover grew and then cut to a different banner** (`eb95f45`), which read as a glitch. Replaced by a plain 200 ms page change (`fe3d302`).
10. **The page change could show a bare frame** while the banner decoded; the banner decodes synchronously now (`d2bae9a`).
11. **Reduced-motion paths rot when nobody looks**: the herping beam couldn't be steered and a light never faded under reduced motion until keyboard play was tested (`8b329bb`).
12. **"No animation" can be the machine**: Windows "Animation effects" off makes browsers report reduced motion.

## Gotchas

- `style-src 'unsafe-inline'` is what lets `open.ts` and `landingBootstrap` inject the `@view-transition` rule. Tightening `style-src` would break the page change.
- A cross-document view transition needs both pages to opt in. The opt-in is removed on `pagehide` so Back doesn't fade, and Firefox gets only the rise.
- `:hover` sticks after a tap, and several older CSS hover rules (card sheets, title underlines) aren't wrapped in `@media (hover: hover)`.
- Reduced motion is read once at load in LeadPhoto, Lightbox and the aquarium, but live in PlateArt and `prefersReducedMotion()`.
- `[hidden]` loses to a `display` rule; use `:not([hidden])` or a scoped `[hidden] { display: none !important }`.
- The contact drawer and its round mail button predate the design rules. Don't copy them.
- The lightbox background is 95% opaque, so the page shows faintly behind captions. Making it solid was offered on 2026-10-16 with no answer yet.

Add new verdicts and lessons here, dated, in the commit that acts on them.
