# Image pipeline — how a photo gets from your camera to the live site

> Audience: anyone uploading photos. Read this once to understand what happens when you drop a folder in Blob.

## The end-to-end path

```
   You                Azure Blob              GitHub Actions          Visitor's browser
    │                     │                         │                         │
    │  upload folder ──►  │                         │                         │
    │                     │                         │                         │
    │                     │ ◄── list blobs ──────── │                         │
    │                     │                         │                         │
    │                     │ ◄── download originals ─│                         │
    │                     │                         │                         │
    │                     │ ◄── (if RAW) upload ── │                         │
    │                     │      JPEG sidecar       │                         │
    │                     │                         │                         │
    │                     │                         │── astro build ──►       │
    │                     │                         │   creates dist/         │
    │                     │                         │                         │
    │                     │                         │── deploy to SWA ──►     │
    │                     │                         │                         │
    │                     │ ◄────────────────── direct image URL (lightbox) ──│
    │                     │                                                   │
    │                     │ ◄─── thumbnails from SWA CDN ────────────────────│
```

Two paths to the visitor:
- **Thumbnails + responsive variants** ship inside the SWA deploy. Tiny, optimized, multiple sizes.
- **Full-resolution originals** stay in Blob and load only when the lightbox is opened.

---

## Step 1: you upload

### Tools

- **Azure Storage Explorer** (free desktop app from Microsoft, GUI) — easiest if you have a few hundred files.
- **`az storage blob upload-batch`** (CLI) — easiest for scripted bulk uploads or remote work.
- (Future) **admin upload UI on the site itself** — not built yet; see [architecture.md](architecture.md).

### Folder convention

Each top-level prefix in the `originals` container is one session. (Azure Blob doesn't actually have folders — it uses "prefixes" in blob names, e.g. `2025-china-trip/IMG_0001.jpg`. Same thing visually in any GUI.)

```
originals/
├── 2025-china-trip/
│   ├── _session.json           ← optional metadata
│   ├── IMG_0001.jpg
│   ├── IMG_0002.ARW            ← Sony RAW
│   └── ...
└── tidepools-spring-2026/
    ├── _session.json
    ├── DSC03421.jpg
    └── ...
```

### Optional `_session.json`

Put one at the root of each session prefix to override defaults:

```json
{
  "title": "China, Spring 2025",
  "date": "2025-04-12",
  "location": "Beijing → Xi'an → Chengdu",
  "description": "Three weeks across three cities.",
  "cover": "IMG_4421.jpg",
  "order": 10
}
```

| Field | Required | Default if omitted |
|---|---|---|
| `title` | no | humanized folder name (`2025-china-trip` → `2025 China Trip`) |
| `date` | no | earliest EXIF `DateTimeOriginal` across the photos |
| `location` | no | empty |
| `description` | no | empty |
| `cover` | no | first image alphabetically |
| `order` | no | sessions without `order` sort by date desc; sessions with it sort first (lowest = top) |
| `images` | no | discovered automatically; provide an array of filenames to enforce ordering or attach captions |

If `images` is provided as an array of objects, each can carry a `caption` that the lightbox displays:

```json
"images": [
  { "file": "IMG_0001.jpg", "caption": "Mutianyu at sunrise" },
  { "file": "IMG_0042.ARW", "caption": "Terracotta warriors" }
]
```

### Accepted formats

- **Standard:** JPG, JPEG, PNG, WebP, AVIF, TIFF, HEIC, HEIF (HEIC works because GitHub's Ubuntu runner ships `libheif`).
- **RAW:** Sony `.ARW`, Nikon `.NEF`, Canon `.CR2` / `.CR3`, Adobe `.DNG`, Fuji `.RAF`. Handled via `libraw-bin` → `dcraw_emu`.

Anything else is silently ignored. Add the extension to the matching set in `scripts/prebuild.mjs` if you need more.

---

## Step 2: the build pipeline runs

Three triggers can start a build (see [cicd.md](cicd.md)):
- Push to `main` (you changed code)
- Hourly cron (most common — picks up new photos automatically)
- Manual "Run workflow" click (impatience)

What happens inside `scripts/prebuild.mjs`:

1. **Authenticate to Azure** via OIDC. The build runs as the managed identity created by Bicep, which has `Storage Blob Data Contributor` permission on the storage account.
2. **Load the manifest** from `metadata/manifest.json` (a JSON file with last-seen blob ETags). On the first ever run, this doesn't exist yet and that's fine.
3. **List session prefixes** under `originals/` (one directory listing call).
4. **For each session prefix:**
   - Download `_session.json` if present.
   - List image blobs under that prefix.
   - **For each image blob:**
     - Compare its ETag to what's in the manifest.
     - If unchanged AND a cached local copy exists → reuse it. Skip download.
     - If it's a RAW file → check whether `derivatives/<session>/<base>.jpg` already exists with metadata `source-etag` matching the RAW's current ETag.
       - **Yes** → reuse the existing derivative.
       - **No** → download the RAW, convert it (see Step 3 below), upload the JPEG sidecar to `derivatives/`.
     - If it's a standard image → download it.
   - Read intrinsic width/height with sharp and EXIF date with exifr.
   - Write `src/content/sessions/<slug>.json` for Astro to consume.
5. **Save the updated manifest** back to `metadata/manifest.json`.

The cache key is the blob ETag, which Azure changes every time a blob is modified — so renames or content changes invalidate cleanly.

---

## Step 3: RAW files (Sony `.ARW` and friends)

**The problem:** browsers can't display `.ARW`. Neither can sharp (the image library Astro uses under the hood).

**The solution:** convert RAW → TIFF → JPEG during the build:

1. Download the RAW from Blob.
2. Run `dcraw_emu -w -q 3 -T -o 1 <file>` — produces a high-quality TIFF in sRGB.
   - `-w` = use the camera's white balance
   - `-q 3` = highest-quality demosaicing (AHD)
   - `-T` = TIFF output
   - `-o 1` = sRGB color space
3. Pipe the TIFF through `sharp(...).jpeg({ quality: 95, mozjpeg: true })` → high-quality JPEG.
4. Upload that JPEG to `derivatives/<session>/<base>.jpg` with:
   - `Content-Type: image/jpeg`
   - `Cache-Control: public, max-age=31536000, immutable`
   - Metadata `source-etag=<RAW's ETag>` (so next run knows whether to reconvert)

**The original RAW stays in `originals/` untouched.** You never lose the negative. The derivative is what the site shows and what the lightbox treats as "full resolution."

**dcraw_emu** comes from the `libraw-bin` apt package, installed in the build workflow (cached between runs so it's instant after the first install).

If you add a new RAW format, just add its lowercase extension to the `RAW_EXTS` set in `scripts/prebuild.mjs`.

---

## Step 4: Astro builds the site

Once `src/content/sessions/` is populated, Astro's `astro build` does the rest:

- **Content collection** — Astro reads each `<slug>.json` against the Zod schema in `src/content/config.ts`. Schema violations abort the build (good — catches bad sidecars before they reach prod).
- **Image optimization** — every reference to a session image goes through `<Picture>`, which during build calls sharp to produce:
  - Multiple widths: 480, 800, 1200, 1600 px (and 2160 on session pages)
  - Three formats per width: AVIF (smallest, modern browsers), WebP (broadly supported), JPEG (universal fallback)
- **Static HTML** — every page is pre-rendered to a `.html` file. The `<picture>` tags contain `srcset` listing every variant; the browser picks the right one.
- **Lightbox URL** — each image's full-res URL (either the original or the RAW-derived sidecar) is baked into the rendered HTML as `data-pswp-*` attributes. The lightbox loads it on click — never on initial page render.

The output is a `dist/` folder of self-contained static files.

---

## Step 5: deploy to SWA

The `Azure/static-web-apps-deploy@v1` action uploads `dist/` to SWA's deployment endpoint using the deploy token. SWA fans the new files out to its global CDN edge locations within a few seconds.

PR builds get their own preview environment automatically.

---

## How long does it take?

| Event | Time to live |
|---|---|
| You push a code change | ~3 minutes (full build + deploy) |
| You upload a new photo and wait for the cron | up to 1 hour |
| You upload a new photo and click "Run workflow" | ~3 minutes |
| Future Event Grid path | ~1 minute |

Incremental builds (only one new photo since last run) are usually under 90 seconds thanks to the ETag cache.

---

## What's stored where

| Container | Contents | Public? | Listable? |
|---|---|---|---|
| `originals/` | Your uploads. Source of truth. | Reads of known URLs | No |
| `derivatives/` | RAW→JPEG sidecars. Regenerable. | Reads of known URLs | No |
| `metadata/` | `manifest.json`. Future admin state. | No | No |

| Path in repo | Contents |
|---|---|
| `src/content/sessions/*.json` | Per-session metadata + image list. Gitignored — written fresh by prebuild every run. |
| `src/content/sessions/<slug>/images/*` | The actual JPEGs Astro processes. Gitignored. |
| `dist/` | The built site. Gitignored. Recreated every build. |
| `.cache/prebuild/` | Local cache of downloaded blobs keyed by ETag. Gitignored. Persisted between CI runs via `actions/cache`. |
