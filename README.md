# photography-website

A personal website built around a photography portfolio, with a **Hobbies** section of small hand-drawn interactive toys, a browser-based **admin panel** for editing content, a contact form, and privacy-friendly **traffic analytics**. Photos live in Azure Blob Storage and the site is a static Astro build hosted on Azure Static Web Apps. Drop a folder of photos into Blob and the site picks them up on the next build.

The project started as a photography portfolio and has grown into a small personal site. The portfolio is still the home page; everything else (hobbies, admin, analytics, the contact form) sits beside it and can be toggled off in [site.config.ts](site.config.ts).

**Why each piece exists**: see [docs/architecture.md](docs/architecture.md).
**New to any of this?** Start with [docs/glossary.md](docs/glossary.md).

---

## Quick links

| Topic | Doc |
|---|---|
| Product experience, measured baseline, design decisions, and roadmap | [docs/product-experience.md](docs/product-experience.md) |
| What is Astro, SWA, Blob, CDN, and why each one | [docs/architecture.md](docs/architecture.md) |
| What Azure resources exist and what each costs | [docs/azure.md](docs/azure.md) |
| What Infrastructure-as-Code (Bicep) is and what each `.bicep` file does | [docs/iac-bicep.md](docs/iac-bicep.md) |
| How the GitHub Actions workflows work and why | [docs/cicd.md](docs/cicd.md) |
| How a photo travels from your camera to the live site | [docs/image-pipeline.md](docs/image-pipeline.md) |
| The optional **Hobbies** section + interactive islands | [docs/hobbies.md](docs/hobbies.md) |
| Editing session metadata from the browser (`/admin`) | [docs/admin.md](docs/admin.md) |
| Privacy-friendly traffic analytics (`/admin` Analytics tab) | [docs/analytics.md](docs/analytics.md) |
| Photo captions and session descriptions, written from the photos | [docs/photos.md](docs/photos.md) |
| Posting photos to Instagram a few a day, automatically | [docs/social.md](docs/social.md) |
| How the site is hardened (CSP, HSTS, etc.) | [docs/security.md](docs/security.md) |
| Running locally, npm, dev server, fixtures | [docs/local-dev.md](docs/local-dev.md) |
| **What personal info ends up in the public repo (and what doesn't)** | [docs/privacy.md](docs/privacy.md) |
| Glossary of every term used here | [docs/glossary.md](docs/glossary.md) |

---

## Tech at a glance

- **Frontend:** Astro 5 + Tailwind v3 (static build, near-zero JS), see [docs/architecture.md](docs/architecture.md)
- **Interactive hobbies:** hand-drawn canvas pixel-art islands (aquarium, tide-pooling, fishing) with zero runtime dependencies, see [docs/hobbies.md](docs/hobbies.md)
- **Dynamic API:** three Azure Functions bundled with SWA (contact form, admin session manager, analytics beacon), see [docs/architecture.md](docs/architecture.md)
- **Admin + analytics:** browser `/admin` panel gated by GitHub sign-in, cookieless traffic metrics, see [docs/admin.md](docs/admin.md) and [docs/analytics.md](docs/analytics.md)
- **Hosting:** Azure Static Web Apps (Free tier), see [docs/azure.md](docs/azure.md)
- **Storage:** Azure Blob Storage across five containers (`originals`, `derivatives`, `variants`, `metadata`, `hobby-media`), see [docs/image-pipeline.md](docs/image-pipeline.md)
- **Galleries:** sessions open on a banner crop then a justified grid; the lightbox always ends on the untouched original while painting in ~80 ms, see [docs/image-pipeline.md#viewing-full-resolution-without-the-wait](docs/image-pipeline.md#viewing-full-resolution-without-the-wait)
- **Domain + DNS:** Azure App Service Domain + Azure DNS
- **IaC:** Bicep, see [docs/iac-bicep.md](docs/iac-bicep.md)
- **CI/CD:** GitHub Actions, OIDC federation (no long-lived secrets), see [docs/cicd.md](docs/cicd.md)
- **Cost target:** ~$2–3/month at personal traffic (incl. `.com` domain), see [docs/azure.md#monthly-cost](docs/azure.md#monthly-cost)
- **What about your name/address/etc. in this repo?** See [docs/privacy.md](docs/privacy.md)

---

## Local development (TL;DR)

Full version in [docs/local-dev.md](docs/local-dev.md).

```bash
npm ci
npm run fixtures           # synthetic sessions for local dev
npm run dev                # → http://localhost:4321
```

`npm run fixtures:many` generates ~40 sessions across 5 years so you can see how the sidebar feels at scale.

---

## First-time Azure setup

Full walkthrough with explanations in [docs/azure.md](docs/azure.md) and [docs/cicd.md](docs/cicd.md). The minimal sequence:

### 0. Prereqs

- Azure CLI (`az`) installed and `az login` done
- GitHub CLI (`gh`) installed and `gh auth login` done (logged in as the GitHub account that owns the repo)
- An empty GitHub repo created and this code pushed to `main`
- The subscription ID + tenant ID of your Azure subscription

### 1. Fill in placeholders

Edit [site.config.ts](site.config.ts):
- `ownerName`, your full name (drives footer + EXIF copyright; **becomes public when you push**)
- `siteTitle`, `siteDescription`, taste
- `domain`, apex domain you'll register (e.g. `<yourname>.com`)
- `copyrightStartYear`, current year on first deploy

Edit [infra/main.parameters.json](infra/main.parameters.json):
- `githubOwner`, your GitHub username/org
- `domainName`, leave `""` on first deploy if you want infra up before registering a domain; fill in and re-deploy later

> Full inventory of what becomes public and what stays private: [docs/privacy.md](docs/privacy.md).

### 2. Bootstrap the deploy identity

```bash
./scripts/setup-federated-credential.sh <subscription-id> <github-owner> <github-repo>
```

It prints three values. Add them as repo secrets (Settings → Secrets and variables → Actions):
- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

What this does and why: [docs/cicd.md](docs/cicd.md#oidc-federation-no-long-lived-secrets).

### 3. (Optional) Add a PAT for secret auto-write

If you want the **Infra (Bicep)** workflow to auto-write `AZURE_STATIC_WEB_APPS_API_TOKEN` etc. back into repo secrets, add a fine-grained PAT with `Secrets: read/write` on this repo as `GH_PAT_FOR_SECRETS`. Otherwise run `./scripts/bootstrap-swa-token.sh` by hand after the first deploy.

### 4. Run the Infra workflow

GitHub → **Actions** tab → **Infra (Bicep)** → **Run workflow** → environment `prod`.

This deploys the whole Azure stack. Everything it creates is enumerated in [docs/iac-bicep.md](docs/iac-bicep.md#what-the-bicep-deploys-resource-by-resource).
It also configures the SWA Functions with the storage connection, a private
analytics salt, and the GitHub user who ran the workflow as the initial admin.

### 5. Register the domain (interactive, one-time)

```bash
az appservice domain create \
  --resource-group rg-photography-prod \
  --hostname yourdomain.com \
  --contact-info @contact.json \
  --accept-terms
```

`contact.json` format: <https://learn.microsoft.com/azure/app-service/manage-custom-dns-buy-domain>. **Gitignored**: never commit it.

Then set `domainName` in `infra/main.parameters.json` and re-run the Infra workflow, then bind the apex/www domains:

```bash
./scripts/bind-domain.sh rg-photography-prod swa-photography-prod yourdomain.com
```

### 6. Update `site.config.ts` with the real Blob host

After the first infra deploy, set `blobHost` in [site.config.ts](site.config.ts) to the actual storage account hostname (printed in the deploy output). Commit and push.

---

## Adding a session

The easy way, drop photos in `staging/` and run the upload script:

```bash
# 1. Put your photos in a named folder under staging/
mkdir -p staging/2026-japan
cp ~/photos/japan/*.jpg staging/2026-japan/

# 2. Upload to Blob Storage and trigger a build
./scripts/upload-session.sh 2026-japan --build
```

The script handles Azure auth (auto-switches tenant via `.env`), filters to
accepted file types (JPG, HEIC, PNG, TIFF, RAW), uploads to the `originals`
container, and optionally triggers the build. See [staging/README.md](staging/README.md).
The argument must name one direct child of `staging/`; every session folder must
map to a unique public slug and contain at least one image.

### Setting session metadata

Two options:

- **Admin panel** (no code): visit `/admin`, sign in with GitHub, edit title,
  cover thumbnail, location, description, and display order in the browser.
  See [docs/admin.md](docs/admin.md).
- **`_session.json` sidecar**: add this file at the session's prefix root in Blob
  Storage (the admin panel writes the same file):
  ```json
  {
    "title": "Japan, Spring 2026",
    "date": "2026-03-15",
    "location": "Tokyo → Kyoto",
    "description": "Two weeks chasing cherry blossoms.",
    "cover": "DSC03421.jpg",
    "order": 5
  }
  ```

`date` must be a real `YYYY-MM-DD` calendar date. Prebuild validates the whole
sidecar and fails with the field path instead of publishing partial defaults.

`cover` picks the card thumbnail and the link-preview image. The session page
opens on a separate wide banner, which is a hard crop: upright frames lose most
of their height. Set `"banner"` to the filename you want there and it is used
as-is. Leave it out and the banner derives one: the cover when the cover is
landscape enough, otherwise the widest photograph in the session. Add an
optional `"bannerFocus"` — any CSS `object-position`, e.g. `"center 30%"` — to
steer where that crop sits.

### Title and description conventions

Session titles follow **`Place, Region, Month Year`**:

```
Zhangjiajie, Hunan, April 2026
Gunn Peak, Washington, June 2026
Tortuguero night walk, Costa Rica, September 2026
```

The specific place goes first because that's the word people search for, and
the shape stays the same across the archive so the session list reads as one
set rather than thirty separate naming decisions. Keep the month in step with
the date the page displays, which prebuild derives from EXIF.

Descriptions render on the **session page only** — the home-page cards show
title, date, location and photo count. The description was previously on both,
which duplicated the same sentences across two URLs for no benefit.

A species is only ever named from your own iNaturalist observation of that
photo. Everything else gets plain words ("a tree frog", "a heron"): a wrong
species name is worse than no name at all for a naturalist audience, and it
can rank the page for something it isn't.

Changes go live on the next build, click **Run workflow** on `Build and Deploy`
(or **Rebuild Site** in the admin panel) for a ~5 minute publish, or wait for the cron.

Full pipeline walkthrough: [docs/image-pipeline.md](docs/image-pipeline.md).

### Captions and descriptions, written for you

After a build publishes new photos, the **Photo captions** workflow looks at
each one once with a vision model, matches it to your iNaturalist
observations, and writes:

- **a caption for every photo**, e.g. `Northwestern garter snake (Thamnophis
  ordinoides) coiled on a mossy log, Sauk Mountain`. It's the photo's `alt`
  text and lightbox caption, which is what image search actually reads.
- **a description for every session**, written from all of its photos'
  captions and identifications.

Both land in the session's `_session.json` and the site rebuilds, usually
within half an hour of the upload. Edit either in `/admin` and your version
stays: the pipeline never overwrites text you've changed.

| Field | If you set it | If you leave it blank |
| --- | --- | --- |
| `title` | kept as-is | drafted, `Place, Region, Month Year` |
| `location` | kept as-is | drafted |
| `description` | kept as-is | **written from every photo in the session** |
| per-image `caption` | kept as-is | **written from the photo and its iNaturalist ID** |

It needs a vision model. The recommended one is keyless Azure OpenAI in your
own tenant, so photos never leave it and there's no API key to leak. Setup,
how identifications work, the checks every caption and description has to
pass, and commands to preview or redo anything:
[docs/photos.md](docs/photos.md).

---

## Repository layout

```
photography-website/
├── .github/workflows/         # CI/CD, see docs/cicd.md
├── api/                       # Azure Functions: contact, sessionmgr, track
├── docs/                      # detailed docs (you are reading the index)
├── infra/                     # Bicep IaC, see docs/iac-bicep.md
├── public/                    # static assets copied verbatim to the site root
├── scripts/                   # prebuild, bootstrap scripts, photos/ (captions), social/ (Instagram)
├── src/
│   ├── components/            # Astro components (Header, SessionNav, Lightbox, …)
│   │   └── hobbies/           # interactive island mounts (aquarium, tide pool, fishing)
│   ├── content/               # content collections (sessions + hobbies)
│   ├── layouts/               # page shells
│   ├── lib/                   # blob URL helper, session sort, theme, admin, analytics
│   │   └── hobbies/           # canvas pixel-art engines (zero dependencies)
│   ├── pages/                 # route definitions (incl. /admin and /hobbies)
│   └── styles/                # Tailwind entry
├── site.config.ts             # display config (committed; not for secrets)
├── site.config.example.ts     # template for new clones
├── staticwebapp.config.json   # SWA headers + routing, see docs/security.md
└── README.md                  # this file
```

---

## License

The **source code** in this repository is licensed under the MIT License. See [LICENSE](LICENSE).

The **photographs, graphics, and written content** are not covered by that license. All photographs and images on the site are © Truman Brown, all rights reserved, and are not licensed for reuse. The photos themselves are not stored in this repository; they live in Azure Blob Storage and are served to the site at build time.

Third-party content carries its own terms: the tide-pooling reveal cards can show Creative Commons photos from iNaturalist with attribution shown in the card, and those remain under their respective CC licenses. See [docs/hobbies.md](docs/hobbies.md) for details.
