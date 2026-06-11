# photography-website

Personal photography portfolio. Photos live in Azure Blob Storage; the website is a static Astro build hosted on Azure Static Web Apps. Drop a folder of photos into Blob, the site updates itself on the next build.

**Why each piece exists** — see [docs/architecture.md](docs/architecture.md).
**New to any of this?** Start with [docs/glossary.md](docs/glossary.md).

---

## Quick links

| Topic | Doc |
|---|---|
| What is Astro, SWA, Blob, CDN, and why each one | [docs/architecture.md](docs/architecture.md) |
| What Azure resources exist and what each costs | [docs/azure.md](docs/azure.md) |
| What Infrastructure-as-Code (Bicep) is and what each `.bicep` file does | [docs/iac-bicep.md](docs/iac-bicep.md) |
| How the GitHub Actions workflows work and why | [docs/cicd.md](docs/cicd.md) |
| How a photo travels from your camera to the live site | [docs/image-pipeline.md](docs/image-pipeline.md) |
| Editing session metadata from the browser (`/admin`) | [docs/admin.md](docs/admin.md) |
| Privacy-friendly traffic analytics (`/admin` Analytics tab) | [docs/analytics.md](docs/analytics.md) |
| How the site is hardened (CSP, HSTS, etc.) | [docs/security.md](docs/security.md) |
| Running locally — npm, dev server, fixtures | [docs/local-dev.md](docs/local-dev.md) |
| **What personal info ends up in the public repo (and what doesn't)** | [docs/privacy.md](docs/privacy.md) |
| Glossary of every term used here | [docs/glossary.md](docs/glossary.md) |

---

## Tech at a glance

- **Frontend:** Astro 5 + Tailwind v4 (static build, near-zero JS) — see [docs/architecture.md](docs/architecture.md)
- **Hosting:** Azure Static Web Apps (Free tier) — see [docs/azure.md](docs/azure.md)
- **Storage:** Azure Blob Storage, four containers: `originals`, `derivatives`, `variants`, `metadata` — see [docs/image-pipeline.md](docs/image-pipeline.md)
- **Domain + DNS:** Azure App Service Domain + Azure DNS
- **IaC:** Bicep — see [docs/iac-bicep.md](docs/iac-bicep.md)
- **CI/CD:** GitHub Actions, OIDC federation (no long-lived secrets) — see [docs/cicd.md](docs/cicd.md)
- **Cost target:** ~$2–3/month at personal traffic (incl. `.com` domain) — see [docs/azure.md#monthly-cost](docs/azure.md#monthly-cost)
- **What about your name/address/etc. in this repo?** — see [docs/privacy.md](docs/privacy.md)

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
- `ownerName` — your full name (drives footer + EXIF copyright; **becomes public when you push**)
- `siteTitle`, `siteDescription` — taste
- `domain` — apex domain you'll register (e.g. `<yourname>.com`)
- `copyrightStartYear` — current year on first deploy

Edit [infra/main.parameters.json](infra/main.parameters.json):
- `githubOwner` — your GitHub username/org
- `domainName` — leave `""` on first deploy if you want infra up before registering a domain; fill in and re-deploy later

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

### 5. Register the domain (interactive, one-time)

```bash
az appservice domain create \
  --resource-group rg-photography-prod \
  --hostname yourdomain.com \
  --contact-info @contact.json \
  --accept-terms
```

`contact.json` format: <https://learn.microsoft.com/azure/app-service/manage-custom-dns-buy-domain>. **Gitignored** — never commit it.

Then set `domainName` in `infra/main.parameters.json` and re-run the Infra workflow, then bind the apex/www domains:

```bash
./scripts/bind-domain.sh rg-photography-prod swa-photography-prod yourdomain.com
```

### 6. Update `site.config.ts` with the real Blob host

After the first infra deploy, set `blobHost` in [site.config.ts](site.config.ts) to the actual storage account hostname (printed in the deploy output). Commit and push.

---

## Adding a session

The easy way — drop photos in `staging/` and run the upload script:

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

Changes go live on the next build — click **Run workflow** on `Build and Deploy`
(or **Rebuild Site** in the admin panel) for a ~5 minute publish, or wait for the cron.

Full pipeline walkthrough: [docs/image-pipeline.md](docs/image-pipeline.md).

---

## Repository layout

```
photography-website/
├── .github/workflows/         # CI/CD — see docs/cicd.md
├── docs/                      # detailed docs (you are reading the index)
├── infra/                     # Bicep IaC — see docs/iac-bicep.md
├── public/                    # static assets copied verbatim to the site root
├── scripts/                   # prebuild + bootstrap shell scripts
├── src/
│   ├── components/            # Astro components (Header, SessionNav, Lightbox, …)
│   ├── content/               # content collection (sessions populated by prebuild)
│   ├── layouts/               # page shells
│   ├── lib/                   # blob URL helper, session sort, theme bootstrap
│   ├── pages/                 # route definitions
│   └── styles/                # Tailwind entry
├── site.config.ts             # display config (committed; not for secrets)
├── staticwebapp.config.json   # SWA headers + routing — see docs/security.md
└── README.md                  # this file
```
