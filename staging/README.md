# Photo staging area

This folder is **gitignored**. Put photos here before uploading them to Azure Blob.

## Layout

One direct child folder per session, mirroring the Blob layout. The subfolder
name becomes the session prefix in Blob and must not contain `/` or `\`. Names
must produce unique public slugs of at most 200 characters; prebuild rejects
collisions such as `Hiking 2025` and `Hiking-2025`.

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
uploading half a session. **Nothing is re-encoded or resampled** — the exact
bytes from the archive are what land in Blob. Needs `unzip` or `python3`.

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

The script requires at least one accepted image, uploads to `originals` under
the matching prefix, and honors Azure overrides from `.env`. The site picks it
up on the next hourly cron, or immediately if you pass `--build` (or click "Run
workflow" in GitHub Actions).

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

It uploads to the `hobby-media` container and writes the gallery into
`src/content/hobbies/<slug>.json`. Details: [docs/hobbies.md](../docs/hobbies.md#photo-galleries-hobby-media).

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
