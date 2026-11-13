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

A runbook for one of Truman's PCs: Windows with WSL (Ubuntu 24.04) and VS Code connected to WSL. Work
moved from the laptop to the desktop on 2026-11-12 and switches between them from then on. An agent
can follow it top to bottom. Run every command inside WSL as your normal Linux user, not `root`.
The Linux user name may differ from the laptop's, so paths below use `~`.

### What comes over by itself and what doesn't

| What | How it gets to the new PC |
|---|---|
| Code, skills, instructions, docs | this repo (step 6) |
| His always-on Copilot rules, personal skills and hooks | the private repo `TrumanBrown/copilot-home`, checked out as `~/.copilot` (step 4) |
| Copilot Memory | stored on his GitHub account, nothing to do |
| `mocks/` and `scripts-local/` (gitignored here) | the private repo `TrumanBrown/photography-website-local`, synced by a hook (step 7) |
| The laptop's Copilot chats, June to 2026-11-12 | a release asset on that private repo, unpacked into `~/.copilot/session-archive/` (step 8) |
| Photos, secrets, app settings, infra | already in Blob, GitHub and Azure; nothing is per machine |
| `.env` (photography tenant and subscription for uploads) | recreate it (step 6) |
| Sign-ins (GitHub, Azure, VS Code), installed tools | redo them (steps 1 to 5) |
| `staging/` | not synced. Every zip in it is already a session in Blob (checked 2026-11-12). Copy a folder over only to upload it from this PC |
| VS Code's own chat history | stays on each PC. The laptop's is in the step 8 archive |

### 1. Windows side

- WSL with Ubuntu 24.04 and a normal default user (`wsl --install -d Ubuntu-24.04` in an admin
  PowerShell, then pick a user name).
- VS Code with the WSL and GitHub Copilot extensions, signed in to GitHub as TrumanBrown. Open the
  checkout through WSL (`code ~/projects/photography-website` from a WSL shell).
- Files go to Truman as `\\wsl.localhost\Ubuntu\home\<user>\...` paths from `wslpath -w` (or
  `C:\Users\<user>\...` for a file on the Windows side), printed in full as text he can copy, and
  servers as `http://localhost:<port>/` links. WSL forwards localhost to Windows. A `file:///C:/...`
  link, or a link that shows only the file name, doesn't open from a WSL VS Code window.

### 2. Tools inside WSL

```bash
sudo apt-get update
sudo apt-get install -y git gh xz-utils unzip python3-pip libraw-bin libimage-exiftool-perl ripgrep sqlite3

# Node 22 through nvm (.nvmrc says 22; 22.23.4 or newer)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 22 && nvm alias default 22

# Azure CLI for Linux, and Bicep
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
az bicep install

# iPhone HEIC conversion, for prebuild:remote and the fishing catches
python3 -m pip install --user --break-system-packages pillow pillow-heif
```

Then open a new shell and check that `which node npm` points into `~/.nvm` and `which az` is
`/usr/bin/az`. WSL also puts Windows programs on PATH, and a Windows `node` running the tests is a
known trap (ship-and-ci gotchas). The laptop used the Windows `az` from `/mnt/c`, which works with
the quirks in the azure-ops skill. The Linux one avoids them. The desktop already had NodeSource's
Node 22 in `/usr/bin`. Leave it: a new shell still finds nvm's first, and it keeps the Windows `node`
from being found where nvm isn't loaded.

`ripgrep` and `sqlite3` are for searching the laptop's chats (step 8). If `sudo` asks for a password,
ask Truman. He can type it, or approve running the one command as root with
`wsl.exe -u root -- <command>`, which is how the desktop got `ripgrep`, `sqlite3` and the step 6 fix.

Optional, for screenshots and browser checks: `npx playwright install chromium`, plus the libraries
in the design-mocks skill's gotchas if Chromium won't start.

### 3. GitHub sign-in and git identity

```bash
gh auth login --web --git-protocol https --scopes workflow     # as TrumanBrown
gh auth setup-git
git config --global user.name "Truman Brown"
git config --global user.email "trumanbrown@users.noreply.github.com"
```

WSL can't open a browser, so open https://github.com/login/device on Windows and type the code `gh`
prints. The email is the author on recent commits to `main`
(`git log -1 --format='%an <%ae>' origin/main` once the repo is cloned). Never his personal Gmail
(ship-and-ci lesson 10) and never a work account.

The `workflow` scope lets `git push` change `.github/workflows/`, which happens most weeks. Without
it the push is refused ("refusing to allow an OAuth App to create or update workflow"). If `gh` is
already signed in as TrumanBrown, `gh auth status` lists its scopes, and
`gh auth refresh -h github.com -s workflow` adds a missing one with another code.

### 4. copilot-home (`~/.copilot`)

VS Code's Copilot may already have created `~/.copilot`. Back up anything personal in it, then turn
it into a checkout of his private repo (the repo's own README has the long version):

```bash
mkdir -p ~/.copilot/backups/$(date +%F)
cp -a ~/.copilot/copilot-instructions.md ~/.copilot/skills ~/.copilot/backups/$(date +%F)/ 2>/dev/null
cd ~/.copilot
git init -b main
git remote add origin https://github.com/TrumanBrown/copilot-home.git
git fetch origin
git reset origin/main
git checkout -- .
git branch -u origin/main
git config user.name "Truman Brown"
git config user.email "70858679+TrumanBrown@users.noreply.github.com"
sleep 60    # sync.sh skips a pull within a minute of the last fetch
bash ~/.copilot/home-sync/sync.sh pull && bash ~/.copilot/home-sync/sync.sh push
cat ~/.copilot/logs/copilot-home-sync.log 2>/dev/null || echo "no log, so no errors"
```

`git status` should then be clean. This brings `copilot-instructions.md`, the personal skills, and
`hooks/copilot-home.json` with its scripts in `home-sync/`: `sync.sh` keeps `~/.copilot` itself in
step, and `photo-local.sh` handles this repo (step 7). The log is only written when something goes
wrong.

If Copilot also runs on Windows itself (VS Code without WSL, or the Copilot CLI or app), do the same
in `%USERPROFILE%\.copilot` with the README's Windows steps: Git for Windows' `git.exe`, the
repo-level Git Credential Manager settings for TrumanBrown (the desktop's global Windows git
identity is his work one), and `sync.ps1` instead of `sync.sh`. Back up and delete a
`skills\truman-voice` left by the October voice pack. It's `email-voice` now.

### 5. Azure sign-in

```bash
az login --tenant <photography tenant id> --use-device-code
az account set --subscription <photography subscription id>
az account show --query "{name:name, tenant:tenantId}"
az storage container list --account-name <account> --auth-mode login --query "[].name" -o tsv
```

The ids are in the laptop's `.env` (step 6) or the Azure portal. Plain `az login` against that
tenant failed once with AADSTS50076 (MFA required); `--tenant ... --use-device-code` works. The
account is the host in `blobHost` in `site.config.ts` without `.blob.core.windows.net`. His account
already has the Storage Blob Data role on it, so the last command lists `originals`, `incoming`
and the rest. If `az` is still signed in to a work account, sign in to the photography tenant before
any Azure command (azure-ops gotchas).

Without the laptop's `.env`, the storage account names its own tenant:
`curl -s -o /dev/null -D - -H 'Authorization: Bearer x' "https://<account>.blob.core.windows.net/?comp=list" | grep -i www-authenticate`
shows `login.microsoftonline.com/<tenant id>`. After signing in, the subscription is the one where
`az storage account list --subscription <id> --query "[?name=='<account>']"` isn't empty.

### 6. This repo

If the PC had a checkout before (the desktop had one from June), save what isn't on GitHub, then
delete it: uncommitted changes (`git status`), commits on no remote as `git format-patch` files
(`git log --branches --not --remotes`, and `git log --reflog --not --remotes` for ones a rebase left
behind), `git stash list`, and the gitignored `staging/`, `mocks/`, `scripts-local/` and `.env`.
Check `~/projects/photography-website.worktrees/` and `~/projects/photography-website-local.git`
too. The desktop's went to `~/backups/photography-website-2026-11-12/`.

If `ls -ld ~/projects` shows `root` (the desktop's did, from when WSL ran as root), run
`sudo chown "$USER": ~/projects` first. Otherwise the clone, `photo-local.sh setup` (step 7 puts its
git directory beside the checkout) and worktrees all fail.

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/TrumanBrown/photography-website.git
cd photography-website
nvm use
npm ci && npm ci --prefix api
node scripts/generate-fixtures.mjs    # npm run check needs a session JSON
```

Then create `.env` in the checkout (gitignored, never committed), with the same two values as step 5:

```bash
cat > .env <<'EOF'
# Azure tenant & subscription for the photography site. Gitignored, never commit.
AZURE_TENANT_ID=<photography tenant id>
AZURE_SUBSCRIPTION_ID=<photography subscription id>
EOF
```

`scripts/upload-session.sh` reads it and switches `az` to that tenant before uploading. Without it,
an `az` on another tenant fails with "Issuer validation failed".

### 7. `mocks/` and `scripts-local/`

They're gitignored here, so a second, private repo tracks just those two folders:
`TrumanBrown/photography-website-local`. Its git directory sits beside the checkout, at
`~/projects/photography-website-local.git`, and uses the checkout as its work tree, so the folders
stay at their usual paths and the mock skills and prep scripts work unchanged. This repo never sees
the git directory or the files.

```bash
bash ~/.copilot/home-sync/photo-local.sh setup ~/projects/photography-website
bash ~/.copilot/home-sync/photo-local.sh git status -sb    # "## main...origin/main" and nothing else
```

`setup` clones the private repo and checks the two folders out. If either folder already exists, it
first moves it to `~/projects/photography-website-local-backup-<time>/`.

The hook in `~/.copilot/hooks/copilot-home.json` then keeps both PCs in step:

- When a Copilot session starts in the main checkout, it runs `git pull --ff-only` on this repo (at
  most once a minute), commits any local change to the two folders, pulls the private repo with a
  rebase, and pushes in the background.
- When a turn ends, it commits and pushes the two folders in the background.
- Worktrees and every other folder are skipped. It never holds a session up. Files over 50 MB and
  `node_modules` stay local, and a change that looks like it holds a key isn't committed. Each
  problem goes in `~/.copilot/logs/photo-local-sync.log`.

Run git for these folders through the script (`photo-local.sh git <args>`). Plain `git` in the
checkout talks to this public repo. If the log says the pull failed after the same file changed on
both PCs, nothing is lost; finish it by hand:

```bash
S=~/.copilot/home-sync/photo-local.sh
bash $S git pull --rebase          # stops at the conflict
# fix the file, then
bash $S git add <file> && bash $S git rebase --continue && bash $S git push
```

If the log says the public pull failed, there were local commits or an edit in the way: run
`git pull --rebase` in the checkout before loading skills.

### 8. The laptop's chats

```bash
mkdir -p ~/.copilot/session-archive && cd ~/.copilot/session-archive
gh release download chats-laptop-2026-11-12 --repo TrumanBrown/photography-website-local
sha256sum -c copilot-chats-laptop-2026-11-12.tar.xz.sha256
tar -xJf copilot-chats-laptop-2026-11-12.tar.xz && rm copilot-chats-laptop-2026-11-12.tar.xz*
```

About 470 MB to download and 930 MB unpacked: all 46 Copilot CLI sessions (full event logs,
checkpoints, plans, small files), `session-store.db`, and VS Code's own chat history for this repo.
Bulky scratch files (Python environments, node_modules, Chromium libraries, frame dumps, large
renders) were left out, and keys, tokens, connection strings, SAS signatures and auth cookies were
replaced with `[REDACTED:<kind>]`. Its `README.md` says how to search it and `INDEX.md` lists every
session. Search with `rg` over the folder: the bundled `session-store.db` indexes only 6 of the 46
sessions, so `sqlite3` finds far less. `~/.copilot/copilot-instructions.md` tells Copilot to search it when he asks about past
work. Don't move it into `~/.copilot/session-state/`; it's for reading.

### 9. Restart and check

1. Close every VS Code window and open the checkout again. A running Copilot caches instructions and
   hooks, so a new chat alone isn't enough the first time. Developer: Reload Window reloads those,
   but VS Code's WSL server keeps the PATH it read when it started, so right after installing nvm a
   reloaded chat still runs an older `node`. If `which node` in the new chat isn't under `~/.nvm`,
   run `wsl --shutdown` in PowerShell and open the checkout again.
2. Start a Copilot chat in `~/projects/photography-website`, then read
   `~/.copilot/logs/photo-local-sync.log` and `~/.copilot/logs/copilot-home-sync.log`. No new lines
   means both syncs worked.
3. `npm test && npm run lint && npm run check`. ESLint errors under `mocks/` are local only.
   `npx eslint . --ignore-pattern 'mocks/**'` shows what CI sees.
4. `gh run list --limit 3` and `az account show` both answer.
5. Ask Copilot something only the skills know (for example "what did Truman say about the globe
   spin?") to see the repo's skills load.

### Day to day on two PCs

- Skills, docs and code move only through commits to `main`, so finish and push work before
  switching PCs (`Finishing a change` in copilot-instructions.md). The next session on the other PC
  pulls it.
- Mocks move at the end of every turn. A mock edited outside Copilot moves at the next session
  start in the checkout, or with `bash ~/.copilot/home-sync/photo-local.sh push ~/projects/photography-website`.
- `staging/`, `.env`, sign-ins and tools stay per PC. Upload a session from the PC that has its
  photos.
- `~/.config/<project>/contact.json` (WHOIS contact info, gitignored) is needed only when updating
  the domain registration, and only on the PC that does it. The desktop's is in
  `~/.config/photography-website/`, copied from root's home on 2026-11-12.

## Open items (not blocking anything)

- A dormant cleanup item: a leftover service principal from an unrelated project may still have sub-scope perms. Audit periodically with `az role assignment list --include-inherited`.
- The workflows now prefer the Bicep build identity (`AZURE_DEPLOY_CLIENT_ID`) and fall back to the bootstrap MI until that secret exists. Once a build has passed with it, remove the bootstrap MI's `github-main`/`github-pull-request` credentials and its User Access Administrator role (re-run `setup-federated-credential.sh` for the exact commands), and the build identity's unused Storage Table Data Contributor role ([cicd.md](cicd.md#two-identities-least-privilege-by-job)).
- Keep dependency advisory checks green after upgrades ([security.md](security.md#dependency-advisory-checks)). The site now uses Astro 7, JSON glob loaders in `src/content.config.ts`, and Tailwind v3 through PostCSS.
