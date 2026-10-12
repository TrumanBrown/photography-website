# CI/CD: what each workflow does and why

> Audience: someone who has read a `.github/workflows/*.yml` file and squinted at it.

## What "CI/CD" is

- **CI (Continuous Integration)** = "every time someone pushes code, run automated checks to catch problems early."
- **CD (Continuous Deployment)** = "every time code passes checks, deploy it automatically."

GitHub Actions is GitHub's built-in CI/CD service. It runs YAML files in `.github/workflows/` on free Linux VMs ("runners"). Each YAML file is a **workflow** containing one or more **jobs**, each with a sequence of **steps**.

For this project we use it for two distinct purposes:
1. **Deploying infrastructure** (rarely, only when Bicep changes).
2. **Building and publishing the site** (often, on every push, every hour, and on demand).

---

## Workflows in this repo

```
.github/workflows/
├── infra.yml              # deploy Bicep (manual trigger)
├── build-and-deploy.yml   # rebuild + publish site (push, hourly, manual)
├── lint.yml               # PR quality gate
├── photos.yml             # photo captions + session descriptions, and Instagram planning (see docs/photos.md)
├── social-post.yml        # optional: publishes the day's Instagram posts (see docs/social.md)
└── photo-locations.yml    # monthly + manual: removes GPS from anything public that still has it

infra/modules/scheduler.bicep  # optional: Azure timer that starts photos.yml and social-post.yml on time
```

### [`infra.yml`](../.github/workflows/infra.yml): deploy Azure infrastructure

**When it runs:** only when you click "Run workflow" in the Actions tab. There is no automatic trigger because deploying infra during a normal site build would be wasteful and risky.

**What it does:**
1. Logs into Azure via OIDC as the bootstrap identity. The job declares `environment: prod`, the only subject that identity trusts ([below](#two-identities-least-privilege-by-job)).
2. Runs `azure/arm-deploy@v2` against `infra/subscription.bicep`. This creates or updates the resource group and everything inside it.
3. Reads the deployment outputs (SWA name/token, storage account name, build identity client ID).
4. Writes the storage connection string and a derived private analytics salt directly to masked SWA app settings. It initializes `ADMIN_GITHUB_USERS` to the invoking user only when no allowlist exists, preserving later manual additions.
5. Writes the deploy token, storage account name and build identity (`AZURE_DEPLOY_CLIENT_ID`) into repo secrets via `gh` if `GH_PAT_FOR_SECRETS` is configured. Otherwise use `scripts/bootstrap-swa-token.sh` once.

**When to run it:**
- First-time setup (after you've created the federated MI via `scripts/setup-federated-credential.sh`).
- Whenever you change anything in `infra/`.
- Whenever you change `domainName` in `main.parameters.json`.
- **Never** for normal site/content changes.

### [`build-and-deploy.yml`](../.github/workflows/build-and-deploy.yml): rebuild and publish the site

**When it runs:**
- `push` to `main` → code changed
- trusted, same-repo `pull_request` to `main` → validation + preview deploy
- Dependabot or fork `pull_request` to `main` → validation build without Azure secrets
- `schedule: '0 * * * *'` → hourly cron, picks up new photos in Blob
- `workflow_dispatch` → manual button for impatience
- `repository_dispatch: blob-changed` → reserved for future Event Grid → webhook hookup; harmless to leave wired

A `concurrency` block cancels older runs on the same branch when a new one arrives, useful when you push three commits in quick succession.

**Steps in order (with explanations):**

1. **Checkout** the repo, pulls the code into the runner's working directory.
2. **Set up Node.js 22** with `actions/setup-node@v4`, caches npm by `package-lock.json` so subsequent runs are fast.
3. **`npm ci`** for the site, then for `api/`: installs dependencies from the lock files. Everything is installed, install scripts included, before the job signs in to anything. Then **`npm test`** runs the pure-logic suite (session/date helpers, prebuild validation and the location check, API auth/rate limiting/IP parsing, Blob URLs, HTML escaping, hobby engines, the photo and social pipelines); a failure stops the run before build or deploy.
4. **Choose the content path.** Trusted events install the image tools (`libraw-bin` for RAW, `exiftool` for removing GPS, `pillow-heif` for iPhone HEIC), sign in to Azure via OIDC as the build identity, restore the prebuild cache, and run `scripts/prebuild.mjs` against Blob. Prebuild first publishes new uploads from the private `incoming` container, removing any GPS position (metadata only; the image itself is untouched), and makes sure no photo it publishes records where it was taken ([security.md](security.md#photo-locations)). The completed prebuild cache is saved immediately for the next run, then its local copy is deleted because the images have already been materialized under `src/content/`. Dependabot and fork PRs cannot receive those secrets, so they run `scripts/generate-fixtures.mjs` instead. Both paths produce schema-valid session content for the same production build command.
5. **Sign out of Azure** before the site build, so Astro, Vite and their plugins never run with a credential.
6. **Restore Astro asset cache**: `.cache/astro/` holds Astro's build cache, including the optimized WebP/JPEG image variants. Persisting it across runs means only new or changed photos get re-encoded by sharp; unchanged variants are reused instead of regenerated from scratch every build.
7. **`npm run build`**: verifies inline CSP hashes and the CSP's storage host, then runs `astro build`. Astro processes images through sharp into WebP/JPEG variants and outputs `dist/`.
8. **Sign in again and sync variants to Blob (trusted events only)**: `scripts/sync-variants.mjs` uploads generated photos to `variants/`, rewrites HTML URLs, and removes those large files from the SWA payload.
9. **Stage `staticwebapp.config.json`** and save the Astro asset cache.
10. **Deploy to SWA (trusted events only)** via `Azure/static-web-apps-deploy@v1` with `skip_app_build: true`. This uses the SWA deploy token, not the Azure sign-in.
11. **Start the photo pipeline** when prebuild found photos it hasn't seen yet (`new_photos` output). The build never calls a model itself; see the next section.

The prebuild cache cleanup is a disk-capacity requirement, not a cache miss. A production run can restore about 5.5 GiB of prebuild inputs and 2.1 GiB of Astro variants. Prebuild copies its cached inputs into `src/content/`, and Astro copies optimized variants into `dist/`; retaining every copy at once can exhaust a GitHub-hosted runner with `ENOSPC` late in image generation. Saving `.cache/prebuild` before deleting the runner's local copy preserves the next run's cache while freeing enough space for Astro and `dist/`.

**PR previews:** trusted same-repo pull requests receive an SWA preview at a unique URL (`pr-<n>-<random>.<region>.azurestaticapps.net`). Dependabot and fork PRs still install, test, build, and validate API dependencies, but skip Azure login, Blob writes, preview deployment, and preview cleanup because GitHub intentionally withholds repository secrets from those events. Once a trusted PR merges or closes, a separate `close_pr` job tears its preview down so it doesn't count against SWA Free's three staging environments. (The trigger lists `closed` explicitly; the build job skips that event.)

### [`photos.yml`](../.github/workflows/photos.yml): photo captions and session descriptions

**When it runs:** once a day from the Azure timer (below), twice a day from its own schedule when GitHub runs it, right after a build finds new photos, or by hand (with `limit`, `overwrite` and `dry_run` options). Only when a model is configured.

**What it does:** looks at each new photo once with a vision model, matches it to your iNaturalist observations, writes every photo's caption and each session's description into `_session.json`, then starts `build-and-deploy.yml` so they go live. With `SOCIAL_ENABLED=true` it also plans and writes the next two weeks of Instagram posts. Needs `actions: write` for that last dispatch. Full walkthrough: [docs/photos.md](photos.md).

### [`social-post.yml`](../.github/workflows/social-post.yml): Instagram posting

**When it runs:** every 30 minutes through the posting day, started by the timer below; on its own half-hourly schedule as a backup; or by hand (tick **force** to post now). Only with `SOCIAL_ENABLED=true`, and it only publishes with `SOCIAL_LIVE=true`.

**What it does:** a dependency-free check decides in seconds whether one of the day's slots is due. If it is, it renders the next planned photo, hands it to Instagram and publishes it, exactly once per slot. Full walkthrough: [docs/social.md](social.md).

### The timer: a Logic App that starts workflows

GitHub's scheduler is best effort and skips many scheduled runs: here an hourly cron ran about every five hours. Posting needs set times, so [infra/modules/scheduler.bicep](../infra/modules/scheduler.bicep) deploys a consumption Logic App that calls GitHub's `workflow_dispatch` API: `social-post.yml` at :02 and :32 from 7 am to 10:32 pm Pacific, and `photos.yml` at 3:02 am. It authenticates with the Static Web App's `GITHUB_TOKEN` setting (a fine-grained token with Actions read and write on this repo), read at deploy time and hidden from the run history. Turn it on with `enableSocialScheduler` in `infra/main.parameters.json`.

### [`photo-locations.yml`](../.github/workflows/photo-locations.yml): photo location sweep

**When it runs:** once a month, or by hand from **Actions → Photo locations → Run workflow**.

**What it does:** installs exiftool, signs in as the build identity, and runs `node scripts/location.mjs blobs --apply`: every photo in the public containers (`originals`, `derivatives`, `hobby-media`, and Astro's copies in `variants`) that still records where it was taken has that removed, in place, with the same URL and headers and the image data untouched. Uploads and builds already prevent this; the sweep cleans up what was published before they did, and a scheduled run that finds anything fails so GitHub emails you. The log shows counts, never file names.

### [`lint.yml`](../.github/workflows/lint.yml): PR quality gate

**When it runs:** on every push to `main` and every PR targeting `main`.

**What it does:**
1. `npm ci`, then installs exiftool so the tests that prove location removal leaves image data byte for byte actually run.
2. **Unit tests** via `npm test` (the pure-logic suite; blocking).
3. **ESLint** via `npm run lint` (blocking).
4. Prettier check (non-blocking, flagged but doesn't fail the PR).
5. Synthesizes fixture sessions via `scripts/generate-fixtures.mjs` (so Astro has content to type-check).
6. Runs `npm run check` (CSP hash and storage-host drift check, plus `astro check`: TypeScript and content schema validation).

This catches broken templates and schema-violating session JSON **before** they hit `main` and break a real build.

Dependabot groups npm minor/patch releases into monthly PRs. Semver-major updates are ignored by automation and handled as explicit migrations, so tightly coupled packages such as Astro, its Tailwind integration, and Tailwind itself are upgraded and tested together instead of producing known-invalid peer dependency combinations.

---

## Why each trigger exists (the cron especially)

The non-obvious one is the **hourly cron**. The site needs to update when you upload photos to Blob, but uploading to Blob doesn't touch the git repo. So how does the site know to rebuild?

Three options:
1. **You click a button every time** (annoying, easy to forget).
2. **A webhook fires the moment a blob changes** (Event Grid + Function → GitHub `repository_dispatch`). Best UX but adds two more pieces of infrastructure.
3. **A cron job rebuilds periodically and notices new files** (free, no extra parts; up to an hour in theory, longer in practice, because GitHub runs schedules best effort and skipped most of this repo's hourly runs).

We chose (3) for now and pre-wired (2): the workflow already accepts the `repository_dispatch: blob-changed` event type, so the day you add the Event Grid plumbing, the workflow needs no change.

In practice you rarely wait on the cron: `./scripts/upload-session.sh <session> --build` starts a build right after uploading, the admin panel's **Rebuild Site** button does the same, and the photo pipeline starts one when it has written new captions. **Run workflow** works any time.

---

## OIDC federation (no long-lived secrets)

The bit most people find surprising: **there is no Azure password stored in GitHub.**

### The traditional way (don't do this)

You'd create a service principal in Azure, get a `client_secret`, paste it into GitHub Actions secrets. If the secret leaks (commit accident, screen share, malicious dependency), an attacker has indefinite access to your Azure subscription.

### The modern way (what we use)

GitHub Actions can mint short-lived **OIDC JSON Web Tokens** (JWTs) that prove "this token was issued by GitHub, for repo X, on branch Y, in workflow run Z." Azure can be configured to **trust** those tokens for a specific managed identity.

The flow:
1. Workflow starts. GitHub mints a JWT with claims about this run.
2. `azure/login@v2` sends the JWT to Azure's token endpoint, saying "give me a token for managed identity ID `<x>`."
3. Azure checks: does that MI have a federated credential whose `subject` matches the JWT's claims? If yes, issues a real Azure token valid for ~1 hour.
4. Subsequent `az` calls use that short-lived token.

After the workflow finishes, the token expires and there's nothing to leak. Even if someone breaks into your runner, they have at most an hour of access.

### Two identities, least privilege by job

Workflows don't all need the same rights, so they don't share an identity:

| | Build identity | Bootstrap identity |
|---|---|---|
| Name | `id-photography-deploy-<env>`, in the site's resource group | `id-photography-bootstrap`, in `rg-photography-bootstrap` |
| Created by | [infra/modules/identity.bicep](../infra/modules/identity.bicep) | [scripts/setup-federated-credential.sh](../scripts/setup-federated-credential.sh) |
| Used by | `build-and-deploy.yml`, `photos.yml`, `social-post.yml`, `photo-locations.yml` | `infra.yml` only |
| Client ID secret | `AZURE_DEPLOY_CLIENT_ID` | `AZURE_CLIENT_ID` |
| Federated credentials (subjects) | `github-main`: `repo:<owner>/<repo>:ref:refs/heads/main`; `github-pull-request`: `repo:<owner>/<repo>:pull_request` | `github-environment-prod`: `repo:<owner>/<repo>:environment:prod` |
| Rights | `Storage Blob Data Contributor` on the storage account, `Reader` on the resource group, `Cognitive Services OpenAI User` on the caption model | `Contributor` on the subscription, `Role Based Access Control Administrator` limited by a condition to assigning the build identity's three roles to service principals |

Why the split matters: the three busy workflows install and run hundreds of npm packages, on every push, every hour, and for pull requests. If one of those packages were compromised, the token it could find would reach blobs in one storage account and nothing else. The subscription-level identity only ever runs Microsoft's deployment action, from a manual workflow, and only for a job that declares `environment: prod`, an environment you can limit to `main` and to required reviewers under **Settings → Environments**.

A job that names an environment presents the subject `...:environment:<name>` instead of its branch, which is why the bootstrap identity trusts the environment and nothing else. To deploy a second environment, run the bootstrap script with `GH_ENVIRONMENTS="prod dev"`.

**Fallback.** Until `AZURE_DEPLOY_CLIENT_ID` exists, the three workflows sign in with `AZURE_CLIENT_ID` (`secrets.AZURE_DEPLOY_CLIENT_ID || secrets.AZURE_CLIENT_ID`). The Infra workflow writes `AZURE_DEPLOY_CLIENT_ID` when `GH_PAT_FOR_SECRETS` is set; otherwise `./scripts/bootstrap-swa-token.sh` does.

**Moving an existing setup over** (if your bootstrap identity was created before this split, it still trusts `main` and pull requests and holds User Access Administrator):

1. Run **Infra (Bicep)** (with `GH_PAT_FOR_SECRETS`), or `./scripts/bootstrap-swa-token.sh <rg> <swa> <owner/repo>`, so `AZURE_DEPLOY_CLIENT_ID` is set.
2. Run **Build and Deploy** and **Photo captions** once and check they pass as the build identity.
3. Re-run `./scripts/setup-federated-credential.sh <subscription-id> <owner> <repo>`. It adds the environment credential and the limited role, and prints the exact `az` commands that delete the old `github-main`/`github-pull-request` credentials and the User Access Administrator assignment from the bootstrap identity. Run them.
4. Optionally remove the build identity's old `Storage Table Data Contributor` assignment, which earlier versions of `identity.bicep` granted and nothing uses: `az role assignment delete --assignee <build identity principal id> --role "Storage Table Data Contributor" --scope <storage account id>`.

## A short npm primer (skip if you know this already)

If you've used Node before, none of this is new. If you haven't:

- **npm** = Node Package Manager. Ships with Node.js. Installs JavaScript packages.
- **`package.json`** = the project's manifest. Lists dependencies and "scripts" (named command shortcuts you can run with `npm run <name>`).
- **`package-lock.json`** = the exact resolved version of every dependency (including transitive). Should always be committed. Guarantees reproducible installs.
- **`node_modules/`** = where npm installs the packages. **Never** committed, recreated from `package-lock.json` on every install.
- **`npm install`** = install dependencies, update `package-lock.json` if anything is missing.
- **`npm ci`** = installer optimized for CI. Wipes `node_modules/` and installs exactly what `package-lock.json` says. Fails if the lock file is out of date. **This is what CI uses; you usually want it locally too.**
- **`npm run dev`** = runs the `dev` script defined in `package.json`. In this project that's `astro dev`, a development server with hot reload on `http://localhost:4321`.
- **`npm run build`** = runs `astro build`. Produces the production `dist/` folder.
- **`npm run fixtures`** = generates fake sessions for local development. See [local-dev.md](local-dev.md).

`npm` "scripts" are arbitrary; you can see all of this project's in [`package.json`'s `scripts` block](../package.json).

---

## Secrets cheat sheet

| Secret | Source | Used by |
|---|---|---|
| `AZURE_CLIENT_ID` | Bootstrap script output (`id-photography-bootstrap`) | OIDC login in `infra.yml`; fallback for the others until `AZURE_DEPLOY_CLIENT_ID` exists |
| `AZURE_DEPLOY_CLIENT_ID` | Bicep output `managedIdentityClientId` (`id-photography-deploy-<env>`), written by the Infra workflow or `bootstrap-swa-token.sh` | OIDC login in `build-and-deploy.yml`, `photos.yml`, `social-post.yml`, `photo-locations.yml` |
| `AZURE_TENANT_ID` | Bootstrap script output | OIDC login |
| `AZURE_SUBSCRIPTION_ID` | You enter it | OIDC login |
| `GH_PAT_FOR_SECRETS` | You generate it (optional): fine-grained, **Secrets: Read and write** on this repo only | Infra workflow auto-writes the deploy token, storage account and build identity secrets |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Bicep output | `Azure/static-web-apps-deploy@v1` step |
| `AZURE_STORAGE_ACCOUNT` | Bicep output | `scripts/prebuild.mjs`, `sync-variants.mjs` and the photo and posting pipelines (env var) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | You create them (optional) | `photos.yml`, only when not using keyless Azure OpenAI, see [docs/photos.md](photos.md#settings) |
| `IG_ACCESS_TOKEN`, `SOCIAL_SECRET_KEY`, `IG_USER_ID` | You create them (optional) | `photos.yml` and `social-post.yml`, see [docs/social.md](social.md#settings) |

The four `AZURE_*` IDs are identifiers, not credentials: without a matching
GitHub OIDC token they grant nothing. They're secrets so they stay out of logs.

Runtime-only values (`AZURE_STORAGE_CONNECTION_STRING`, `ANALYTICS_SALT`, and
`ADMIN_GITHUB_USERS`) live in SWA app settings, not GitHub Actions secrets. The
Infra workflow initializes them without printing their values.
