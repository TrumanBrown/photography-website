# Session handoff: engineering lessons

A reference for picking up the project on a new machine, in a new chat, or after a long break. The full design rationale lives in [docs/](.). This file is the short "what works today + what landed the hard way" version.

For an agent, each part of the site also has a skill in [.github/skills/](../.github/skills/), listed in [copilot-instructions.md](../.github/copilot-instructions.md#skills): the steps that work for that part, the owner's verdicts on it, and the lessons from reworking it. New lessons go there as they happen.

> **Operational specifics (subscription/tenant/MI IDs, exact resource names)** are not in this file. Reproduce them on demand with `az` against the live deployment, or keep your own private notes outside the repo.

---

## Architecture in one paragraph

Static Astro site deployed to **Azure Static Web Apps** (Free tier). Photos in **Azure Blob Storage** across six containers (`originals` / `derivatives` / `variants` / `hobby-media`, plus private `metadata` and `incoming`). Build is a **GitHub Actions** workflow: hourly cron + push + manual. Auth between GitHub and Azure is **OIDC federation** on two user-assigned managed identities (a blob-only one for builds, a subscription-level one for the manual infra deploy), no long-lived CI secret. Infra defined in **Bicep**, applied via a separate manual workflow. Custom domain registered through **Azure App Service Domain**, bound to SWA via a post-deploy script. Realistic cost: about $4/mo recurring + $12/yr domain, measured ([README](../README.md#what-it-costs)).

**Captions and Instagram (optional).** A second workflow, **Photo captions** (`photos.yml`), looks at each photo once with a keyless Azure OpenAI model, takes species from the owner's iNaturalist observations of that photo, and writes per-photo captions and session descriptions into `_session.json`; the build never calls a model. With `SOCIAL_ENABLED`, the same run plans and writes Instagram posts two weeks ahead, and **Social post** (`social-post.yml`) publishes three a day. A consumption Logic App starts both on time, because GitHub's scheduler skips most scheduled runs here. Private state lives under `metadata/photos/` and `metadata/social/`. See [photos.md](photos.md) and [social.md](social.md).

## Container roles

| Container | Public? | Contents |
|---|---|---|
| `incoming/` | Private | New uploads from `upload-session.sh` (`incoming/originals/...`) and `upload-hobby-media.mjs` (`incoming/hobby-media/...`). Prebuild removes any GPS position, publishes them, and empties it. |
| `originals/` | Blob (anon read of known URLs, no list) | Source-of-truth photos, published from `incoming/`. JPG/HEIC/RAW, exactly as uploaded minus any GPS position. |
| `derivatives/` | Blob | JPEG sidecars from RAW/HEIC sources, written by prebuild with a `source-etag` metadata tag for cache invalidation. |
| `variants/` | Blob | Astro responsive WebP/JPEG outputs, moved here by [scripts/sync-variants.mjs](../scripts/sync-variants.mjs) after each build. Also stores admin thumbnails under `thumbs/<slug>/`. **Critical for staying under SWA Free's 250 MB app cap**: without this, ~50-photo sessions blow the limit. |
| `metadata/` | Private | Prebuild's `manifest.json` (blob name → etag, target and the photo's full size), the 2,400 px copies the build reads instead of the originals (`build-copies/`), and `admin-index.json` (resolved session metadata the admin panel reads, see lesson 19). |
| `hobby-media/` | Blob | Full-resolution and display-size photos used only by hobby galleries. |

## GitHub Actions secrets

Set in the repo (Settings → Secrets and variables → Actions):

- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, OIDC pointers (technically identifiers, not secrets). `AZURE_CLIENT_ID` is the bootstrap identity, used by the Infra workflow.
- `AZURE_DEPLOY_CLIENT_ID`, the build identity the other workflows sign in as (an identifier).
- `AZURE_STATIC_WEB_APPS_API_TOKEN`, real secret; rotated by re-running the Bicep deploy.
- `AZURE_STORAGE_ACCOUNT`, storage account name.
- Optional: `GH_PAT_FOR_SECRETS`, and the photo/Instagram secrets. Full table: [cicd.md](cicd.md#secrets-cheat-sheet).

GitHub-side billing note: the **Actions account budget must be > $0 with stop-usage on**. The default $0 budget blocks all Actions runs, even on free public repos. Card-on-file is also required regardless.

## SWA environment variables

The Infra workflow initializes these SWA app settings:

- `AZURE_STORAGE_CONNECTION_STRING`, storage connection string (used by contact form + admin API).
- `ADMIN_GITHUB_USERS`, comma-separated GitHub usernames allowed to use the admin API; initialized to the first workflow actor, preserved on later Infra runs, and fail-closed if absent.
- `ANALYTICS_SALT`, private input for privacy-friendly visitor/rate-limit hashes.

Set manually only when needed:

- `GITHUB_TOKEN`, fine-grained GitHub PAT with `actions:write` scope. Enables the "Rebuild Site" button in the admin panel. Optional.

## Hard-won lessons (in the order they bit us)

1. **GitHub Actions requires a card on file** even for free public-repo runs. Set the Actions budget to $1 with stop-usage so the floor isn't $0 (which blocks everything).
2. **OIDC federated credential subjects are literal strings.** A workflow with `environment: prod` produces subject `repo:<owner>/<repo>:environment:prod`, NOT `:ref:refs/heads/main`. Each variant needs its own federated credential on the MI.
3. **SWA custom-domain bindings + Bicep don't mix.** The apex binding's validation needs a TXT record containing a token only available AFTER the binding HTTP call starts. Bicep tries to do both in the same deployment and deadlocks. Bindings now done by [scripts/bind-domain.sh](../scripts/bind-domain.sh) after `infra` deploy, using `az rest` to PUT bindings async and poll for `status=Ready`.
4. **Azure rejects concurrent federated-credential writes** on the same MI. Bicep needs `dependsOn` between them, see [infra/modules/identity.bicep](../infra/modules/identity.bicep).
5. **Storage account "Owner" doesn't grant data-plane access.** You need `Storage Blob Data Owner` (or Reader/Contributor) on the storage account scope. Bicep doesn't grant this to your user. Do it manually after first deploy.
6. **SWA Free managed Functions need a storage connection string.** The build identity can use OIDC, but the runtime cannot use that identity. The Infra workflow masks the connection string and writes it directly to SWA app settings; never put it in git or a GitHub secret.
7. **SWA action's `app_location` + `skip_app_build: true`** makes the action ignore `output_location` and treat `app_location` as the deploy root. Set `app_location: dist` directly.
8. **`az storage blob upload-batch --pattern` doesn't support brace expansion.** Silently matches zero files when given `{*.jpg,*.png}`. Use `find` + per-file `az storage blob upload` instead. Fixed in [scripts/upload-session.sh](../scripts/upload-session.sh).
9. **iPhone HEIC files use HDR tone-mapping** (ftyp brands `tmap` / `MiHE` / `MiHB`) that Ubuntu's `heif-convert` + ImageMagick libheif delegate both fail to decode with "Metadata not correctly assigned to image." **`pillow-heif` handles them cleanly.** [scripts/heic-to-jpeg.py](../scripts/heic-to-jpeg.py) wraps it; workflow apt-installs `python3-pip` + pip-installs `pillow pillow-heif --break-system-packages`.
10. **Prebuild cache key must include the target filename**, not just source name+etag. When HEIC→jpg conversion was added later, the cache key (source name+etag) was unchanged so the prebuild reused HEIC bytes for a .jpg local file, breaking Astro's image pipeline.
11. **CSP `script-src` blocks inline scripts** unless you add `'unsafe-inline'` or per-script hashes. Dark mode, the theme toggle, the home page's lead-photo chooser and the page-landing check use SHA-256 hashes in [staticwebapp.config.json](../staticwebapp.config.json); `npm run check:csp` verifies all four, and that the policy's storage host matches `blobHost`, during check and build.
12. **SWA Free has a 250 MB app-size limit** (Standard is 500 MB; both insufficient for many photos). Solution: [scripts/sync-variants.mjs](../scripts/sync-variants.mjs) runs after `astro build`, moves all responsive image variants from `dist/_astro/` to the `variants/` blob container, rewrites HTML refs to point at Blob. dist drops from 539 MB → ~330 KB regardless of photo count.
13. **`upload-session.sh` only uploaded 1 file** because the `while read` loop fed the file list via stdin, but `az storage blob upload` also reads stdin, consuming remaining entries after the first iteration. Fixed by reading from file descriptor 3 (`read <&3 ... done 3< "$TMPLIST"`).
14. **Windows `az` CLI under WSL appends `\r`** to query output. The tenant-switching comparison (`$current_tenant != $AZURE_TENANT_ID`) always failed, triggering a login prompt every run. Fixed with `tr -d '\r'`.
15. **SWA Functions: top-level `require()` of heavy SDKs crashes silently.** `require('@azure/storage-blob')` at module level kills the function under Functions Runtime ~4 + Node 22. The runtime drops the function (returns 404, zero error logs). Fix: lazy-load inside a getter function, never at top level.
16. **SWA permanently caches broken function state.** If a function crashes on first deploy, it stays 404 even after code fixes. The only fix is renaming the function folder to force SWA to re-register it from scratch.
17. **SWA `responseOverrides` for 401 is global**: applies to API routes too, breaking `fetch()` calls by redirecting to an HTML login page. Fix: don't use route-level auth on API endpoints; do server-side identity checks via the `x-ms-client-principal` header.
18. **Admin API writing `"order": null` broke the Zod schema.** `z.number().int().optional()` rejects `null` (only allows `undefined` / missing). Prebuild then copies that null into the session JSON, failing the Astro build. Fix: schema accepts `.nullable()`, API deletes the key instead of writing null, prebuild uses `!= null` guard.
19. **Admin showed broken thumbnails + wrong order for mixed-case folder names.** A session uploaded as `Shanghai-city-...` (mixed case) stored thumbnails under the prebuild-sanitized lowercase slug (`shanghai-city-...`), but the admin built thumbnail URLs from the raw folder name → 404. Also, the admin read dates from the `_session.json` sidecar, which usually has *no* date (dates are EXIF-derived by prebuild and only written to the generated session JSON), so sort order diverged from the public site. Fix: prebuild now writes `metadata/admin-index.json` with fully-resolved metadata (raw `prefix` for blob read/write + sanitized `slug` for thumbnail URLs + EXIF date). The admin API reads that single file (falls back to the originals scan if absent). The admin client uses `thumbSlug` for thumbnail URLs and sorts with the same `orderThenDateDesc` policy as the public site.
20. **The schema supported captions but Admin dropped them.** Production had 394 photographs with EXIF but no captions, and uncaptioned gallery links were announced as camera filenames. The consolidated admin index now carries a caption map, the API validates ordered image/caption edits, and Admin exposes a lazy-thumbnail caption editor with completion counts. Captions remain optional and publish with the next rebuild.
21. **Do not mark every above-fold image high priority.** The likely LCP image gets eager/high priority; every other cover/gallery image stays lazy. Blob preconnect removes connection setup from the critical path without creating a network stampede.
22. **The build's own downloads were most of the Azure bill.** GitHub's runners are Azure VMs in other regions, so prebuild's Blob downloads are billed as transfer between regions. Once the full-size prebuild cache (9 GB) and Astro's variants passed GitHub's 10 GB of cache per repository, GitHub evicted one of them on most runs and builds re-downloaded every original: about 1,300 GB and $21 in a month, on a site that otherwise costs about $5. Fix: prebuild works from 2,400 px build copies (the widest page image is 2,000 px; the lightbox loads originals from Blob), keeps them in `metadata/build-copies/`, and prunes its cache to what a run used. Keep the two caches well under 10 GB together.

## Admin panel

The site has an admin page at `/admin` for editing session metadata (title, cover, location, description, display order) from the browser. See [docs/admin.md](admin.md) for full details.

**Key points:**
- Auth: anyone can view the static `/admin` shell, but the API requires a GitHub `x-ms-client-principal` whose normalized username appears in `ADMIN_GITHUB_USERS`. Missing/malformed settings and principals fail closed.
- The session editor is one resizable panel: written metadata on the left, a single photograph grid on the right whose mode (cover / header / rotation / captions) decides what a tap assigns.
- Pickers use two generated sizes from `variants/thumbs/<slug>/` (512px) and `variants/thumbs-lg/<slug>/` (1280px), served through a `srcset` whose `sizes` is measured from the rendered tile, so stretched columns and retina screens get a sharp frame without small tiles paying for it. Both are stamped with the width they were made at, so a size bump regenerates them. The preview overlay loads the full-size frame from the URLs recorded in `admin-index.json`.
- Three tabs: **Sessions** (edit metadata), **Messages** (read contact submissions), **Analytics** (privacy-friendly traffic metrics, see [docs/analytics.md](analytics.md)).
- Writes a `_session.json` sidecar to Blob Storage; next build picks up the changes.
- Cannot upload/delete images, delete sessions, or modify code.

**Setup on a new deployment:** Run the Infra workflow to initialize runtime
storage, salt, and admin settings. Set `GITHUB_TOKEN` (fine-grained PAT,
`actions:write` scope) only if the "Rebuild Site" button should be enabled.

## Scripts and when to use each

| Script | When |
|---|---|
| [scripts/setup-federated-credential.sh](../scripts/setup-federated-credential.sh) | One-time, creates the bootstrap MI the Infra workflow deploys as. Re-run it to print cleanup commands for rights earlier versions granted. |
| [scripts/bootstrap-swa-token.sh](../scripts/bootstrap-swa-token.sh) | After Bicep deploy, populates GH secrets (deploy token, storage account, build identity). |
| [scripts/bind-domain.sh](../scripts/bind-domain.sh) | Once, after `infra` workflow + domain registered. |
| [scripts/upload-session.sh](../scripts/upload-session.sh) `<slug>... \| --all [--build]` | Routine: ship one, several, or every staged session from `staging/` to the private `incoming/` container; the next build removes GPS and publishes it. Needs only `az` (and `gh` for `--build`). |
| [scripts/upload-hobby-media.mjs](../scripts/upload-hobby-media.mjs) `<hobby-slug>` | Hobby gallery photos to `hobby-media/`, and the gallery into the hobby's JSON. |
| [scripts/upload-fishing-catches.mjs](../scripts/upload-fishing-catches.mjs) | The fishing page's catch photos: small committed copies, and full-size originals through the private inbox. |
| [scripts/location.mjs](../scripts/location.mjs) `check \| strip \| blobs [--apply]` | Find or remove GPS positions in local photos, or in every public container. The **Photo locations** workflow runs the container sweep monthly in Actions. |
| `npm run photos -- <command>`, `npm run social -- <command>` | Status, previews and overrides for the caption and Instagram pipelines ([photos.md](photos.md), [social.md](social.md)). |
| [scripts/prebuild.mjs](../scripts/prebuild.mjs) | Runs in CI; locally with `AZURE_STORAGE_ACCOUNT=... node scripts/prebuild.mjs`. |
| [scripts/sync-variants.mjs](../scripts/sync-variants.mjs) | Runs in CI between `astro build` and SWA deploy. |
| [scripts/heic-to-jpeg.py](../scripts/heic-to-jpeg.py) | Called by prebuild; not invoked directly. |
| [scripts/csp-hash.mjs](../scripts/csp-hash.mjs) | `npm run check:csp`: verify all inline script hashes against the SWA policy. |
| [scripts/generate-fixtures.mjs](../scripts/generate-fixtures.mjs) | Local dev only; `--many` makes 40 fake sessions. |

## Workflow triggers (current)

- [build-and-deploy.yml](../.github/workflows/build-and-deploy.yml), push to main, same-repo PRs (with preview environments), hourly cron, manual dispatch, `repository_dispatch: blob-changed`. Concurrency-grouped per ref so newer pushes cancel older runs.
- [infra.yml](../.github/workflows/infra.yml), manual only, in the `prod` environment. Re-run when Bicep changes.
- [lint.yml](../.github/workflows/lint.yml), pushes to main and PRs targeting main.
- [photos.yml](../.github/workflows/photos.yml), twice a day on GitHub's cron, at 3:02 am from the Logic App timer, after a build finds new photos, or manual.
- [social-post.yml](../.github/workflows/social-post.yml), half-hourly from the timer (GitHub's cron as backup), or manual; publishes only with `SOCIAL_LIVE=true`.
- [photo-locations.yml](../.github/workflows/photo-locations.yml), monthly or manual; removes GPS from anything public that still has it.

## Setting up on a new machine

```bash
git clone <repo-url>
cd photography-website

# Install Node 22 + Azure CLI + GitHub CLI + Bicep
# (see README for full install commands)

npm ci
az login --use-device-code
gh auth login
gh auth setup-git

# Verify (substitute your storage account name + repo)
az account show --query name
az storage container list --account-name "$YOUR_STORAGE_ACCOUNT" --auth-mode login --query "[].name" -o table
gh repo view <owner>/<repo>
```

Photos in Blob, secrets in GH, infra in Azure: none is per-machine state. The only per-machine thing is `~/.config/<project>/contact.json` (WHOIS contact info, gitignored), needed only when updating the domain registration.

## Open items (not blocking anything)

- A dormant cleanup item: a leftover service principal from an unrelated project may still have sub-scope perms. Audit periodically with `az role assignment list --include-inherited`.
- The workflows now prefer the Bicep build identity (`AZURE_DEPLOY_CLIENT_ID`) and fall back to the bootstrap MI until that secret exists. Once a build has passed with it, remove the bootstrap MI's `github-main`/`github-pull-request` credentials and its User Access Administrator role (re-run `setup-federated-credential.sh` for the exact commands), and the build identity's unused Storage Table Data Contributor role ([cicd.md](cicd.md#two-identities-least-privilege-by-job)).
