# Instagram posting: a few photos a day, automatically

> For the site owner setting this up (or setting it up again), and for anyone recreating the site with their own account. Nothing in this repository, its workflow logs or its docs says which Instagram account it posts to.

- [What it does](#what-it-does)
- [What runs automatically](#what-runs-automatically)
- [What stays private](#what-stays-private)
- [First-time setup](#first-time-setup) (step by step, with where each step happens)
- [Day to day](#day-to-day)
- [Setting it up again](#setting-it-up-again)
- [Settings](#settings)
- [How each post is made](#how-each-post-is-made)
- [Reliability and failures](#reliability-and-failures)
- [Troubleshooting](#troubleshooting)
- [Optional extras](#optional-extras)

---

## What it does

- Posts photographs from the site to one Instagram account: **3 a day** by default, at 08:30, 12:30 and 18:00 Pacific.
- **Never posts the same photograph twice**, even when it exists as several files (crops, re-exports, copies in two sessions), and never re-posts anything already on the account.
- Posts the **whole frame at Instagram's full resolution** (1440 px wide). It never crops. Frames too tall or too wide for Instagram get plain borders instead.
- **Writes each caption from the photo itself**: what's in the frame, where it is, the camera and lens, alt text, and five hashtags. For animals it uses **your own iNaturalist identification of that exact photo**.
- **Picks up new sessions on its own**, the night after they appear on the site.
- Runs entirely in **GitHub Actions**. Nothing has to run on your computer.

## What runs automatically

| When | Where | What happens |
|---|---|---|
| Every night, about 3 am Pacific | **Social catalog** workflow | Finds photos new to the site, fingerprints them, matches animals to your iNaturalist observations, writes their captions with the vision model, checks what's already on the Instagram account, and plans the next 7 days of posts |
| Every 30 minutes, about 7 am to midnight Pacific | **Social post** workflow | Checks whether one of today's posting slots is due. If it is, publishes the next planned photo. Most runs find nothing due and finish in seconds |
| Once a week | inside Social post | Renews the Instagram access token, so it never reaches its 60-day expiry |
| The morning after a day with no post | inside Social post | Fails one run on purpose, so GitHub emails you |
| After 45 days without a commit | inside Social post | Makes an empty commit. GitHub switches off scheduled workflows in public repositories after 60 days without one |

Two switches, both repository variables:

- `SOCIAL_ENABLED=true` lets both workflows run at all.
- `SOCIAL_LIVE=true` lets them actually publish. Without it everything happens (captions, planning, rendering the image) except the post itself. That's the **dry run**.

## What stays private

| Thing | Where it lives | Public? |
|---|---|---|
| Which account, and its access token | GitHub secrets, plus an encrypted copy in the private `metadata` storage container | No |
| Captions, the posting plan, posting history | `metadata/social/` in the private container | No |
| The images sent to Instagram | Uploaded to the private container, given to Instagram as a link that expires after two hours, deleted after posting | No |
| Workflow logs | Public, like every Actions log in a public repository | Yes, but they only contain counts and generic messages. Errors pass through [redact.mjs](../scripts/social/redact.mjs), which strips tokens, account and media ids, signed links and provider ids |
| This code and these docs | The repository | Yes, by design |

Someone reading the repository can tell the feature exists (the workflow runs are visible), but not which account it posts to. The same photographs are public on the site and on Instagram, so a reverse image search could still connect them. The repository just won't be what gives it away.

---

## First-time setup

About 30 minutes. Each step says **where** it happens: the Instagram app, the Meta developer site, or your terminal.

You'll need:

- the Instagram account you want to post to
- a Meta login for the developer site (step 2; it can be unrelated to the Instagram account)
- the GitHub CLI (`gh`), signed in with access to this repository. Anything done with `gh` here can also be done in the browser, under the repository's **Settings → Secrets and variables → Actions**.

Meta renames buttons and moves menus around fairly often. The names below are what the screens said in October 2026.

### Step 1. Make the Instagram account professional

**Where: the Instagram app on your phone, signed in as the account you'll post to.**

1. Profile → ☰ menu → **Settings and activity → Account type and tools → Switch to professional account → Creator**.
2. Keep the account public.
3. Under **Account privacy**, leave "Allow public photos and videos to appear in search engine results" turned on. Google can then index the posts.

The account stays an ordinary Instagram account. It doesn't need a Facebook account or a Facebook Page.

### Step 2. Sign in to Meta for Developers

**Where: https://developers.facebook.com, in a browser.**

Any Meta login works, and it **doesn't have to be related to the Instagram account**. The two only get linked privately, in steps 5 and 6.

- **Create new account** makes a Meta account from just an email address, with no Facebook account. Meta sends a code to verify it. This keeps the developer login completely separate from the Instagram account.
- **Continue with Facebook** also works if you'd rather use an existing Facebook account.

### Step 3. Create the app

**Where: developers.facebook.com → My Apps → Create app.**

1. Give it any name. It's never shown publicly.
2. Use case: tick **only** "Manage messaging & content on Instagram".
3. Business portfolio: choose **"I don't want to connect a business portfolio yet"**.
4. Finish creating it, and leave it **unpublished**. An unpublished (development mode) app can post to accounts you add as testers, without going through Meta's App Review.

### Step 4. Add the two permissions

**Where: in the app's left sidebar → Use cases → "Manage messaging & content on Instagram" → Customize → Permissions and features.**

Click **Add** next to:

- `instagram_business_basic`
- `instagram_business_content_publish`

Do this before step 6. A token only gets the permissions that were added when it was created.

Two things in the sidebar look relevant but aren't:

- **Testing** shows API test calls. It isn't where setup happens.
- **Facebook Login for Business** (Settings, Quickstart, Configurations…) is added to new apps automatically and belongs to the other kind of setup. Leave it alone.

### Step 5. Make the Instagram account a tester

1. **Where: in the app's left sidebar → App roles → Roles → Add People.**
   Choose **Instagram Tester**, enter the Instagram username, and click Add. It shows as *Pending*.
2. **Where: https://www.instagram.com/accounts/manage_access/, signed in as the Instagram account → Tester Invites tab.**
   Click **Accept**. The phone app has the same thing under Settings → Website permissions → Apps and websites → Tester invites, but the website is more reliable.

### Step 6. Generate the access token

**Where: in the app → Use cases → "Manage messaging & content on Instagram" → Customize → API setup with Instagram login.**

This page is on the developer site, not on Instagram.

1. Click the heading **"1. Generate access tokens"** to expand it. The steps on this page are fold-out sections, and the button is inside.
2. Click **Add account**. A popup asks you to log in to **Instagram**, as the account you'll post to.
3. Instagram shows a permissions screen. Allow only what posting needs:

   | Toggle | Set to |
   |---|---|
   | Allow access to messages | Off |
   | View profile and access media (required) | On (can't be changed) |
   | Access and manage comments | Off |
   | Access and manage messages | Off |
   | **Access and publish content** | **On** |
   | Access and manage insights | Off |

4. Click **Allow**. Back on the developer site, the account now appears in the list. Click **Generate token** next to it, and **copy the token straight away**. It's only shown once.

The other steps on that page (webhooks, business login setup, App Review) aren't needed.

### Step 7. Store the token and an encryption key

**Where: a terminal, in this repository.**

```bash
gh secret set IG_ACCESS_TOKEN                               # paste the token when it asks
openssl rand -base64 32 | gh secret set SOCIAL_SECRET_KEY   # a random key; you never need to see it
```

Paste the token only into that prompt, never into a file, chat or issue.

The token lasts 60 days. The post workflow renews it every week and keeps the renewed copy in private storage, encrypted with `SOCIAL_SECRET_KEY`.

### Step 8. Give it a model to write captions

The captions are written by the same Azure OpenAI deployment the site build uses for session descriptions, with no API key. The workflow signs in to Azure the same way the site build does, and that sign-in is the credential.

- **If that deployment exists** (the Infra workflow with `enableDescribeModel`; see [Turning it on](../README.md#turning-it-on) in the README), the repository variables `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_DEPLOYMENT` are already set. Check with `gh variable list`. There's nothing else to do.
- **Otherwise**, use an API key instead: `gh secret set SOCIAL_OPENAI_API_KEY` (or `SOCIAL_ANTHROPIC_API_KEY`).

### Step 9. Turn it on, still as a dry run, and caption the archive

**Where: a terminal.**

```bash
gh variable set SOCIAL_ENABLED --body true
gh workflow run social-catalog.yml -f limit=800   # captions the whole archive
```

The first catalog run takes roughly an hour for 800 photos. Watch it under the repository's **Actions → Social catalog**; the log only shows counts. From now on the nightly run handles new photos (60 a night by default).

The Social post workflow also starts running now, in dry-run mode. At each slot it picks and renders a photo, then stops short of publishing.

### Step 10. Read what it's going to post

**Where: your computer, signed in to Azure with `az login`.**

```bash
export AZURE_STORAGE_ACCOUNT=<storage account>   # the part of blobHost in site.config.ts before .blob.core.windows.net
npm run social -- status     # how many are ready, and roughly when the archive runs out
npm run social -- preview    # writes .cache/social/preview.html: the next week of posts, with photos
```

Open `.cache/social/preview.html` in a browser. It never leaves your machine. To keep a photo from ever being posted, run `npm run social -- skip DSC01234`.

### Step 11. Go live

```bash
gh variable set SOCIAL_LIVE --body true
```

The next due slot publishes. To post one immediately: **Actions → Social post → Run workflow**, tick **force**.

---

## Day to day

Nothing needs doing. New sessions are captioned overnight and join the plan.

When you want to steer it, these run on your computer (with `az login` and `AZURE_STORAGE_ACCOUNT` set, as in step 10):

| Command | What it does |
|---|---|
| `npm run social -- status` | Counts, and roughly when the archive runs out |
| `npm run social -- preview` | The next week of posts as a local web page |
| `npm run social -- skip DSC01234 [why]` | Never post this shot |
| `npm run social -- unskip DSC01234` | Undo a skip |
| `npm run social -- redraft DSC01234` | Rewrite its caption on the next catalog run |
| `npm run social -- approve DSC01234` | Approve this exact caption (only matters with `SOCIAL_REQUIRE_APPROVAL=true`) |
| `npm run social -- retry DSC01234` | Clear failed attempts so a photo can be tried again (`--all` for every photo) |

`DSC01234` can be any unique part of a filename, or a full `session/file` id.

To pause posting, set `SOCIAL_LIVE` to anything other than `true`. To stop everything, set `SOCIAL_ENABLED` to `false`.

## Setting it up again

For example after rebuilding the site, moving to a new repository or storage account, or the token expiring.

| Piece | Where it lives | If it's lost or expired |
|---|---|---|
| Meta app | developers.facebook.com | Keeps working on its own. Only recreate it (steps 2–6) if it was deleted |
| Access token | `IG_ACCESS_TOKEN` secret, plus the encrypted renewed copy in storage | Generate a new one (step 6) and set the secret again (step 7). A new secret always replaces the stored copy |
| Encryption key | `SOCIAL_SECRET_KEY` secret | Make a new one (step 7). The stored copy can't be read without the old key, so the next run starts again from `IG_ACCESS_TOKEN` |
| Captions, plan, history | `metadata/social/` in the site's storage account | The next catalog run rebuilds everything. Photos already on the account are recognised by their fingerprints and not posted again |
| Caption model | Azure OpenAI deployment, plus the two `AZURE_OPENAI_*` variables | Re-run the Infra workflow (step 8) |
| Switches and settings | Repository variables | Set `SOCIAL_ENABLED`, `SOCIAL_LIVE` and any [settings](#settings) again |

The token stops working if the workflows were switched off for more than about 60 days, or if the app was removed from the Instagram account. Either way, redo steps 6 and 7.

If you change to a different Instagram account, redo steps 1, 5, 6 and 7.

## Settings

Set these as **secrets** (masked in logs) or **variables** under Settings → Secrets and variables → Actions. Anything that identifies the account is a secret.

| Name | Kind | Default | What it does |
|---|---|---|---|
| `IG_ACCESS_TOKEN` | secret | (required) | The Instagram token from step 6 |
| `SOCIAL_SECRET_KEY` | secret | (required) | Encrypts the renewed token in storage (step 7) |
| `SOCIAL_ENABLED` | variable | off | `true` lets the workflows run |
| `SOCIAL_LIVE` | variable | off | `true` publishes; anything else is a dry run |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` | variables | set by Infra | Keyless caption model (step 8) |
| `SOCIAL_OPENAI_API_KEY` / `SOCIAL_ANTHROPIC_API_KEY` | secret | none | Caption model by API key instead. Kept separate from the site build's keys |
| `SOCIAL_MODEL` | variable | `gpt-6.1-sol` / `claude-sonnet-4-5` | Model name when using a key |
| `SOCIAL_OPENAI_BASE_URL` | variable | OpenAI | Another OpenAI-compatible endpoint, used with `SOCIAL_OPENAI_API_KEY` |
| `SOCIAL_POSTS_PER_DAY` | variable | `3` | 1 to 6 |
| `SOCIAL_SLOTS` | variable | `08:30,12:30,18:00` | Posting times, comma-separated |
| `SOCIAL_TIMEZONE` | variable | `America/Los_Angeles` | Time zone for the slots |
| `SOCIAL_MIN_GAP_MINUTES` | variable | `150` | Minimum time between two posts |
| `SOCIAL_DAY_END` | variable | `23:00` | No new posts after this time |
| `SOCIAL_TALL_IMAGES` | variable | `pad` | `skip` leaves out frames that would need borders |
| `SOCIAL_PAD_COLOR` | variable | `auto` | Border colour. `auto` picks black or white from the photo's edges |
| `SOCIAL_REQUIRE_APPROVAL` | variable | off | `true` posts only captions you've approved |
| `SOCIAL_INATURALIST_USER` | variable | the hobby pages' account | Which iNaturalist account to match against |
| `IG_LOGIN_MODE`, `IG_USER_ID` | variable, secret | `instagram` | Only for the [Facebook Login setup](#location-tags-and-tagging-accounts) |

---

## How each post is made

### 1. Choosing the photograph

"Never twice" works on **shots**, meaning presses of the shutter, rather than files. A shot is identified by the camera model and the capture time recorded in the photo. Files without a capture time fall back to a fingerprint of the image. When a shot exists as several files, the one that fits Instagram without borders is posted, then the largest. Your own crops are used exactly as you made them.

Each nightly run plans the next week. Each next post is the best-scoring shot that doesn't repeat something recent:

- the same session isn't posted twice within a day
- the same species isn't posted again within about five days
- frames from the same burst aren't posted again within about ten days
- the same location as the last post or two is penalised, so places rotate

The score is the model's 1–10 rating of how likely the frame is to stop someone scrolling, plus a bump for verified species and for sessions from the last 45 days.

Shots are skipped automatically when they're under 1080 px wide, out of focus, or an identifiable person is the subject.

### 2. The image

Instagram only accepts JPEGs between 4:5 (portrait) and 1.91:1 (landscape), at most 1440 px wide and 8 MB. Anything wider is shrunk on Instagram's side, so 1440 px is the most resolution a post can carry. [render.mjs](../scripts/social/render.mjs):

- starts from the untouched original and turns it the right way up from its EXIF data, as the site does
- sends it at 1440 px wide with high-quality resizing, and never enlarges it
- sends a frame inside Instagram's limits whole, with nothing added
- gives a frame outside them (mostly 2:3 portraits) **plain borders, never a crop**, black or white to match the photo's own edges
- writes sRGB, 4:4:4 colour, JPEG quality 95, with camera metadata removed

### 3. Animals: your iNaturalist observations

Every photo on your iNaturalist observations is fingerprinted once (a 128-bit image fingerprint). A site photo is treated as the photo on an observation when both of these hold:

- the fingerprints are within 14 bits of each other
- the observation date is within a day of the capture date

When a date is missing, the fingerprints must be within 6 bits instead.

Those numbers were measured on this archive. Different shots never came closer than 9 bits, and only same-day near-duplicates got that close. True copies sat within 16 bits, and 288 of 290 were observed within a day of capture. Matching by time alone fails here: some camera clocks were off by up to 18 hours, and busy survey nights produce false matches.

When there's no fingerprint match, observations made within five minutes of the capture are offered to the vision model with both photos. One is only used if the model is confident it's the same animal. Each session's camera-clock error is learned from its fingerprint matches first.

From the matched observation, [inat.mjs](../scripts/social/inat.mjs) takes:

- the common and scientific names
- the class, order and family
- iNaturalist's Wikipedia summary
- the global IUCN Red List status

A species name is only used when that observation is **research grade at species level or finer**. Anything else stays at group level ("a tree frog"), the same rule as the site's captions.

As a second check, every caption is compared with the full list of species you've recorded on iNaturalist. A caption that names one without a verified identification for that photo goes back to be rewritten. Identifications are re-checked every night, and a caption whose identification changed is rewritten.

Observation notes aren't used. On this account they're questions to identifiers ("Can someone help confirm this ID?"), not captions.

### 4. The vision model

Every photo, animal or not, is described by a vision model ([model.mjs](../scripts/social/model.mjs)). It receives:

- the photo, downscaled to 1280 px
- the session title, location and your own session description
- the camera, lens and capture month
- the iNaturalist facts, when there are any
- the site's voice rules from [site-copy.instructions.md](../.github/instructions/site-copy.instructions.md)

It returns:

- the kind of subject
- a few words on what it's doing
- the place
- a one-to-three-sentence description
- alt text
- a 1–10 appeal score
- a skip flag for blurred or people shots

Its rules: describe only what's visible, add at most one fact (and only from the supplied summary), and use place names only if the session title or location already contains them.

**Example, a mountain session.** In "Sunrise, Mount Rainier National Park, July 2026", one frame actually shows a foggy meadow and a creek. The model writes what's in the frame ("Fog over a subalpine meadow and a winding creek"), not what the session is named after. It names Mount Rainier only because the session text does, and borrows context from your own description. A draft that names a peak the session text doesn't mention is rejected and rewritten.

### 5. The caption

```
Boat-billed heron (Cochlearius cochlearius) peering out from behind a branch, Tortuguero, Limón Province, Costa Rica

Rain beading on the crown, a bill like an upturned boat, and eyes far too big for its head. Boatbills are nocturnal herons that live in mangrove swamps from Mexico south to Peru and Brazil.

Sony a6700 · E 70-350mm F4.5-6.3 G OSS at 350mm · f/6.3 · 1/50s · ISO 6400
The rest of this set is on example.com, link in bio

#boatbilledheron #birdsofinstagram #tortuguero #birdphotography #sonya6700
```

- **First line:** keywords first, because Instagram search and Google read it. Verified species get their scientific name too.
- **Body:** written by the model under the rules above.
- **Red List line:** added when the global IUCN status is Near Threatened or worse.
- **Gear line:** from the photo's EXIF data.
- **Link line:** captions can't hold clickable links, so it points to the link in the profile.
- **Alt text:** sent with every post. Instagram and Google both read it.

**Hashtags:** exactly five, because Instagram allows no more since December 2025. They're built from data by [hashtags.mjs](../scripts/social/hashtags.mjs), never made up by the model:

| Slot | Comes from | Example |
|---|---|---|
| Subject | Research-grade species, or a landmark named in the session | `#boatbilledheron` |
| Community | iNaturalist lineage, or the model's subject group | `#birdsofinstagram` |
| Place | A place word from the session title or location | `#tortuguero` |
| Genre | Lens and subject | `#birdphotography`, `#macrophotography` |
| Gear | Camera body | `#sonya6700` |

When there's no subject tag (most landscapes), the broad region takes the slot (`#costarica`, `#pnw`).

**Checks before a caption is saved:**

- **Fixed automatically:** em dashes, emoji, exclamation marks, and stray `#` or `@`.
- **Rejected and rewritten once:** marketing words, place names that aren't grounded in the session, and unverified species names.
- **Held back:** a caption that still fails is marked "needs review" and is never posted unprompted.

---

## Reliability and failures

**Posting times.** GitHub drops many scheduled runs; this repository's hourly site build fired about a fifth of the time. So Social post fires every 30 minutes at off-peak minutes, and [due.mjs](../scripts/social/due.mjs) decides whether a post is due. Post *N* becomes due at slot *N* and stays due until it's done, so a dropped run only means the next one catches up.

**Exactly once** ([post.mjs](../scripts/social/post.mjs)):

- runs never overlap
- each day has one private record, and a post is claimed in it before anything is sent to Instagram
- the Instagram "container" id is saved before publishing. If a run dies halfway, the next run asks Instagram what happened to it and finishes it
- only an Instagram status of ERROR or EXPIRED counts as "not posted". An unknown status keeps the slot blocked rather than risk posting twice
- a photo that's posted or still in progress today or yesterday can't be picked again

**Failures.**

- **A problem with the photo itself** (Instagram rejecting the image, or a missing or unreadable file) counts as a strike against that photo. Two strikes and it's left out until `npm run social -- retry`.
- **Anything else** (an expired token, a rate limit, an outage) never counts against a photo. Posting pauses for two hours and the run fails once that day, so you get one email rather than thirty.

**Missed days.** A dropped schedule never fails on its own. So the first run each morning checks for yesterday's post and fails if there wasn't one, which makes GitHub email whoever last edited the schedule. That's one email per missed day.

## Troubleshooting

**During setup**

- **No "Add account" button (step 6).** Click the "1. Generate access tokens" heading to expand it. Make sure the page is **API setup with Instagram login**, not "with Facebook login".
- **The account isn't offered.** Check that it's a professional account (step 1) and that the tester invite was accepted (step 5). Then wait a couple of minutes and refresh.
- **A guide says you need a Facebook Page.** That's only true for the other setup ([Facebook Login](#location-tags-and-tagging-accounts)), not this one.
- **You can't find the setup pages.** They're all under **Use cases → Customize**, not under "Testing" or "Facebook Login for Business".

**Once it's running**

- **An email says "No post was published yesterday".** Open that day's Social post runs. A failed post shows its (redacted) reason. If there are no runs at all, GitHub dropped them. That's rare across 30+ attempts a day, but if it keeps happening, trigger the workflow from a reliable timer (for example an Azure Logic App calling `workflow_dispatch`).
- **The run reports an invalid or expired token.** Redo steps 6 and 7.
- **Nothing is posting.**
  - Check that `SOCIAL_ENABLED` and `SOCIAL_LIVE` are both `true`.
  - Run `npm run social -- status` and check "Ready to post".
  - Look for photos "left out after failing twice" in the same output.
- **A caption is wrong.** Run `npm run social -- skip` or `npm run social -- redraft`. If the mistake came from the session's description, fix that in `/admin` first; the next site build passes it on.

## Optional extras

### Location tags and tagging accounts

The setup above ("Instagram Login") can't add a location to a post or tag other accounts in the photo. Meta's own docs say this setup "cannot access ads or tagging." Both are available through the **Facebook Login** setup instead:

1. Link the Instagram account to a Facebook Page.
2. Create a Business-type app with Facebook Login for Business and the Instagram API.
3. Grant `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` and `pages_show_list`.
4. Use a token that doesn't expire: a Page token, or a system user token.
5. Set `IG_LOGIN_MODE=facebook` and add the account id as the `IG_USER_ID` secret.

The code supports both setups.

### Private settings file

`metadata/social/config.json` in the private container (upload it with Storage Explorer or `az storage blob upload`):

```json
{
  "linkLine": "More at example.com, link in bio",
  "hubHashtags": { "frogsofinstagram": "some_feature_hashtag" },
  "hubAccounts": { "birdsofinstagram": ["some_feature_account"] },
  "locations": { "session-slug": "123456789" }
}
```

- `linkLine` replaces the caption's last line before the hashtags.
- `hubHashtags` puts a feature account's hashtag in the genre slot for that kind of subject.
- `hubAccounts` tags up to two feature accounts in the photo, which is how many curators find work. Facebook Login only.
- `locations` maps a session to a location's Facebook Page id. Facebook Login only.

These live in private storage because they're strategy, not code.

### Trying it without Azure or Instagram

Both scripts can run locally against the sessions prebuild already downloaded, keeping state in `.cache/social/state`:

```bash
node scripts/social/catalog.mjs --local --provider mock   # mock captions, no model
node scripts/social/post.mjs --local --force              # renders the next post to a local file
```

## Cost

| Item | Cost |
|---|---|
| GitHub Actions | Free on public repositories |
| Caption model | About $1–15 once for the whole archive, then cents a month |
| Storage | Cents |
| Instagram API | Free |
