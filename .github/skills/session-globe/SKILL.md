---
name: session-globe
description: "The archive globe in the rail (src/lib/globe.ts, src/components/ArchiveRail.astro), its pins from the hand-kept gazetteer in src/lib/geo.ts, the spin that lands on a session, throwing it, the flight into a session (src/lib/flight.ts) and the landing on the session page (src/lib/landing.ts). Use when: a new session or place has no pin, sits on another pin, or the places count doesn't match the home page; adding a town, region or country to the gazetteer; the spin feels harsh, slow or random, jumps after it lands, or misbehaves when spammed; the flight or dive into a session lags, stutters, pauses or flashes black; changing the globe caption or counts; or checking what Truman approved about the globe."
argument-hint: 'the place or the problem, e.g. "no pin for Stockholm, Sweden" or "spin stutters on the phone"'
---

# Session globe

The rail on every photography page has a small globe with a pin for each place Truman has photographed. Press it and it spins, lands on a place, and flies you into one of that place's sessions: the globe lifts to fill the screen, a ring draws around the place, it dives in, and the session's banner opens out of it. Truman liked the flight a lot ("i like that alot", 2026-10-14) after several rounds where the spin was harsh, slow or landed off target.

| Path                               | Role                                                                                                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/geo.ts`                   | `GAZETTEER`: coordinates for session `location` strings, the only source of pins. `coordsFor()` matches loosely (case, accents and punctuation ignored), then falls back to the broader comma parts, then to the longest known place inside the text |
| `src/lib/archive.ts`               | `buildPlaces()`: one pin per distinct `location` string                                                                                                                                                                                              |
| `src/lib/globe.ts`                 | `pickSpinTarget` (a random region first, then a place in it, never the current one), `planSpin`, `planGlide`, `planThrow`, `drawGlobe` (shared by the rail and the flight), `createGlobe`                                                            |
| `src/lib/flight.ts`                | `fly`: lift (0.9 s), ring (0.22), hold for the banner if needed (at most `MAX_WAIT`, 2.5 s), dive to 1.3 s, photo opens; `loadBanner` fetches the session page and decodes its banner                                                                |
| `src/lib/landing.ts`               | the landing note (`LANDING_KEY`, kind `photo` for a flight), `landingBootstrap` (inline, CSP-hashed) and `settleLanding()` on the session page                                                                                                       |
| `src/components/ArchiveRail.astro` | the rail globe, its caption ("Everywhere I've photographed", pinned sessions, places), shown only with more than one place                                                                                                                           |

Tests: `src/lib/geo.test.ts` (exact pins, fallbacks, two decimals at most), `archive.test.ts`, `globe.test.ts`, `flight.test.ts`, `landing.test.ts`. More in [docs/product-experience.md](../../../docs/product-experience.md#motion-that-answers-what-you-do).

## Rules

- **Pins are public, coarse points.** A town, park or region at two decimals at most, never a spot, and never a position read from a photo (photos have none once published). See photo-sessions for location privacy.
- **Every spin looks random but lands exactly on a place that has a session**, with the landing planned before the spin starts, and nothing moves after it lands (2026-10-13).
- **Spam re-aims; it never stacks.** Pressing again mid-spin re-plans from where the globe is, up to four turns, and only the newest spin opens a session (`7620dcb`).
- **The session page opens facing the place**, so the next page's globe doesn't swing in.
- Reduced motion skips the spin and goes straight to the session.

## Add a place (new session, no pin)

Pins don't appear by themselves. A new `location` that the gazetteer can't resolve gets no pin and no warning, and two `location` strings that resolve to the same fallback point draw two dots on top of each other (why the Tibet split needed its own entries).

1. Find the session's exact `location` text (its `_session.json`, /admin, or the session page).
2. Add `"<lower-case location>": { lat, lon }` to `GAZETTEER` under its country group, two decimals at most. When a new country or state appears, add a broad entry for it too (as `1d8a6d2` did for Minnesota, Sweden and Scotland).
3. Add an `expect(coordsFor("..."))` line to `src/lib/geo.test.ts`, run `npx vitest run src/lib/geo.test.ts`, commit and push. It deploys.
4. After the deploy, the home page line `N sessions · M photographs · P places` should match the globe caption's sessions and places.

Region hubs (`/places/<region>/`) come from `regionOf()` in `src/lib/places.ts`, not from the gazetteer.

## Tuning by symptom

| Symptom                                  | Where to look                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Spin goes straight to the session        | the OS reports reduced motion (Windows "Animation effects" off does this)                                   |
| Spin feels harsh or too long             | `SPIN_BASE` (1.7 s) and `SPIN_PER_TURN` (0.5 s) in `globe.ts`, and the pace jitter                          |
| Lands off centre, or moves after landing | the landing has to come from `pickSpinTarget` + `planSpin` before the spin starts (`d85892e`)               |
| Throw feels wrong                        | `FRICTION` (2.9) and `THROW_MIN` (120 degrees a second)                                                     |
| Stutter during the dive                  | allocation or off-screen drawing in `drawGlobe`; profile for garbage collection pauses (`d2bae9a`)          |
| Pause while the ring is drawn            | waiting up to 2.5 s for the banner: a slow network, or the dev server resizing an original on first request |
| Black or bare frame at the page change   | the session banner must keep `decoding="sync"` in `[slug].astro`                                            |
| Caption says the wrong thing             | it's rendered on the server in `ArchiveRail.astro` from all sessions                                        |

Measure smoothness on `npm run build && npm run preview` or on the live site, never on `astro dev`: the dev server resizes 6192 px originals on first request and its toolbar runs 50 to 130 ms audits mid-animation. `npx astro preferences disable devToolbar` helps when you must use dev. A 4x CPU slowdown in DevTools stands in for a mid-range laptop.

## Truman's verdicts

- 2026-10-06: liked a globe that "spins... and lands to a spot in my photographs, but that would skew heavily to washington", hence a random region first, then a place.
- 2026-10-06: keep the sessions overview beside the globe: a smaller rail, bigger photos, a persistent globe that highlights the session you're in.
- 2026-10-06: "the globe spin needs to be way smoother and fluid. its harsh"; "spin takes too long to finalize on a location, and if you spam it it behaves weird. make it smooth, professional, not too long".
- 2026-10-13: "every spin should look random but always land smoothly on a location where a session exists."
- 2026-10-14: "still completely broken globe experience"; asked for the zoom from overhead into the place and then cleanly into the session, "with the header image being your landing zone". The flight that followed: "i like that alot".
- 2026-10-15: the caption "shoul dbe all my locations across all my sessions, not just this year" (`b798fa8`); "This globe to session animation or moveement is really laggy, tell me why" (`d2bae9a`).

## Hard-won lessons

1. **Plan the landing first.** Spins that picked a stopping point as they slowed stopped off centre, the ring gave the landing away early, and the next page's globe swung in from elsewhere. Now the target and the whole spin are planned up front, the ring draws only on arrival, and the session page opens facing the place (`d85892e`).
2. **Pins come from the gazetteer only.** The globe once published positions read from photo EXIF, accurate to about a metre (`79259d2`, 2026-10-12).
3. **New places silently lack pins.** After the Tibet split two sessions sat on the Lhasa pin (`7ebde27`), and on 2026-10-15 four of 65 sessions had no pin at all (`1d8a6d2`). Compare the counts after every new session.
4. **The caption was a mock leftover** ("Everywhere, this year") until it was rendered on the server from every session (`b798fa8`).
5. **The flight lagged because of garbage, not drawing.** `drawGlobe` allocated per point and drew a 20,000-point grid off screen. The rewrite took a frame from 3.7 to 0.6 ms and dropped frames from 5.3% to 1.0% (`d2bae9a`). The banner decoding asynchronously caused the black frame.
6. **Judging smoothness on the dev server misleads.** Truman's "laggy" recording was partly dev-only image resizing and toolbar audits, partly real per-frame allocation. Fix the real part and measure on a build.

## Gotchas

- `landingBootstrap` is one of four inline scripts with a SHA-256 hash in the CSP. Any edit, even whitespace, needs `npm run check:csp` and the new hash in `staticwebapp.config.json` (ship-and-ci).
- The landing note must match the path, trailing slash included, and be under 10 seconds old, or it's ignored.
- A two or three frame hitch remains on slow CPUs as the globe lifts out of the rail.
- `isMapped` is used only in tests, so nothing warns at build time about an unmapped location.
- Don't count places from the local `src/content/sessions/`; it's stale. Production had 65 sessions on 2026-10-15.

Add new verdicts and lessons here, dated, in the commit that acts on them.
