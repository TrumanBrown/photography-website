# Instagram posting: a few photos a day, automatically

> For the site owner setting this up (or setting it up again), and for anyone recreating the site with their own account. Nothing in this repository, its workflow logs or its docs says which Instagram account it posts to.

- [What it does](#what-it-does)
- [What runs automatically](#what-runs-automatically)
- [New sessions](#new-sessions)
- [What stays private](#what-stays-private)
- [First-time setup](#first-time-setup) (step by step, with where each step happens)
- [Day to day](#day-to-day)
- [Setting it up again](#setting-it-up-again)
- [Settings](#settings)
- [How each post is made](#how-each-post-is-made)
- [Stories](#stories)
- [Reliability and failures](#reliability-and-failures)
- [Troubleshooting](#troubleshooting)
- [Optional extras](#optional-extras)

---

## What it does

- Posts photographs from the site to one Instagram account: **3 a day** by default, at 08:30, 12:30 and 18:00 Pacific.
- **Never posts the same photograph twice**, even when it exists as several files (crops, re-exports, copies in two sessions), and never re-posts anything already on the account.
- Posts each photo at **Instagram's full resolution** (1440 px wide). Frames that fit Instagram's shape go out whole. Frames too tall or too wide for it (mostly 2:3 portraits) are **cropped to fit**, from the middle unless one end is empty sky, water or blur ([The image](#2-the-image)).
- **Writes each caption from the photo's record**: the same one-time analysis that writes the website's captions ([docs/photos.md](photos.md)). Each post gets what the photo is of and what it's doing, where it is, **one true fact about the species or the place** taken from Wikipedia, the camera and lens, alt text, and five hashtags. For animals and plants it uses **your own iNaturalist identification of that exact photo**.
- **Mixes the feed**: one post in every three is a landscape or place, the rest wildlife.
- Posts **one story a day**, at a different time each day: a photo from the archive, vertical ones first, with nothing added ([Stories](#stories)).
- **Picks up new sessions on its own**, the night after they appear on the site.
- Runs entirely in **GitHub Actions**. Nothing has to run on your computer.

## What runs automatically

| When | Where | What happens |
|---|---|---|
| Every 30 minutes from 7 am to 10:30 pm Pacific, and at 3 am | **The timer**, a Logic App in your Azure resource group ([infra/modules/scheduler.bicep](../infra/modules/scheduler.bicep)) | Starts Social post on GitHub at :02 and :32, and Photo captions at 3:02 am. GitHub's own scheduler is best effort: on this repository an hourly schedule ran about once every five hours, and the new half-hourly one didn't run at all for its first hours, so the timer is what keeps posts on time. The schedules inside the workflow files stay as a backup |
| Once a day (the timer), twice a day (GitHub's schedule, when it runs), and after new photos appear | **Photo captions** workflow ([docs/photos.md](photos.md)) | Analyses photos new to the site once, for the website and Instagram alike. With `SOCIAL_ENABLED=true` it also checks what's already on the Instagram account, plans the next two weeks of posts and writes them, so posting carries on for two weeks even if nothing starts this workflow |
| Each time the timer starts it | **Social post** workflow | Checks whether one of today's posting slots is due. If it is, publishes the next planned photo. Then the same for the day's story, when stories are on. Most runs find nothing due and finish in seconds |
| Once a week | inside Social post | Renews the Instagram access token, so it never reaches its 60-day expiry |
| The morning after a day with no post | inside Social post | Fails one run on purpose, so GitHub emails you |
| After 45 days without a commit | inside Social post | Makes an empty commit. GitHub switches off scheduled workflows in public repositories after 60 days without one |

Two switches, both repository variables:

- `SOCIAL_ENABLED=true` turns on the Instagram stage of Photo captions, and the Social post workflow.
- `SOCIAL_LIVE=true` lets them actually publish. Without it everything happens except the post itself. That's the **dry run**: at each slot it picks the photo, renders it, and hands the image and caption to Instagram exactly as a real post would, which proves the token works, the account can publish and Instagram accepts the post. Then it stops. Instagram throws an unpublished post away by itself within a day, and nobody sees it.

## New sessions

Nothing needs doing when you add photos. After `./scripts/upload-session.sh <folder> --build`:

1. **Build and Deploy** publishes the photos, notices ones the pipeline hasn't seen, and starts **Photo captions**.
2. **Photo captions** analyses the new photos, matches them to your iNaturalist observations, writes their website captions and the session description, redeploys the site, and adds them to the Instagram plan.
3. They're posted as their turn comes. Sessions photographed in the last 45 days get a small head start; the plan never posts one session twice in a day, the same species or landmark within about five days, or frames from the same burst within about ten.

Adding iNaturalist observations later is fine: the next Photo captions run matches them, whether the observation uses the same photo or another one from the same moment, and the website captions and any post not yet published pick up the species. iPhone HEIC photos are matched by the capture time in their originals.

## What stays private

| Thing | Where it lives | Public? |
|---|---|---|
| Which account, and its access token | GitHub secrets, plus an encrypted copy in the private `metadata` storage container | No |
| Each photo's record (what's in it, its identification, its written post) | `metadata/photos/` in the private container | No |
| The facts posts draw on, and which Wikipedia article each came from | `metadata/photos/facts.json` in the private container | No |
| The posting plan, posting history, story history, your trip notes | `metadata/social/` in the private container | No |
| The images sent to Instagram | Uploaded to the private container, given to Instagram as a link that expires after two hours, deleted after posting | No |
| Workflow logs | Public, like every Actions log in a public repository | Yes, but they only contain counts and generic messages. Errors pass through [redact.mjs](../scripts/photos/redact.mjs), which strips tokens, account and media ids, signed links and provider ids |
| This code and these docs | The repository | Yes, by design |
| The link to the account on the live site | The site's footer and the home page's structured data, built from the `INSTAGRAM_URL` secret | Yes, on the site only. The repository and its logs never contain it |

Someone reading the repository can tell the feature exists (the workflow runs are visible), but not which account it posts to. The live site does link to the account, so a visitor who follows the README to the site can find it. That's on purpose, because the posts are there to send people to the site and the link sends them back. The same photographs are public on the site and on Instagram, so a reverse image search could connect them too. The repository just won't be what gives it away.

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

### Step 8. Make sure the photo pipeline is running

Posts are written from the same records as the website's captions, by the **Photo captions** workflow. If the site already has captions, this is done.

- Check with `gh variable list` that `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_DEPLOYMENT` are set (the keyless model), or `PHOTOS_ENABLED` with an API key.
- Otherwise, follow [Setting it up](photos.md#setting-it-up) in docs/photos.md first.

### Step 9. Start the timer

**Where: GitHub, the Azure portal or CLI, then the Actions tab.**

The timer starts the posting workflow on time ([why it's needed](#what-runs-automatically)). It uses the same GitHub token as the admin panel's **Rebuild Site** button: a fine-grained token with **Actions: Read and write** on this repository and nothing else.

1. If the Rebuild button works, that token already exists. Otherwise create one at **GitHub → Settings → Developer settings → Fine-grained tokens**: repository access *Only select repositories* (this one), permission **Actions: Read and write**. Save it as the `GITHUB_TOKEN` setting of the Static Web App ([docs/admin.md](admin.md)).
2. Make sure `enableSocialScheduler` is `true` in [infra/main.parameters.json](../infra/main.parameters.json), then run **Actions → Infra (Bicep) → Run workflow**. That deploys a Logic App named `logic-photography-<environment>-scheduler`, which reads the token from the Static Web App while it's being deployed.

A new timer runs once straight away, so a **Social post** run appears in the Actions tab within a minute or two. The token is never in the repository, the deployment's outputs or the timer's run history. When you replace it, run the Infra workflow again so the timer picks up the new one. Without a token the timer is deployed switched off.

### Step 10. Turn it on, still as a dry run

**Where: a terminal.**

```bash
gh variable set SOCIAL_ENABLED --body true
gh workflow run photos.yml   # plans the next two weeks and writes those posts
```

The photos are already analysed, so this run only checks the account, plans the next two weeks and writes those posts: a couple of minutes. Watch it under **Actions → Photo captions**; the log only shows counts. From now on it keeps two weeks of posts written ahead.

From now on each Social post run the timer starts is a dry run: at each slot it rehearses a post with Instagram, then stops short of publishing. To see a rehearsal straight away, run it by hand: **Actions → Social post → Run workflow** (leave **force** unticked). If a slot has passed today, the log ends with "Instagram accepted the image and caption, and the account can publish".

### Step 11. Read what it's going to post

**Where: your computer, signed in to Azure with `az login`.**

```bash
npm run social -- status     # how many are ready, and roughly when the archive runs out
npm run social -- preview    # opens the next week of posts in your browser
```

The preview shows each post in the order it'll go out, with its full caption and alt text, and the photo in the frame Instagram will use (cropped where it doesn't fit, the way it'll be posted). The page is written to `.cache/social/preview.html` and never leaves your machine. The storage account is read from `blobHost` in `site.config.ts`; set `AZURE_STORAGE_ACCOUNT` only if yours is different.

To keep a photo from ever being posted, run `npm run social -- skip DSC01234`.

### Step 12. Go live

```bash
gh variable set SOCIAL_LIVE --body true
```

The next run publishes once a slot has passed. Switching on part-way through a day picks up from there: at 7:45 pm, say, the first post goes out at the next run and a second one 2½ hours later if that's still before 11 pm. To start with a full day instead, switch it on after 11 pm. To post one immediately: **Actions → Social post → Run workflow**, tick **force**.

---

## Day to day

Nothing needs doing. New sessions are analysed soon after they go live and join the plan.

When you want to steer it, these run on your computer (signed in with `az login`, as in step 11):

| Command | What it does |
|---|---|
| `npm run social -- status` | Counts, roughly when the archive runs out, and how many photos are left for stories |
| `npm run social -- preview` | Opens the next story and the next week of posts in your browser (`--no-open` just writes the page) |
| `npm run social -- skip DSC01234 [why]` | Never post this shot, as a post or a story |
| `npm run social -- unskip DSC01234` | Undo a skip |
| `npm run social -- redraft DSC01234` | On the next Photo captions run, write the photo a new opening and first line (its website caption changes too) and give its post a different fact |
| `npm run social -- opening DSC01234 "your words"` | Use your own words for the start of a planned post, exactly as written (end with an emoji, or the animal's is added). `--clear` goes back to a written one |
| `npm run social -- note <trip> "canal boat tour"` | Tell the openings what you were doing on that trip (or, with a photo instead of a trip, at that photo). They only mention things like a hike, a drive or a boat tour when a note or the trip's name says so. `--clear` removes it |
| `npm run social -- notes` | Every trip with its note and how many photos it has left to post |
| `npm run social -- approve DSC01234` | Approve this exact caption (only matters with `SOCIAL_REQUIRE_APPROVAL=true`) |
| `npm run social -- retry DSC01234` | Clear failed attempts so a photo can be tried again (`--all` for every photo) |

`DSC01234` can be any unique part of a filename, or a full `session/file` id.

To pause posting, set `SOCIAL_LIVE` to anything other than `true`. To stop stories only, set `SOCIAL_STORIES` to anything other than `true`. To stop everything, set `SOCIAL_ENABLED` to `false`.

## Setting it up again

For example after rebuilding the site, moving to a new repository or storage account, or the token expiring.

| Piece | Where it lives | If it's lost or expired |
|---|---|---|
| Meta app | developers.facebook.com | Keeps working on its own. Only recreate it (steps 2–6) if it was deleted |
| Access token | `IG_ACCESS_TOKEN` secret, plus the encrypted renewed copy in storage | Generate a new one (step 6) and set the secret again (step 7). A new secret always replaces the stored copy |
| Encryption key | `SOCIAL_SECRET_KEY` secret | Make a new one (step 7). The stored copy can't be read without the old key, so the next run starts again from `IG_ACCESS_TOKEN` |
| Photo records | `metadata/photos/` in the site's storage account | The next Photo captions run analyses everything again ([docs/photos.md](photos.md)) |
| Plan, history | `metadata/social/` in the site's storage account | The next Photo captions run plans again. Photos already on the account are recognised by their fingerprints and not posted again |
| Model | Azure OpenAI deployment, plus the two `AZURE_OPENAI_*` variables | Re-run the Infra workflow ([docs/photos.md](photos.md#setting-it-up)) |
| Timer | Logic App in the site's resource group, reading the Static Web App's `GITHUB_TOKEN` | Run the Infra workflow (step 9). Run it again after replacing `GITHUB_TOKEN` |
| Switches and settings | Repository variables | Set `SOCIAL_ENABLED`, `SOCIAL_LIVE` and any [settings](#settings) again |

The token stops working if the workflows were switched off for more than about 60 days, or if the app was removed from the Instagram account. Either way, redo steps 6 and 7.

If you change to a different Instagram account, redo steps 1, 5, 6 and 7.

## Settings

Set these as **secrets** (masked in logs) or **variables** under Settings → Secrets and variables → Actions. Anything that identifies the account is a secret. The model and the iNaturalist account are shared with the website captions: see [docs/photos.md](photos.md#settings).

| Name | Kind | Default | What it does |
|---|---|---|---|
| `IG_ACCESS_TOKEN` | secret | (required) | The Instagram token from step 6 |
| `SOCIAL_SECRET_KEY` | secret | (required) | Encrypts the renewed token in storage (step 7) |
| `SOCIAL_ENABLED` | variable | off | `true` turns on the Instagram stage and the Social post workflow |
| `SOCIAL_LIVE` | variable | off | `true` publishes; anything else is a dry run |
| `SOCIAL_POSTS_PER_DAY` | variable | `3` | 1 to 6 |
| `SOCIAL_LANDSCAPE_EVERY` | variable | `3` | One post in every this many is a landscape or place, while any are left. `0` lets the score alone decide, which puts identified wildlife first |
| `SOCIAL_SLOTS` | variable | `08:30,12:30,18:00` | Posting times, comma-separated |
| `SOCIAL_TIMEZONE` | variable | `America/Los_Angeles` | Time zone for the slots |
| `SOCIAL_MIN_GAP_MINUTES` | variable | `150` | Minimum time between two posts |
| `SOCIAL_DAY_END` | variable | `23:00` | No new posts after this time |
| `SOCIAL_TALL_IMAGES` | variable | `crop` | Frames taller than 4:5 or wider than 1.91:1. `crop` trims them to fit, `pad` posts them whole with plain borders, `skip` leaves them out |
| `SOCIAL_PAD_COLOR` | variable | `auto` | Border colour with `SOCIAL_TALL_IMAGES=pad`. `auto` picks black or white from the photo's edges |
| `SOCIAL_REQUIRE_APPROVAL` | variable | off | `true` posts only captions you've approved |
| `SOCIAL_STORIES` | variable | off | `true` posts one story a day (only while `SOCIAL_LIVE` is `true`); `rehearse` does everything but publish |
| `SOCIAL_STORY_WINDOW` | variable | `10:00-21:00` | The day's story goes out at a time picked within this window, different each day |
| `IG_LOGIN_MODE`, `IG_USER_ID` | variable, secret | `instagram` | Only for the [Facebook Login setup](#location-tags-and-tagging-accounts) |
| `INSTAGRAM_URL` | secret | none | The account's profile address (`https://www.instagram.com/<handle>/`). Build and Deploy reads it to add an Instagram link to the site's footer and the home page's structured data ([instagram.ts](../src/lib/instagram.ts)). Anything else is ignored. Without it the site doesn't link the account |

The timer's own settings are parameters of [scheduler.bicep](../infra/modules/scheduler.bicep): `timeZone` (a Windows time zone name, `Pacific Standard Time` by default; keep it the same as `SOCIAL_TIMEZONE`), `postingHours` (7 to 22, which covers the default slots, the story window and the 11 pm cutoff) and `pipelineHour` (3). Change them there and run the Infra workflow.

---

## How each post is made

### 1. Choosing the photograph

"Never twice" works on **shots**, meaning presses of the shutter, rather than files. A shot is identified by the camera model and the capture time recorded in the photo. Files without a capture time fall back to a fingerprint of the image. When a shot exists as several files, the one that fits Instagram without cropping is posted, then the largest. A crop of your own that fits Instagram's shape is posted exactly as you made it.

Each Photo captions run plans the next two weeks. Each next post is the best-scoring shot that doesn't repeat something recent:

- the same session isn't posted twice within a day
- the same species, or for a landscape the same landmark (or the same outing when there's no landmark), isn't posted again within about five days
- frames from the same burst aren't posted again within about ten days
- the same location as the last post or two is penalised, so places rotate

The score is the analysis's 1–10 rating of how likely the frame is to stop someone scrolling, plus a bump for photos identified to species and for sessions from the last 45 days.

On score alone, identified wildlife would fill the feed for months before a landscape came up. So **one post in every three is the best landscape or place left** (mountains, forests, waterfalls, rivers, lakes, coasts, glaciers, cities, temples), which at three a day is one a day. `SOCIAL_LANDSCAPE_EVERY` changes the ratio, and `0` turns it off.

Shots are skipped automatically when they're under 1080 px wide, out of focus, an identifiable person is the subject, or the photo plainly isn't what its iNaturalist identification says.

### 2. The image

Instagram only accepts JPEGs between 4:5 (portrait) and 1.91:1 (landscape), at most 1440 px wide and 8 MB. Anything wider is shrunk on Instagram's side, so 1440 px is the most resolution a post can carry. [render.mjs](../scripts/social/render.mjs):

- starts from the untouched original and turns it the right way up from its EXIF data, as the site does
- sends it at 1440 px wide with high-quality resizing, and never enlarges it
- sends a frame inside Instagram's limits whole, with nothing added
- **crops a frame outside them** to the nearest shape Instagram takes. A 2:3 portrait loses a sixth of its height, a 3:4 phone photo a sixteenth. The crop comes from the middle unless one end of the frame is empty (plain sky, still water, out-of-focus background) and the other isn't. Then it comes off the empty end, stopping a little short of whatever's there. A busy end doesn't pull the crop toward it, so a heron near the top isn't cut off to keep the twigs at the bottom
- writes sRGB, 4:4:4 colour, JPEG quality 95, with camera metadata removed

Where each crop sits is worked out once, when the photo is first planned, and kept in the catalog along with the cropped frame's fingerprint. The preview shows the same crop the post will get. If a crop doesn't work for a photo, `npm run social -- skip DSC01234` keeps it off Instagram.

Borders that follow each viewer's light or dark mode aren't possible: a border is part of the JPEG, and Instagram has no transparency, so it's black or white for everyone. `SOCIAL_TALL_IMAGES=pad` still posts these frames whole with plain borders (black or white, matched to the photo's edges), and `skip` leaves them out.

### 3. What's in the photo, and what it is

Both come from the photo's record, made once for the website and Instagram alike ([docs/photos.md](photos.md)):

- **What it is** comes from your iNaturalist observation of that photo, matched by image fingerprint or by time, and used at whatever rank it has. The model never identifies anything. See [Identifications come from iNaturalist](photos.md#identifications-come-from-inaturalist).
- **What's in the frame** comes from the one look a vision model took at the photo: subject, what it's doing, the light, the setting, a plain description. See [The one look at each photo](photos.md#the-one-look-at-each-photo), including how a mountain photo is handled.

From the identified taxon, [inat.mjs](../scripts/photos/inat.mjs) also keeps the class, order and family, iNaturalist's Wikipedia summary, and the global IUCN Red List status.

### 4. The fact

Each post carries one fact, so it reads like something a person who knows the animal or the place would tell you, rather than a description of the picture. Facts are written once per species or place, kept privately in `facts.json`, and shared by every post of that species or place, so writing a post needs no model call at all.

Where a fact comes from, most specific first ([wiki.mjs](../scripts/photos/wiki.mjs)):

1. **The species' own Wikipedia article**, through the link iNaturalist keeps for the taxon. Taxa are never looked up by name, because names collide ("Zelus" is a Greek god as well as an assassin bug genus).
2. **Its genus's article, then its family's**, when the species has none or it has nothing worth saying. These have to mention the family or order, and their facts have to be true of the whole group ("Like other cuckoos, they ..."), never something only some of them do, and never where they live.
3. **The place**, for a landscape or a species with nothing usable: the landmark in the photo ("Mount Baker"), or else the session's place, preferring the national park over the town that shares its name. The article has to mention the wider place (the province, state or country), so a band named after a village doesn't count.

[facts.mjs](../scripts/photos/facts.mjs) asks a model, text only, for up to four facts from the article, most surprising first, in plain sentences the way a guide would say them on a walk. Fewer when the article only has one or two good ones. Each fact is then checked against the article before it's kept:

- the sentence it came from has to be in the article, and so does every number in it
- no first person: the photographer didn't write these
- no teaser opening ("Poison comes from dinner."), no closing clause that says it again ("..., that's how they hunt"), no "like this one"
- no species the article doesn't mention, and none of the words the voice rules ban
- for a genus or family: nothing only some of them do, nothing about their range

A species posted more than once rotates through its facts, least used first. Species that share a genus or family article share its facts, so two katydids don't say the same thing in the same week. A lookup that finds nothing is tried again after 30 days; until then the post falls back to its place, and if that has nothing either, it goes out without a fact. To rewrite every stored fact (after changing the prompt, say), bump `FACTS_VERSION` in facts.mjs.

Wikipedia is read through its public API, one request at a time, with a user agent naming the site, as Wikimedia's API etiquette asks.

### 5. The caption

```
Saw this groove-billed ani (Crotophaga sulcirostris) munching on some insect in Bijagua. Such a unique bird, the beak goes so far up its head, almost looks like a horn lol 🦏
Bijagua, Alajuela Province, Costa Rica.

Fun fact: Groove-billed anis lay their eggs in one communal nest, and all group members incubate the eggs and care for the young.

Sony a6700 · E 70-350mm F4.5-6.3 G OSS at 350mm · f/6.3 · 1/500s · ISO 320
Full resolution and the rest of this session are on example.com, link in bio

#groovebilledani #birdsofinstagram #bijagua #birdphotography #sonya6700
```

- **Opening**, in your voice: how you came across it, the name with its scientific name, what it's doing, and your reaction, the way you'd tell a friend. Two or three sentences. See below.
- **One emoji** at the end of the opening, in place of its last full stop.
- **Place**, in full, on its own line: places only (no habitat words like "shrub-steppe"), and Washington as "Washington state, USA", the way you wrote it.
- **Fact:** one of the species' or place's facts, as above, after `Fun fact: `.
- **Red List line:** added when the global IUCN status is Near Threatened or worse.
- **Gear line:** from the photo's EXIF data.
- **Link line:** captions can't hold clickable links, so it sends people to the link in your profile, for the full-resolution photo and the rest of the session. Put the site's address in your bio for it to work. Change the wording with `linkLine` in the [private settings file](#private-settings-file); posts already written are updated with it on the next run.
- **Alt text:** the record's plain description of the frame, sent with every post. Instagram and Google both read it.

**The voice.** People scroll past posts that read as AI-written, so the opening is written in your voice, from your own rewrites of posts that didn't sound like you. How you write is in the [truman-voice skill](../.github/skills/truman-voice/SKILL.md); the post format, the generator's rules and your rewrites are in the [caption-voice skill](../.github/skills/caption-voice/SKILL.md), with the [humanizer](../.github/skills/humanizer/SKILL.md) skill (blader/humanizer, MIT) for anything they don't settle. [voice.mjs](../scripts/photos/voice.mjs) puts both into one text-only call per ten planned posts, in the order they'll go out, and asks for three versions of each opening with an emoji. An identified species is written as `{name}`, and code fills in the verified name. An opening is kept only if it:

- has `{name}` exactly once for an identified species, where the animal first comes up (not tacked on after a comma), and no other species name; code fixes the words in front of it ("these two otters", "an agami heron")
- has an opinion in it (a reaction, a comparison, a joke), not just a description of the photo, and never mentions the background, blur or framing
- says nothing about what you were doing, who you were with, the weather or the time of day unless the trip's name, the photo's record or your trip notes back it up: "on a canal tour" needs a trip named for the canals or a note saying so, and waiting, "finally" or company need your notes
- has no numbers, no "today" or "last week", no questions (a hedging "(?)" is fine), no stock phrases ("nature never disappoints"), no forced-casual stand-ins for "I love" ("I dig", "I'm a fan of", "got a kick out of") and none of the words the voice rules ban
- doesn't repeat its fun fact, and copies no phrase from your rewrites or another post
- doesn't start with the same words as any of the four posts before it, and spreads your habits out: "lol" on one post in four at most (it's dropped rather than the post), "such a" never on two posts in a row (and opening a sentence on one post in four), "I love", "I like", "my favorite", "little", "pretty" and "almost" only every few posts

The emoji has to be one emoji showing the animal or the scene (🐊 ⛰️ 🐦 🚗), never a face, heart or hand, and not ✨, 🌿, 🔥, 📸 or the like; otherwise the opening's other suggestions or the animal's own emoji take its place. It differs from the post before when there's a choice.

The generator also mustn't try to be clever: no quips about an animal's posture, attitude or plans ("better posture than me", "supervising the whole slope"), and "looks like he's..." or "I'd..." only every few posts.

A post whose options all fail (usually because it's too close to a post next to it) gets one more try in the same run, on its own so the model sees the posts right before it, and is tried again on the next two runs. Until it has an opening it isn't posted: it never goes out with a plain fallback. The poster also refuses a post built the old way (an older `POST_VERSION` in [compose.mjs](../scripts/social/compose.mjs)), so changing the format never lets an old-style post slip out before the next run rewrites it.

**Your notes.** The best openings say what you were doing ("Pulled over on the side of the road to capture this canyon view"), and only you know that. `npm run social -- note <trip> "..."` stores a line about a trip, privately in `metadata/social/notes.json`; the openings and the trip's session description on the website draw on it but never post it as is, and both are rewritten with it on the next run. `npm run social -- notes` lists every trip and how many photos it has left to post, so you can start with the big ones.

To change how posts sound, edit the skills; to rewrite the posts already planned, bump `VOICE_VERSION` in voice.mjs. To redo one post, `npm run social -- redraft <photo>` gives it a new opening and fact. To write one yourself, `npm run social -- opening <photo> "..."`: your words go in as they are, and the rest of the post (place, fact, gear, link, hashtags) is built around them.

A post is only written once its photo is planned for the coming two weeks, so rewording any part never means rewriting the whole archive. A written post keeps its fact while that fact still exists.

Published posts can't be changed from here: Instagram's API can only turn comments on or off, or delete a post. Edit a published caption in the Instagram app.

**Hashtags:** exactly five, because Instagram allows no more since December 2025. They're built from data by [hashtags.mjs](../scripts/social/hashtags.mjs), never made up by the model:

| Slot | Comes from | Example |
|---|---|---|
| Subject | The species identified on iNaturalist, or a landmark named in the session | `#redeyedtreefrog` |
| Community | iNaturalist lineage, or the model's subject group | `#frogsofinstagram` |
| Place | A place word from the session title or location | `#tapirvalley` |
| Genre | Lens and subject | `#birdphotography`, `#macrophotography` |
| Gear | Camera body | `#sonya6700` |

When there's no subject tag (most landscapes), the broad region takes the slot (`#costarica`, `#pnw`).

**Checks before a caption is saved:**

- **Fixed automatically:** em dashes, exclamation marks, stray `#` or `@`, and any emoji inside the text (the one at the end is added by code).
- **Already checked on the way in:** the opening and the fact each pass their own checks before they're stored (banned words, names nobody wrote down, species the photo isn't identified as, facts that can't be traced to their article).
- **Held back:** a caption that still fails the copy checks is marked "needs review" and is never posted unprompted.

---

## Stories

With `SOCIAL_STORIES=true` (and `SOCIAL_LIVE=true`), the Social post workflow also posts **one story a day** ([story.mjs](../scripts/social/story.mjs)).

**When.** At a time picked within `SOCIAL_STORY_WINDOW` (10:00 to 21:00 Pacific by default), different each day, so stories don't appear like clockwork. It goes out on the first timer run after that time; a missed run only delays it, until the day ends at 11 pm.

**Which photo.**

- **Vertical photos first**, while any are left, so the 9:16 frame needs as little fill as possible. Among similar ratings, the shape closest to 9:16 wins. Other shapes only once the vertical ones run out (`npm run social -- status` says how many are left).
- **Never twice**: never a photo already used for a story, one planned for the feed in the next two weeks, or one the feed posted in the last month.
- **Never one the photo checks leave out** (blurry, an identifiable person, under 1080 px, an identification that doesn't match) or one you skipped.
- **Outings rotate**: not the same outing as either of the last two stories, nor a frame from the same burst as one of the last ten.

**What it looks like.** The photo alone, whole and never cropped, in a 1080×1920 frame. Where it isn't 9:16, a blurred, dimmed copy of the same photo fills the rest: about 150 px above and below a 2:3 vertical. No text, stickers or music. Instagram's API can't add a location, a link, a poll or music to a story anyway; those only exist in the app. Camera data and location are stripped, as for posts.

**Switches.** `SOCIAL_STORIES=rehearse` does everything except publish: it picks the photo, renders it and hands it to Instagram as a story, then stops, once a day. Any other value turns stories off. To post today's story now instead of at its time, run **Actions → Social post → Run workflow** with **story** ticked; it never posts a second story the same day.

**Reliability.** Exactly-once and failures work as for posts (below), with their own day records (`metadata/social/story-days/`) and history (`metadata/social/stories.json`). A photo Instagram rejects gets one more try another day; another photo takes its place that day. `npm run social -- retry` clears story strikes too.

---

## Reliability and failures

**Posting times.** GitHub drops many scheduled runs; this repository's hourly site build fired about a fifth of the time. So the [timer](#step-9-start-the-timer) starts Social post every 30 minutes through the posting day, GitHub's schedule adds more starts when it runs, and [due.mjs](../scripts/social/due.mjs) decides whether a post is due. Post *N* becomes due at slot *N* and stays due until it's done, so a missed start only means the next one catches up. Starts that overlap wait for each other, and the day record makes sure a slot is only ever posted once.

**Exactly once** ([post.mjs](../scripts/social/post.mjs)):

- runs never overlap
- each day has one private record, and a post is claimed in it before anything is sent to Instagram
- the Instagram "container" id is saved before publishing. If a run dies halfway, the next run asks Instagram what happened to it and finishes it
- only an Instagram status of ERROR or EXPIRED counts as "not posted". An unknown status keeps the slot blocked rather than risk posting twice
- a photo that's posted or still in progress today or yesterday can't be picked again

**Failures.**

- **A problem with the photo itself** (Instagram rejecting the image, or a missing or unreadable file) counts as a strike against that photo. Two strikes and it's left out until `npm run social -- retry`.
- **"Media ID is not available"** (Instagram error 9007). Instagram sometimes says a post is ready, then refuses to publish it for a few seconds. Publishing waits and tries again for about a minute. If it still won't go, the post is kept as it is, the run fails once that day with a log line saying so, and the next run publishes it. It's never counted against the photo.
- **Anything else** (an expired token, a rate limit, an outage) never counts against a photo. Posting pauses for two hours and the run fails once that day, so you get one email rather than thirty.

**Missed days.** A dropped schedule never fails on its own. So the first run each morning checks for yesterday's post and fails if there wasn't one, which makes GitHub email whoever last edited the schedule. That's one email per missed day.

## Troubleshooting

**During setup**

- **No "Add account" button (step 6).** Click the "1. Generate access tokens" heading to expand it. Make sure the page is **API setup with Instagram login**, not "with Facebook login".
- **The account isn't offered.** Check that it's a professional account (step 1) and that the tester invite was accepted (step 5). Then wait a couple of minutes and refresh.
- **A guide says you need a Facebook Page.** That's only true for the other setup ([Facebook Login](#location-tags-and-tagging-accounts)), not this one.
- **You can't find the setup pages.** They're all under **Use cases → Customize**, not under "Testing" or "Facebook Login for Business".

**Once it's running**

- **The Social post workflow has no runs at all.** The timer isn't starting it. In the Azure portal, open the Logic App `logic-photography-<environment>-scheduler` → **Run history**. Failed runs with status 401 mean `GITHUB_TOKEN` has expired or lost its Actions permission: replace it on the Static Web App and run the Infra workflow. A disabled Logic App means it was deployed without a token (step 9). Meanwhile, run Social post by hand (**Actions → Social post → Run workflow**); a post that's due stays due, so one run catches up.
- **An email says "No post was published yesterday".** Open that day's Social post runs. A failed post shows its (redacted) reason. If there are no runs at all, GitHub dropped them. That's rare across 30+ attempts a day, but if it keeps happening, trigger the workflow from a reliable timer (for example an Azure Logic App calling `workflow_dispatch`).
- **The run reports an invalid or expired token.** Redo steps 6 and 7.
- **Nothing is posting.**
  - Check that `SOCIAL_ENABLED` and `SOCIAL_LIVE` are both `true`.
  - Run `npm run social -- status` and check "Ready to post".
  - Look for photos "left out after failing twice" in the same output.
- **A caption is wrong.** Run `npm run social -- skip` or `npm run social -- redraft`. If an opening keeps getting what you were doing wrong, add a trip note. If the mistake is in what the photo shows or what it is, fix the record instead: `npm run photos -- redo <photo>`, or the identification on iNaturalist ([docs/photos.md](photos.md#troubleshooting)).

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

Both can run locally against the sessions prebuild already downloaded, keeping state in `.cache/photos/state` and `.cache/social/state`:

```bash
SOCIAL_ENABLED=true node scripts/photos/catalog.mjs --local --provider mock   # mock records and posts, no model
node scripts/social/post.mjs --local --force                                  # renders the next post to a local file
```

## Cost

| Item | Cost |
|---|---|
| GitHub Actions | Free on public repositories |
| Timer (Logic App) | About 1,000 runs a month, which costs a few cents at most |
| Writing posts | Cents a month. Analysing the photos is shared with the website ([docs/photos.md](photos.md#cost-and-speed)) |
| Storage | Cents |
| Instagram API | Free |
