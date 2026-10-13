# Photo captions and session descriptions

> How every photo on the site gets its caption, and every session its description, without anyone writing them by hand. For the site owner, and for anyone recreating the site.

- [What it does](#what-it-does)
- [How a new session gets its copy](#how-a-new-session-gets-its-copy)
- [The one look at each photo](#the-one-look-at-each-photo)
- [Identifications come from iNaturalist](#identifications-come-from-inaturalist)
- [Captions](#captions)
- [Session descriptions](#session-descriptions)
- [Your edits win](#your-edits-win)
- [Setting it up](#setting-it-up)
- [Day to day](#day-to-day)
- [Settings](#settings)
- [What stays private](#what-stays-private)
- [Troubleshooting](#troubleshooting)
- [Cost and speed](#cost-and-speed)

---

## What it does

Each photograph is looked at **once** by a vision model. What it sees is stored as a private record, together with your iNaturalist identification of that photo when there is one. Everything public is then written from that record:

| Output | Written by | Example |
|---|---|---|
| **Photo caption** (alt text, lightbox caption, image search) | Code, from the record, opening with a first line written once per photo (text only) | `Turquoise-browed motmot (Eumomota superciliosa) perched on a branch, Playa Flamingo` |
| **Session description** (top of the session page, search snippet) | One text-only model call per session, from every photo's caption | `Jagged gray peaks and forested valleys fill most of these, with patches of snow on the rocky slopes...` |
| **Instagram posts** (optional, [docs/social.md](social.md)) | Code, plus a few facts per species or place written once from Wikipedia, and one text-only call per ten posts for the first line and reaction in your voice | A livelier first line with the fuller place, your one-line reaction, a fun fact, gear, five hashtags |

Because the photo is only ever looked at once, changing how captions or descriptions are worded never means paying to analyse the archive again.

The code lives in [scripts/photos/](../scripts/photos/); the Instagram side is in [scripts/social/](../scripts/social/).

## How a new session gets its copy

```
upload-session.sh --build
        │
        ▼
Build and Deploy ──── photos go live (no captions yet)
        │              prebuild counts photos the pipeline hasn't seen
        ▼
Photo captions workflow  (photos.yml)
  1. scan       fingerprint each new photo, read its camera facts
  2. group      files of the same shutter press become one "shot"
  3. iNat       match shots to your iNaturalist observations
  4. analyse    one vision call per new shot  ──►  private record
     lines      one text-only call per outing: each photo's first line
  5. website    captions + session description ──► _session.json
  6. instagram  only with SOCIAL_ENABLED=true
        │
        ▼
Build and Deploy ──── captions and description live
```

Usually 15 to 30 minutes from the first build to the second. The workflow also runs on a schedule, so anything a run missed is picked up within a day: twice a day on GitHub's scheduler (about 3 am and 3 pm Pacific, though GitHub skips many scheduled runs), and at 3 am from the Azure timer when the Instagram posting is set up ([docs/social.md](social.md#what-runs-automatically)).

The site build itself never calls a model.

## The one look at each photo

[analyse.mjs](../scripts/photos/analyse.mjs) sends the model the photo (1280 px on the long edge) and what's already known:

- the session title, location and month
- your iNaturalist identification, if the photo has one
- the only place and landmark names it's allowed to use: the ones in the session title, the location and the folder name (`mt-baker-fall-2026` gives "Mount Baker")

It answers with neutral facts, never finished copy:

| Field | Example |
|---|---|
| `subject` | `Snow-covered peak`, `Heron`, `Two harbor seals` |
| `scene` | `rising beyond a grassy bank and small pond` |
| `conditions` | `at sunset`, `in fog` (empty for ordinary daylight) |
| `setting` | `alpine meadow`, `tide pool` |
| `description` | one or two plain sentences, used as Instagram alt text and for descriptions |
| `landmark`, `place_tag` | only names from the allowed list |
| `appeal` | 1 to 10, used to order Instagram posts |
| `id_check` | `fits`, or `conflict` when the photo plainly isn't the identified organism |

**Example, a mountain photo** from "Yellow Aster Butte, Washington, October 2026" (folder `mt-baker-fall-2026`). The model sees a glaciated peak behind a tarn. Its answer:

```json
{ "subject": "Mount Baker", "scene": "rising beyond a rocky meadow and still pond", "conditions": "" }
```

It may say "Mount Baker" only because the folder name does. If it had named Mount Shuksan, which you never wrote anywhere, the name would be thrown out and the caption would fall back to "Snow-covered peak". To have a peak named in captions, put it in the session's title, location or folder name.

Folder names are the one place name nobody proofreads. A state, country or island with two letters swapped ("crater-lake-oreogn") is read as the right name ("Crater Lake Oregon"), and every run's log warns about the folder with the name to rename it to; the web address keeps the typo until it's renamed. `upload-session.sh` checks names before uploading, so this is only a safety net ([placenames.mjs](../scripts/photos/placenames.mjs)). A state code at the end and filler words are left out too: `napali-coast-hi` is "Napali Coast", `fort-worden-and-nearby-wa` is "Fort Worden", `northern-kauai-pics` is "Northern Kauai".

## Identifications come from iNaturalist

Your iNaturalist observations are the source of truth for what an organism is. The model never identifies anything; it only describes.

A photo is matched to an observation in one of two ways ([inat.mjs](../scripts/photos/inat.mjs)):

- **Same photo.** Every photo on your observations is fingerprinted. A site photo matches when the fingerprints are within 14 bits and the observation is dated within a day of capture (within 6 bits when there's no date). Measured on this archive, different shots never came closer than 9 bits. Up to 24 bits also counts when the two times agree to the second (or to the minute, for a time typed in by hand) but sit whole hours apart: the same photo, with iNaturalist reading its time in another time zone. Unrelated photos sit around 64 bits apart.
- **Same moment.** With no fingerprint match, research-grade observations made within five minutes of the capture are shown to the model next to the photo. One is only used if the model is confident it's the same organism. Each session's camera-clock error is learned from its fingerprint matches first. This check happens while a photo is looked at, so a photo of an organism without an identification gets another look when an observation from the same moment turns up that it couldn't have been compared with: one added to iNaturalist since, or any at all if the photo had no capture time then.

Both need the photo's capture time. **HEIC, TIFF and RAW photos** are shown on the site as a JPEG the build makes, which carries no camera data, so their capture time, camera and lens are read once from the original in the `originals` container. Without that, an iPhone photo could only match an observation photo that was a near-identical copy. Location is never read from the original.

The match is used **at whatever rank and grade it has**, because even an identification still waiting for confirmation is yours and beats a model's guess:

| Observation | Caption |
|---|---|
| Species (research grade, or your own ID) | `Northwestern garter snake (Thamnophis ordinoides) coiled on a mossy log, Sauk Mountain` |
| Genus or family only | `Spiny lizard (Sceloporus) basking on a rock, ...` |
| No match | `Heron standing in shallow water, ...` (plain words, never a species) |

When you change an identification on iNaturalist, the next run follows it and looks at that photo again.

Two extra guards:

- Every caption and description is checked against the full list of species you've recorded on iNaturalist. One that names a species the photo isn't identified as is rejected.
- If the model reports a `conflict` (say, a bird when the identification is a frog), the name isn't used and the photo is left out of Instagram.

iNaturalist place names are never used. An observation's place can be a street address, so captions only use place names you wrote yourself.

## Captions

Built by code in [website.mjs](../scripts/photos/website.mjs):

```
<first line>, <place>
```

**The first line** says what the photo is of and what it's doing, the way a person would say it:

- `Red-eyed tree frog (Agalychnis callidryas) clinging to a stem`
- `A candy bar held up to Mount Rainier`
- `Tiger Leaping Gorge with a winding river`

It's written once per photo by [lines.mjs](../scripts/photos/lines.mjs), in one text-only call per outing, from the notes the one look already stored, so no photo is looked at again. Its rules:

- **For an identified organism the model only writes what follows the name** ("clinging to a stem"). The name itself comes from iNaturalist, never the model: the iNaturalist name with its scientific name, counted when several are visible ("Two harbor seals (Phoca vitulina)"). A species with no English name is led by the model's plain word for what it is, because that's what people search for: "Jumping spider (Corythalia opima)".
- **Never the background, the blur or the framing.** "Clinging to a green stem against a dark background" is how a camera describes a photo, not how a person does. Behind a person or an object, though, a landmark from the notes stays, because it's the point of the photo.
- **Photos of the same subject from one outing are written together**, so eleven photos of one peak get eleven different lines rather than one line eleven times.
- **Checked like everything else:** none of the banned or vague words ("object", "illuminated"), no place or species name the record doesn't have. A body part gets its "with its" ("with its mouth open"). A line that fails falls back to one built from the notes: `<subject> <scene> <conditions>`.

To rewrite every first line (after changing the prompt, say), bump `LINE_VERSION` in lines.mjs. The next run rewrites them all, text only, in a few minutes.

**The place** is the first part of the session title ("Yellow Aster Butte"):

- without what you did there: "Tortuguero night walk" gives "Tortuguero", "Portland and Nearby" gives "Portland"
- lowercase when it's a habitat rather than a name: "shrub-steppe"
- left off when the line already names it ("Mount Baker from Yellow Aster Butte"). Sharing a word isn't naming it: "Tibetan gazelle" still gets "Tibetan plateau"

**Also:**

- **At most 125 characters,** the length screen readers and image search handle best. The place is dropped first when it's too long.
- **No hashtags, no trailing period, none of the words the site's voice rules ban.**

The caption is used as the photo's `alt` text, its lightbox caption, and the `caption` in the page's structured data.

## Session descriptions

One text-only call per session ([website.mjs](../scripts/photos/website.mjs)) gets:

- every photo's caption, without the place
- the identified species, with counts
- the settings and the light seen across the session
- the six best frames in more detail, with any background, blur or framing cut out first
- the site's voice rules from [site-copy.instructions.md](../.github/instructions/site-copy.instructions.md)

It writes 2 to 4 sentences in your voice, without repeating the title or date that sit right above it. Each session is given one of five shapes, picked from its folder name (lead with the standout photo, lead with the setting, two sentences only, and so on), so the archive doesn't read as one template thirty times. Before a description is used, it has to pass these checks (`descriptionProblems`):

- no em dashes, emoji or banned marketing words
- nothing that describes the photo rather than the moment: the background, the blur, the framing, which way something faces, the flash ("against a dark background", "facing left")
- no species name that isn't identified in that session
- no capitalised name that isn't in the session's own text, so no invented places
- not opening with the same word as three other sessions
- no run of six words copied from another session's description (sessions that share photos tend to)
- under 700 characters

A draft that fails goes back with the reasons, up to three times. If it still fails, the old description stays and `npm run photos -- status` says why.

A description is only rewritten when the session's photos or identifications change, and only once every photo in the session has been analysed. One the pipeline wrote before a check existed is also rewritten if it breaks the photo-not-moment check, never one you edited. A session with no title or location gets one drafted too, in the `Place, Region, Month Year` shape. A title or location that's already set is never changed.

## Your edits win

Copy goes into each session's `_session.json`, the same file `/admin` edits. The private record remembers exactly what the pipeline last wrote to each field. A later run only replaces text that still matches it:

- **Edit a caption or description in `/admin`** and it stays yours. The pipeline never touches it again.
- **Clear a caption or description** and the next run fills it in again.
- **Title and location** are only ever filled when blank.

Everything else in `_session.json` (photo order, cover, banner, showcase) is left exactly as it was. Writes use the file's ETag, so a save in `/admin` at the same moment isn't lost.

The **overwrite** option on the workflow ignores your edits once, for replacing copy that was never yours, such as text from an older tool.

## Setting it up

1. **A vision model.** The keyless Azure OpenAI deployment is recommended: set `enableDescribeModel` to `true` in [infra/main.parameters.json](../infra/main.parameters.json), run the Infra workflow, then set two repository variables from its outputs:

   ```
   AZURE_OPENAI_ENDPOINT   = https://<your-resource>.openai.azure.com/
   AZURE_OPENAI_DEPLOYMENT = gpt-6.1-sol
   ```

   The workflow signs in through the same OIDC login the site build uses, so no API key exists anywhere and the photos stay in your tenant. To use an API key instead, set the `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) secret and the variable `PHOTOS_ENABLED=true`.

2. **Your iNaturalist account.** Taken from the hobby pages' `userId` automatically, or set the `INATURALIST_USER` variable.

3. **The first run.** In **Actions → Photo captions → Run workflow**, set the limit to more than your photo count (e.g. `900`). Tick **dry_run** to have everything written privately first, then read it with `npm run photos -- preview`. Run it again without dry_run to publish. Tick **overwrite** only if the sessions already have generated copy you want replaced.

From then on it runs by itself.

## Day to day

Nothing needs doing. These run on your computer, signed in with `az login`. The storage account is read from `blobHost` in `site.config.ts`; set `AZURE_STORAGE_ACCOUNT` only if yours is different.

| Command | What it does |
|---|---|
| `npm run photos -- status` | What's analysed, matched and written, and any description that failed its checks |
| `npm run photos -- preview [session]` | Opens every photo with its caption, and each description, in your browser |
| `npm run photos -- redo DSC01234` | Look at this photo again on the next run |
| `npm run photos -- redo --session <slug>` | ...or every photo in a session |
| `npm run photos -- redescribe <slug>` | Rewrite this session's description on the next run |

The next run is the next scheduled one (twice a day), or start it from **Actions → Photo captions → Run workflow**.

## Settings

| Name | Kind | Default | What it does |
|---|---|---|---|
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` | variables | none | Keyless Azure OpenAI. Setting them turns the workflow on |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | secret | none | A model by API key instead, with `PHOTOS_ENABLED=true` |
| `PHOTOS_ENABLED` | variable | off | `true` runs the workflow without the Azure OpenAI variables |
| `OPENAI_BASE_URL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL` | variables | OpenAI, `gpt-6.1-sol`, `claude-sonnet-4-5` | Endpoint and model for the API-key route |
| `PHOTOS_MODEL`, `PHOTOS_PROVIDER` | variables | inferred | Override the model or provider (`azure`, `openai`, `anthropic`, `mock`) |
| `INATURALIST_USER` | variable | the hobby pages' account | Whose observations count as identifications |

Workflow options (Run workflow): `limit` (photos to analyse, default 300), `overwrite`, `dry_run`.

## What stays private

| Thing | Where | Public? |
|---|---|---|
| Each photo's record, the iNaturalist index, what was last written | `metadata/photos/` in the private container | No |
| Captions and descriptions | Each session's `_session.json`, and the site | Yes, that's the point |
| Workflow logs | Actions | Yes, but counts only |
| Photos sent to the model | Downscaled copies, to your own Azure OpenAI deployment when using the keyless setup | No |

## Troubleshooting

- **A new session has no captions after an hour.** Open **Actions → Photo captions**. If no run started, check the `AZURE_OPENAI_*` variables (or `PHOTOS_ENABLED`). The next scheduled run catches up either way.
- **A caption is wrong.** Edit it in `/admin`; it stays. Or run `npm run photos -- redo <photo>` for a fresh look.
- **A photo has no caption.** The model's content filter can refuse a harmless photo (one of a person bent over on a slope was refused here). It isn't retried, and `npm run photos -- status` lists it. A photo with an iNaturalist identification still gets a caption from that alone. Write one in `/admin`, or `redo` it to try again. Other failures are retried for three runs.
- **A species is wrong.** Fix the identification on iNaturalist. The next run follows it.
- **A species isn't named, though it's on iNaturalist.** The match needs the photo's capture time, or a near-identical copy of the photo on the observation. Check the photo still has its camera data (HEIC originals are read automatically), and that the observation's time is right; an observation whose time is off by whole hours still matches when the photos are close. `npm run photos -- redo <photo>` looks again.
- **A peak or lake isn't named.** Add it to the session's title, location or folder name, then `npm run photos -- redo --session <slug>`.
- **A description didn't change.** It's left alone once edited in `/admin`. `npm run photos -- status` lists any that failed their checks.
- **Trying it without Azure:** `node scripts/photos/catalog.mjs --local --provider mock` runs every stage against the sessions prebuild downloaded, with state in `.cache/photos/state`.

## Cost and speed

On this site's deployment (`gpt-6.1-sol`, 50K tokens a minute); times are measured, costs estimated:

| Job | Time | Cost |
|---|---|---|
| The whole archive, ~820 shots | about 35 minutes | roughly $10 to $15 (estimate) |
| Every first line again, ~820 photos, text only | about 8 minutes | under a dollar (estimate) |
| A new session of 30 photos | 2 to 3 minutes | a few cents |
| A description rewrite | seconds | under a cent |
| Instagram facts for a new species or place | seconds | under a cent |
| Instagram first lines and reactions, two weeks of posts | about a minute | a few cents |
