---
name: instagram-posting
description: "Mechanics of the Instagram pipeline: planning two weeks of posts in the Photo captions run (catalog.mjs stage 6), scripts/social (plan, render and crops, compose, hashtags, post, story, schedule, token, seal), social-post.yml and the Logic App timer that starts it, exactly-once publishing, the daily story, dry runs and rehearsals, previews for Truman, and keeping the account out of the public repo. Use when: changing what or when it posts (posts a day, slots, the landscape mix), crops or borders, stories, hashtags, the link line or location tags; previewing upcoming posts or stories; skipping a photo, redrafting a post or putting his own words in; 'No post was published yesterday', 'Media ID is not available' or another Social post failure; the token expired or needs rotating; or GitHub's cron didn't fire. Caption wording follows caption-voice and truman-voice."
argument-hint: 'the change or the failure, e.g. "preview the next week of posts" or "run 38190329431 failed"'
---

# Instagram posting

Three photos a day go to Truman's Instagram, each used once, with a caption in his voice, a fun fact, the gear, a link line and five hashtags, plus one story a day. Posts are planned two weeks ahead by the Photo captions run (stage 6 of `scripts/photos/catalog.mjs`, only with `SOCIAL_ENABLED=true`) and published by the Social post workflow (`social-post.yml`), which a Logic App starts at :02 and :32 past each hour from 07:02 to 22:32 Pacific. GitHub's own crons are a backup that arrives hours late or not at all. The full write-up, including the first-time Meta setup, is [docs/social.md](../../../docs/social.md).

| Path                                                              | Role                                                                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/social/plan.mjs`                                         | `planQueue`: two weeks of posts, spacing sessions, species and places, a landscape every third post                                                                  |
| `scripts/social/render.mjs`                                       | the upload: 4:5 to 1.91:1, at most 1440 px wide, never upscaled, EXIF stripped; `cropPosition` places a crop once per photo; `renderStory` makes the 1080×1920 frame |
| `scripts/social/compose.mjs`, `hashtags.mjs`                      | the caption: opening plus one emoji, place line, `Fun fact:`, gear, link line, five hashtags, at most 2,200 characters                                               |
| `scripts/social/due.mjs`, `post.mjs`, `story.mjs`, `schedule.mjs` | is anything due (cheap, before `npm ci`), publish exactly once, the daily story, slot times                                                                          |
| `scripts/social/instagram.mjs`, `token.mjs`, `seal.mjs`           | the Graph API client (single images and stories only), token refresh, AES-256-GCM sealing                                                                            |
| `scripts/social/settings.mjs`                                     | every `SOCIAL_*` and `IG_*` setting and its default                                                                                                                  |
| `infra/modules/scheduler.bicep`                                   | the Logic App timer (Windows time zone, posting hours)                                                                                                               |

Private state lives in Blob under `metadata/social/`: the queue, the ledgers of what was posted, per-day attempt records, the sealed token, trip notes, and `config.json`, which Truman edits by hand (link line, hub hashtags and accounts, location ids). Caption wording comes from [caption-voice](../caption-voice/SKILL.md) and [truman-voice](../truman-voice/SKILL.md); what the photo is comes from [photo-captions](../photo-captions/SKILL.md).

## Truman's rules for Instagram

- **Every photo once, never again**, in any order (2026-10-10). Already on the account means never planned.
- **Two or three a day**, "i dont want this going for years" (2026-10-10). The default is 3.
- **The whole photo at full quality.** He first asked for no cropping at all; when borders read as bars, he chose a slight crop "to make it fit in the natural area" (2026-10-14), which is now the default.
- **Stories: one a day, the photo only, no text**, vertical shots first "so less blurred space" (2026-10-13).
- **Never pause posting.** Review happens on drafts while posting carries on (2026-10-13).
- **Nobody reading the public repo can tell which account this posts to** (2026-10-10). The handle, app name, user id, hub accounts and location ids stay in secrets or `config.json`, and logs print counts through `redact()`.
- Don't automate follows, likes, comments or DMs, and don't hand his Instagram password to any tool. That was the agent's advice on 2026-10-13 when he asked what else to automate, and it still stands.

## Commands

| Command                                                   | What it does                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run social -- status`                                | posted, ready, waiting, skipped by reason, already on the account, days of posts left, stories posted and left                                                 |
| `npm run social -- preview [count]`                       | `.cache/social/preview.html`: the next story and the next `count` posts (default a week) in an Instagram frame, with crop notes and anything that needs review |
| `npm run social -- skip <photo> [why]` / `unskip <photo>` | never post it, as a post or a story / undo                                                                                                                     |
| `npm run social -- redraft <photo>`                       | next Photo captions run writes it a new opening, first line and a different fact                                                                               |
| `npm run social -- opening <photo> "words"` / `--clear`   | his own opening, used exactly as written                                                                                                                       |
| `npm run social -- note <trip or photo> "text"` / `notes` | private trip notes, the only source for what he was doing                                                                                                      |
| `npm run social -- retry <photo>` / `retry --all`         | clear failure strikes                                                                                                                                          |
| `npm run social -- approve <photo>`                       | only with `SOCIAL_REQUIRE_APPROVAL=true`                                                                                                                       |
| `gh workflow run social-post.yml -f force=true`           | post now, ignoring the slots                                                                                                                                   |
| `gh workflow run social-post.yml -f story=true`           | today's story now (never a second one)                                                                                                                         |

Switches (repository variables): `SOCIAL_ENABLED` (planning), `SOCIAL_LIVE` (only `true` publishes; anything else is a dry run that rehearses with Instagram short of publishing), `SOCIAL_STORIES` (`true` or `rehearse`). Cadence: `SOCIAL_POSTS_PER_DAY` (1 to 6), `SOCIAL_SLOTS`, `SOCIAL_MIN_GAP_MINUTES` (150), `SOCIAL_DAY_END`, `SOCIAL_TIMEZONE`, `SOCIAL_LANDSCAPE_EVERY` (3). The rest are in [docs/social.md](../../../docs/social.md#settings).

## Show Truman what's coming

`npm run social -- preview` (or `preview 42` for two weeks), then give him the page as a Windows link (ship-and-ci). For a pending change, hold the website and generate drafts first (photo-captions, "Roll out a wording or rules change"), show both previews, wait for his OK, and keep posting live the whole time.

## Change the cadence

1. `gh variable set SOCIAL_POSTS_PER_DAY --body <n>`. The Photo captions run reads it too and plans n × 14 posts. Default slots: 3 a day at 08:30, 12:30 and 18:00.
2. `SOCIAL_SLOTS` needs at least as many valid `HH:MM` entries as posts a day, or it silently falls back to the defaults.
3. Slots outside 07:00 to 22:59 Pacific need `postingHours` in `scheduler.bicep` changed and the Infra workflow run (azure-ops). Keep its Windows `timeZone` and `SOCIAL_TIMEZONE` in step.
4. Update the settings tables in docs/social.md and the README; `logic.test.mjs` covers the schedule.

## Stories

Candidates are photos at least 1080 px on the short side that were never storied, aren't queued as posts, and weren't posted in the last 30 days. Vertical ones (height at least 1.2× width) go first. The time is picked from the date within 10:00 to 21:00. The frame shows the whole photo over a blurred, dimmed copy of itself. Selection rules are in `storyCandidates` and `pickStory` (`story.mjs`), the frame in `renderStory`, timing in `decideStory` (`schedule.mjs`), tests in `story.test.mjs`.

The API can't add text, stickers, music, a location or a link to a story, and it can't share a feed post as a story. Truman asked for that on 2026-10-14 ("it should post the feed post itself, as a story, not a copy of the image"); it isn't possible through the API, so it wasn't built. He tags story locations himself with Muse, a separate scheduling app that also posts its own daily story. He's open to tools like it for what the API can't do (2026-10-13).

## When a Social post run fails

- A red run can be on purpose: "No post was published yesterday..." is the missed-day alert, and the first failure of a day fails the run so he gets an email (later ones log "already reported").
- `Media ID is not available` (error 9007) after the container finished: Instagram lag. Publishing retries for about a minute, and the next run publishes a container left in flight (`dc3fc3b`).
- Token invalid or expired: rotate it (below). Publishing limit used up: wait. A photo that failed twice is left out; `npm run social -- retry <photo>` clears it.
- No Social post runs at all: check the Logic App's run history. A 401 there means the `GITHUB_TOKEN` app setting (a fine-grained token with Actions write) expired or lost permission: replace it and run Infra again, because the Logic App reads it at deploy time. Meanwhile `gh workflow run social-post.yml` keeps things moving.
- If Photo captions stops for more than two weeks, the queue runs dry and the missed-day alert goes quiet too.

## Rotate the token

1. Meta for Developers: the app's Instagram API setup, "Generate access tokens", Generate token ([docs/social.md step 6](../../../docs/social.md#step-6-generate-the-access-token)). Truman does this; never ask him to paste a token into the chat.
2. He runs `gh secret set IG_ACCESS_TOKEN` and pastes it at the prompt. A new token replaces the sealed copy on the next run.
3. Lost `SOCIAL_SECRET_KEY`: `openssl rand -base64 32 | gh secret set SOCIAL_SECRET_KEY`. The old sealed token becomes unreadable and the seed token is used.
4. Refresh happens weekly on its own (the token lasts 60 days). A token under a day old can't be refreshed; that warning is harmless.

## Published posts

Instagram's API can only turn comments on or off and delete. To change a live caption, hand Truman the finished text to paste in the app (done 2026-10-12 for five posts and 2026-10-13 for an emoji). The published text stays in the record with its media id.

## Truman's verdicts

- 2026-10-10: one photo used once; "make sure to post the full res image, no cropping or anything"; "2-3 pics a day"; nothing in the repo may show where it posts.
- 2026-10-10: he'll put the site in his bio, so posts say the full resolution is there (the link line).
- 2026-10-11: reusing a fun fact on two posts about the same species or place is fine: "so spread out no one will know."
- 2026-10-12: posts "still... read a little too AI", with his own rewrites (caption-voice holds them).
- 2026-10-13: "the text on these images looks ai, i would say automate 1 story post a day, typically try to do vertical shots so less blurred space. no text or anything else."
- 2026-10-13: "don't pause any image posting, i just want to see the drafts."
- 2026-10-13: some emoji "are too much, like the heart eyes"; stick to the animal or the scene.
- 2026-10-14: frames that don't fit get a slight crop instead of a border.

## Hard-won lessons

1. **GitHub's scheduler can't be trusted.** The hourly build ran about one time in five and the posting cron never ran, so a Logic App starts the workflows, two weeks of posts are written ahead, and photos run twice a day (`40f08ed`, `7964e2e`). A keepalive commit stops GitHub disabling schedules after 60 quiet days.
2. **A dry run that stops before Instagram proves nothing.** Rehearsals create a real container and stop short of publishing, which proves the token, the permission and that Instagram accepts the image and caption (`cbb5bde`).
3. **His first preview failed with `AZURE_STORAGE_ACCOUNT is required`.** The CLIs read the account from `blobHost` in `site.config.ts` and say "az login" when that's missing (`cbb5bde`).
4. **Borders read as bars** on the portraits that were a third of the queue, in both themes. Crop by default, placed once per photo with its own fingerprint so it can't post twice (`e510b08`).
5. **A test broke at 10:05 one morning and blocked every deploy**, including his admin edits. `runPost` stamped the real clock while the test faked only `now`. Tests fake `Date` and run at several dates (`a52ccd6`). Image tests got smaller fixtures and 20 s timeouts after timing out on CI (`e00b520`).
6. **Heart-eye emoji and quips didn't sound like him.** One emoji at the end, of the animal or the scene (`55d3d5b`).

## Gotchas

- Time zones: slots and day records use `SOCIAL_TIMEZONE` (IANA), the Logic App uses a Windows zone name, and GitHub crons are UTC without daylight saving.
- `post.mjs` mixes an injected `now` with `new Date()`. Any test touching it must fake `Date`.
- Location tags and tagging accounts need `IG_LOGIN_MODE=facebook` with a Page token; Instagram Login can't do either.
- A container whose status can't be read blocks its slot rather than risk a double post.
- `SOCIAL_MIN_GAP_MINUTES` (150) is longer than the spread at 6 posts a day.
- Photo captions' website hold doesn't stop planned posts being rewritten, and the live poster publishes them.

Add new verdicts and lessons here, dated, in the commit that acts on them.
