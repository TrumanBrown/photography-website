# Product experience: design principles, measurements, and roadmap

> Audience: the site owner and future contributors deciding what to improve without turning a personal photography site into a generic product.

## Product direction

The site is a photography archive first and a collection of interactive hobbies second. The design should feel personal, quiet, and direct:

- Put real photographs in the first viewport; avoid a marketing hero or decorative art.
- Keep navigation predictable while making the photographer and archive scale clear.
- Treat captions and session descriptions as editorial content, not ornamental metadata.
- Spend JavaScript only on interactions that need it: navigation drawers, PhotoSwipe, Admin, analytics, and the Hobbies experiences.
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

The homepage now has a compact `Photography` H1, the existing site description, and a live session/photo count. This fixes the missing page-level heading and tells visitors what archive they are looking at without pushing the first photograph out of the viewport.

The mobile header uses two rows below the desktop breakpoint. The full site name now has its own row instead of collapsing to `T…` beside four competing controls.

### Faster first photograph

Only the first visible homepage cover and first session-gallery photograph use eager loading and `fetchpriority="high"`; every other image remains lazy. The document also preconnects to the configured Blob origin. This prioritizes the likely LCP image without flooding the network with competing high-priority requests.

### Better discovery and continuity

Session descriptions appear on cards when supplied. Session pages include previous/next links in the configured archive order after the gallery, giving mobile visitors a direct continuation path without reopening the session drawer.

The homepage uses the first session cover for Open Graph and Twitter previews. Social image alternative text, site name, locale, and richer generated session descriptions are included. Admin is explicitly `noindex`.

### Photography-specific accessibility

Uncaptioned gallery links are announced as contextual positions such as “Tibet Spring 2026, photo 4 of 71” rather than camera filenames. A real caption replaces that fallback everywhere once supplied.

Admin can now edit an optional caption for every image. Caption edits preserve gallery order, are limited to 500 characters, and are stored in the existing `_session.json` sidecar. Admin shows a caption-completion count per session so accessibility and storytelling can improve incrementally.

Admin tabs now expose the tab/tablist/tabpanel relationship and support Arrow, Home, and End keys. The edit surface is a labelled modal dialog with focus containment, Escape handling, scroll locking, and focus restoration. The theme toggle now announces the action it will perform and exposes the active dark-mode state with `aria-pressed`.

## What remains intentionally unchanged

- Static Astro rendering and Blob-hosted variants remain the right architecture.
- The year-grouped archive and session filter remain simpler than tags or faceted search at the current scale.
- The masonry-style CSS columns keep mixed photo orientations visually natural.
- Hobbies remain route-local; their heavier code does not affect photography pages.
- No web font, design system, component library, map SDK, comments, accounts, favorites, or new cloud service was added.
- Full-resolution downloads remain available in PhotoSwipe.

## Ranked roadmap

| Opportunity                                               | Visitor/owner value                                                 |         Effort | Confidence | Recommendation                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------- | -------------: | ---------: | --------------------------------------------------------------------------- |
| Write session descriptions and captions for featured work | Stronger storytelling, SEO, and non-visual access                   | Content effort |       High | Start now in Admin; prioritize covers and the first 5–10 photos per session |
| Deep-link and share a specific lightbox photo             | Makes individual photographs shareable without a new backend        |         Medium |       High | Near term                                                                   |
| Add optional `featured` editorial ordering                | Lets the owner lead with strongest work rather than only chronology |         Medium |     Medium | Near term after enough curated captions exist                               |
| Add related sessions from explicit tags/collections       | Better discovery than date adjacency when the archive grows         |         Medium |     Medium | Add only with an owner-maintained taxonomy                                  |
| Draft/preview publication status                          | Safer metadata review before public builds                          |         Medium |     Medium | Useful when publishing becomes frequent                                     |
| Static map or timeline exploration                        | Spatial/temporal discovery                                          |          Large |     Medium | Proposal only; avoid an always-loaded map SDK                               |
| Bulk caption editing/import                               | Faster metadata work for hundreds of images                         |         Medium |       High | Add if per-session Admin editing becomes tedious                            |
| Structured production monitoring                          | Faster diagnosis of Function/storage failures                       |         Medium |     Medium | Enable optional diagnostics when traffic or operational value justifies it  |

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
