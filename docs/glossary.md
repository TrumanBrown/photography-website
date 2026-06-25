# Glossary

Every term used in these docs, in alphabetical order. If anything still feels unfamiliar after reading the other docs, look it up here.

### apex (domain)

The "root" of a domain, `yoursite.com`, no `www.` or other subdomain. Some DNS providers can't put certain record types at the apex; Azure DNS can.

### ARM template

Azure Resource Manager template. The native JSON format Azure uses to describe deployments. We write Bicep, which compiles to ARM.

### Astro

The static site generator this project uses. Reads source code, outputs `dist/` folder of HTML/CSS/JS. Ships near-zero JavaScript by default. Has a built-in image optimization pipeline.

### Azure DNS

Azure's hosted DNS service. Holds the records for your domain (A, CNAME, TXT). Charged $0.50/month per zone.

### Azure Static Web Apps (SWA)

Microsoft's managed hosting for static sites. Free tier includes 100 GB/month bandwidth, global CDN, auto TLS, preview environments. We deploy `dist/` into it.

### Bicep

Microsoft's domain-specific language for Azure infrastructure-as-code. Compiles to ARM. Files end in `.bicep`.

### Blob

A single file inside an Azure Storage container. Has a URL like `https://<account>.blob.core.windows.net/<container>/<path>`.

### CDN (Content Delivery Network)

A global network of edge servers that cache your site's files close to visitors. The first visitor in Tokyo pays the latency to fetch from the origin; subsequent visitors hit the local Tokyo cache. SWA's free tier includes a CDN.

### CI / CD

**Continuous Integration:** automated checks (build, lint, type-check) on every push. **Continuous Deployment:** automatic deploy on every successful build. We use GitHub Actions for both.

### Container (Azure Blob)

A top-level "folder" inside a storage account. We use three: `originals`, `derivatives`, `metadata`.

### CORS (Cross-Origin Resource Sharing)

A browser security rule: by default, JavaScript on `yoursite.com` can't `fetch()` data from `someother.com`. The target site sends CORS headers to allow specific origins. We've pre-configured CORS on the storage account for future admin-upload use; the lightbox today uses `<img>` tags, which don't trigger CORS.

### CSP (Content Security Policy)

An HTTP header that tells the browser "only execute scripts / load images / etc. from these specific origins." Our policy locks down everything except the bare minimum. See [security.md](security.md).

### dcraw_emu

A command-line RAW decoder, part of the `libraw-bin` apt package. We run it during the build to convert Sony `.ARW` (and other RAW) into TIFF, then sharp re-encodes to JPEG.

### Dependabot

GitHub's automated dependency-update service. Watches `npm` and `github-actions` ecosystems, opens PRs when a dependency has a security advisory or new version.

### Derivative (in this project)

The JPEG sidecar generated from a RAW file. Stored in the `derivatives` container in Blob, regenerated on demand, never committed to git.

### EXIF

The metadata embedded in image files by cameras, capture date, camera model, settings, GPS, etc. Our prebuild reads EXIF to derive a session's earliest date when no `_session.json` provides one. We also embed a copyright EXIF tag during RAW conversion.

### Entra (Microsoft Entra)

The new name for what was Azure Active Directory (AAD). Microsoft's identity service. Managed identities, service principals, federated credentials all live here.

### ETag

A unique "fingerprint" Azure assigns to each blob. Changes whenever the blob's content changes. We use ETags to skip re-downloading unchanged photos and skip RAW reconversion when the source hasn't changed.

### Federated credential

A configuration on a managed identity that says "trust JWT tokens issued by an external identity provider (here: GitHub Actions) when their claims match this pattern." Lets GitHub assume an Azure identity without a long-lived shared secret.

### Free tier

Most Azure services have a tier that costs $0 up to certain limits. SWA Free gives 100 GB/month bandwidth, App Insights gives 5 GB/month ingestion, etc. We deliberately stay inside free tiers wherever possible.

### GitHub Actions

GitHub's built-in CI/CD service. YAML files in `.github/workflows/` describe automation. Runs on free Linux VMs.

### Hot tier (Azure Blob)

The access tier for blobs you read frequently. Most expensive to store, cheapest to read. We use it for everything since the whole point is reading the photos.

### HSTS

`Strict-Transport-Security` HTTP header. Tells browsers "for the next N seconds, always use HTTPS for this domain, even if the user types `http://`." We set it for 2 years with `includeSubDomains; preload`.

### IaC (Infrastructure as Code)

Defining your cloud infrastructure in text files instead of clicking through a portal. Reproducible, reviewable, version-controlled. Bicep is our flavor.

### Idempotent

Running the same operation twice has the same result as running it once. Bicep deployments are idempotent, re-applying a template is safe.

### Jamstack

"JavaScript + APIs + Markup." A label for the static-files-behind-a-CDN approach. Astro is a Jamstack tool.

### JWT (JSON Web Token)

A signed token containing claims. GitHub Actions mints JWTs about each workflow run; Azure verifies them and issues real Azure tokens in return.

### Lightbox

A UI overlay that displays an image at full size with navigation controls. We use PhotoSwipe v5.

### LRS (Locally Redundant Storage)

The cheapest Azure storage redundancy: three copies of each blob within one datacenter. (ZRS = across zones, GRS = across regions; both cost more.)

### Managed identity

An Azure identity with no password, used by services to authenticate to other Azure services. **User-assigned** managed identities are stand-alone resources you can reference from anywhere. **System-assigned** ones are tied to a specific resource's lifecycle.

### npm

Node Package Manager. Installs JavaScript dependencies. `package.json` lists them; `package-lock.json` pins exact versions; `node_modules/` is the install output.

### OIDC (OpenID Connect)

An identity protocol. GitHub Actions can produce OIDC tokens; Azure can be configured to trust them. This is the foundation of secret-less auth in our CI/CD.

### PhotoSwipe

The vanilla-JavaScript lightbox library we use. ~20 KB compressed.

### Prebuild

In this project, the `scripts/prebuild.mjs` step that syncs sessions from Blob into `src/content/sessions/` before `astro build` runs.

### RAW (camera RAW)

Unprocessed sensor data from a digital camera. Larger than JPEG, captures more detail, can't be displayed directly by browsers. We convert RAW → JPEG sidecars during the build.

### RBAC (Role-Based Access Control)

Azure's permissions model. Roles like `Storage Blob Data Contributor` are assigned to identities (users, service principals, managed identities) at a specific scope (subscription, RG, single resource).

### Resource group (Azure)

A logical "folder" in Azure. We have one: `rg-photography-prod`. Deleting it deletes everything inside.

### Runner (GitHub Actions)

A VM that executes workflow jobs. GitHub provides free Ubuntu/Windows/macOS runners.

### SAS (Shared Access Signature)

A signed URL with embedded permissions and expiry. Could be used to gate blob access behind a login. We don't use SAS today (originals are public-read on known URLs) but `src/lib/blob.ts` is the one place to switch.

### Sharp

The image-processing library Astro uses under the hood. Pure-native, very fast. We also call it directly from `scripts/prebuild.mjs` to JPEG-encode RAW-derived TIFFs.

### Site config (`site.config.ts`)

The committed TypeScript file that holds display values (owner name, copyright, site title, domain). Edited by humans, picked up by the build, not for secrets.

### Soft delete (Azure Blob)

A trash-can feature: deleted blobs are recoverable for N days. We have it enabled for 7 days.

### SPA (Single-Page Application)

A site that ships a tiny HTML shell + a big JavaScript bundle that builds the page client-side. The opposite of what Astro does. Bad for portfolios.

### Static Web App

See "Azure Static Web Apps."

### staticwebapp.config.json

The configuration file SWA reads at the root of a deployed site. Defines routes, headers, MIME types, 404 mapping. Our copy ships the security headers.

### Storage account

The top-level Azure storage resource. Holds blob containers, queues, tables, file shares. We use only blobs.

### Subscription (Azure)

Your billing account. Everything else is scoped within it.

### Tailwind CSS

Utility-first CSS framework. You write `class="p-4"` in HTML; Tailwind generates `padding: 1rem`. Build time strips unused utilities, producing a tiny final CSS file.

### TLS (Transport Layer Security)

The "S" in HTTPS. SWA auto-issues and auto-renews TLS certificates for your domains. The storage account requires TLS 1.2+.

### TSV (Tab-Separated Values)

Output format used by `az` CLI for scripts. `--query "..." -o tsv` returns a single value cleanly.

### WAF (Web Application Firewall)

Filters malicious HTTP traffic. Worth it for sites with logins/forms; overkill (and ~$35/mo) for a static portfolio. We don't use one.

### Workflow (GitHub Actions)

A YAML file in `.github/workflows/` describing automated jobs and the events that trigger them.

### Zod

A TypeScript-first schema validation library. Astro's content collections use Zod to type-check the JSON files in `src/content/`. We define the session shape in `src/content/config.ts`.
