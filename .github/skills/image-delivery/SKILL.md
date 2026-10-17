---
name: image-delivery
description: "How photos reach the browser at full resolution, and what that costs: page variants in Blob (sync-variants.mjs), the 1600 px lightbox bridge, the original swapped in after decode (src/lib/lightbox.ts), HEIC and RAW derivatives, 2,400 px build copies, Cache-Control, eager/lazy and fetchpriority rules, captions under the photo (src/lib/lightbox-caption.ts), the Static Web Apps 250 MB cap and the Blob egress bill. Use when: a photo looks soft, blurry or 'not full res like iCloud'; the lightbox is slow or stuck on a smaller copy; zoom stops early; changing image sizes, srcset, preloading, LCP or priority; a caption covers a photo; builds re-download originals or the Azure Bandwidth or egress charge grows; GitHub cache eviction; or the deploy is too big for Static Web Apps."
argument-hint: 'the symptom or change, e.g. "photo 3 of eastern-washington looks soft after going back to it"'
---

# Image delivery

Every photo exists in four sizes, and each one has a job. Truman's rule is that the photo he uploaded is the photo a visitor gets when they open it, at 1:1, and nothing may quietly put a smaller copy in its place.

| Copy            | Where                                                                                         | Used for                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original        | `originals/<prefix>/<file>` (Blob), immutable Cache-Control for a year                        | the lightbox, after it decodes. HEIC and RAW originals can't be shown by browsers, so the lightbox gets a q95 4:4:4 JPEG from `derivatives/<slug>/` |
| Lightbox bridge | 1600 px WebP in `variants/` (`VIEW_MAX_WIDTH` in `[slug].astro`)                              | the first 1 to 2 seconds of a slide, and its neighbours' preload                                                                                    |
| Page variants   | WebP and JPEG in `variants/` (cards 320 to 960 px, grid 480 to 1600 px, banner up to 2000 px) | cards, the justified grid, banners, the lead photo                                                                                                  |
| Build copy      | `metadata/build-copies/<slug>/` (private), 2,400 px, exact aspect, q95 4:4:4, EXIF kept       | what the build reads instead of the original. Visitors never see it                                                                                 |

Astro writes the page variants into `dist/_astro/`, and `scripts/sync-variants.mjs` moves them to Blob and rewrites the URLs, because Static Web Apps Free allows 250 MB per deploy. The full story is in [docs/image-pipeline.md](../../../docs/image-pipeline.md) ([viewing at full resolution](../../../docs/image-pipeline.md#viewing-full-resolution-without-the-wait), [why the build works from copies](../../../docs/image-pipeline.md#why-the-build-works-from-copies)).

## Rules

- **Full resolution, every time, for everyone.** The current slide always ends on the original. No Save-Data exception, no slow-network exception, no quality switch (`a810c65`). A speed fix that leaves a smaller copy in the lightbox is a regression, however fast it is.
- **Cut cost only where no visitor can see it.** Truman's gate for the build copies was "if no visible difference to customers, then implement this change" (2026-10-15). Prove it before proposing a change: flip between the two on the hardest photos and measure (SSIMULACRA2 was used), then explain the impact very simply.
- **Performance over cost.** He has a monthly Azure credit and has said many times not to hold features back to save it. The exception is waste nobody sees, like the build's own downloads.
- **A caption never covers its photo** at any size, in the lightbox or anywhere else. The photo gets smaller to make room ([site-design rules](../../instructions/site-design.instructions.md)).

## Files

| Path                                                                 | Role                                                                                                                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/sessions/[slug].astro`                                    | sizes and widths, banner choice, the `data-pswp-full`, `-width`, `-height` and `-caption` attributes. The declared size comes from the original's size in the session JSON |
| `src/components/Lightbox.astro`                                      | PhotoSwipe v5 setup: `preload: [1, 2]` (bridges only), grid thumbnail as placeholder, upgrade on `afterInit` and `change`, `#photo-N`, Copy link                           |
| `src/lib/lightbox.ts`                                                | `createUpgrader` (remembers each upgraded `<img>`), `loadOriginal` (decodes before swapping)                                                                               |
| `src/lib/lightbox-caption.ts`                                        | reserves room for each slide's caption (`CAPTION_GAP`, `CAPTION_EDGE`, `TOOLBAR`)                                                                                          |
| `src/components/SessionCard.astro`, `src/components/LeadPhoto.astro` | card covers and the rotating lead photo                                                                                                                                    |
| `scripts/prebuild.mjs`                                               | derivatives (`DERIVATIVE_VERSION`), build copies (`BUILD_COPY_VERSION`, `BUILD_COPY_WIDTH`), Cache-Control on originals, cache pruning                                     |
| `scripts/sync-variants.mjs`                                          | moves `dist/_astro` images to `variants/` and rewrites references (`rewriteAstroRefs`)                                                                                     |
| `.github/workflows/build-and-deploy.yml`                             | the `prebuild-cache-` and `astro-cache-v2-` caches                                                                                                                         |

## "It's not full res"

Truman checks against the iCloud original, so check the same way.

1. Where is he looking? Cards, the grid, banners and the lead photo are variants by design. The lightbox shows the 1600 px bridge for a second or two, longer on a slow connection, and a zoom during that looks soft until the original lands.
2. Wait, then inspect the lightbox `<img>`: `currentSrc` should be the `originals/` URL (or `derivatives/` for HEIC and RAW) and `naturalWidth` should match the link's `data-pswp-width` (6192 for most of his camera files). Still 1600 means the upgrader or a cap regressed. A wrong declared width means the size isn't coming from the session JSON, or a sideways photo's upright size is off.
3. Repeat the sequence that caught the last regression: open `#photo-1`, step six photos forward and back, then close and reopen. Each photo must end on its original (`ee999ba`).
4. HEIC and RAW should show the derivative. Check its `derivative` metadata matches `DERIVATIVE_VERSION`.
5. A private window doesn't cache originals over about 6 MB, so coming back downloads them again. That isn't a bug.
6. Judge on trumanbrown.com. With fixtures there are no Blob originals, so the lightbox "original" is a local placeholder.

## Changing sizes, preloading or priority

- Only the likely LCP image is eager with `fetchpriority="high"`: the first row of cards, the banner (also `decoding="sync"`, so the page change never shows bare paper), the lead photo's first frame. Everything else is lazy. Marking every image above the fold high made them compete (`196cf33`).
- The lightbox preloads bridges for the next slides, never originals. Only the current slide gets its original.
- Widths in `[slug].astro`, `SessionCard.astro` and `LeadPhoto.astro` decide how many variants exist. More widths mean more files to upload and HEAD on every deploy (about 15,000 already).
- Bumping `BUILD_COPY_VERSION` remakes every build copy and changes every Astro variant once (the first run took 19 minutes). Change the `astro-cache-v2-` key in the workflow in the same commit. Bumping `DERIVATIVE_VERSION` reconverts every HEIC and RAW photo.

## Cost checks

- The Bandwidth meter is data leaving the storage account. Split it by who asked: `az monitor metrics list --resource "<storage account id>/blobServices/default" --metric Egress --interval P1D --aggregation Total --filter "Authentication eq '*'" --start-time <iso> --end-time <iso>`. `OAuth` is builds and agents, `Anonymous` is visitors. On WSL, strip the `\r` the Windows `az` adds to command output.
- `gh cache list`: the prebuild cache and the Astro cache should total well under GitHub's 10 GB (about 1.9 and 1.5 GB in October 2026). Over 10 GB, GitHub evicts one and the next build downloads everything again. A Build and Deploy run over 20 minutes is the tell.
- README [What it costs](../../../README.md#what-it-costs) and [docs/azure.md](../../../docs/azure.md#monthly-cost) carry the numbers; update them when a change moves the bill.

## Truman's verdicts

- 2026-10-07: "look at icloud (right) vs website clicked image (left). That is very noticeable degrade in quality. That is unacceptable. I need full res images if user clicks on them."
- 2026-10-07: "dannys photos load so much quicker than mine when clicking through photos", which led to the bridge, the placeholder and the decode-then-swap. Speed came from loading order, not smaller files.
- 2026-10-07: "is the full res image always being shown when user clicks on it". The Save-Data exception came out; the answer has to be a plain yes.
- 2026-10-12: "should always maintain full 1:1 full res image from upload to the website displaying it."
- 2026-10-15: build copies approved on "no visible difference to customers". The next day he asked for the change and the saving to be explained "very very simply" in the README.
- 2026-10-16: "the wbesite (on the left) is not full res like the icloud original" after going back to a photo (`ee999ba`).
- 2026-10-16: "on mobile the captions are going over the image, never allow that" (`2775351`).

## Hard-won lessons

1. **A speed fix shipped a soft lightbox.** `15bf55e` capped the lightbox at a 2,400 px WebP and told PhotoSwipe the photo was 2,400 wide, which was soft on retina screens and stopped zoom early. Fixed 34 minutes later in `e64d3f6`: always upgrade to the original and declare its real size.
2. **Originals had no Cache-Control**, so each view downloaded them again. Prebuild now sets `public, max-age=31536000, immutable` (`e64d3f6`).
3. **Viewing five photos pulled seven originals (72 MB)** because the link pointed at the original and PhotoSwipe preloads neighbours. The link is the bridge, the placeholder is the grid thumbnail, and only the current slide upgrades (`656ca45`).
4. **The agent added its own quality switch for slow networks** and Truman's answer was no exceptions (`7757e44`, removed in `a810c65`).
5. **HEIC photos were JPEG-encoded twice at q92.** Now one TIFF intermediate and a single q95 4:4:4 encode, with `DERIVATIVE_VERSION` bumped to redo them (`79259d2`).
6. **The lightbox got stuck on the bridge after stepping away and back.** PhotoSwipe keeps five slides and rebuilds them, and the upgrader remembered photos instead of `<img>` elements (`ee999ba`). Remember the element.
7. **A phone caption covered a third of the photo**, squeezed to half width by `left: 50%`. Now `paddingFn` reserves the caption's room for each slide, and the caption fades while the photo is zoomed or dragged (`2775351`). The tests cover 390×844, 390×643, 844×390 and 1440×900; check 390×664 by eye too.
8. **The deploy hit 539 MB against the 250 MB cap** with one 39-photo session. Variants moved to Blob (`3ef60eb`). SWA also caps a deploy at 15,000 files.
9. **Rotation frames 404'd only in production.** The variant rewriter's pattern ran past `&#34;`-escaped URLs inside JSON data attributes (`35f9a71`). URLs in `data-*` JSON go through the rewriter, so check them live.
10. **The build's own downloads were most of the Azure bill** ($21 of $26 in a month, about 1,300 GB). The 9 GB full-size cache plus the Astro cache passed GitHub's 10 GB, eviction made builds re-download every original, and runners are Azure VMs in other regions. Build copies fixed it: OAuth egress went from 124 GB in 23 hours to 0.06 GB in 15 (`9c88d92`, `f89f353`).
11. **The build ran out of disk** with the prebuild cache, the content and `dist/` on one runner. The workflow saves the cache, then deletes it before Astro runs (`18ea907`).

## Gotchas

- The comment above `getImage` in `[slug].astro` says the original loads only once a photo is shown larger than the bridge. The code always upgrades the current slide; trust the code.
- Local `dist/` is gigabytes because sync-variants doesn't run locally. It says nothing about the deploy size.
- `npm run prebuild:remote` downloads build copies over the internet and is billed (a test run cost about $0.35). It also writes to production containers.
- A lazy image that's `display: none` is never fetched, which is why PlateArt's light and dark pair are both lazy. Don't make both eager.
- About 1.7 GB of variants from before the build copies are orphaned in Blob. They cost cents a month and nothing removes them.

Add new verdicts and lessons here, dated, in the commit that acts on them.
