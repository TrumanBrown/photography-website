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
└── lint.yml               # PR quality gate
```

### [`infra.yml`](../.github/workflows/infra.yml): deploy Azure infrastructure

**When it runs:** only when you click "Run workflow" in the Actions tab. There is no automatic trigger because deploying infra during a normal site build would be wasteful and risky.

**What it does:**
1. Logs into Azure via OIDC (see below).
2. Runs `azure/arm-deploy@v2` against `infra/subscription.bicep`. This creates or updates the resource group and everything inside it.
3. Reads the deployment outputs (SWA name/token and storage account name).
4. Writes the storage connection string and a derived private analytics salt directly to masked SWA app settings. It initializes `ADMIN_GITHUB_USERS` to the invoking user only when no allowlist exists, preserving later manual additions.
5. Writes the deploy token and storage account name into repo secrets via `gh` if `GH_PAT_FOR_SECRETS` is configured. Otherwise use `scripts/bootstrap-swa-token.sh` once.

**When to run it:**
- First-time setup (after you've created the federated MI via `scripts/setup-federated-credential.sh`).
- Whenever you change anything in `infra/`.
- Whenever you change `domainName` in `main.parameters.json`.
- **Never** for normal site/content changes.

### [`build-and-deploy.yml`](../.github/workflows/build-and-deploy.yml): rebuild and publish the site

**When it runs:**
- `push` to `main` → code changed
- `pull_request` to `main` → preview deploy
- `schedule: '0 * * * *'` → hourly cron, picks up new photos in Blob
- `workflow_dispatch` → manual button for impatience
- `repository_dispatch: blob-changed` → reserved for future Event Grid → webhook hookup; harmless to leave wired

A `concurrency` block cancels older runs on the same branch when a new one arrives, useful when you push three commits in quick succession.

**Steps in order (with explanations):**

1. **Checkout** the repo, pulls the code into the runner's working directory.
2. **Set up Node.js 22** with `actions/setup-node@v4`, caches npm by `package-lock.json` so subsequent runs are fast.
3. **`npm ci`**: installs dependencies from `package-lock.json`. Immediately after, **`npm test`** runs pure-logic coverage for session/date helpers, prebuild validation/cache keys, API auth/rate limiting/IP parsing, Blob URLs, HTML escaping, and hobby engines; a failure stops the run before build or deploy.
4. **Install `libraw-bin`** via apt with cache, needed for Sony `.ARW` RAW conversion. See [image-pipeline.md](image-pipeline.md#raw-files-sony-arw-and-friends).
5. **Azure login (OIDC)**: assumes the managed identity created in `infra/`. No password, no token in secrets. Explained below.
6. **Restore prebuild cache**: `.cache/prebuild/` is a folder of already-downloaded images from previous runs, keyed by blob ETag. Lets incremental builds skip re-downloading unchanged photos.
7. **Run `scripts/prebuild.mjs`**: scans Blob, downloads new photos, converts RAW, writes Astro content collection. Full mechanics: [image-pipeline.md](image-pipeline.md).
8. **Restore Astro asset cache**: `.cache/astro/` holds Astro's build cache, including the optimized WebP/JPEG image variants. Persisting it across runs means only new or changed photos get re-encoded by sharp; unchanged variants are reused instead of regenerated from scratch every build.
9. **`npm run build`**: verifies inline CSP hashes, then runs `astro build`. Astro processes images through sharp into WebP/JPEG variants and outputs `dist/`.
10. **Sync variants to Blob**: `scripts/sync-variants.mjs` uploads generated photos to `variants/`, rewrites HTML URLs, and removes those large files from the SWA payload.
11. **Stage `staticwebapp.config.json`**, save caches, and install the API package's locked dependencies.
12. **Deploy to SWA** via `Azure/static-web-apps-deploy@v1` with `skip_app_build: true`.

**PR previews:** when the trigger is a `pull_request`, SWA automatically spins up a preview environment at a unique URL (`pr-<n>-<random>.<region>.azurestaticapps.net`). Once you merge or close the PR, a separate `close_pr` job tears the preview down so it doesn't count against quotas.

### [`lint.yml`](../.github/workflows/lint.yml): PR quality gate

**When it runs:** on every push to `main` and every PR targeting `main`.

**What it does:**
1. `npm ci`
2. **Unit tests** via `npm test` (the pure-logic suite; this one is blocking).
3. Prettier check (non-blocking, flagged but doesn't fail the PR).
4. Synthesizes fixture sessions via `scripts/generate-fixtures.mjs` (so Astro has content to type-check).
5. Runs `npm run check` (CSP hash drift check plus `astro check`, TypeScript, and content schema validation).

This catches broken templates and schema-violating session JSON **before** they hit `main` and break a real build.

---

## Why each trigger exists (the cron especially)

The non-obvious one is the **hourly cron**. The site needs to update when you upload photos to Blob, but uploading to Blob doesn't touch the git repo. So how does the site know to rebuild?

Three options:
1. **You click a button every time** (annoying, easy to forget).
2. **A webhook fires the moment a blob changes** (Event Grid + Function → GitHub `repository_dispatch`). Best UX but adds two more pieces of infrastructure.
3. **A cron job rebuilds periodically and notices new files** (free, no extra parts, latency ~30 min worst case).

We chose (3) for now and pre-wired (2): the workflow already accepts the `repository_dispatch: blob-changed` event type, so the day you add the Event Grid plumbing, the workflow needs no change.

If hourly latency annoys you, click **Run workflow** for instant rebuild.

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

### How this is set up

- The user-assigned MI created by `scripts/setup-federated-credential.sh` has two federated credentials:
  - `github-main` with subject `repo:<owner>/<repo>:ref:refs/heads/main`
  - `github-pull-request` with subject `repo:<owner>/<repo>:pull_request`
- Only workflow runs matching those subjects can assume the MI.
- The Bicep-managed identity for the build pipeline has the same shape via `modules/identity.bicep`.

The only "secrets" you ever put in GitHub are:
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, these are IDs, not passwords. Knowing them does not grant access.
- `AZURE_STATIC_WEB_APPS_API_TOKEN`, the one real secret. SWA insists on it for the deploy step; rotate by re-deploying the SWA module.
- `AZURE_STORAGE_ACCOUNT`, just the account name.

---

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
| `AZURE_CLIENT_ID` | Bootstrap script output | OIDC login in both workflows |
| `AZURE_TENANT_ID` | Bootstrap script output | OIDC login |
| `AZURE_SUBSCRIPTION_ID` | You enter it | OIDC login |
| `GH_PAT_FOR_SECRETS` | You generate it (optional) | Infra workflow auto-writes other secrets |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Bicep output | `Azure/static-web-apps-deploy@v1` step |
| `AZURE_STORAGE_ACCOUNT` | Bicep output | `scripts/prebuild.mjs` (env var) |

Runtime-only values (`AZURE_STORAGE_CONNECTION_STRING`, `ANALYTICS_SALT`, and
`ADMIN_GITHUB_USERS`) live in SWA app settings, not GitHub Actions secrets. The
Infra workflow initializes them without printing their values.
