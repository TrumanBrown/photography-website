---
name: photo-captions
description: "Mechanics of the photo captions pipeline (photos.yml, scripts/photos/catalog.mjs and its modules): one model look per photo, species from Truman's own iNaturalist observations, the private record in metadata/photos/, website captions and session descriptions merged into _session.json (his edits win), facts checked against Wikipedia, place-name typo checks, the version constants, the website hold, previews, redo and redescribe. Use when: a new session has no captions or no description; a caption or description is wrong, made up or misspelled; a species didn't come through from iNaturalist (iPhone HEIC photos, clock or time-zone slips); re-running one photo or one session; rolling out a wording change (hold website writes, preview, bump a version); a Photo captions run fails; or estimating what a re-run costs. The wording itself follows truman-voice, caption-voice and site-copy."
argument-hint: 'the photo, session or problem, e.g. "kauai-hawaii-mar-2026: birds have no species"'
---

# Photo captions

Every photo gets looked at once by a vision model, matched to Truman's own iNaturalist observation when there is one, and turned into a caption on the site, a session description, and the raw material for Instagram posts. It runs as the Photo captions workflow (`photos.yml`), started by the build when there are new photos, by the Logic App at 03:02 Pacific, and by two GitHub crons that arrive late. The site build itself never calls a model. The full write-up is [docs/photos.md](../../../docs/photos.md).

| Stage in `catalog.mjs` | What it does                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scan, capture          | fingerprint new files, read EXIF; HEIC, TIFF and RAW have no EXIF in their build JPEGs, so clock and camera come from the originals (never location)                                      |
| group                  | files become shots (camera, clock and subsecond); bursts are the same session within 60 s                                                                                                 |
| iNaturalist            | refresh the index of his observations, match frames by fingerprint, then by time (±5 min, research grade), learning each session's clock offset                                           |
| analyse                | one vision call per shot that needs it (`analyse.mjs`)                                                                                                                                    |
| lines, website         | caption first lines (`lines.mjs`), captions by code and a description per session once every photo is analysed (`website.mjs`), merged into `_session.json` with an ETag (`sidecars.mjs`) |
| save, then Instagram   | the record is saved before the Instagram stage, so a failure there can't lose website work. Instagram planning is in the [instagram-posting](../instagram-posting/SKILL.md) skill         |

State is private in Blob under `metadata/photos/` (`catalog.json`, `inat-index.json`, `taxa.json`, `facts.json`). The website text lands in `originals/<prefix>/_session.json`, the same file /admin edits. Wording belongs to [truman-voice](../truman-voice/SKILL.md), [caption-voice](../caption-voice/SKILL.md), [humanizer](../humanizer/SKILL.md) and [site-copy](../../instructions/site-copy.instructions.md); this skill is about how the text gets made and shipped.

## Truman's rules for the pipeline

- **iNaturalist is the source of truth** for anything alive (2026-10-10). Never name a species by hand in copy: the pipeline rejects species names nobody verified, and a hand edit would skip that check. A wrong or missing ID gets fixed on his iNaturalist, by him.
- **Look once.** "don't run this openAI analysis twice for every image. create a master known info for each image" (2026-10-10). Everything is written from the one record.
- **Never make things up.** No guessed behaviour ("you cant infer they are breeding and releasing", 2026-10-07), no names you aren't sure of. `claims.mjs` checks what voice text may claim.
- **The website is written for search; his full voice is for Instagram.** "I care more about instagram human like... the website, the first party voice isn't as important" (2026-10-13). Alt text stays precise and names the place.
- **Show drafts before changing what it writes, and never pause posting**: "don't pause any image posting, i just want to see the drafts for the final version of captions you have before you update the pipeline going forward" (2026-10-13).
- **His edits win.** Anything changed in /admin is never rewritten. Clearing the field hands it back to the pipeline.
- **Repeatable**: a new session must get its captions and description with nothing done by hand (2026-10-10).

## Commands

| Command                                                                                | What it does                                                                                                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run photos -- status`                                                             | counts: analysed, matched, conflicts, given up, descriptions and why any failed their checks                                      |
| `npm run photos -- preview [slug]`                                                     | writes `.cache/photos/preview.html`: captions and descriptions, with today's site text in grey where the next run would change it |
| `npm run photos -- redo <photo>` / `redo --session <slug>`                             | fresh vision look on the next run                                                                                                 |
| `npm run photos -- redescribe <slug>`                                                  | rewrites the description on the next run, unless he edited it                                                                     |
| `gh workflow run photos.yml -f limit=<n> -f dry_run=true -f overwrite=false`           | a run now; `dry_run` writes nothing to the site; `overwrite` (one run only) replaces copy that was never his                      |
| `node scripts/photos/catalog.mjs --local --provider mock [--only <slug>] [--no-write]` | local runs without Azure or a model                                                                                               |

`<photo>` is a full `session/file` id or any unique part of a filename. The CLIs need `az login` with Blob data access; `--local` uses `.cache/photos/state`.

## Fix a caption, a description or a species

- **Wording of one caption or description**: edit it in /admin. It's his from then on.
- **A fresh look at one photo**: `npm run photos -- redo DSC01234`, then `gh workflow run photos.yml` or wait for the next run. That also rewrites the session description (unless edited) and that photo's planned post.
- **A wrong or missing species**: ask Truman to fix or add the observation on iNaturalist. The next run refreshes the index, a changed taxon forces a new look, and caption, description and unpublished posts follow. Still unmatched? Check the photo has a capture time and the observation's time (whole-hour time-zone slips are allowed for close fingerprint matches), then `redo` it. `status` lists photos the model flagged as not matching their ID; those lose the name and stay off Instagram until fixed.
- **A peak or lake that should be named**: put the name in the session title, location or folder name, then `redo --session <slug>`.
- **A typo from the folder name**: rename the session folder (photo-sessions). `scripts/photos/placenames.mjs` fixes swapped letters in place names, and the uploader refuses them.

## Roll out a wording or rules change

1. Record the feedback first: his rewrites go in caption-voice's "His rewrites" and `HIS_STORIES` in `scripts/photos/voice.mjs`; rules for how he writes go in truman-voice.
2. Hold the website: `gh variable set PHOTOS_HOLD_WEBSITE --body true`. Every run then writes privately only. Posting continues.
3. Change the prompts or checks (`voice.mjs`, `lines.mjs`, `website.mjs`, `claims.mjs`, `facts.mjs`) with tests, and bump the version that re-runs what changed (below). Push.
4. `gh workflow run photos.yml`, then `npm run photos -- preview` and `npm run social -- preview`. Give Truman the pages as Windows-openable links (ship-and-ci) and wait for his OK.
5. After his OK: `gh variable delete PHOTOS_HOLD_WEBSITE` and `gh workflow run photos.yml`, which writes the sidecars and redeploys.

| Constant              | File                         | A bump redoes                                                                                        |
| --------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ANALYSIS_VERSION`    | `analyse.mjs`                | every vision look. The only one that pays for vision again (a full pass was estimated at $10 to $15) |
| `LINE_VERSION`        | `lines.mjs`                  | every caption's first line (about 8 minutes)                                                         |
| `DESCRIPTION_VERSION` | `catalog.mjs`                | every session description (about 15 minutes)                                                         |
| `FACTS_VERSION`       | `facts.mjs`                  | the facts                                                                                            |
| `CAPTURE_VERSION`     | `catalog.mjs`                | capture facts read from originals                                                                    |
| `VOICE_VERSION`       | `voice.mjs`                  | planned Instagram openings                                                                           |
| `POST_VERSION`        | `scripts/social/compose.mjs` | the poster refuses drafts older than this until they're rewritten                                    |

A run handles 300 photos by default (`limit`); the archive was about 1,250 in October 2026, so a full regeneration needs a bigger `limit` or several runs.

## A failed or missing run

- No run at all: the job needs `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_DEPLOYMENT` (or another provider with `PHOTOS_ENABLED=true`). The Logic App starts it daily; `gh workflow run photos.yml` starts it now.
- Model 401: the identity the workflow signs in as lacks the OpenAI role (`a6e759b`). 429s are retried.
- "Instagram stage failed; the website copy is unaffected": the run exits 1, but the redeploy still happens.
- "Couldn't update a session file": ETag conflicts after three tries, usually an admin save at the same moment. Run again.
- Run logs show counts and redacted errors only. `npm run photos -- status` shows the state.

## Truman's verdicts

- 2026-10-06: descriptions "not sound so AI", no em dashes, shown only inside the session; "don't name animals or locations if you aren't sure... keep it high level or pull from inaturalist"; the Lijiang session was missing a description.
- 2026-10-10: "how can we automate this so any future session uploads get a descripton"; the one-record design with iNaturalist as truth; "i haven't hand written any session descriptions or captions ever, so you can overwrite all of those on the first run."
- 2026-10-11: "'against a dark background'... are not how humans talk." Focus on the animal, its name and what it's doing.
- 2026-10-11: "tell me how this caption had a typo in oregon?? fix that issue."
- 2026-10-13: Kauai photos "not pulling the actual species names. I put them on inaturalist", and "make sure instagram caption pipeline doesn't have this same issue."
- 2026-10-13: website copy search-first, Instagram in his voice (`1ccb015`); "Looks good deploy those changes" after reviewing drafts (2026-10-14).

## Hard-won lessons

1. **A session went live with no description and no warning**, because no model was configured. Keyless Azure OpenAI and loud warnings on blank sessions followed (`9fd7ec8`).
2. **Analyse once.** Two pipelines looking at the same photos would have paid twice and disagreed. One record feeds everything (`d39eabc`).
3. **A content filter refused a harmless photo and it retried forever**, blocking its session's description. Refused photos are marked unreadable, never retried, and don't block anything (`728fec9`).
4. **Captions read like alt text** ("clinging to a green stem against a dark background"). First lines are their own text-only step, facts come from Wikipedia, and no line describes the backdrop or the pose (`24881aa`). Descriptions describe the moment, not the photo (`bf53cd6`).
5. **Folder typos spread everywhere.** "Crater Lake Oreogn" reached four captions and a hashtag (`2ac6a1c`). "Napali" against "Nā Pali" lost a fun fact until accents and spaces were folded (`dba15e8`).
6. **iPhone photos had no species.** HEIC build JPEGs carry no EXIF, so there was no capture time to match on. Capture facts now come from the originals, close matches allow whole-hour time-zone slips, and photos get a new look when a new observation appears (`773bb84`). Files rewritten by the GPS cleanup needed their EXIF parsed after its header (`5480d17`). Fourteen Kauai photos gained species.
7. **Re-read his words before turning them into a rule.** Limiting "I" openers contradicted his own "I usually start with 'I' or a verb" and was reverted (`88ec0a8`, `5994f96`). Quotas on a phrase made the model hop between synonyms, so stand-ins are banned instead (`feb1b7e`).
8. **Code fills names after the model writes**, so grammar around them needs fixing up: "this two North American river otters", "a agami heron" (`09fa609`).
9. **Search-first copy fixed an SEO regression**: seven Mount Baker photos had identical alt text and descriptions had dropped place names (`1ccb015`).
10. **27 hummingbirds got 27 pose-only lines.** Photos may share a line; poses never make one (`483f387`).
11. **A description stuck on old text** because the copy check matched a species name both shared. Species names are stripped before that check (`eb81fee`).
12. **Every documented setting must be wired into the workflow.** Three documented variables did nothing because the workflow never passed them (`1ea824a`).

## Gotchas

- `scripts/photos/text.mjs` and `voice.mjs` read other files by exact heading: truman-voice from `## How he writes` to `## Where it applies`, caption-voice from `## How a post reads` to `## Procedure`, and site-copy's `Never sound like a language model`, `Voice`, `Sentences` and `Do not write` sections. Renaming one silently empties a prompt.
- The website hold and `dry_run` stop only `_session.json` writes. Planned Instagram posts are still rewritten, and the live poster publishes them.
- `redo` also redoes the session description. A trip note (`npm run social -- note`) rewrites the description and planned openings too.
- A caption edited in /admin never updates again, even when the iNaturalist ID changes. Clear it to hand it back.
- A new session is invisible to the pipeline until a build has written `metadata/admin-index.json`.
- iNaturalist hides the exact location of some species. The record stores an `obscured` flag but nothing uses it yet, and a post has named a trail for one such species. Ask Truman before changing this.
- Rate limits: the model at 50K tokens a minute (backfills slow down, and two at once share it), iNaturalist about one request a second, Wikipedia one per 1.2 s.

Add new verdicts and lessons here, dated, in the commit that acts on them.
