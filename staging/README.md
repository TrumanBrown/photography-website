# Photo staging area

This folder is **gitignored**. Put photos here before uploading them to Azure Blob.

## Layout

One direct child folder per session, mirroring the Blob layout. The subfolder
name becomes the session prefix in Blob and must not contain `/` or `\`. Names
must produce unique public slugs of at most 200 characters; prebuild rejects
collisions such as `Hiking 2025` and `Hiking-2025`.

The name is also the session's web address, and captions read place names from
it, so `upload-session.sh` stops on a misspelled state, country or island
(`crater-lake-oreogn-sep-2025`) and says what to rename it to. `--keep-names`
uploads it as it is.

```
staging/
├── 2026-mexico/
│   ├── _session.json          (optional metadata)
│   ├── DSC03421.jpg
│   ├── DSC03422.ARW
│   └── ...
├── tidepools-spring-2026/
│   ├── _session.json
│   ├── anemone.jpg
│   └── ...
└── README.md                  (this file; only file kept in git)
```

### Nested folders are flattened

iCloud bulk downloads wrap everything in a generic `iCloud Photos` folder. Drop
the whole thing in as-is — the uploader recurses into any subfolder, at any
depth, and uploads each photo to the session root, so the parent folder name
still supplies the location and date:

```
staging/
└── costa-rica-tapir-valley-august-2026/
    └── iCloud Photos/
        ├── DSC06858.JPEG      → costa-rica-tapir-valley-august-2026/DSC06858.JPEG
        └── DSC06866.JPEG      → costa-rica-tapir-valley-august-2026/DSC06866.JPEG
```

If flattening would produce two identical filenames, the subfolder path is kept
as a prefix so neither photo is lost (`Day 2/DSC06858.JPEG` becomes
`Day-2-DSC06858.JPEG`). A `_session.json` found anywhere under the session
folder is uploaded to the session root; the shallowest one wins.

macOS zip cruft (`__MACOSX/`, `._NAME` resource forks, `.DS_Store`) is dropped
without comment.

### Zips work too — no need to extract first

A `.zip` is a session. Name the zip for the session and leave it in `staging/`:

```
staging/
└── costa-rica-tapir-valley-august-2026.zip     → session costa-rica-tapir-valley-august-2026
```

If the zip has a generic name (iCloud often hands back `iCloud Photos.zip`), put
it in a session folder instead and let the folder carry the location + date:

```
staging/
└── costa-rica-tapir-valley-august-2026/
    └── iCloud Photos.zip
```

Either way the archive is unpacked to a scratch folder under `staging/` that is
deleted when the run ends; your zip is never modified. Extraction verifies every
entry's CRC, so a bad or truncated archive aborts the whole run instead of
uploading half a session. **Nothing is re-encoded or resampled** — the image
data from the archive is exactly what gets published, at full resolution. The
one change is that a GPS position, if a photo records one, is removed before
it's public (below). Needs `unzip` or `python3`.

If both `<name>/` and `<name>.zip` exist, the folder wins and the script says so.

## Optional `_session.json`

```json
{
  "title": "Mexico, Spring 2026",
  "date": "2026-04-15",
  "location": "Oaxaca → Mexico City",
  "description": "Two weeks chasing food and color.",
  "cover": "DSC03421.jpg",
  "order": 1
}
```

All fields are optional; sensible defaults are derived from filenames + EXIF if
absent. `date` must be a real `YYYY-MM-DD` date. Invalid JSON or field types fail
the build rather than being silently ignored.

## Photo locations are removed, without touching the photo

Phones (or a camera paired with one) write where each photo was taken into the
file, to within a few metres, and anyone with a published photo's link can
download it. So uploads go to a private inbox, the `incoming` container, which
nobody can read. The next build removes the GPS position and only then
publishes each photo to `originals`.

Removing it rewrites metadata only. The published file is byte for byte the
image you uploaded, at full resolution, with its camera, lens, exposure and
capture time; the files here in `staging/` aren't changed. It all happens in
GitHub Actions, so there's nothing to install for it. Until a build runs, your
new photos are private and not on the site.

## Upload to Blob

After dropping photos in `staging/<session>/`:

```bash
# Upload one session (prompts before transfer, prints progress)
./scripts/upload-session.sh 2026-mexico

# A zip works the same way, with or without the .zip on the end
./scripts/upload-session.sh costa-rica-tapir-valley-august-2026.zip

# Upload several at once
./scripts/upload-session.sh 2026-mexico tidepools-spring-2026

# Upload every staged session
./scripts/upload-session.sh --all

# Upload + trigger a build immediately
./scripts/upload-session.sh --all --build
```

`--all` takes every direct child folder and top-level `.zip` of `staging/` except
`hobby-*` entries, anything named in `UPLOAD_SKIP_DIRS` (defaults to `fishing`),
and anything with no accepted image files. It prints the full plan with
per-session file counts and sizes, notes any folders it flattened, lists what it
is skipping, and asks once before transferring anything.

The script requires at least one accepted image, uploads to the private inbox
(`incoming/originals/<session>/`), and honors Azure overrides from `.env`. The
next build publishes it to `originals/<session>/` and the site picks it up: pass
`--build` to start that build straight away (or click "Run workflow" in GitHub
Actions), or wait for the hourly cron, which GitHub often skips.

Do not include both a converted source and another image that would produce the
same filename, such as `DSC0123.ARW` and `DSC0123.jpg`. Prebuild rejects that
ambiguous pair. In `_session.json`, refer to converted photos by their original
source names; prebuild maps them to generated JPEGs.

## Hobby media (separate from photography)

Photos for the **Hobbies** section (e.g. the aquarium "My tank" gallery) go in a
different container so they never become a photography session. Put full-res
files in a `hobby-<slug>/` folder and use the hobby uploader:

```bash
# files in staging/hobby-aquarium-keeping/
AZURE_STORAGE_ACCOUNT=<account> \
  node scripts/upload-hobby-media.mjs aquarium-keeping --hero DSC1234.jpg
```

The full-size photos go through the same private inbox (published to
`hobby-media` by the next build, exactly as uploaded minus any GPS position),
the smaller inline copies straight to `hobby-media`, and it writes the gallery
into `src/content/hobbies/<slug>.json`. Details: [docs/hobbies.md](../docs/hobbies.md#photo-galleries-hobby-media).

The fishing page's "Fish I've caught" photos have their own folder,
`staging/fishing/`, named after each catch's `photo` in
`src/lib/hobbies/fishing-catches.json`. `node scripts/upload-fishing-catches.mjs`
publishes them the same way: full size through the private inbox, plus a small
committed copy for the page ([docs/hobbies.md](../docs/hobbies.md#reference-implementation-the-fishing-island)).

## After successful upload

You can leave files in `staging/` (they stay gitignored — your call whether to keep a local copy) or delete to reclaim disk:

```bash
rm -rf staging/2026-mexico
rm -f staging/costa-rica-tapir-valley-august-2026.zip
```

Originals stay safe in Blob with 7-day soft-delete in case of accident.

## What's accepted

- JPG / JPEG / PNG / WebP / AVIF / TIFF / HEIC / HEIF
- Sony `.ARW`, Nikon `.NEF`, Canon `.CR2` / `.CR3`, Adobe `.DNG`, Fuji `.RAF`

Anything else is skipped by the upload + prebuild. Videos (`.mov`, `.mp4`, …)
and iCloud `.aae` edit sidecars are harmless: the uploader counts them, tells you
what it left behind, and carries on with the photos.
