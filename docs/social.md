# Social posting: daily Instagram posts from the archive

> Audience: the site owner setting this up, or anyone recreating the site with their own account. Nothing in this repository says which account it posts to, and nothing it logs does either.

Two GitHub Actions workflows post photographs from the site to an Instagram professional account, a few a day, until every photograph has gone out once:

- **[Social catalog](../.github/workflows/social-catalog.yml)** runs nightly. It fingerprints new photos, matches animals to your iNaturalist observations, has a vision model draft each post, and plans the next week.
- **[Social post](../.github/workflows/social-post.yml)** fires every half hour and publishes the next planned photo whenever one of the day's slots is due.

Both are off until you set the `SOCIAL_ENABLED` repository variable to `true`, and nothing is published until `SOCIAL_LIVE` is `true` too.

---

## What stays private

| Thing | Where it lives | Public? |
|---|---|---|
| Which account it posts to, and the access token | GitHub secrets, plus a sealed copy in the private `metadata` container | No |
| Catalog, captions, plan, posting history | `metadata/social/*` (the private container) | No |
| The images sent to Instagram | Uploaded to the private container, handed to Meta as a link that expires after two hours, deleted after posting | No |
| Workflow logs | Public, like every Actions log in a public repo | Yes, but they only contain counts and generic messages. Errors go through [redact.mjs](../scripts/social/redact.mjs), which strips tokens, account and media ids, signed URLs and provider ids |
| The code and these docs | This repository | Yes, by design: it's how anyone else could set up the same thing |

One honest limit: the same photographs are public on the site and on Instagram, so a reverse image search could connect the two. The repository just won't be what gives it away.

---

## How a post is built

### 1. Which photo

The archive holds crops, `-1` re-exports, `.JPG`/`.JPEG` pairs and the same frame copied into two sessions. "Never post the same photo twice" therefore works on **shots** (one shutter press), keyed by camera model plus the capture time recorded in EXIF. Files without a capture time fall back to a perceptual fingerprint. Anything already on the account, posted before this existed or by hand later, is fingerprinted and excluded.

Order isn't chronological. Each next post is the best-scoring shot that doesn't repeat something recent:

- the same session isn't posted twice within a day
- the same species isn't posted again within about five days
- frames from the same burst aren't posted within about ten days

The score is the model's 1–10 "would this stop a scroll" rating, plus a bump for verified species and for sessions from the last 45 days, minus a little for repeating the previous post's kind of subject or place.

Shots are skipped automatically when they're under 1080 px wide, out of focus, or an identifiable person is the subject. You can skip anything else yourself (see [Day to day](#day-to-day)).

**Strikes.** Only a problem with the photo itself counts against it: Instagram rejecting the image, or a missing or unreadable file. Two strikes and the shot is left out until `npm run social -- retry`. An expired token, a rate limit or an outage never counts against a photo. It pauses posting for two hours and fails the run once that day, so you get one email rather than thirty.

### 2. The image: full resolution, never cropped

Instagram's publishing API only accepts JPEGs between 4:5 (portrait) and 1.91:1 (landscape), at most 1440 px wide and 8 MB. Anything wider is downscaled on Instagram's side, so 1440 px is the most resolution a post can carry. [render.mjs](../scripts/social/render.mjs):

- starts from the untouched original and applies EXIF orientation, exactly like the site does
- sends it at 1440 px wide with high-quality resampling, never upscaled
- sends a frame that's already inside Instagram's allowed shape whole, with nothing added
- gives a frame that's too tall (2:3 portraits) or too wide **plain borders, never a crop**, black or white to match the photo's own edges
- writes sRGB, 4:4:4 chroma, quality 95, and strips camera metadata

Set `SOCIAL_TALL_IMAGES=skip` to leave out frames that would need borders instead.

When the same shot exists as both your crop and the full frame, the version that needs no border is posted, then the largest. Your crops are used as you made them.

### 3. Is it an animal? iNaturalist

If the hobby pages link to an iNaturalist account (or `SOCIAL_INATURALIST_USER` is set), every photo on that account's observations is fingerprinted once. A site photo whose fingerprint matches **and** whose observation date is within a day of the capture date is **that observation's photo**. Matching by time alone fails here: camera clocks in this archive were off by up to 18 hours in places, and dense survey nights produce false matches.

Fingerprints are 128-bit. They were tuned on this archive:

- **Different shots** never came closer than 9 bits, and only same-day near-duplicates got that close.
- **True iNaturalist copies** sat within 16 bits, and 288 of 290 were observed within a day of capture.

So a match needs at most 14 bits and agreeing dates, or at most 6 bits when a date is missing. The closest match always wins, and only near-ties are broken by "animal over the plant it sits on".

When there's no exact-frame match, observations made within five minutes of the capture become candidates. The session's clock error is learned from its exact matches first. A candidate is only used if the vision model, shown both photos, is confident it's the same animal.

From the matched observation, [inat.mjs](../scripts/social/inat.mjs) takes:

- the common and scientific name
- the class, order and family
- iNaturalist's Wikipedia summary
- the global IUCN Red List status

A species name is only ever used when the observation is **research grade at species rank or finer**. Anything else stays at group level ("a tree frog"), the same rule as the site's captions. As a backstop, every draft is checked against the full list of species you've recorded. A caption that names one of them without a verified ID for that photo is sent back. Identifications are re-checked on every catalog run, and a post whose ID changed is redrafted.

Observation notes are deliberately ignored. On this account they're questions to identifiers ("Can someone help confirm this ID?"), not captions.

### 4. Looking at the photo

Every photo, animal or not, goes through a vision model. The simplest option is the site's own Azure OpenAI deployment (the Infra workflow's `enableDescribeModel`). Set the `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_DEPLOYMENT` repository variables and the workflow's Azure sign-in is the credential, so no API key exists anywhere and photos stay in your tenant. Otherwise set `SOCIAL_OPENAI_API_KEY` or `SOCIAL_ANTHROPIC_API_KEY`. The model receives:

- the photo, downscaled to 1280 px
- the session title, location and your own session description
- the camera and lens from EXIF, and the capture month
- the iNaturalist facts above, when there are any
- the site's voice rules from [site-copy.instructions.md](../.github/instructions/site-copy.instructions.md)

It returns JSON:

- what the subject is
- a few words on what it's doing
- where it is
- a one-to-three-sentence description
- alt text
- an appeal score
- a skip flag

Its rules: describe only what's visible; add at most one fact, and only from the supplied summary; and use place names only if they already appear in the session title or location.

**Example, a mountain session.** Take a frame from "Sunrise, Mount Rainier National Park, July 2026" that actually shows a foggy meadow and a creek. The model writes what's in the frame ("Fog over a subalpine meadow and a winding creek"), not what the session is named after. It names Mount Rainier only because the session text does, and leans on your own description ("I started in fog down in the meadows…") for context. If it names a peak that isn't in the session text, the draft is rejected and rewritten.

### 5. The caption

```
Boat-billed heron (Cochlearius cochlearius) peering out from behind a branch, Tortuguero, Limón Province, Costa Rica

Rain beading on the crown, a bill like an upturned boat, and eyes far too big for its head. Boatbills are nocturnal herons that live in mangrove swamps from Mexico south to Peru and Brazil.

Sony a6700 · E 70-350mm F4.5-6.3 G OSS at 350mm · f/6.3 · 1/50s · ISO 6400
The rest of this set is on example.com, link in bio

#boatbilledheron #birdsofinstagram #tortuguero #birdphotography #sonya6700
```

- **First line:** keywords first, which is what Instagram search and Google read. Verified species get their scientific name, and places come from your session text.
- **Body:** written by the model under the rules above.
- **IUCN line:** added by code when the global status is Near Threatened or worse.
- **Gear line:** from EXIF.
- **Pointer:** captions can't carry links, so it points to the link in the profile.
- **Hashtags:** exactly five, built by [hashtags.mjs](../scripts/social/hashtags.mjs) from data, never invented:

| Slot | From | Example |
|---|---|---|
| Subject | Research-grade species, or a landmark named in the session | `#boatbilledheron` |
| Community | iNat lineage (order, class) or the model's subject group | `#birdsofinstagram` |
| Place | A place word from the session title or location | `#tortuguero` |
| Genre | Lens and subject | `#birdphotography`, `#macrophotography` |
| Gear | Camera body | `#sonya6700` |

When the subject slot is empty (most landscapes), the broad region fills it (`#costarica`, `#pnw`).

The model also writes the **alt text**. It's sent with every post, and both Instagram and Google read it.

Every caption is checked before it's saved:

- **Fixed automatically:** em dashes, emoji, exclamation marks and stray `#`/`@`.
- **Rejected:** banned marketing words and ungrounded place names, followed by one redraft with the reason.
- **Needs review:** a draft that still fails is marked and never posted unprompted.

---

## When it posts

The default is three posts a day at 08:30, 12:30 and 18:00 Pacific, at least 2½ hours apart:

| Variable | Default | Meaning |
|---|---|---|
| `SOCIAL_POSTS_PER_DAY` | `3` | 1–6 |
| `SOCIAL_SLOTS` | per count | comma-separated `HH:MM` |
| `SOCIAL_TIMEZONE` | `America/Los_Angeles` | |
| `SOCIAL_MIN_GAP_MINUTES` | `150` | |
| `SOCIAL_DAY_END` | `23:00` | no new posts after this |

GitHub drops scheduled runs; this repository's hourly build fired about a fifth of the time. So the post workflow fires every half hour at off-peak minutes across the posting day. A dependency-free check ([due.mjs](../scripts/social/due.mjs)) ends most runs in seconds. Post *N* becomes due at slot *N* and stays due until it's done, so a dropped run just means the next one catches up.

**Exactly once** ([post.mjs](../scripts/social/post.mjs)):

- runs are serialised
- each day has one private record, and a post is claimed in it with a conditional write before anything goes to Instagram
- the media container id is saved before publishing, so a run that dies mid-publish is settled by the next one, which asks Instagram for the container's status
- only `ERROR` or `EXPIRED` count as "not posted"; a status that can't be read keeps the slot blocked rather than risk a repeat
- a shot that's posted or still in flight today or yesterday can't be picked again

**Missed days are loud.** A dropped schedule never fails on its own. The first run of the next day checks for yesterday's post and fails if there wasn't one, which makes GitHub email whoever last edited the cron line. It's one email per missed day.

**Staying enabled.** Public repositories lose their schedules after 60 days without a commit. After 45 quiet days the post workflow makes an empty commit, which keeps both this and the site build alive.

---

## Setup

### 1. The Instagram account

1. Switch it to a **professional** account (Creator or Business): Settings → Account type and tools.
2. Keep it public, and leave "Allow public photos and videos to appear in search engine results" on (Settings → Account privacy).

### 2. A Meta app (pick one)

**A. Instagram Login (simplest, no Facebook Page)**

1. At developers.facebook.com create an app and add the Instagram product's **API setup with Instagram login**.
2. Under App roles add the account as an **Instagram tester**, and accept the invite in Instagram (Settings → Website permissions → Apps and websites).
3. On the API setup page, generate a token with `instagram_business_basic` and `instagram_business_content_publish`. It's long-lived (60 days); the workflow refreshes it weekly from then on.
4. Leave the app in **Development** mode. App Review is only needed to serve other people's accounts.

This setup **cannot add a location or tag other accounts** (Meta: "This API setup cannot access ads or tagging").

**B. Facebook Login (adds location tags and tagged accounts)**

1. Link the Instagram account to a Facebook Page.
2. Create a Business-type app with Facebook Login for Business and the Instagram API.
3. Grant `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` and `pages_show_list`.
4. Use a token that doesn't expire: a Page token from a long-lived user token, or a system user token.
5. Set `IG_LOGIN_MODE=facebook` and add the account id as the `IG_USER_ID` secret.

### 3. Secrets and variables

Set these under Settings → Secrets and variables → Actions. Anything that identifies the account is a **secret**, because secrets are masked in logs and variables aren't.

| Name | Kind | Needed | What |
|---|---|---|---|
| `IG_ACCESS_TOKEN` | secret | yes | The token from step 2. Pasting a new one replaces the stored copy |
| `SOCIAL_SECRET_KEY` | secret | Instagram Login | 32 random bytes, `openssl rand -base64 32`. Seals the refreshed token at rest |
| `IG_USER_ID` | secret | Facebook Login | The Instagram professional account id |
| `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_DEPLOYMENT` | variables | one model option | Keyless Azure OpenAI (from the Infra workflow's outputs). Preferred |
| `SOCIAL_OPENAI_API_KEY` or `SOCIAL_ANTHROPIC_API_KEY` | secret | one model option | Vision model by key instead. Separate from the site build's keys on purpose |
| `SOCIAL_ENABLED` | variable | yes | `true` turns both workflows on |
| `SOCIAL_LIVE` | variable | to publish | `true` publishes; anything else is a dry run |
| `SOCIAL_MODEL` | variable | no | Model name for key-based providers (defaults: `gpt-6.1-sol` / `claude-sonnet-4-5`); Azure uses the deployment |
| `SOCIAL_OPENAI_BASE_URL` | variable | no | Another OpenAI-compatible endpoint, used with `SOCIAL_OPENAI_API_KEY` |
| `SOCIAL_INATURALIST_USER` | variable | no | Defaults to the login the hobby pages link to |
| `SOCIAL_TALL_IMAGES` | variable | no | `pad` (default) or `skip` |
| `SOCIAL_REQUIRE_APPROVAL` | variable | no | `true` posts only shots you've approved |
| `IG_LOGIN_MODE` | variable | no | `instagram` (default) or `facebook` |

The workflows reuse the site's OIDC login (`AZURE_*` secrets) to reach the private container. Nothing new is needed in Azure.

### 4. First run

1. Set `SOCIAL_ENABLED=true`, leaving `SOCIAL_LIVE` unset.
2. Run **Social catalog** by hand with `limit` = `800` to caption the whole archive (roughly 30–60 minutes).
3. Read the plan with `npm run social -- preview` (below), and skip anything you don't want.
4. Set `SOCIAL_LIVE=true`. The next due slot publishes.

---

## Day to day

From your machine, after `az login`, with `AZURE_STORAGE_ACCOUNT` set:

```bash
npm run social -- status                 # counts, and roughly when the archive runs out
npm run social -- preview                # .cache/social/preview.html: next week's posts with photos
npm run social -- skip DSC01234 [why]    # never post this shot
npm run social -- unskip DSC01234
npm run social -- redraft DSC01234       # rewrite its caption on the next catalog run
npm run social -- approve DSC01234       # approves this exact draft (SOCIAL_REQUIRE_APPROVAL=true)
npm run social -- retry DSC01234         # clear failed attempts (or --all)
```

The preview is a local file and never leaves your machine. To post right away, run **Social post** with `force` ticked.

Dry runs work without Azure or Instagram: `node scripts/social/catalog.mjs --local --provider mock` and `node scripts/social/post.mjs --local --force` use `src/content/sessions` and keep state in `.cache/social/state`.

## Optional private settings

`metadata/social/config.json` in the private container (upload it with Storage Explorer or `az storage blob upload`):

```json
{
  "linkLine": "More at example.com, link in bio",
  "hubHashtags": { "frogsofinstagram": "some_feature_hashtag" },
  "hubAccounts": { "birdsofinstagram": ["some_feature_account"] },
  "locations": { "session-slug": "123456789" }
}
```

- `hubHashtags` puts a feature account's hashtag in the genre slot for that kind of subject.
- `hubAccounts` (Facebook Login only) tags up to two feature accounts in the photo, which is how many curators find work.
- `locations` (Facebook Login only) maps a session to a location's Facebook Page id.

These stay private because they're strategy, not code.

## Cost

| Item | Cost |
|---|---|
| GitHub Actions | Free on public repositories |
| Vision model | One-time $1–15 for ~800 photos, then cents a month |
| Blob | Cents |
| Instagram API | Free |

## Troubleshooting

- **"No post was published yesterday."** Open the workflow's runs for that day. A failed publish shows its (redacted) reason. If there are no runs at all, GitHub dropped them. That's rare across 30+ attempts, but if it keeps happening, start the workflow on a reliable timer (an Azure Logic App calling `workflow_dispatch`).
- **Token errors.** Instagram Login tokens die after 60 days without a refresh, for example if the workflows were disabled. Generate a new one and paste it into `IG_ACCESS_TOKEN`.
- **A caption is wrong.** Run `npm run social -- skip <photo>`, or `npm run social -- redraft <photo>` to have it rewritten on the next catalog run. If the mistake came from the session's description, fix that in `/admin` first; the next site build passes it on.
