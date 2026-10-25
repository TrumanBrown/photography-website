---
name: photo-sessions
description: "Adding, splitting, renaming and fixing photo sessions end to end: staging/ folders and iCloud zips, scripts/upload-session.sh, the private incoming container, the build's prebuild (GPS removal, HEIC and RAW conversion, build copies), the caption run that follows, _session.json sidecars, the admin panel (/admin: cover, header, rotation, captions, display order, Rebuild Site) and the checks after a deploy. Use when: Truman uploads or stages new photos or asks for a new session; a session needs splitting, merging or renaming, or photos need moving between sessions; a title, location, date, cover, header or rotation pick is wrong; the admin panel misbehaves (can't unselect a photo, thumbnails too small, frames that don't fit); a build fails after an upload or an admin save; location data turns up in a photo; or checking that a new session went live with full-res originals, captions and a globe pin."
argument-hint: 'session folder or slug and the job, e.g. "staging/olympic-winter-2026: upload it" or "split tibet-spring-2026 by date"'
---

# Photo sessions

A session is one folder of photos in Blob Storage (`originals/<prefix>/`, where the prefix is the folder name with its case kept) plus an optional `_session.json` beside them. None of it is committed: `staging/` and `src/content/sessions/` are gitignored, and every build writes the session pages from Blob. A new session goes live in two builds. The first publishes the photos, and the second carries the captions that the Photo captions workflow writes in between.

```
staging/<name>/ or <name>.zip
  -> scripts/upload-session.sh -> incoming/originals/<name>/   (private)
  -> Build and Deploy: prebuild publishes to originals/ with GPS removed, converts HEIC and RAW,
     makes 2,400 px build copies and admin thumbnails, writes metadata/admin-index.json
  -> Photo captions (photos.yml): captions, description, blank title and location -> second build
  -> Truman picks cover, header and rotation in /admin -> Save -> Rebuild Site
```

Related skills: [image-delivery](../image-delivery/SKILL.md) for resolution, sizes and the lightbox, [session-globe](../session-globe/SKILL.md) for pins, [photo-captions](../photo-captions/SKILL.md) for caption and description text, and [ship-and-ci](../ship-and-ci/SKILL.md) for failed runs.

## Truman's rules for sessions

- Full resolution from upload to the lightbox, 1:1. Nothing in the pipeline may degrade a photo ("That is unacceptable", 2026-10-07). See image-delivery.
- No location data in anything public. Photos are published only through `incoming/`, which strips GPS, and globe pins come from the session's `location` text, never from a photo.
- Titles read `Place, Region, Month Year` with commas, never an em dash ("so telling of AI", 2026-10-06). The caption pipeline checks the shape (`TITLE_SHAPE` in `scripts/photos/website.mjs`). Descriptions show only on the session page, not on cards.
- Don't name an animal or a place unless iNaturalist or Truman says so, and never guess at what people were doing ("you cant infer they are breeding and releasing", 2026-10-07).
- The header and the rotation are his picks. Rotation shows only photos he chose, so a session he picked nothing from shows nothing (2026-10-14). Never swap out a header he chose (2026-10-12).
- Anything he edited in /admin is his. The caption pipeline never writes over it, and neither should you.

## Files

| Path                                                                     | Role                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/upload-session.sh`                                              | staging to `incoming/` (private). `<name>...` or `--all`, plus `--build` (start a build), `--yes` (no prompt, which agents need) and `--keep-names`                                                                                          |
| `scripts/photos/check-names.mjs`                                         | refuses a folder whose place name has swapped letters (`oreogn`); the uploader runs it                                                                                                                                                       |
| `scripts/prebuild.mjs`                                                   | publishes `incoming/`, validates sidecars and slugs, converts HEIC and RAW to JPEG derivatives, makes build copies and admin thumbnails, writes `src/content/sessions/<slug>.json`, `metadata/manifest.json` and `metadata/admin-index.json` |
| `scripts/location.mjs`                                                   | `check` or `strip <file>...`, and `blobs [--apply]`: finds or removes GPS in local files or in every public container                                                                                                                        |
| `src/content/config.ts`                                                  | the sessions schema, which is what a sidecar may hold                                                                                                                                                                                        |
| `src/pages/sessions/[slug].astro`                                        | the session page: banner (`banner`, else the cover if it's wide enough, else the widest photo), justified rows, lightbox                                                                                                                     |
| `src/pages/admin/index.astro`, `src/lib/admin.ts`, `src/lib/admin-ui.ts` | the admin panel. `admin-ui.ts` holds the pure rules: what fits, toggling, thumbnail sizes                                                                                                                                                    |
| `api/sessionmgr/`                                                        | admin API. GET reads `admin-index.json`, PUT merges into `_session.json`, POST starts Build and Deploy                                                                                                                                       |

The long versions: [staging/README.md](../../../staging/README.md), [docs/image-pipeline.md](../../../docs/image-pipeline.md), [docs/admin.md](../../../docs/admin.md), [README.md#adding-a-session](../../../README.md#adding-a-session).

## Add a session

1. Put a folder or zip under `staging/`, named for the place and month: `crater-lake-oregon-sep-2025`. The name becomes the URL (`/sessions/<slug>/`, lower-cased) and the caption pipeline's place words, so spell the place right. A generic iCloud zip goes inside a named folder.
2. Optionally add `staging/<name>/_session.json` ([fields](../../../docs/image-pipeline.md#optional-_sessionjson)). Refer to photos by their source names (`.HEIC`, `.ARW`).
3. Run `./scripts/upload-session.sh <name> --build --yes`. Sign in with `az login` on the photography tenant first, or it starts a device-code login. The photos stay private until the build.
4. Watch Build and Deploy (`gh run list --limit 5`, then `gh run watch <id>`). The log shows `incoming: published N file(s)` and `session: <slug> (N images)`, and the run starts Photo captions when there are new photos.
5. Photo captions takes 15 to 30 minutes and then starts a second build. It fills in a blank title and location.
6. Truman sets the cover, header and rotation in /admin, saves, and presses Rebuild Site. Don't pick for him unless he asks.
7. Check the result (below), and add a gazetteer entry if the globe has no pin for the new place (session-globe).

### After the deploy

- Location gone: `node scripts/location.mjs blobs` (needs `az login`), or run the Photo locations workflow.
- Full resolution: open a photo, wait two seconds, and check that the lightbox `<img>` has a `currentSrc` under `originals/` (or `derivatives/` for HEIC and RAW) and a `naturalWidth` equal to the link's `data-pswp-width`.
- Captions arrived: a description on the session page, a caption under each photo in the lightbox, and `npm run photos -- status`.
- Pin: the home page line `N sessions · M photographs · P places` matches the counts in the globe caption. A gap means the gazetteer doesn't know a `location`.
- Judge all of this on trumanbrown.com. The local `src/content/sessions/` holds stale copies, and fixtures have no Blob originals.

## Split, merge or rename a session

This was done for the Tibet trip on 2026-10-14: one session became Lhasa, Shannan and Shigatse, and Nagqu, split by capture date. Blob has no rename, so:

1. List the photos: `az storage blob list --account-name <account> --container-name originals --prefix <old>/ --auth-mode login --query "[].name" -o tsv`.
2. Copy each one to `originals/<new>/<file>` on the server side, then delete it from `<old>/`.
3. Write each new `<new>/_session.json` with a title, a `location` the gazetteer knows, and `images` with their captions carried over. In the old sidecar, drop the moved files from `images`, `showcase` and `cover`. A `cover` that names a missing file fails the build, while a missing `banner` quietly falls back.
4. Add gazetteer entries for the new places so they don't stack on the old pin (`7ebde27`), then commit and push.
5. Expect each moved photo to be downloaded once more (the manifest is keyed by blob name), new derivatives and copies under the new slug, and old `#photo-N` links to shift. Add a redirect route in `staticwebapp.config.json` if the old URL was shared. Captions and Instagram history follow the shot (camera, clock and subsecond), not the folder, so they survive the move.

Merging is the same move with one target. Two files that end up with the same lower-case name fail the build (`validateImageTargets`), and so do two folders that sanitize to the same slug.

## The admin panel

/admin signs in with GitHub, and the API checks the user against the `ADMIN_GITHUB_USERS` setting and fails closed. The editor has one photo grid with four modes:

| Mode     | What a tap sets                                         | Rules                                                                 |
| -------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Cover    | the 4:3 card and the og:image                           | tap it again to go back to the first photo                            |
| Header   | the session banner                                      | "Only frames that fit" (ratio 1.2 or wider) is on by default          |
| Rotation | the home page lead photo picks (`showcase`, up to 40)   | 3:2 only (1.48 to 1.52); a pick that doesn't fit can still be removed |
| Captions | the caption under the photo, which is also its alt text | up to 500 characters                                                  |

Save writes `_session.json` in Blob, and it goes live with the next build: Rebuild Site (about 5 minutes; it needs the `GITHUB_TOKEN` app setting) or the hourly cron. `bannerFocus` has no UI, so edit the sidecar with `az storage blob download` and `upload`; admin saves keep keys they don't know. The ratio constants live in two places each (`LEAD_RATIO` in `src/lib/archive.ts` and `src/lib/admin-ui.ts`, `BANNER_MIN_RATIO` in `admin-ui.ts` and `[slug].astro`), so change both.

## A build failed after an upload or an admin save

Read the failed step first (`gh run view <id>`; ship-and-ci has the log commands). If it's "Unit tests", the metadata is fine: the 2026-10-14 failure that held up his admin edits was a test that depended on the clock (`a52ccd6`). Otherwise:

| Message                                                               | Fix                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Invalid session metadata at <prefix>/_session.json`                  | fix that field in Blob or /admin (dates are `YYYY-MM-DD`, captions at most 500 characters) |
| `"A" and "B" both map to "<slug>"`                                    | rename one of the folders                                                                  |
| `conflicting image filenames`                                         | two files with the same lower-case target name; rename one                                 |
| `Image not found for session "<slug>"`                                | a stale `cover` after a split or rename                                                    |
| `N uploaded photo(s) record where they were taken; they stay private` | exiftool is missing on the runner, or a file can't be cleaned. Never publish it by hand    |
| a schema error on `order`                                             | `"order": null` again; the schema allows null and the API deletes the key (`4c581f4`)      |

Then run `gh workflow run build-and-deploy.yml`. A run cancelled by a newer push or by the hourly cron isn't a failure; check the newer run.

## Truman's verdicts

- 2026-10-06: session cards must look like collections, all one fixed size and easy to click. The home page shows the overview of every session and never opens one by itself.
- 2026-10-06: titles shaped like "location - geo - time", not "journey across tibet"; descriptions only inside the session.
- 2026-10-07: "I need full res images if user clicks on them."
- 2026-10-07: let him choose the session header instead of using the first photo (`9e01670`).
- 2026-10-08: in the admin panel the "images are way too small to see, the session panel thing isn't sizeable" (`eef0377`, `af0b6c9`).
- 2026-10-09: the lead photo starts on a random pick at each page load.
- 2026-10-13: "this should default to images that fit" (`d663abf`).
- 2026-10-14: "sometimes I can't unselect an image for rotation" (`8bb7e80`); only his rotation picks show (`f33405c`).
- 2026-10-14: split the Tibet session in two or three, "keep images full res, keep captions the same".

## Hard-won lessons

1. **Uploads go through the private inbox.** Until `79259d2` (2026-10-12), 116 public iPhone photos in 35 sessions recorded where they were taken to within a few metres. Uploads now land in `incoming/`, locations are stripped when they're published, and a monthly sweep checks every public container.
2. **Mixed-case folders are allowed, but the raw prefix and the slug differ.** Admin thumbnails broke for `Shanghai-city-...` because their URLs used the folder name (`a2b01ef`). Blob reads and admin writes use the raw prefix; everything else uses the sanitized slug.
3. **Sideways photos need their upright size.** Portraits with EXIF orientation 5 to 8 were listed as 3:2 and offered for rotation (`e07be72`).
4. **A toggle must always be able to remove.** A rotation pick that didn't fit couldn't be taken out, because the toggle refused every frame that didn't fit (`8bb7e80`).
5. **"Automatic" rotation filled the lead box with photos he didn't choose** (`f33405c`). Only explicit picks rotate.
6. **The admin API wrote `"order": null` and the schema rejected it** (`4c581f4`). Accept null in the schema, delete the key in the API, and guard with `!= null`.
7. **A hard 5:2 crop of the cover cut heads off portraits** (`6cc6cd0`). The banner uses the cover only when it's at least 1.2:1, otherwise the widest photo, and `banner` and `bannerFocus` override both.
8. **A misspelled folder spread into captions and hashtags** ("Crater Lake Oreogn", `2ac6a1c`). The uploader now refuses swapped letters in place names.
9. **A prebuild path that only runs against Blob broke a deploy** (`ReferenceError: sessionCoords`, `0cf49ff`). `prebuild:local` never runs that code, so ESLint's `no-undef` and a careful read of the diff are the only checks before CI.
10. **The first build after a split downloads every moved photo again**, and the old derivatives, thumbnails and copies stay behind. That's cheap, but nothing cleans them up.
11. **Staged photos arrived corrupted in an agent worktree** (2026-06-28). The worktree had no `staging/`, because it's gitignored, and all 17 photos he copied into it had about two thirds of their bytes replaced by `EF BF BD`, the UTF-8 replacement character, which can't be undone. Read `staging/` from the main checkout, check each staged photo decodes before using it, and if one is full of `EF BF BD`, ask him to copy it again directly or as a zip.

## Gotchas

- `npm run prebuild:remote` isn't read-only. It publishes the inbox, strips GPS in place, uploads derivatives, copies and thumbnails, rewrites the manifest, and its downloads are billed as egress. Don't run it just to look.
- Admin Save sends every field it loaded. Saving between a caption run and the rebuild after it can put older text back, and the pipeline then treats that text as his edit. Edit after the post-caption build.
- A session made only of iPhone HEIC photos may get the build date unless its sidecar has a `date`, because the HEIC derivative carries no EXIF.
- The uploader doesn't lower-case folder names. Re-uploading identical files gives them new ETags, so they're downloaded and copied again.
- `places/<region>/` hubs exist only for regions with two or more sessions, and nothing links to them except the sitemap.
- The hourly cron is best effort, so upload with `--build` rather than waiting for it.

Add new verdicts and lessons here, dated, in the commit that acts on them.
