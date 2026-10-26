# Security plan: every threat surface and the mitigation

> Audience: anyone who wants to understand or audit the site's posture.

## TL;DR

The site has no visitor accounts or custom user database. An `/admin` panel uses
**SWA built-in GitHub authentication** plus a server-side username allowlist,
see [docs/admin.md](admin.md). Three small Functions handle contact messages,
analytics, and admin operations, so the runtime surface is intentionally narrow
but not zero. What we focus on:

- Lock down the storage account so attackers can't enumerate or modify it.
- Never publish where a photo was taken: GPS is stripped from every photo before it's public, and the globe and maps only use coarse, hand-picked points. See [Photo locations](#photo-locations).
- Send strong HTTP security headers so visitors' browsers refuse to be misused.
- Gate every admin API operation with a fail-closed GitHub-principal allowlist.
- Use short-lived OIDC credentials for CI, with a least-privilege identity for everything that runs third-party code, and isolate the unavoidable runtime connection string in SWA app settings. See [GitHub Actions and Azure identities](#github-actions-and-azure-identities).
- Collect analytics **without retaining raw IPs or cookie identifiers**, see [docs/analytics.md](analytics.md).
- Be honest about what's worth defending vs. what would just inflate the bill.

### Analytics endpoint

`/api/track` is an anonymous POST endpoint that records pageviews. It is hardened against abuse and privacy issues:
- **No raw network identifier stored.** Unique visitors are counted via a daily-salted `sha256(ip + ua + date + salt)` hash; the raw IP and user-agent are never persisted. No cookies or persistent client identifiers.
- **Input is bounded and sanitized** (path/referrer length caps, duration sanity range, bot-UA filtering). Referrers are reduced to hostname only.
- **Fails silently**: the function always returns 204 and never surfaces errors to the page, so analytics can't break the site.
- Worst-case abuse is a flood of fake pageview rows in the `pageviews` table (cosmetic, cheap to clear). No data exposure, no write access to anything else.

---

## Threat surfaces and mitigations

### TLS / HTTPS / certificates

| Surface | Mitigation |
|---|---|
| Plaintext HTTP traffic | SWA enforces HTTPS-only. `http://` URLs redirect with 301 to `https://`. |
| Certificate expiry | SWA auto-provisions and auto-renews TLS certificates for the default hostname and every custom domain. You never see a cert file. |
| Old TLS versions on blob endpoint | Storage account configured `minimumTlsVersion: TLS1_2` and `supportsHttpsTrafficOnly: true`. |
| Downgrade attacks | HSTS header with `max-age=63072000; includeSubDomains; preload`, browsers refuse `http://` for two years. |

### HTTP security headers

Delivered via [staticwebapp.config.json](../staticwebapp.config.json) `globalHeaders` block, applied to every response.

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Force HTTPS for 2 years. |
| `Content-Security-Policy` | See below | Browser refuses to execute resources outside the allowlist. |
| `X-Content-Type-Options` | `nosniff` | Browsers don't guess file types; prevents `.jpg` containing JS from executing. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Outbound links leak only origin, not full URL. |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), payment=()` | Deny powerful APIs, except `camera` for the site's own origin (the Birding hobby's optional selfie capture; see note below). |
| `X-Frame-Options` | `DENY` | Other sites can't iframe yours (clickjacking). |
| `Cross-Origin-Opener-Policy` | `same-origin` | A page this site opens, or one that opens it, can't reach back into it through `window.opener` (tab-nabbing, cross-window leaks). The site's own new-tab links already use `noopener`. |
| `Cross-Origin-Resource-Policy` | `same-site` | Other sites can't embed the site's own files (scripts, fonts, plates). The photos come from Blob Storage, which this header doesn't cover. |

The `/admin` routes add `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`, so the admin shell is never cached by a browser or proxy and never listed by a search engine. `Cross-Origin-Embedder-Policy` is left off: it would block the iNaturalist photos on the hobby pages, which don't send the header it needs.

#### Error pages

`responseOverrides` in the same file serve the site's own pages for errors: 404 shows [404.astro](../src/pages/404.astro) (with links back to the archive), 403 shows [403.astro](../src/pages/403.astro) (built to `/403/index.html`, which is what the override names), and 401 sends you to the GitHub sign-in for `/admin`. Both pages are `noindex`. Static Web Apps doesn't let a site replace its 5xx pages, and a static page can't throw one; the API functions answer their own errors as JSON with flat, detail-free messages.

#### security.txt

[/.well-known/security.txt](https://trumanbrown.com/.well-known/security.txt) ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)) tells researchers where to report a problem: GitHub's private vulnerability reporting, as in [SECURITY.md](../SECURITY.md). It's built by [security.txt.ts](../src/pages/.well-known/security.txt.ts) from [src/lib/security-txt.ts](../src/lib/security-txt.ts). The RFC requires an `Expires` date, so the build sets it 180 days ahead and every build moves it forward. If the site went six months without a build, the file would say it had expired, which is accurate.

#### The CSP unpacked

```
default-src 'self';
img-src 'self' https://<account>.blob.core.windows.net https://static.inaturalist.org https://inaturalist-open-data.s3.amazonaws.com data: blob:;
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self' blob:;
connect-src 'self' https://<account>.blob.core.windows.net https://api.inaturalist.org;
frame-src https://www.youtube-nocookie.com;
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
object-src 'none';
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

(The live policy in [staticwebapp.config.json](../staticwebapp.config.json) names the real storage account, `blobHost` in [site.config.ts](../site.config.ts), and also carries four `sha256` hashes in `script-src`: two for the dark-mode inline scripts, one for the home page's lead photograph chooser and one for the check that opens a page the way the last one left it (a session on the photograph a globe spin or a card grew into, a hobby on the frame or big dots its card's scene left it on, starting the scene's worker); they are omitted above for readability.)

Translation:
- **`default-src 'self'`**: load resources only from the site's own origin unless overridden.
- **`img-src ... data: blob:`**: also allow images from the site's own storage account (lightbox full-res, hobby photos), the iNaturalist photo CDNs (the tide-pooling observations grid and species photos), `data:` URIs (inlined SVG icons), and `blob:` object URLs (the Birding island's local selfie preview). Naming the one account, rather than `*.blob.core.windows.net`, means injected markup can't load from, or send data to, some other storage account.
- **`script-src 'self' 'wasm-unsafe-eval'`**: own-origin scripts only. `'wasm-unsafe-eval'` lets the Birding island compile the self-hosted MediaPipe WASM; it permits WebAssembly only, **not** JavaScript `eval`.
- **`worker-src 'self' blob:`**: the hobby cards' opening scenes draw in a same-origin worker (`/_astro/worker-…js`, see [hobbies.md](hobbies.md#opening-scenes)), and the MediaPipe runtime spawns a same-origin worker (and a `blob:` worker) to run the landmark model off the main thread. The scene worker fetches plates from the storage account, which `connect-src` already allows.
- **`connect-src 'self' ...`**: own origin (the Birding model + WASM are fetched from `/birding/`, so `'self'` covers them), the site's storage account (lightbox original download), and the public iNaturalist API.
- **`frame-src https://www.youtube-nocookie.com`**: the one thing the site puts in an iframe, the video of the tank on the aquarium page, in YouTube's privacy-enhanced player ([hobbies.md](hobbies.md#a-video-of-the-real-thing)). The page talks to it over `postMessage` instead of loading YouTube's iframe API script, so `script-src` stays `'self'`. The player's own requests are governed by YouTube, not this policy. Without this directive `default-src 'self'` blocks every iframe.
- **`style-src 'self' 'unsafe-inline'`**: `'unsafe-inline'` is required by Astro's scoped style blocks. Can be tightened later with hashes; modest risk.
- **`object-src 'none'`**: no `<object>` / `<embed>` / Flash-era nonsense.
- **`frame-ancestors 'none'`**: modern equivalent of `X-Frame-Options: DENY`.
- **`base-uri 'self'`**: attackers can't inject a `<base>` tag pointing relative URLs elsewhere.
- **`form-action 'self'`**: forms can only submit to the site's own origin (contact form, admin).

`npm run check:csp` verifies every inline script (the two dark-mode ones,
the lead photograph chooser and the page landing) against the configured hashes, and that the
policy's storage host is exactly `blobHost` from `site.config.ts`. It runs as
part of `npm run check` and `npm run build`, so changing an inline script or the
storage account without updating the policy fails before deployment. If you add
another inline script, add its hash rather than enabling `'unsafe-inline'`.

The JSON-LD blocks on the home, session and places pages go through
`jsonForScript` in [src/lib/html.ts](../src/lib/html.ts), which escapes `<`, so
a title or caption containing `</script>` can't end the block and inject markup.

### Contact form abuse

The public contact endpoint (`api/contact`) has layered protection:

- **Honeypot field.** A hidden `website` input that humans never see. Bots that fill it get a fake success and are silently dropped.
- **Server-side validation.** Name, email, and message are length-checked and the email is format-checked before anything is stored. Nothing is emailed, so there are no mail headers to inject.
- **Per-IP rate limit.** Each client is capped at five messages per hour. The limiter stores only a secret-salted, truncated hash of the IP, never the raw IP, in a `contactratelimit` table. ETag-conditional updates prevent parallel requests from overwriting the count. It fails open on a storage outage so a legitimate message is not rejected solely because the limiter is unavailable.
- **Limits of the limit.** The client IP is the first `X-Forwarded-For` entry SWA hands the Function ([api/shared/client-ip.js](../api/shared/client-ip.js)). SWA doesn't document whether a client-supplied value can survive there, so treat the limit as a speed bump against floods, not a guarantee.

### Blob storage access controls

| Surface | Mitigation |
|---|---|
| Shared access keys leaking | Shared-key access is enabled because SWA Free managed Functions cannot use a managed identity for these data-plane calls. The connection string is stored only as a masked SWA app setting and is never emitted to git or GitHub secrets. Build-time access still uses short-lived OIDC credentials. Rotate storage keys and re-run Infra if exposure is suspected. |
| Anonymous enumeration of all your photos | Containers use public-access level `Blob`, **not** `Container`. Anonymous users can `GET` a blob if they know its URL; they cannot list the container's contents. `metadata` (manifest, admin index, pipeline state, the sealed Instagram token) and `incoming` (new uploads waiting for a build) are fully private. |
| Pipeline credentials sitting in env vars | Workflows authenticate as managed identities via OIDC federation. No keys, no PATs. Tokens are short-lived, and the identity that runs third-party build code can only touch blobs in this one storage account. See [GitHub Actions and Azure identities](#github-actions-and-azure-identities). |
| Unauthorized writes to `originals/` | RBAC: the build identity has `Storage Blob Data Contributor` on this account only; the admin Function writes `_session.json` through the connection string after its allowlist check. Public users have read-only access to known URLs. |
| Contact messages and analytics rows | Live in Table Storage, which only the Functions (connection string) and you can read. The CI identities have no table role. |
| Accidental delete or overwrite | 7-day blob soft-delete enabled, which also keeps the previous bytes as a snapshot when a blob is overwritten. Recover via `az storage blob undelete` (and, for an overwrite, copy the restored snapshot back over the blob). |

### Photo locations

Phones, and cameras paired with one, write where each frame was taken into the
file, to within a few metres. The photo containers are readable by anyone with
a URL, the lightbox links straight to full-size originals, and Astro copies the
originals byte for byte into `variants/`. So a photo taken at home would
publish the address. The rule is that no published file records a position.
[scripts/location.mjs](../scripts/location.mjs) does the removing, with
exiftool: it deletes the EXIF GPS block and XMP geotags and rewrites nothing
else, so the compressed image data stays byte for byte what was uploaded (a
test checks exactly that), at full resolution, with camera, lens, exposure and
capture time kept. All of it runs in GitHub Actions; nothing is needed on your
machine.

| Where | What happens |
|---|---|
| Upload ([scripts/upload-session.sh](../scripts/upload-session.sh), [scripts/upload-hobby-media.mjs](../scripts/upload-hobby-media.mjs)) | Photos go to the private `incoming` container, unreadable by URL. Nothing is changed on your machine. |
| Every build, first ([scripts/prebuild.mjs](../scripts/prebuild.mjs), `publishIncoming`) | Removes the position from anything in `incoming` that records one, then publishes it to `originals` (or `hobby-media`) and deletes it from `incoming`. A photo that can't be cleaned stops the build and stays private. |
| Every build, per photo (`keepLocationsPrivate`) | A backstop for photos put in `originals` some other way (Storage Explorer, `az`) and ones published before any of this existed. Once per photo and ETag it checks the working copy Astro reads and, for HEIC/RAW, the source file (its URL is easy to guess from the derivative's), and strips whatever records a position everywhere it's published, keeping each blob's name and headers. A working copy, derivative, linked original or new HEIC/RAW source that can't be cleaned fails the build; a HEIC/RAW source an earlier build already published gets a warning and another try. Only then is the working copy swapped for a 2,400 px copy of the cleaned file, kept in the private `metadata` container, which later builds read instead. |
| Monthly, or on demand ([`photo-locations.yml`](../.github/workflows/photo-locations.yml)) | Scans every public container, including Astro's old copies in `variants/`, and strips anything that still records a position. A scheduled run that finds something fails, so GitHub emails you. The log shows counts only. `node scripts/location.mjs blobs` does the same from your machine if you'd rather. |

The only image a build re-encodes at full size is a HEIC or RAW photo, which
browsers can't display: it becomes a full-resolution JPEG in one step from a
lossless decode, at quality 95 with full colour resolution, and the HEIC/RAW
itself stays in `originals`. The smaller copies the pages show first (grid
images, the lightbox's quick preview) are resized on purpose; the lightbox
always ends on the full-size file. So is the 2,400 px copy the build works
from, which is made only after any position is gone and is never published.

Nothing derives a position from photos any more: the home-page globe pins each
session from a hand-kept table of coarse, public points
([src/lib/geo.ts](../src/lib/geo.ts), two decimal places at most), and the
herping map and iNaturalist embeds snap observations to a 0.1° grid (about
11 km) and show a town or region, never `place_guess`'s street address
([src/lib/hobbies/inat-place.ts](../src/lib/hobbies/inat-place.ts)).

Browser caches and search engines that fetched a file before it was cleaned
keep what they fetched; that can't be recalled.

### Hotlinking and scraping

"Hotlinking" = someone embeds your photo on their site by linking to its URL, eating your bandwidth without credit. "Scraping" = bot downloads everything.

What we do (cheap, reasonable):
- Visible "© <Year> <Owner Name>" footer on every page, and the all-rights-reserved notice for photographs in the [README](../README.md#license).
- `robots.txt` allows search engines to crawl page URLs but doesn't promote the blob origin.
- Blob containers can't be listed, so only photos a page links to can be found.

What we don't do (expensive, low value):
- **Rate limiting per IP.** Needs Front Door + WAF (~$35/mo). Vast overspend for a personal portfolio.
- **SAS-signed URLs with short expiry.** Would break shareable image links and SEO previews.

The honest framing: for a public portfolio, the goal isn't making theft impossible (it can't be, if it's visible it's downloadable). The goal is ensuring attribution + the copyright claim is unambiguous when theft happens.

### Web Application Firewall (WAF)

Deliberately skipped. WAF in Azure requires either Azure Front Door or Application Gateway, both of which carry a ~$35+/month base fee.

Worth it when you have substantially more traffic or higher-value operations:
- Login / auth endpoints to brute-force
- Forms that could be SQL-injected
- Admin panels to defend
- Server-side code with patchable vulnerabilities

This site has a contact form and allowlisted admin API, but their bounded inputs,
rate limiting, and server-side authorization are proportionate at personal-site
traffic. Revisit if admin upload or broader accounts ship.

### Secret hygiene

- **No secrets in the repo, ever.** The only configurable values committed live in `site.config.ts` (display config) and `infra/main.parameters.json` (resource names + your GitHub username). Neither is sensitive. [.gitignore](../.gitignore) also covers `.env*`, `contact.json`, Azure Functions' `local.settings.json`, and key and certificate files (`*.pem`, `*.key`, `*.pfx`, `*.p12`).
- **GitHub → Azure auth** is OIDC federation. No `client_secret` exists for an attacker to steal.
- **One required secret in GitHub Actions:** `AZURE_STATIC_WEB_APPS_API_TOKEN`, the SWA deploy token, rotated by re-running the Bicep deploy. The optional features add their own (`GH_PAT_FOR_SECRETS`, the Instagram token and its sealing key, a model API key); the full list is in [cicd.md](cicd.md#secrets-cheat-sheet). The `AZURE_*` IDs are identifiers, not credentials.
- **Runtime secrets stay in SWA app settings:** the storage connection string and optional GitHub rebuild PAT. The Infra workflow masks the connection string before writing it.
- **Domain registration contact info** (`contact.json`, contains your real address and phone) is gitignored.
- **Commit metadata is public too.** Every commit records an author email. Commit with your GitHub noreply address (`git config --global user.email <id>+<user>@users.noreply.github.com`) and turn on **Settings → Emails → Block command line pushes that expose my email**. An address already in history stays visible unless the history is rewritten.
- **Dependabot** is enabled for the `npm` and `github-actions` ecosystems. Alerts and security updates are on, so a dependency with a published CVE gets a pull request right away; routine version bumps come monthly.

### GitHub repository settings

These live in the repository's settings rather than in a file, so they're listed here to be checked or redone on a fork (`gh api repos/<owner>/<repo>` shows most of them):

| Setting | State | Why |
|---|---|---|
| Secret scanning and push protection | on | A push containing a recognised credential is refused before it reaches GitHub. |
| Private vulnerability reporting | on | The channel [SECURITY.md](../SECURITY.md) and security.txt point to. Turn on with `gh api -X PUT repos/<owner>/<repo>/private-vulnerability-reporting`. |
| Dependabot alerts and security updates | on | `gh api -X PUT repos/<owner>/<repo>/vulnerability-alerts` and `.../automated-security-fixes`. |
| Code scanning | CodeQL, from [codeql.yml](../.github/workflows/codeql.yml) | See [cicd.md](cicd.md#codeqlyml-code-scanning). |
| Ruleset "Protect main" | blocks force pushes and deleting `main` | History on `main` can't be rewritten or lost, even by the owner by accident. It doesn't require pull requests or checks, because the owner pushes finished work straight to `main` and a required check would refuse a push that hasn't been checked yet. CI still runs on every push. |
| Default `GITHUB_TOKEN` permission | read | Each workflow asks for what it needs in its `permissions:` block. |

#### Code scanning triage

CodeQL's first scan (2026-10-26) raised 21 alerts. Four were fixed: two HTML-stripping helpers that ran one pass and decoded `&amp;` before the other entities ([inat.mjs](../scripts/photos/inat.mjs), [build-day-list.mjs](../scripts/build-day-list.mjs)), and two cache reads that checked for a file before reading it ([build-day-list-relief.mjs](../scripts/build-day-list-relief.mjs), [build-day-list-borders.mjs](../scripts/build-day-list-borders.mjs)). The rest were dismissed in the Security tab with these reasons, so a new alert of the same kind still shows up for review:

- **Network data written to files** (`js/http-to-file-access`) and **file data sent over the network** (`js/file-access-to-http`): the data scripts download public datasets (Natural Earth, iNaturalist, Wikipedia) into caches and the photo pipeline sends photos and metadata to its APIs. That's their job, and they run on the owner's machine or in CI, never for a visitor.
- **The scene worker** (`src/lib/scenes/worker.ts`): a dedicated worker can only be messaged by the page that created it, so it needs no origin check; the "dynamic method call" is a `Map` lookup, which can't reach a prototype method; and the plate URLs it fetches come from the page's own build, with the CSP limiting where it can connect.
- **The preview opener** (`scripts/photos/open.mjs`): it only opens an HTML file the script itself just wrote.

### GitHub Actions and Azure identities

Workflows sign in to Azure with OIDC, so there is no Azure password anywhere. Two managed identities split the work by how much code each one runs:

| Identity | Created by | Signs in for | Can do | Trusts tokens from |
|---|---|---|---|---|
| `id-photography-deploy-<env>` | [infra/modules/identity.bicep](../infra/modules/identity.bicep) | Build and Deploy, Photo captions, Social post, Photo locations (`AZURE_DEPLOY_CLIENT_ID`) | `Storage Blob Data Contributor` on the site's storage account, `Reader` on its resource group, `Cognitive Services OpenAI User` on the caption model | `main`, and pull requests from branches in this repository |
| `id-photography-bootstrap` | [scripts/setup-federated-credential.sh](../scripts/setup-federated-credential.sh) | Infra (Bicep) only (`AZURE_CLIENT_ID`) | `Contributor` on the subscription, plus `Role Based Access Control Administrator` limited by a condition to assigning those three roles to service principals | the `prod` GitHub Environment only |

The workflows that install hundreds of npm packages therefore hold a token that can, at worst, change blobs in one storage account (7-day soft delete keeps the previous bytes). Contact messages, analytics, DNS, the deploy token and role assignments are out of reach. The identity that can change the subscription runs only `azure/arm-deploy`, from a manual workflow, behind an environment you can restrict to `main` and to required reviewers.

Other guards in the workflows:

- **Packages install before any sign-in**, and Build and Deploy signs out of Azure while `astro build` runs Astro, Vite and their plugins, signing in again only to upload the variants. Social post signs out before `npm ci` for the same reason.
- **Least-privilege `GITHUB_TOKEN`**: each workflow declares `permissions:`; the one job that can push (Social post's keepalive commit) runs no packages.
- **No secrets for untrusted code**: fork and Dependabot pull requests build from fixtures with no Azure access; nothing uses `pull_request_target`; no event text is interpolated into `run:` scripts.
- **Masked outputs**: the storage connection string, analytics salt and deploy token are masked before use; the photo and posting pipelines log counts only, through [redact.mjs](../scripts/photos/redact.mjs).

Moving an existing setup onto this model (one-time): run the Infra workflow with `GH_PAT_FOR_SECRETS` set, or `./scripts/bootstrap-swa-token.sh`, to create the `AZURE_DEPLOY_CLIENT_ID` secret; let one build pass; then re-run `./scripts/setup-federated-credential.sh`, which prints the commands that remove the bootstrap identity's old `main`/pull-request trust and its User Access Administrator role. Details in [cicd.md](cicd.md#two-identities-least-privilege-by-job).

### Supply chain

| Surface | Mitigation |
|---|---|
| Malicious npm package | `npm ci` against committed `package-lock.json`; Dependabot alerts and security updates; no autopilot updates. In CI, packages install and the site builds without Azure credentials, and the credential the build does hold reaches blobs only. |
| Compromised GitHub Action version | Every action is pinned to a full commit SHA with the version in a comment, and Dependabot bumps both ([cicd.md](cicd.md#how-the-workflows-pin-their-actions)). CodeQL's `actions` queries flag any that slip back to a tag. |
| Compromised npm registry mirror | Currently we trust the public registry; nothing avoids this at this scale. |
| Image tools installed in CI | `libraw-bin` and `exiftool` come from Ubuntu's apt archive on a pinned `ubuntu-24.04` runner; `pillow` and `pillow-heif` from PyPI, unpinned, before any sign-in. |

#### Known advisories that stay open

`npm audit` reports a few advisories that have no fix this repo can take yet. As of 2026-10-26:

- **Astro 5** (`astro` and the `zod`, `esbuild` and nested `sharp` it brings): the fixes are in Astro 6 and 7, a major migration that also moves the Tailwind integration. The critical one is an XSS through `define:vars` and the high one is in server islands; the site uses neither, and it's a static build with no server rendering. The `esbuild` one affects only the dev server on Windows. The nested `sharp` 0.34 processes only the owner's own photos at build time. The site's own `sharp` is on 0.35, which has the libvips fixes.
- **`@azure/msal-node`** under `@azure/identity`: the fix is msal-node 7.1, and the newest `@azure/identity` (4.14) still requires 6. The advisory is about the authorization-code sign-in flow, which nothing here uses: the scripts use `DefaultAzureCredential`, which in CI picks up the Azure CLI session from the OIDC sign-in.

Check with `npm audit --omit=dev` after any dependency change, and take the Astro migration as its own piece of work.

### Data we collect

- **Cookieless first-party analytics** records page path, referrer hostname,
  duration, and a daily rotating secret-salted visitor hash. It never stores the
  raw IP or user-agent. See [analytics.md](analytics.md).
- **No cookies.** Theme preference uses `localStorage`; analytics correlation uses tab-scoped `sessionStorage`.
- **Contact submissions contain the name, email, and message the sender chooses to provide.** They are stored privately in Table Storage and visible only through the allowlisted admin API.
- **Birding selfies never leave the device.** The optional "you as a bird" island reads the selfie into a canvas and runs the MediaPipe landmark model entirely in the browser. The photo and the landmarks are never uploaded, stored, or logged; there is no server endpoint that receives them. The only network traffic is fetching the same-origin model + WASM, and the generated bird PNG is saved only if the visitor clicks Download.

---

## How to validate after deploy

```bash
# Check headers + CSP scoring
curl -I https://yourdomain.com
# Or use https://securityheaders.com/?q=https://yourdomain.com

# Check TLS
# Use https://www.ssllabs.com/ssltest/analyze.html?d=yourdomain.com

# Confirm you can't list the storage container
curl -s 'https://<account>.blob.core.windows.net/originals?restype=container&comp=list' | head -5
# Should return 404 ResourceNotFound

# Confirm no published photo records where it was taken:
# GitHub → Actions → Photo locations → Run workflow (or, with az login:)
node scripts/location.mjs blobs
```

Aim for an A or A+ on both securityheaders.com and ssllabs.com on first deploy.

---

## What I'd add later if the project grew

In rough order:
1. **CSP `'unsafe-inline'` tightening** via Astro's hash mode, easy win once we stop iterating on styles.
2. **`Cross-Origin-Embedder-Policy: require-corp`** if we ever need full cross-origin isolation (COOP is already on). It needs the iNaturalist photos proxied or dropped first.
3. **WAF + stricter edge rate limiting** the moment the site gets an upload endpoint or broader login model.
4. **Allowlist admins by SWA `userId`** instead of GitHub username: a username freed by a rename can be registered by someone else.
5. **Hash-pinned `pip` installs** in the build. The actions are already pinned to SHAs.
6. **Astro 7**, which closes the advisories listed under [Known advisories that stay open](#known-advisories-that-stay-open).
