# Admin panel: editing session metadata from the browser

> Audience: site owner (you). Explains what `/admin` does, how SWA auth protects it, and how to set it up on a fresh deployment.

## What it does

The admin page at `https://trumanbrown.com/admin` has three tabs:

### Sessions tab: edit session metadata

The session list shows each session's cover thumbnail, its slug, date, and place, and badges for
what is still missing (no description, no cover, how many captions are written, how many frames are
in the home rotation). A search box filters by title, slug, place, or date, and the dropdown narrows
to **Still unfinished**, **Missing captions**, or **In the home rotation**.

**Edit** opens a resizable editor panel. Drag its header to move it, drag the bottom-right corner to
resize it, or hit **Fill screen**. The size is remembered in `localStorage` and reused next time.

The left column holds the written metadata:

- **Title**: the display name shown on cards and the session page.
- **Location**: where the session was shot.
- **Description**: a short blurb shown on the session page, with a character count.
- **Display order**: explicit sort priority (lower numbers first; blank = sort by date).
- A summary of the date, cover, header, rotation, and caption counts as they currently stand.

The right column is one large photograph grid. The segmented control decides what a tap on a frame
does, and the grid is drawn in the shape that slot actually uses on the site:

- **Cover**: the frame that stands for the session on the home page and in the archive. Tapping the
  chosen cover again, or the dashed **Auto** tile, hands it back to the first photograph.
- **Header**: the frame the session page opens on, cropped wide (tiles are drawn at 5:2). Upright
  frames are dimmed because the crop eats most of their height, but they can still be picked.
  **Auto** follows the cover.
- **Rotation**: the photographs offered to the rotating lead box on the home page. The box is a
  fixed 3:2, so anything else is greyed out and can't be chosen. An empty list means the site picks
  one frame automatically.
- **Captions**: a list view with a thumbnail per row. Captions become the alt text in the lightbox
  and the line under each photograph.

Every tile carries badges for the roles it already holds (Cover, Header, Rotation, Caption) and its
aspect ratio, so the state of a session is readable without switching modes. The **Size** slider
scales the thumbnails from 120px to 640px and is remembered between sessions. **Only frames that
fit** hides the frames the chosen slot can't use; in Captions mode it hides the ones already
written.

The ⤢ button on a tile (or `P` on a focused tile) opens the full-size photograph over the editor,
with arrow keys to step through the session and a button that applies the current mode to it.

Changes are written to a `_session.json` sidecar file in `originals/<session>/` in Blob Storage. Click **Rebuild Site** to deploy changes (~5 min), or wait for the hourly cron.

### Messages tab: read contact form submissions

Read-only view of messages submitted through the contact form, newest first. Shows name, email (as a `mailto:` link), message, and timestamp. Useful on mobile since the Azure portal app can't browse Table Storage. No write/delete actions, manage or delete messages via Storage Explorer / the portal.

### Analytics tab: privacy-friendly traffic metrics

Read-only view of site traffic with same-length prior-period comparisons, a labeled daily pageview/visitor chart, visit quality, page-level engagement, entry pages, timing coverage, and acquisition share (last 7/30/90 days). The chart supports hover and keyboard focus and has an equivalent screen-reader table. No cookies, no third parties, no IP stored. See [docs/analytics.md](analytics.md) for metric definitions, limitations, and the full privacy model.

## How to use it

1. Go to `https://trumanbrown.com/admin`.
2. Sign in with GitHub when prompted (one-time per browser session).
3. The page lists all sessions found in Blob Storage. Search or filter to find one.
4. Click **Edit** on any session → the editor panel opens with the written metadata on the left and the session's photographs on the right.
5. Change what you want, switch between Cover / Header / Rotation / Captions to assign frames → click **Save** (or Ctrl+S / ⌘S).
6. Click **Rebuild Site** at the top → site updates in ~5 minutes.

Closing the editor with unsaved edits asks first. The header shows an **Unsaved** badge whenever the
draft differs from what's in Blob Storage.

## How authentication works

This uses **Azure Static Web Apps built-in authentication**, not custom code.

### The flow

```
Browser → /admin
  ↓
Page loads (accessible to anyone)
  ↓
JS calls /.auth/me
  ↓
Not logged in?  → Shows "Sign in with GitHub" button
Logged in?      → JS calls GET /api/sessionmgr
  ↓
API checks x-ms-client-principal header
  ↓
GitHub username NOT in allowlist → 403 "Not authorized"
GitHub username IS in allowlist  → Returns session list
```

### How the auth works

The `/admin` page itself is accessible to everyone (it's just static HTML with a sign-in button). Security is enforced **server-side** in the API function:

1. SWA automatically sets the `x-ms-client-principal` header on requests from authenticated users. This header cannot be forged by clients.
2. The function decodes this header to get the GitHub username.
3. It requires the principal's identity provider to be GitHub and checks the normalized username against `ADMIN_GITHUB_USERS`.
4. Non-matching users get 403. Unauthenticated users (no header) get 403.

The allowlist fails closed: a missing, empty, or malformed setting authorizes
nobody. The Infra workflow initializes it to the GitHub user who first runs that
workflow and preserves an existing allowlist on later runs; comma-separated
entries can be configured in SWA app settings.

## Architecture

```
Browser ──GET /admin──▶ SWA ──▶ Static HTML + JS
         (anyone can load the page)

Browser ──GET /api/sessionmgr──▶ SWA Functions ──▶ check x-ms-client-principal
         ──▶ Blob Storage (list originals/, read _session.json sidecars)

Browser ──PUT /api/sessionmgr──▶ SWA Functions ──▶ check x-ms-client-principal
         ──▶ Blob Storage (write _session.json)
                                       │
                                       ▼
                               Next build reads
                               _session.json sidecar
                               ──▶ site updated

Browser ──GET /api/sessionmgr?type=messages──▶ SWA Functions ──▶ check principal
         ──▶ Table Storage (read contactmessages, newest first)
```

The API function ([`api/sessionmgr/index.js`](../api/sessionmgr/index.js)) uses the same `AZURE_STORAGE_CONNECTION_STRING` app setting as the contact form function. It derives the Blob hostname from that connection, accesses Blob Storage for sessions, and reads Table Storage (`contactmessages`) for the Messages tab.

### Thumbnail performance

[scripts/prebuild.mjs](../scripts/prebuild.mjs) writes two admin sizes per photograph with sharp:

| Path | Width | Typical size | Used for |
| --- | --- | --- | --- |
| `variants/thumbs/<slug>/` | 512px | ~25KB | session list rows, small tiles |
| `variants/thumbs-lg/<slug>/` | 1280px | ~125KB | large tiles, retina screens |

The grid stretches its columns to fill the row, so a tile at the top of the slider can be 600px wide
and twice that in device pixels on a retina display. The tiles therefore carry a `srcset` with both
widths and a `sizes` measured from the tile after layout, so the browser downloads the large file
only when a tile is genuinely large and the cheap one everywhere else. A tile whose large file does
not exist yet falls back to the 512px one rather than breaking.

Each file is stamped with the width it was generated at, so raising either width regenerates the
ones that are now too small instead of leaving a mixed set behind.

The preview overlay is the one place that loads the real photograph. `prebuild` records a public URL
per frame in `admin-index.json` (the original for browser-ready formats, the JPEG derivative for RAW
and HEIC) and the API passes them through as `urls`. Before a build with that field exists, the
preview falls back to a thumbnail.

### Keyboard behavior

- Left/Right arrows move between the Sessions, Messages, and Analytics tabs; Home/End jump to the first/last tab.
- In the photograph grid, one Tab reaches the grid and the arrow keys move between frames. Enter or
  Space assigns the frame, `P` previews it, Home/End jump to the first/last frame.
- In the preview, Left/Right step through the session and Escape closes it without closing the editor.
- Ctrl+S / ⌘S saves. Escape closes the editor, asking first when there are unsaved edits.
- The editor keeps Tab focus inside and restores focus to the session's Edit button on close.
- Caption edits update the in-page counts immediately. The public site changes after the next rebuild, like all other metadata edits.

## Fresh deployment setup

The Infra workflow automatically sets `AZURE_STORAGE_CONNECTION_STRING`,
`ANALYTICS_SALT`, and `ADMIN_GITHUB_USERS`. After the first deployment:

1. Optionally change `ADMIN_GITHUB_USERS` to a comma-separated list of GitHub usernames.
2. **Set `GITHUB_TOKEN`** to a fine-grained GitHub PAT with `actions:write` scope on this repo. This enables the "Rebuild Site" button. If omitted, the button shows an error but everything else works.
3. Visit `https://yourdomain.com/admin`, sign in with GitHub and you'll see the session manager.

If you deploy Bicep manually instead of using the workflow, set the three
automatic app settings yourself before using the Functions.

## What the admin panel cannot do

By design, the admin panel only edits metadata. It cannot:

- Upload, delete, or reorder images.
- Delete sessions.
- Change site configuration or code.
- Access other Azure resources.
- Grant admin access to other users (that's Portal-only).

For anything beyond metadata edits, use VS Code + the CLI tools (`upload-session.sh`, etc.).
