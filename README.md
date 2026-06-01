# photography-website

Personal photography portfolio, hosted on Azure Static Web Apps with images in Azure Blob Storage.

- **Frontend:** Astro 5 + Tailwind v4 (static build, near-zero JS)
- **Hosting:** Azure Static Web Apps (Free)
- **Storage:** Azure Blob Storage (three containers: `originals`, `derivatives`, `metadata`)
- **Domain + DNS:** Azure App Service Domain + Azure DNS
- **IaC:** Bicep
- **CI/CD:** GitHub Actions (OIDC federation; no long-lived secrets)
- **Cost target:** under $5/month at personal traffic

The full design is in [the plan](#plan). What follows is the runbook.

---

## Local development

Requires Node 22 (`nvm use` picks it up from `.nvmrc`).

```bash
npm ci
npm run fixtures      # generate synthetic sessions into src/content/sessions/
npm run dev           # → http://localhost:4321
npm run build         # outputs to dist/
```

`npm run fixtures` is safe to re-run; it skips sessions that already exist.

To wipe local sessions and start fresh:

```bash
rm -rf src/content/sessions/* && touch src/content/sessions/.gitkeep
```

---

## First-time Azure setup

### 0. Prereqs

- Azure CLI (`az`) installed and `az login` done
- GitHub CLI (`gh`) installed and `gh auth login` done
- A GitHub repo created (e.g. `<you>/photography-website`) and this code pushed to `main`
- The subscription ID + tenant ID of your Azure subscription

### 1. Fill in placeholders

Edit [site.config.ts](site.config.ts):

- `ownerName` — your full name
- `siteTitle`, `siteDescription` — taste
- `domain` — the apex domain you'll register (e.g. `trumandoe.com`)
- `copyrightStartYear` — current year on first deploy

Edit [infra/main.parameters.json](infra/main.parameters.json):

- `githubOwner` — your GitHub username/org
- `domainName` — leave `""` on first deploy if you want to bring up the stack before registering a domain; fill it in later and re-deploy.

### 2. Create the bootstrap managed identity

This identity is what GitHub Actions assumes to run the infra deploy. It's separate from the per-app identity created inside Bicep.

```bash
./scripts/setup-federated-credential.sh <subscription-id> <github-owner> <github-repo>
```

Copy the three values it prints into the repo's secrets:

```
AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID
```

(Settings → Secrets and variables → Actions → New repository secret)

### 3. (Optional) Add a PAT for secret auto-write

If you want the `Infra (Bicep)` workflow to write `AZURE_STATIC_WEB_APPS_API_TOKEN` and friends back into the repo's secrets automatically, create a fine-grained PAT with `Secrets: read/write` on this repo and add it as:

```
GH_PAT_FOR_SECRETS
```

Without it, you'll run `./scripts/bootstrap-swa-token.sh` once by hand after the first infra deploy.

### 4. Run the infra workflow

Actions tab → **Infra (Bicep)** → Run workflow → environment `prod`.

This deploys the entire stack:

- Resource group `rg-photography-prod`
- Storage account + three blob containers + CORS
- Static Web App (Free)
- User-assigned managed identity + federated credentials + RBAC
- Application Insights + Log Analytics workspace

It does **not** register the domain on first run (interactive license agreement required).

### 5. Register the domain (once)

```bash
az appservice domain create \
  --resource-group rg-photography-prod \
  --hostname yourdomain.com \
  --contact-info @contact.json \
  --accept-terms
```

`contact.json` is a JSON object documented at <https://learn.microsoft.com/azure/app-service/manage-custom-dns-buy-domain>.

After purchase, set `domainName` in [infra/main.parameters.json](infra/main.parameters.json) and re-run the Infra workflow. Then bind the apex/www domains:

```bash
./scripts/bind-domain.sh rg-photography-prod swa-photography-prod yourdomain.com
```

### 6. Wire repo secrets for the build workflow

If you skipped step 3, run:

```bash
./scripts/bootstrap-swa-token.sh rg-photography-prod swa-photography-prod <gh-owner>/photography-website
```

This sets `AZURE_STATIC_WEB_APPS_API_TOKEN`, `AZURE_STORAGE_ACCOUNT`, and `APPINSIGHTS_CONNECTION_STRING`.

### 7. Update `site.config.ts` with the real Blob host

After the first infra deploy you'll know the storage account name. Set it in [site.config.ts](site.config.ts):

```ts
blobHost: 'stphotoprod<suffix>.blob.core.windows.net',
```

Commit and push — the next build picks it up.

---

## Adding a session

1. Open Azure Storage Explorer (or use `az storage blob upload-batch`).
2. Under the `originals` container, create a prefix (`folder`) for the session, e.g. `2026-japan/`.
3. Drop your photos in (JPG, HEIC, PNG, TIFF, or Sony `.ARW` / other RAW).
4. **Optionally** add a `_session.json` at the prefix root:
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
5. The next hourly build (or click **Run workflow** on `Build and Deploy`) will publish it. Latency: ~3 minutes if manual, up to ~1 hour for the scheduled run.

### RAW files

Sony `.ARW`, Nikon `.NEF`, Canon `.CR2`/`.CR3`, Adobe `.DNG`, and Fuji `.RAF` are auto-converted to JPEG at build time. The original RAW stays in `originals/` untouched; a 95-quality JPEG is written to `derivatives/<session>/<name>.jpg` and that's what the site shows. RAW conversions are cached by source etag — they only re-run when the RAW file actually changes.

---

## Architecture, cost, security, future plans

See the design plan in your session notes (`/memories/session/plan.md`).

Quick reference:

```
GitHub repo ──push/schedule──► GitHub Actions ──OIDC──► Azure Blob (read originals, write derivatives)
                                       │
                                       └─► Azure Static Web Apps (deploy dist/)
                                                       │
                                                       ▼
                                              Visitor's browser (HTTPS)
                                                       ▲
                                              (lightbox full-res direct from Blob)
```

---

## Plan

Authored separately — see session memory. Highlights:

- Drop a folder of photos into Blob → site updates itself on the next build
- No database, no server, no runtime code — static files behind a CDN
- Sony RAW handled via `dcraw_emu` (`libraw-bin`) → sharp → JPEG
- Total cost: ~$2–3/month including the `.com` domain
- Future admin-upload UI fits cleanly on SWA's API functions + managed auth
