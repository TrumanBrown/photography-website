# Photo staging area

This folder is **gitignored**. Put photos here before uploading them to Azure Blob.

## Layout

One subfolder per session, mirroring the Blob layout. The subfolder name becomes the session prefix in Blob.

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

All fields optional; sensible defaults are derived from filenames + EXIF if absent.

## Upload to Blob

After dropping photos in `staging/<session>/`:

```bash
# Upload one session (prompts before transfer, prints progress)
./scripts/upload-session.sh 2026-mexico

# Upload + trigger a build immediately
./scripts/upload-session.sh 2026-mexico --build
```

The script uploads to the `originals` container under the matching prefix. The site picks it up on the next hourly cron, or immediately if you pass `--build` (or click "Run workflow" in GitHub Actions).

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
```

Originals stay safe in Blob with 7-day soft-delete in case of accident.

## What's accepted

- JPG / JPEG / PNG / WebP / AVIF / TIFF / HEIC / HEIF
- Sony `.ARW`, Nikon `.NEF`, Canon `.CR2` / `.CR3`, Adobe `.DNG`, Fuji `.RAF`

Anything else is silently skipped by the upload + prebuild.
