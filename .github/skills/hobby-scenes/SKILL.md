---
name: hobby-scenes
description: "The opening scenes that play when a hobby card is clicked (src/lib/scenes/: engine.ts, stage.ts, table.ts, one module per hobby, hand.ts, worker.ts, player.ts, gl.ts, pen.ts), the handover to the hobby page (src/lib/open.ts, landing.ts landingBootstrap, covered.ts, carry.ts), plate dots (plate-dots.ts) and warming on hover. Use when: adding or changing a hobby's click animation (globe and finder box, gourami swim-off, crab pinch, cast and bite, bird fly-off, salamander hand scoop, hiker summit); a scene doesn't show, falls back to the plain sink or dive, starts late, lags, stutters, freezes, pauses mid-move or skips; scenes work locally but not on the live site (CORS); a stipple plate was re-rendered and a scene's outlines may be off; editing landingBootstrap (CSP hash); or stepping through a scene with ?scene-debug."
argument-hint: 'the hobby and the problem, e.g. "birding: legs lag behind in the fly-off"'
---

# Hobby scenes

Clicking a hobby card, on /hobbies/ or in the band on the home page, plays a short scene drawn in that card's own stipple dots and hands over to the hobby page. Narrow nature's globe spins and a red finder box targets a place, the gourami swims off, the crab pinches the screen, the fish takes the lure and is pulled away, the bird flies off, a hand scoops up the salamander, and the hiker climbs and throws his arms up. After the rounds of fixes Truman said "overall the animations are good, and the motion is pretty smooth", and called the crab pinch "really fantastic" (2026-10-14).

## How a click plays

1. **Warming.** Hovering, focusing or pressing a card (`a[data-open="hobby"]`) sends its plate to a worker (`src/lib/scenes/worker.ts`, on an OffscreenCanvas), which reads the dots, prepares the props and rehearses the scene once off-page. The card under the pointer jumps the queue; the rest warm one at a time when idle. The hobby page is prefetched too.
2. **Click** (`openHobby` in `src/lib/open.ts`). The plate's hover boil is held and the worker starts the scene. If it hasn't answered "setting" within 600 + 150 ms (`SCENE_WAIT_MS`, `WORD_MS`) the page gives up, and after "setting" the scene gets `SETUP_MS` (1500 ms) to start. A click that misses gets the plain dive or the sink instead.
3. **Lift, then leave.** The scene lifts the plate for `LIFT_MS` (450). At `LEAVE` it posts the held frame and its dots, which go into sessionStorage with the landing note, and the browser navigates. Nothing moves between `LEAVE` and `ACT` (870 ms): the page only pushes in slightly (`HOLD_ZOOM` 1.03 over `PUSH_MS`).
4. **The hobby page.** The inline head script `landingBootstrap` (`src/lib/landing.ts`, hashed in the CSP) paints the held frame and restarts the worker. `settleDots()` resumes the scene, which plays all its action after `ACT` and ends by opening the page along its own motion. Then `uncover()` lets the islands start (`whenUncovered()` in `src/lib/covered.ts`).
5. The globe is the exception: it never leaves early, and ends on big dots with a reveal.

| Path                                                | Role                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/scenes/table.ts`                           | `SCENES`, keyed by hobby slug                                                                                                                                 |
| `src/lib/scenes/<name>.ts`                          | one scene each (`globe`, `aquarium`, `crab`, `fishing`, `birding`, `herping` with `hand.ts`, `hiking`), written with `defineScene({ parts, prepare, start })` |
| `src/lib/scenes/engine.ts`                          | timing (`LIFT_MS`, `LEAVE`, `HOLD`, `ACT`, `HOLD_ZOOM`, `PUSH_MS`, `PUSH_EASE`), the painter, the debug hooks                                                 |
| `src/lib/scenes/stage.ts`                           | the maths: `split`, `stipple`, `aim`, `wakeTimes`, `wakeHoles`, `exitDistance`, card units 880×660                                                            |
| `worker.ts`, `player.ts`, `protocol.ts`, `carry.ts` | the worker, its driver on the page, their messages, the sessionStorage carry                                                                                  |
| `gl.ts`, `pen.ts`, `label.ts`, `look.ts`            | WebGL2 instanced discs, the 2D fallback, labels in the page font, fades and blurs                                                                             |
| `src/lib/plate-dots.ts`                             | `plateUrl` (adds `?scene` to cross-origin plates), `loadPlate` (`crossOrigin`), `findDots`                                                                    |
| `src/components/PlateArt.astro`                     | each plate's `data-card` URL (what the scene reads) and the hover boil (`plate:hold`, `plate:free`)                                                           |
| `src/styles/global.css`                             | `.landing-veil`, `.landing-frame`, `@keyframes landing-hold`                                                                                                  |

The long version, with the scene table, is [docs/hobbies.md#opening-scenes](../../../docs/hobbies.md#opening-scenes).

## Truman's rules for scenes

- **Act on the new page.** Change pages at the end of the lift, before anything moves, so neither page has to boot during the action.
- **End by opening the page along the scene's own motion**: wake holes behind a swimmer or a flyer, the crab's shockwave, a quick push on the hiker with a fade. Never zoom into the dots ("the zooming in on the dots doesn't look great actually", 2026-10-14). Only the globe keeps its big dots.
- **Props are drawn in the plate's own pen**, the same dot size and shading as the card: the hand, the rod, the lure.
- **Smooth like a professional site.** No pause mid-move, no figure tearing apart, nothing left behind. "remember, smooth like professional website ux animations" (2026-10-14).
- **Stable beats clever.** "sometimes when I click on the hobbies, the animations don't show, or are laggy or freeze. fix that. make it stable, smooth" (2026-10-15). Fix the cause; never just raise a deadline.
- **It has to work on trumanbrown.com from a cold cache**, not only locally.
- Reduced motion skips the scene and navigates plainly.
- Big batches of animation work go to a local preview first when he asks (ship-and-ci), and long work gets progress reports ("youve been working for horus on this, what is the current status", 2026-10-15).

## Add or change a scene

1. Write `src/lib/scenes/<name>.ts`: `export default defineScene({ parts, prepare, start })`. `parts` are polygons in card units (880×660) traced on this plate, and the first part to claim a dot gets it. `prepare` draws props with `stipple()` in the plate's pen (`r0`). It runs before the click, so keep it near 50 ms. Pale props need a `pass: "halo"` first, and dark plates draw light dots, so shading flips (see `hand.ts`).
2. A scene that ends on the hobby page sets `leave: LEAVE` and `depart: ACT`, holds still between them, does all its action after `ACT`, and ends with the page open and none of its dots left.
3. Register it in `table.ts` under the slug.
4. Keep script well under 2 ms a frame (120 Hz screens). Work out anything that depends only on time once per frame, never once per dot (the aquarium fix in `8492c7d`), and let `wakeTimes` skip work that can't change (`bb322e8`).
5. Run `npx vitest run src/lib/scenes`.
6. Look at it. On `npm run dev`, open `/hobbies/?scene-debug`, click a card, then use `__scene.seek(ms)` frame by frame and `__scene.hand()` to change page. Compare `?scene-2d`, `?scene-gl` and `?scene-main`, in both themes, at desktop and phone sizes, from /hobbies/ and from the home band.
7. A timing change: `PUSH_EASE` is copied by hand into `landing-hold` in `global.css` (twice). A `landingBootstrap` change: run `npm run check:csp` and replace the hash in `staticwebapp.config.json`, and keep the string free of backslashes and `${}`.
8. Update the scene table in docs/hobbies.md and the scenes bullet in docs/product-experience.md.
9. Push, then check trumanbrown.com right after the deploy with a cold cache: the start (under 100 ms; the last run measured 15 to 60 ms), the frame rate, and no fallback.

## Debug by symptom

| Symptom                                       | Likely cause                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Works locally, not on the live site           | CORS: in production plates come from the storage host, and a canvas can't read a cross-origin image without `crossOrigin`. Dev serves them same-origin |
| Click goes to the page through the paper sink | the plate wasn't readable or loaded in time, or the worker missed the deadline. Check the console and the `?scene` URL                                 |
| No scene anywhere                             | reduced motion is on (Windows "Animation effects" off), or a hidden VS Code browser panel paused rAF                                                   |
| Pause mid-move                                | something changes page or boots during the action; all action belongs after `ACT`                                                                      |
| Stutter or freeze                             | main-thread work competing: an island not waiting for `whenUncovered()`, a heavy `prepare`, per-dot maths, the worker not in use                       |
| About 250 ms before the first scene starts    | cold code; warming and `rehearse()` on hover aren't reaching it                                                                                        |
| A figure tears or leaves parts behind         | `parts` no longer match the plate (after a re-render), or a prop doesn't follow its part                                                               |

Judge smoothness on `npm run build && npm run preview` or the live site, with a 4x CPU slowdown, and on battery. The dev server resizes images on first request and its toolbar runs audits mid-animation.

## Truman's verdicts

- 2026-10-14, the brief: the globe should "target it on one area (via red box, target sign, etc)"; the gourami "swim to the right... turning around"; the crab's "right pincer animate out, and pinch down on the screen"; the rod should "cast a lure in front of the fishe's mouth... the fish should bite it"; the bird should "look around and then fly off"; "a hand come scoop up the salamander"; "a little man climb the mountain logo... celebrates with arms up". "don't push it live... host it locally so I can play around."
- 2026-10-14, first look: the zoom into the dots had to go everywhere except Narrow nature ("for narrow nature, let's keep it as is"); "the crab pinch animation is really fantastic"; the bird's look-around was "awkard with the breaks in the dots"; the hiker's "emote at the top is hard to tlel since the arms blur together".
- 2026-10-14, second look: "the legs get left behind in the fly"; the crab "pauses slightly before pinching"; "the fish pauses for some reason after first turn"; "make the fish moving slightly before the cast, and the cast puts the lure too close"; "the hand looks a little to olow quality, and the zoom in is slightly too big".
- 2026-10-15: scenes sometimes didn't show, lagged or froze. Fixed by the worker and the warming work below.

## Hard-won lessons

1. **Dot-zoom endings looked wrong** on every scene (`88b2260`). Each now opens the page along its own motion (`b59d198`).
2. **Scenes paused mid-move** because the page changed during the action and the old page froze while the new one booted (`b59d198`). Now the page changes at `LEAVE`, holds still until `ACT` with a clock-driven push-in that the CSS matches, and the new page plays all the action. `scenes.test.ts` enforces `leave`, `depart` and the stillness between (`fd05d4e`).
3. **No scenes on the live site.** Plates are moved to the storage host at deploy, and reading a cross-origin image taints the canvas. Load with `crossOrigin` against the storage CORS rules (`18e0798`). Local dev can't show this.
4. **Clicks skipped their scene with a half-loaded plate.** The hover boil swaps `img.src`, and CORS and non-CORS copies of one URL kept revalidating under `Vary: Origin`. The scene reads the stable `data-card` URL with its own `?scene` query (`8492c7d`). Hover effects and click transitions must not share state.
5. **Stutters and freezes at 15 to 30 fps.** The scene drew on the main thread while both pages loaded, the islands ran their own loops and the herp map read back from the GPU. Birding and herping props took up to 1.5 s to prepare, and the held frame was an SVG background the GPU redrew for every tile. The fix was an OffscreenCanvas worker drawing WebGL2 discs, a held frame painted once, islands frozen while covered, and per-frame instead of per-dot maths. Result: 120 fps (`8492c7d`).
6. **A cold deploy made a click hang for up to 9 s.** The wait only began once the worker reached the click. The deadline now runs from the click, with a fallback (`e0f30f8`).
7. **That deadline then backfired on the live site**: warm-up work for other cards ran ahead of the click, and cold setup took longer than 750 ms, so herping and fishing got the fallback. Warm work became single tasks behind clicks and is held while a scene plays, the deadline ends at "setting", and `SETUP_MS` follows (`bb322e8`). Fix the cause, never raise the number.
8. **About 250 ms before a scene started on a laptop on battery**, because the browser optimizes code slowly on its first run. `rehearse()` sets each scene up once on hover, focus or press (`946311b`), and the likely card jumps the queue (`b55be55`). Live starts went to 15 to 60 ms.
9. **Figures were redone three times**: the bird's head turn tore the dots, the hand looked low quality, the hiker's arms blurred. Draw props as stipple in the plate's pen and step through with `?scene-debug` before showing Truman.

## Gotchas

- `landingBootstrap` is hashed in the CSP and changed five times in three days. Other sessions edit `landing.ts` and `open.ts` too, so after a rebase run `npm run check:csp` again.
- No test ties `PUSH_EASE` to the CSS `cubic-bezier(0.33, 1, 0.68, 1)` in `landing-hold`.
- `scenes.test.ts` uses a synthetic plate. Re-rendering a real plate with the stipple-plates skill can quietly misalign hand-traced coordinates (`SHOULDER`, `HINGE`, `TIPS` in `crab.ts`, and every `parts` polygon), so look at the scene after any re-render.
- Plates fail CORS on hosts missing from the storage CORS list, likely including PR preview hosts, and scenes there fall back to the sink.
- A landing note older than 10 s is ignored. The carried dots can be a couple of hundred KB; if storage is full the page reads the plate again.
- A plate with fewer than 40 dots gets no scene.
- Two open issues from 2026-10-15: a click before the card's plate has loaded gets the sink, and the herping page still hitches about 25 ms while decoding iNaturalist data.
- The fishing plate is a coho salmon, though `fishing.ts` comments and the docs call it a trout.

Add new verdicts and lessons here, dated, in the commit that acts on them.
