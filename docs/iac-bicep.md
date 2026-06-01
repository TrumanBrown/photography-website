# Infrastructure as Code — what Bicep is and what every file does

> Audience: someone who has used the Azure Portal but never written IaC. Read this before your first `Run workflow` on `Infra (Bicep)`.

## What "Infrastructure as Code" actually means

If you create Azure resources by clicking around the Portal, three things go wrong over time:
1. **You forget what you did.** Six months later, you can't recreate it.
2. **Tear-down + rebuild is a manual slog.** Moving to a different subscription means re-clicking dozens of pages.
3. **Changes are invisible.** No diff, no review, no rollback.

"Infrastructure as Code" means: write a text file describing what should exist, commit it to git, apply it with one command. Now your infrastructure has version history, code review, and is reproducible.

## Why Bicep specifically

| Option | What it is | Why not it |
|---|---|---|
| **ARM templates** | Microsoft's original IaC format. Raw JSON. | Painfully verbose. Bicep compiles down to ARM but is ~⅓ the lines. No reason to write raw ARM. |
| **Terraform** | Multi-cloud IaC from HashiCorp. | Requires a separate "state file" stored somewhere (typically another blob container). Adds setup complexity. Worth it if you target AWS+Azure+GCP. Overkill for one cloud. |
| **Pulumi** | IaC written in real programming languages (TS/Python/Go). | Adds a runtime dependency. Useful if you have complex logic. Overkill here. |
| **Docker + Container Apps** | Package your app in a container; run it on Azure's container service. | Static files don't need a container. You'd pay for an always-on container to serve HTML. |
| **Bicep** ✓ | Microsoft-first IaC, native to Azure. | Tracks state via Azure's own deployment history — no separate state file. Excellent VS Code tooling. Cleanest fit for "one cloud, one project, readable." |

## How Bicep deploys actually work

Bicep doesn't execute anything itself. The flow is:
1. You write `.bicep` files.
2. The `az bicep build` step compiles them to `.json` ARM templates.
3. The `az deployment ... create` command sends that JSON to Azure's deployment engine.
4. Azure compares "what you declared" against "what currently exists" and applies the diff.

Re-running with the same input does **nothing** if reality already matches — this is called "idempotent." That's what makes it safe to run repeatedly (e.g., on every push to `main`).

---

## Repo layout

```
infra/
├── subscription.bicep        # subscription-scope: creates the resource group
├── main.bicep                # resource-group-scope: orchestrates the modules
├── main.parameters.json      # values passed into subscription.bicep
└── modules/
    ├── storage.bicep         # storage account + 3 containers + CORS
    ├── swa.bicep             # Static Web App + custom domains
    ├── identity.bicep        # managed identity + RBAC + GitHub OIDC
    ├── domain.bicep          # App Service Domain + DNS records
    └── monitoring.bicep      # App Insights + Log Analytics workspace
```

### Why a separate `subscription.bicep`

Most Bicep templates target a resource group ("resource group scope" — they assume the RG already exists). But on first deploy the RG doesn't exist yet. `subscription.bicep` runs at **subscription scope**, where you can create resource groups. It creates the RG and then calls `main.bicep` scoped into that RG. This is standard practice and lets you go from zero to fully-deployed in one command.

---

## What the Bicep deploys, resource by resource

Each numbered item below is created by the modules in `infra/modules/`.

### 1. Resource group — `rg-photography-prod`

A logical folder in Azure that holds every other resource. Created by `subscription.bicep`. Deleting the RG = deleting everything in this list.

### 2. Storage account — `stphoto<env><suffix>`

Created by [`modules/storage.bicep`](../infra/modules/storage.bicep). Configured for safety + low cost:
- `Standard_LRS` (cheapest redundancy — three copies in one datacenter)
- `Hot` access tier (optimized for frequent reads)
- `allowSharedKeyAccess: false` — disables the legacy "use this magic key to do anything" mode. All management must go through Entra (Azure AD) identities.
- `minimumTlsVersion: TLS1_2`, `supportsHttpsTrafficOnly: true` — never accept plaintext or old TLS.
- 7-day blob soft-delete — accidental delete is undoable for a week.

### 3. Three blob containers

- `originals` — your uploads. Public-read on known URLs only (cannot be listed by anonymous users).
- `derivatives` — RAW→JPEG sidecars written by the build pipeline. Same access.
- `metadata` — fully private. Holds the build's manifest of file fingerprints and is reserved for future admin-app state.

The choice of "Blob" public-access level (vs. "Container") is deliberate — see [security.md](security.md#blob-access).

### 4. CORS rule

Lets browsers on `yoursite.com` make `fetch()` requests against the blob endpoint. **CORS = Cross-Origin Resource Sharing**, a browser security rule that by default blocks cross-origin requests. We don't actually need it today (the lightbox uses `<img>` tags, which don't trigger CORS) but it's pre-wired for a future admin upload UI.

### 5. Static Web App — `swa-photography-prod`

Created by [`modules/swa.bicep`](../infra/modules/swa.bicep). Free SKU. SWA Free is only available in a handful of regions; the module maps your chosen resource-group region (e.g. `westus3`) onto a nearby SWA-supported region automatically.

When `domainName` is set, the module also creates child resources for the apex + `www` custom-domain bindings with managed certificates.

### 6. User-assigned managed identity — `id-photography-deploy-<env>`

Created by [`modules/identity.bicep`](../infra/modules/identity.bicep). This is the "service account" the build workflow assumes to download originals and write derivatives.

It has two federated credentials:
- `github-main` — trusts JWTs from `repo:<owner>/<repo>:ref:refs/heads/main`. Scoped tightly to your repo + branch.
- `github-pull-request` — trusts JWTs from `repo:<owner>/<repo>:pull_request`. Needed for SWA preview deploys.

And two role assignments:
- `Storage Blob Data Contributor` on the storage account — read originals, write derivatives.
- `Reader` on the resource group — look up resource properties during deploy.

Full mechanism: [cicd.md](cicd.md#oidc-federation-no-long-lived-secrets).

### 7. App Service Domain (only if `domainName` is set)

The domain registration itself. Bicep can manage it after first-time interactive purchase via `az appservice domain create --accept-terms`. Privacy protection on (your address isn't in public WHOIS lookups). Auto-renew on (don't lose the domain to forgetfulness).

### 8. DNS records in the auto-created zone

- `A` (alias) at apex → SWA hostname (created by [scripts/bind-domain.sh](../scripts/bind-domain.sh) because alias-to-SWA isn't representable in pure Bicep)
- `CNAME` `www` → SWA hostname
- `TXT` at apex → SWA validation token (proves to SWA that you own the domain)

### 9. Application Insights + Log Analytics workspace

Created by [`modules/monitoring.bicep`](../infra/modules/monitoring.bicep). App Insights is the pageview-and-performance monitor; Log Analytics is the underlying storage workspace. Free 5 GB/mo ingestion. Daily cap 0.1 GB on the workspace as a runaway-cost safety net.

### 10. Outputs

The deployment emits values your scripts/workflows need:
- `storageAccountName`, `blobEndpoint`
- `swaName`, `swaDefaultHostname`
- `managedIdentityClientId`, `managedIdentityPrincipalId`
- `appInsightsConnectionString`

The Infra workflow uses these to populate repo secrets (`AZURE_STATIC_WEB_APPS_API_TOKEN`, `AZURE_STORAGE_ACCOUNT`, etc.) so the build workflow can find them.

---

## How to deploy / re-deploy

### From GitHub (normal path)

GitHub → **Actions** → **Infra (Bicep)** → **Run workflow** → pick environment. Done.

### From your laptop (debugging)

```bash
az login
az deployment sub create \
  --location westus3 \
  --template-file infra/subscription.bicep \
  --parameters @infra/main.parameters.json \
  --parameters githubOwner=<owner> githubRepo=<repo>
```

### Preview what would change

```bash
az deployment sub what-if \
  --location westus3 \
  --template-file infra/subscription.bicep \
  --parameters @infra/main.parameters.json
```

This shows a diff between declared state and current state. Always good before a deploy in a long-lived environment.

### Tear it all down

```bash
az group delete --name rg-photography-prod --yes --no-wait
```

App Service Domain registration **is not** deleted by this — that's intentional; you don't want a typo to lose your domain. Delete it explicitly with `az appservice domain delete` if you really mean it.

---

## Common Bicep gotchas you may hit

- **First-time domain purchase needs interactive consent.** You cannot do it through Bicep on the first deploy; run `az appservice domain create --accept-terms` once, then Bicep can manage it.
- **Storage account name must be globally unique** across all of Azure, 3–24 lowercase chars, digits/letters only. The module appends a short `uniqueString()` suffix to make collisions essentially impossible.
- **SWA Free has region restrictions.** Not every Azure region offers SWA Free; the module maps your RG region to a supported SWA region.
- **Some warnings are intentional.** [`modules/domain.bicep`](../infra/modules/domain.bicep) declares a `contact` parameter that's unused inside Bicep — it's just there so you can pass contact info through to the bootstrap script's `az appservice domain create` call. The module suppresses the lint warning with `#disable-next-line`.
