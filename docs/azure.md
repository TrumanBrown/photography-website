# Azure architecture and resources

> Concise reference. For why we picked Astro/SWA/Blob over alternatives, see [architecture.md](architecture.md). For what each `.bicep` file actually does, see [iac-bicep.md](iac-bicep.md).

## Architecture in one diagram

```
GitHub repo ──push / hourly cron──► GitHub Actions
                                          │
                                  OIDC ───┤
                                          ▼
                       ┌────────────────────────────────┐
                       │  Azure Blob Storage            │
                       │   originals/  derivatives/     │
                       │   metadata/                    │
                       └──────────┬─────────────────────┘
                                  │ reads sources, writes derivatives
                                  ▼
                       Astro build → dist/
                                  │
                                  ▼
                       ┌────────────────────────────────┐
                       │  Azure Static Web Apps (CDN)   │
                       │  yourdomain.com  (custom TLS)  │
                       └──────────┬─────────────────────┘
                                  │ HTTPS
                                  ▼
                          Visitor's browser
                                  │ click → full-res
                                  ▼ direct anonymous read
                          Azure Blob (originals/derivatives)
```

Two paths to the visitor: optimized thumbnails ship inside SWA, full-resolution originals stay in Blob and load only when the lightbox opens.

---

## Resources Bicep creates

All inside resource group `rg-photography-prod`.

| Resource | Purpose |
|---|---|
| **Storage account** `stphoto<env><suffix>` | Holds photos + build state. LRS, hot tier, shared-key access disabled. |
| ↳ Container `originals` | Your uploads. Public-read by URL, no listing. |
| ↳ Container `derivatives` | RAW→JPEG sidecars written by the build. Same access. |
| ↳ Container `metadata` | Private. Build manifest + future admin state. |
| **Static Web App** `swa-photography-prod` (Free SKU) | Hosting + global CDN + auto-TLS + PR previews. |
| ↳ Custom domain bindings (apex + `www`) | Created only when `domainName` is set. |
| **User-assigned managed identity** `id-photography-deploy-<env>` | Service account GitHub Actions assumes via OIDC. RBAC: `Storage Blob Data Contributor` on the storage account, `Reader` on the RG. |
| ↳ Federated credentials `github-main`, `github-pull-request` | Trust JWTs from this specific repo + branch. No long-lived secrets. |
| **App Service Domain** `yourdomain.com` | `.com` registration. Only created when `domainName` is set; first-time purchase needs `az appservice domain create --accept-terms` once. |
| **Azure DNS zone** `yourdomain.com` | Holds `A` (apex → SWA), `CNAME` `www`, `TXT` (SWA ownership token). |
| **Application Insights** `appi-photography-prod` | Pageview/perf monitoring. Respects DNT. |
| **Log Analytics workspace** `log-photography-prod` | App Insights storage backend. 0.1 GB/day cap. |

Full module-by-module breakdown: [iac-bicep.md#what-the-bicep-deploys-resource-by-resource](iac-bicep.md#what-the-bicep-deploys-resource-by-resource).

---

## Monthly cost

Assumes ~30 GB stored, ~5 GB egress, personal traffic. Region `westus3`.

| Service | Tier / Usage | Monthly |
|---|---|---|
| Static Web Apps | Free tier (100 GB bandwidth, TLS, PR previews) | $0.00 |
| Blob capacity | 30 GB hot LRS @ ~$0.018/GB | $0.55 |
| Blob ops + egress | <1M reads; first 100 GB egress free | <$0.05 |
| App Service Domain (`.com`) | $11.99/yr amortized | ~$1.00 |
| Azure DNS zone | 1 zone @ $0.50 | $0.50 |
| Application Insights + Log Analytics | First 5 GB/mo free, capped at 0.1 GB/day | $0.00 |
| Bicep deployments | Always free | $0.00 |
| **Total** | | **~$2.10 – $2.60** |

Even at 10× traffic and 100 GB stored, the bill stays under $6/mo, comfortably inside $150/mo credits.

### What we deliberately don't use

| Skipped | Why |
|---|---|
| Front Door Standard (~$35/mo) | SWA's free CDN already does global edge caching. |
| WAF | Needs Front Door. Static site has no logins/forms to defend. |
| Plausible/Fathom (~$9/mo) | App Insights free tier covers it. |
| Azure Key Vault | Effectively no runtime secrets. GitHub Actions secrets hold the few we have. |

---

## Future extensibility

Each of these can be added later without touching anything above.

- **Admin upload UI:** SWA supports managed auth (GitHub/Entra/OIDC) + serverless `/api/*` functions. Add an auth-gated route that streams to Blob. Same SWA, no new hosting tier.
- **iCloud sync:** separate scheduled GitHub Action or Azure Function that writes blobs to `originals/`. Site code reacts to new blobs on the next build, no integration.
- **Sub-minute refresh:** Azure Event Grid → tiny Function → GitHub `repository_dispatch: blob-changed`. The build workflow already accepts that trigger.
- **Login-gated originals:** every blob URL flows through [src/lib/blob.ts](../src/lib/blob.ts). Swap to SAS URLs there and the rest of the site is unchanged.
