# Product experience: design principles, measurements, and roadmap

> Audience: the site owner and future contributors deciding what to improve without turning a personal photography site into a generic product.

## Product direction

The site is a photography archive first and a collection of interactive hobbies second. The design should feel personal, quiet, and direct:

- Put real photographs in the first viewport; avoid a marketing hero or decorative art.
- Keep navigation predictable while making the photographer and archive scale clear.
- Treat captions and session descriptions as editorial content, not ornamental metadata.
- Spend JavaScript only on interactions that need it: navigation drawers, PhotoSwipe, small hover previews, Admin, analytics, and the Hobbies experiences.
- Prefer build-time relationships and metadata over new runtime services.

## Measured baseline (July 2026)

The production audit covered every public route, Admin, and the 404 page at desktop (1440×900), tablet (768×1024), and mobile (390×844): 63 route/viewport combinations. All returned the expected status with no horizontal overflow, visible zero-size media, page errors, or unexpected failed requests.

Production content at the time of review:

- 12 photography sessions
- 394 photographs
- 6 sessions with a location
- 0 session descriptions
- 0 image captions
- EXIF capture settings on most photographs

Homepage delivery before this improvement pass:

- 48.7 KB HTML
- 6.5 KB JavaScript across three small modules (uncompressed response sizes)
- 37.8 KB CSS (uncompressed response size)
- 50.3 KB for the first 480 px WebP cover candidate
- One-year immutable caching on scripts, styles, and image variants

The integrated browser runs in a hidden tab, which suppresses the Largest Contentful Paint observer, and the public PageSpeed API was rate-limited during the audit. No fabricated LCP score is recorded here. The implementation-level LCP findings were still conclusive: the first homepage cover and first gallery photograph were both marked `loading="lazy"`, and the Blob origin was not preconnected.

## Improvements made

### Clearer first impression

The homepage now has a compact `Photographs` H1, the existing site description, and a live session/photo count. This fixes the missing page-level heading and tells visitors what archive they are looking at without pushing the first photograph out of the viewport.

The mobile header uses two rows below the desktop breakpoint. The full site name now has its own row instead of collapsing to `T…` beside four competing controls.

### Faster first photograph

Only the first visible homepage cover and first session-gallery photograph use eager loading and `fetchpriority="high"`; every other image remains lazy. The document also preconnects to the configured Blob origin. This prioritizes the likely LCP image without flooding the network with competing high-priority requests.

### Better discovery and continuity

Session descriptions appear at the top of the session page. (They were briefly on the home-page cards too; that duplicated the same sentences across two URLs, so cards now show only title, date, location and photo count.) Session pages include previous/next links in the configured archive order after the gallery, giving mobile visitors a direct continuation path without reopening the session drawer.

The homepage uses the first session cover for Open Graph and Twitter previews. Social image alternative text, site name, locale, and richer generated session descriptions are included. Admin is explicitly `noindex`.

### Photography-specific accessibility

Uncaptioned gallery links are announced as contextual positions such as “Tibet Spring 2026, photo 4 of 71” rather than camera filenames. A real caption replaces that fallback everywhere once supplied.

Admin can now edit an optional caption for every image. Caption edits preserve gallery order, are limited to 500 characters, and are stored in the existing `_session.json` sidecar. Admin shows a caption-completion count per session so accessibility and storytelling can improve incrementally.

Admin tabs now expose the tab/tablist/tabpanel relationship and support Arrow, Home, and End keys. The edit surface is a labelled modal dialog with focus containment, Escape handling, scroll locking, and focus restoration. The theme toggle now announces the action it will perform and exposes the active dark-mode state with `aria-pressed`.

Every page starts with a "Skip to content" link that appears when Tab reaches it, so keyboard visitors don't have to walk the whole session rail to reach a photograph. Below 900px the page keeps 60px of scroll padding at the top, so a focused element never ends up under the sticky bar. The footer link uses `--ink-2`, which clears 4.5:1 in both themes (it was 2.4:1).

An October 2026 audit ran axe-core (WCAG 2.2 A and AA) over every built page in both themes, plus the open contact form, and tabbed through each kind of page checking that every stop shows a focus ring. Contrast passed everywhere. What it fixed:

- **The rail's two links are 24px rows.** "Photographs" and "Things to try" were 15px tall and 16px apart, under WCAG 2.2's 24px minimum tap target (2.5.8).
- **Hobby gallery links always have a name.** An empty caption used to give the link an empty `aria-label`; it now falls back to "Open full-resolution photo", like a missing one.
- **The canvas toys play from the keyboard** (2.1.1). The tide pool beach, the herping road and the three fishing maps each take focus, arrow keys pick (or steer), Enter or Space acts, and a polite live region says what's picked. See [docs/hobbies.md](hobbies.md#interactive-island-conventions).

### Motion that answers what you do

A later pass borrowed mechanics from four React component libraries (Cult UI, Watermelon UI, Skiper UI, Magic UI) and rules from Vercel's web interface guidelines, UI/UX Pro Max and Bencium's motion spec. The site has no React, so each one is rewritten in plain CSS or TypeScript in the archive's ink and paper. Things move only in answer to the visitor; the lead photo is the one thing that changes on its own, and it now has a pause. Under `prefers-reduced-motion` all of it settles instantly.

- **The lightbox opens from the photo you clicked.** PhotoSwipe zooms out of the grid thumbnail (300ms open, 250ms close) and back into it on close. Each photo has its own address (`#photo-4`, kept current with `replaceState`, so it adds no history entries), and loading that address opens the lightbox on that photo. The toolbar's Copy link button copies it; on touch screens it's Share, through the device share sheet. (From Watermelon UI `copy-confirm`, and Vercel's and Pro Max's "deep-link everything".)
- **Home cards skim.** With a mouse, moving across a session card steps through its first eight photos, 480px WebP fetched on the first hover. The card's header and cover are unchanged, and a click still opens the session. Touch screens don't skim. (Watermelon UI `scrub-slider`, Cult UI `hover-video-player`.)
- **The rail peeks.** On desktop, pointing at a session in the archive rail, or tabbing to it, shows its cover beside the rail. It hides when the pointer leaves or the list scrolls. (Watermelon UI `preview-link-card`.)
- **The lead photo has a timer and a pause.** A 1px rule over the caption fills while each photo is up, and a Pause button stops the rotation: anything that moves on its own for more than five seconds needs a way to stop it (WCAG 2.2.2). It also waits while the tab is hidden, the photo is scrolled away, or the caption is hovered or focused.
- **The theme switch is on every page.** It sits in the rail and the phone bar as well as the hobby header, and crossfades between themes with a View Transition. `theme-color` and `color-scheme` follow the site's theme rather than the system's, so the phone's address bar, scrollbars and form controls match the page. (Magic UI `animated-theme-toggler`, Skiper UI `skiper26`; both also wipe a circle out from the switch, which was left out as louder than anything else on the site.)
- **Spinning the globe flies you into a session.** The spin's landing place is picked before it starts, and the path is worked out to stop exactly on it. As the rail's globe slows, a full-screen copy lifts out of the rail and grows to fill the screen. It stops with the place in the middle, rings it and names it, then dives in. The session's banner photograph opens out of the ring until it fills the screen, and the session page opens on that same frame before settling the photograph into its banner ([flight.ts](../src/lib/flight.ts), [landing.ts](../src/lib/landing.ts)). The session page and its photograph are fetched while the globe spins, so the page change is a cache hit. Escape or a click calls it off; a throw of the globe flies in the same way. Under reduced motion it goes straight to the session.
- **Session cards open into their session.** A card on the home or places pages, or a row in the rail, grows its photo to fill the screen while the session's banner photograph loads; the session page then opens on that photograph and settles it into its banner, the same landing the globe uses ([open.ts](../src/lib/open.ts), [landing.ts](../src/lib/landing.ts)). The globe in the rail turns to the session's place on the way. Pointing at a card for a moment fetches its page and photograph, so the click doesn't wait. A ctrl, cmd or middle click still opens a tab.
- **Hobby cards open with a scene of their own.** Clicking a hobby card lifts its stipple plate off the card and acts something out in the plate's own dots, and the way it ends opens the hobby page: the gourami darts off and its ripples wash the paper away, the crab snaps its claw on the screen and a shockwave rings out, the trout is hauled off the top of the screen and the oystercatcher flies up out of it with the page opening along their trails, a hand pulls the salamander away to the side, and the view rushes in on the hiker cheering on the summit as it fades. The globe spins, a red finder box locks onto a spot, and the page opens through the big dots it dives into ([src/lib/scenes/](../src/lib/scenes/), [hobbies.md](hobbies.md#opening-scenes)). The page changes during a still moment of the scene, and the hobby page picks the scene up from that same frame. A second click hurries it along and Escape calls it off; under reduced motion the card just opens its page.
- **A clue's price is stamped on it.** In Narrow nature, the points a species costs land in red on its corner as you reveal it, slammed down like a rubber stamp, then drift down and fade (`stamp()` in [motion.ts](../src/lib/motion.ts)). It's the floating score text games use (Krillion pops its points beside the score), kept by the thing you paid for, since the points total sits below the map and is usually off screen. Under reduced motion it just appears and fades.
- **New fish jump into the tank.** In the aquarium, a fish leaps from the swatch you tapped, turning from the swatch into its sprite as it goes, flicks water off its tail, splashes down through the surface and sinks to its depth ([aquarium-jump.ts](../src/lib/hobbies/aquarium-jump.ts)). Tap fast and a run of them goes in. Under reduced motion they're simply added.
- **Fish are netted out, and Start over tips the tank.** The "−" beside a species sends a little pixel net down for one of them, which scoops it up and lifts it out; several can be in at once. Start over tips the whole tank toward one side: everything rushes for the low corner and pours out over the rim with the water, then the tank rocks back level, empty.
- **The verdict is stamped on the map.** In Narrow nature, once the answer is down, "Spot on", "Not quite" or the like is stamped in ink on the map's corner with the distance under it, and stays there with the result.
- **First finds are stamped.** In tide pooling and herping, a creature you haven't found before gets "New to your journal" stamped across the corner of its picture ([specimen.ts](../src/lib/hobbies/specimen.ts)).
- **The postcard gets a postmark.** Once a hiking postcard has developed, a round postmark with the trail's name and the day slams onto its corner. It's painted into the 2,400 × 1,600 canvas as it lands, so the downloaded PNG has it too.
- **The bird is inked in.** The selfie-to-bird picture is rebuilt dot by dot, darkest first, in its own colours, like the stipple plates, then the finished picture comes up through the dots ([bird-ink.ts](../src/lib/hobbies/bird-ink.ts)). The downloaded PNG is the finished picture.

### Prints and licensing inquiries

Before this, nothing on the site said a photo could be printed or licensed, so interest from visitors (including the ones arriving from social media) had nowhere to go. With `prints: true` in [site.config.ts](../site.config.ts):

- **A Prints button in the session lightbox.** It sits beside Share as a word in the toolbar. Tapping it closes the lightbox and opens the existing contact form with the photo's own address (`/sessions/<slug>/#photo-12`) already in the message, so an inquiry always names the exact photo. The form opens only after PhotoSwipe's `destroy`, because PhotoSwipe hands focus back to the grid thumbnail as it closes. A prefill never replaces something the visitor already typed. Fishing catches and hobby galleries use the same lightbox without the button (`<Lightbox prints>` is opt-in).
- **A plain `/prints` page**, linked from the footer, that says what to expect (rough size in, options and a price back) and holds the licensing terms under `#licensing`. Its buttons open the same form through a `data-contact-open` / `data-contact-message` hook in `ContactForm.astro`, which any page can use.
- **The "Licensable" badge in Google Images.** Each session photo's `ImageObject` gains `license` and `acquireLicensePage`, both pointing at `/prints/#licensing` (`src/lib/prints.ts`). Google shows the badge and a link to that page beside the image, so someone who finds a photo through image search can ask about it.

It's inquiry-only on purpose: no shop, checkout, prices or new cloud service. Messages land in the same `contactmessages` table as any other contact. A print-on-demand store can come later if the inquiries show demand.

### Privacy page

`/privacy/` ([src/pages/privacy.astro](../src/pages/privacy.astro)) tells visitors, in the site's own voice, what the contact form keeps and for how long, how visit counts work without cookies or stored IP addresses, what stays in their browser, which outside hosts a page talks to (Azure, and iNaturalist on some hobby pages), how Do Not Track is handled, and how to have their data deleted. It's linked from the footer and from a line under the contact form's Send button. It has a "Last updated" date: change the page and the date together whenever any of those change ([docs/analytics.md](analytics.md), [docs/privacy.md](privacy.md)).

### The design, written down

A later review took five ideas from a reel about AI-built interfaces looking generic: give the agent design direction, audit what it built against written guidelines, work from a real design system, build from references, and let the agent open the browser and look at the result. The site already had a direction and its references (`mocks/`). What it lacked was the design written somewhere an agent reads it, and the drift showed: the places pages, the 404 and the contact drawer had picked up stock Tailwind, including `font-semibold` headings that the browser has to fake because Libre Franklin is only self-hosted at weights 300 to 500.

- **Design rules for agents.** [site-design.instructions.md](../.github/instructions/site-design.instructions.md) sits beside the copy rules and applies to every `.astro` and CSS file: tokens, weights, parts, motion, images, touch targets, and where Vercel's Web Interface Guidelines give way to house style (`...`, sentence case, first person).
- **Places and 404 back on the system.** Light H1, `.u-label` meta line and back link, ink tokens. The places grid loads its first row eagerly, like the home page.
- **Line breaks.** Headings wrap `balance` and everything else `pretty`, so rail and card titles no longer end on a lone "Rica".
- **Touch.** The lead photo's arrows and Pause are at least 24px, and on touch screens they get 44px-tall hit areas that don't move the caption. "Things to try" stays on one line in the phone bar from 360px up.
- **The mail button.** The footer keeps 96px free below its links, so the fixed button no longer sits on "How this site is built" at the bottom of short pages.
- **Contact form.** Name and email declare `autocomplete` (WCAG 1.3.5, which axe doesn't check), and the email field skips spellcheck.

## What remains intentionally unchanged

- Static Astro rendering and Blob-hosted variants remain the right architecture.
- The year-grouped archive and session filter remain simpler than tags or faceted search at the current scale.
- The masonry-style CSS columns keep mixed photo orientations visually natural.
- Hobbies remain route-local; their heavier code does not affect photography pages.
- No web font, design system, component library, map SDK, comments, accounts, favorites, or new cloud service was added.
- Full-resolution downloads remain available in PhotoSwipe.

## Ranked roadmap

| Opportunity                                               | Visitor/owner value                                                            |         Effort | Confidence | Recommendation                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------: | ---------: | ----------------------------------------------------------------------------------------------- |
| Write session descriptions and captions for featured work | Stronger storytelling, SEO, and non-visual access                              | Content effort |       High | Start now in Admin; prioritize covers and the first 5–10 photos per session                     |
| Add optional `featured` editorial ordering                | Lets the owner lead with strongest work rather than only chronology            |         Medium |     Medium | Near term after enough curated captions exist                                                   |
| Add related sessions from explicit tags/collections       | Better discovery than date adjacency when the archive grows                    |         Medium |     Medium | Add only with an owner-maintained taxonomy                                                      |
| Draft/preview publication status                          | Safer metadata review before public builds                                     |         Medium |     Medium | Useful when publishing becomes frequent                                                         |
| Static map or timeline exploration                        | Spatial/temporal discovery                                                     |          Large |     Medium | Proposal only; avoid an always-loaded map SDK                                                   |
| Bulk caption editing/import                               | Faster metadata work for hundreds of images                                    |         Medium |       High | Add if per-session Admin editing becomes tedious                                                |
| Structured production monitoring                          | Faster diagnosis of Function/storage failures                                  |         Medium |     Medium | Enable optional diagnostics when traffic or operational value justifies it                      |
| Restyle the contact drawer and mail button                | The last stock-Tailwind UI on the public site; one design language everywhere  |          Small |       High | Paper panel, square inputs with a 1px rule, `.btn-ink`, a square mail button without the shadow |
| Committed browser check for layout regressions            | Catches overflow, covered links, faux bold and lazy first images before deploy |         Medium |     Medium | A Playwright script over the validation routes first; CI only if it stays fast                  |

## Validation checklist

After product-facing changes:

```bash
npm run prebuild:local
npm run lint
npm run check
npm test
npm run build
```

Then inspect `/`, one short session, one long session, `/hobbies`, each Hobbies route, `/admin`, and a missing route at 1440×900, 768×1024, and 390×844. Check keyboard focus, horizontal overflow, console/page errors, and the first image's `loading`/`fetchpriority` attributes.
