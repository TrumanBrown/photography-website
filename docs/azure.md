# Azure — what we use, what each thing does, what it costs

> Audience: someone who hasn't used Azure before. Read top to bottom on first deploy; skim later.

## 1. What Azure is, in one paragraph

Azure is Microsoft's cloud. You can think of it as a giant menu of "services" — each one is a building block. A "VM" is a service. A "managed database" is a service. "Static Web Apps" is a service. You provision the services you need, you pay for what you use, and Microsoft handles the underlying hardware. Everything is grouped under a **subscription** (a billing account) and resources live inside **resource groups** (logical folders).

This project uses six services. The full bill is ~$2–3/month.

---

## 2. The services this project uses

### 2.1 Subscription + Resource Group (free)

- **Subscription** = your billing account. You already have one tied to your Microsoft employee credits ($150/month). All resources here live inside it.
- **Resource group** = a folder in Azure used to group related resources. In this project: `rg-photography-prod`. **Deleting the resource group deletes everything inside it** — that's the "tear it down cleanly" guarantee.

### 2.2 Azure Storage Account → Blob Storage

Holds your photos and the build pipeline's state.

- **Storage account** = the top-level "drive" resource. Globally unique name (e.g. `stphotographyprodabc123`).
- **Blob service** = the file-storage capability of that account. (Storage accounts can also offer queues, tables, file shares — we only use blob.)
- **Containers** = top-level folders inside the blob service. We have three:
  - `originals/` — your uploads (JPG, HEIC, PNG, TIFF, RAW). Public-read of individual blobs by URL; **anonymous users cannot list** the container (they can't discover photos without a URL).
  - `derivatives/` — auto-generated JPEGs from RAW files, written by the build pipeline. Same access as `originals`.
  - `metadata/` — fully private. Stores the build pipeline's manifest (last-seen file fingerprints), reserved for future admin-app state.
- **Blob** = a single file. URL pattern: `https://<account>.blob.core.windows.net/<container>/<path>`.

Hardening details (TLS, key disablement, soft-delete) → [security.md](security.md).

### 2.3 Azure Static Web Apps (SWA)

The hosting + CDN that serves your website.

- **What it actually is:** Microsoft's managed service for static sites. Free tier includes 100 GB/month bandwidth, a global CDN, free auto-renewing HTTPS certs, free custom domain bindings, and free preview environments (each pull request gets a unique URL).
- **What "no server" means here:** there's no Linux/Windows VM, no Node.js process, no container. Just the files you uploaded sitting behind Microsoft's edge servers. There is nothing for you to log into. Updates work by uploading a new copy of the `dist/` folder via a deployment token.
- **Routing/header rules:** controlled by [staticwebapp.config.json](../staticwebapp.config.json) at the root of the deploy. We use it for security headers and cache rules — see [security.md](security.md).

### 2.4 Azure App Service Domain

Your `.com` registration.

- **What it is:** Azure's first-party domain registrar. Behind the scenes it buys the domain from a partner (currently GoDaddy), but the resource is managed inside Azure like everything else.
- **Why use this vs. an external registrar (Namecheap, Cloudflare, etc.):** one bill, one set of credentials, one IaC template, auto-provisioned DNS zone. Slightly more expensive (~$12/yr for `.com` vs. ~$10 elsewhere). The simplicity is worth it for a single-domain personal project.
- **One-time friction:** first-time registration requires interactively accepting a legal agreement. You run `az appservice domain create --accept-terms` once. After that, the Bicep template manages it like any other resource.

### 2.5 Azure DNS

Holds your domain's DNS records.

- **What DNS is:** the system that translates `yoursite.com` into a server IP. Without it, browsers wouldn't know where to connect.
- **What "a DNS zone" is:** the record set for one domain. Records inside: `A` (IP for the apex), `CNAME` (alias from `www` to the SWA hostname), `TXT` (proof-of-ownership tokens), etc.
- **Why use Azure DNS vs. the registrar's built-in DNS:** App Service Domain auto-creates an Azure DNS zone and points the domain's nameservers at it. Bicep can then manage every record. Putting DNS at a third party would mean toggling between two consoles to make changes.

### 2.6 Application Insights + Log Analytics workspace

Free pageview metrics + performance monitoring.

- **App Insights** = Microsoft's "Real User Monitoring." A tiny JavaScript snippet on each page reports pageviews, load times, and errors back to Azure.
- **Workspace-based:** the data is stored in a Log Analytics workspace (a unified Azure analytics store).
- **Free tier:** 5 GB ingestion/month is free, and the snippet respects the user's "Do Not Track" setting. Daily ingestion is capped at 0.1 GB so an unexpected traffic burst can't generate a bill.
- **Why use this vs. Plausible / Fathom / Google Analytics:** App Insights is in the Azure portal you're already in, free at this scale, and not a third-party tracker so the privacy story is cleaner.

### 2.7 User-assigned Managed Identity

The "service account" GitHub Actions uses to talk to Azure.

- **What a managed identity is:** an Azure-managed identity object that has its own ID but no password. Other services (or, here, external systems via OIDC) authenticate as it.
- **Why a *user-assigned* one (vs. system-assigned):** user-assigned identities are stand-alone resources whose lifecycle is decoupled from any specific Azure resource. They survive recreations, can be referenced by multiple things, and let us set up OIDC federation against GitHub once and never think about it again.
- **What permissions it has:**
  - `Storage Blob Data Contributor` on the storage account — read originals, write derivatives.
  - `Reader` on the resource group — look up resource properties during deploys.

Full mechanism (OIDC federation, secret-less auth) is in [cicd.md](cicd.md#oidc-federation-no-long-lived-secrets).

---

## 3. Monthly cost estimate

Assumptions: ~20 GB of originals (RAW-heavy could push to 50 GB; still fine), ~5 GB monthly egress, personal traffic levels. Region: **`westus3`** (cheap, modern, US-central latency).

| Service | Tier / Usage | Monthly |
|---|---|---|
| Static Web Apps | Free tier (100 GB bandwidth, custom domains, TLS, staging envs) | **$0.00** |
| Blob Storage capacity | 30 GB hot LRS @ ~$0.018/GB (originals + derivatives) | **$0.55** |
| Blob Storage operations | Reads from lightbox + build pulls; well under 1M @ $0.004/10K | **<$0.05** |
| Blob egress | First 100 GB/mo free across the account; expected usage ~5 GB | **$0.00** |
| App Service Domain (`.com`) | $11.99/yr → amortized | **~$1.00** |
| Azure DNS zone | 1 zone @ $0.50 + queries (negligible) | **$0.50** |
| Application Insights | First 5 GB/mo ingestion free; sampled, well under cap | **$0.00** |
| Bicep / ARM deployments | Always free | **$0.00** |
| **Total realistic** | | **~$2.10 – $2.60** |

### Vocab in the table

- **LRS** = "Locally Redundant Storage." Three copies of each blob kept within one datacenter. Cheapest. (ZRS replicates across availability zones; GRS replicates across regions. Both cost more and we don't need them.)
- **Hot access tier** = optimized for frequent reads. (Cool/Cold are cheaper to store but more expensive to read — bad fit for a website.)
- **Egress** = data leaving Azure (downloads to visitors). Azure gives 100 GB/month free per subscription.
- **Amortized** = the yearly fee divided by 12.

### What we deliberately don't use

| Skipped | Why |
|---|---|
| Azure Front Door Standard (~$35/mo base) | Fancier CDN with WAF support. SWA's free CDN already handles global edge caching. Front Door alone would dwarf the rest of the bill. |
| Web Application Firewall | Requires Front Door/App Gateway. Worth it for sites with logins or payment forms. Static photo site has no real attack surface — see [security.md](security.md). |
| Plausible / Fathom analytics (~$9/mo) | App Insights free tier covers it. |
| Azure Key Vault | We have effectively zero secrets at runtime. GitHub Actions secrets store what little we have. |

### Headroom

Your subscription gives you $150/month in credits. This site burns under 2% of them. If traffic 10× and storage doubles to 60 GB, the total is still under $6/month.

---

## 4. How resources connect (with names)

```
Subscription (your billing account)
└── Resource group: rg-photography-prod
    ├── Storage account: stphotoprod<suffix>
    │   ├── Container: originals  (public-read, no list)
    │   ├── Container: derivatives (public-read, no list)
    │   └── Container: metadata   (private)
    ├── Static Web App: swa-photography-prod
    │   ├── Custom domain: yourdomain.com
    │   └── Custom domain: www.yourdomain.com
    ├── App Service Domain: yourdomain.com
    ├── DNS Zone: yourdomain.com
    │   ├── A record @ (apex → SWA)
    │   ├── CNAME record www (→ SWA hostname)
    │   └── TXT record @ (ownership validation)
    ├── User-assigned managed identity: id-photography-deploy-prod
    │   ├── Federated credential: github-main
    │   └── Federated credential: github-pull-request
    ├── App Insights: appi-photography-prod
    └── Log Analytics workspace: log-photography-prod
```

Every name above is generated by Bicep — see [iac-bicep.md](iac-bicep.md) for the exact naming logic and module breakdown.

---

## 5. Future extensibility

These are the bits you'd touch later — none requires rebuilding.

- **Admin upload UI:** Static Web Apps has built-in **managed auth** (GitHub, Entra/AAD, custom OIDC) and **serverless API functions** (`/api/*`). The admin UI becomes a small auth-gated SWA route that streams uploads to Blob via a colocated function. No new hosting tier; same SWA.
- **iCloud sync:** a separate scheduled GitHub Action (or an Azure Function) that pulls from iCloud via `pyicloud` or CloudKit and writes blobs to `originals/`. The site code doesn't know it exists — it just reacts to new blobs on the next build.
- **Faster than hourly refresh:** wire Azure Event Grid → small Azure Function → GitHub `repository_dispatch: blob-changed`. The build workflow already accepts that trigger; only the glue needs to be added.
- **Pre-signed URLs / login-gated originals:** all blob URLs go through `src/lib/blob.ts`. Replace that helper to emit SAS URLs and nothing else changes.
