# Security plan: every threat surface and the mitigation

> Audience: anyone who wants to understand or audit the site's posture.

## TL;DR

The site has no public logins and no user database. An `/admin` panel exists but is gated by **SWA built-in auth** (GitHub OAuth + role invitation), see [docs/admin.md](admin.md). Its **runtime** attack surface is essentially "what bugs exist in Microsoft's CDN," which is Microsoft's problem to fix. What we focus on:

- Lock down the storage account so attackers can't enumerate or modify it.
- Send strong HTTP security headers so visitors' browsers refuse to be misused.
- Gate admin routes behind SWA role-based auth (GitHub OAuth, invite-only `admin` role).
- Use short-lived, narrowly-scoped credentials everywhere (OIDC federation, no long-lived secrets).
- Collect analytics **without storing any PII** (no IP, no cookies, see [docs/analytics.md](analytics.md)).
- Be honest about what's worth defending vs. what would just inflate the bill.

### Analytics endpoint

`/api/track` is an anonymous POST endpoint that records pageviews. It is hardened against abuse and privacy issues:
- **No PII stored.** Unique visitors are counted via a daily-salted `sha256(ip + ua + date + salt)` hash; the raw IP is never persisted. No cookies or persistent client identifiers.
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
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | Explicitly deny powerful APIs. |
| `X-Frame-Options` | `DENY` | Other sites can't iframe yours (clickjacking). |

#### The CSP unpacked

```
default-src 'self';
img-src 'self' https://*.blob.core.windows.net https://static.inaturalist.org https://inaturalist-open-data.s3.amazonaws.com data:;
script-src 'self' https://js.monitor.azure.com;
connect-src 'self' https://*.blob.core.windows.net https://api.inaturalist.org https://*.in.applicationinsights.azure.com https://*.livediagnostics.monitor.azure.com;
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
object-src 'none';
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

Translation:
- **`default-src 'self'`**: load resources only from the site's own origin unless overridden.
- **`img-src 'self' https://*.blob.core.windows.net https://static.inaturalist.org https://inaturalist-open-data.s3.amazonaws.com data:`**: also allow images from any Azure Blob endpoint (lightbox full-res, hobby photos), the iNaturalist photo CDNs (the tide-pooling observations grid and species photos), and `data:` URIs (inlined SVG icons).
- **`script-src 'self' https://js.monitor.azure.com`**: own origin + the App Insights SDK CDN.
- **`connect-src 'self' https://*.blob.core.windows.net https://api.inaturalist.org https://*.in.applicationinsights.azure.com ...`**: Blob (lightbox original download), the public iNaturalist API (tide-pooling observations grid), and App Insights ingestion endpoints.
- **`style-src 'self' 'unsafe-inline'`**: `'unsafe-inline'` is required by Astro's scoped style blocks. Can be tightened later with hashes; modest risk.
- **`object-src 'none'`**: no `<object>` / `<embed>` / Flash-era nonsense.
- **`frame-ancestors 'none'`**: modern equivalent of `X-Frame-Options: DENY`.
- **`base-uri 'self'`**: attackers can't inject a `<base>` tag pointing relative URLs elsewhere.
- **`form-action 'self'`**: forms can only submit to the site's own origin (contact form, admin).

If you ever add inline scripts, switch to per-script hashes rather than `'unsafe-inline'`. Astro can emit hash-based CSPs in a future iteration if needed.

### Contact form abuse

The public contact endpoint (`api/contact`) has layered protection:

- **Honeypot field.** A hidden `website` input that humans never see. Bots that fill it get a fake success and are silently dropped.
- **Server-side validation.** Name, email, and message are length-checked and the email is format-checked before anything is stored.
- **Per-IP rate limit.** Each client is capped at a handful of messages per hour. The limiter stores only a salted, truncated hash of the IP (the same hashing the analytics beacon uses), never the raw IP, in a `contactratelimit` table. It fails open: if the limiter backend errors, a real message is never blocked.

### Blob storage access controls

| Surface | Mitigation |
|---|---|
| Shared access keys leaking | `allowSharedKeyAccess: false`. There is no "master password" for the storage account. All management must go through Microsoft Entra (Azure AD) identities. |
| Anonymous enumeration of all your photos | Containers use public-access level `Blob`, **not** `Container`. Anonymous users can `GET` a blob if they know its URL; they cannot list the container's contents. |
| Pipeline credentials sitting in env vars | The build pipeline authenticates as a managed identity via OIDC federation. No keys, no PATs. The token is short-lived and scoped to one branch of one repo. See [cicd.md](cicd.md#oidc-federation-no-long-lived-secrets). |
| Unauthorized writes to `originals/` | RBAC: only the managed identity has `Storage Blob Data Contributor`. Public users have read-only access to known URLs. |
| Accidental delete | 7-day blob soft-delete enabled. Recover via `az storage blob undelete`. |

### Hotlinking and scraping

"Hotlinking" = someone embeds your photo on their site by linking to its URL, eating your bandwidth without credit. "Scraping" = bot downloads everything.

What we do (cheap, reasonable):
- EXIF copyright tag embedded into every derivative JPEG during prebuild.
- Visible "© <Year> <Owner Name>" footer on every page.
- Per-image credit text near each lightbox.
- Right-click context-menu suppression on the lightbox image (mild deterrent, not security, anyone with DevTools can grab the URL anyway).
- `robots.txt` allows search engines to crawl page URLs but doesn't promote the blob origin.

What we don't do (expensive, low value):
- **Rate limiting per IP.** Needs Front Door + WAF (~$35/mo). Vast overspend for a personal portfolio.
- **SAS-signed URLs with short expiry.** Would break shareable image links and SEO previews.

The honest framing: for a public portfolio, the goal isn't making theft impossible (it can't be, if it's visible it's downloadable). The goal is ensuring attribution + the copyright claim is unambiguous when theft happens.

### Web Application Firewall (WAF)

Deliberately skipped. WAF in Azure requires either Azure Front Door or Application Gateway, both of which carry a ~$35+/month base fee.

Worth it when you have:
- Login / auth endpoints to brute-force
- Forms that could be SQL-injected
- Admin panels to defend
- Server-side code with patchable vulnerabilities

A static portfolio has none of those. Revisit if/when admin upload ships.

### Secret hygiene

- **No secrets in the repo, ever.** The only configurable values committed live in `site.config.ts` (display config) and `infra/main.parameters.json` (resource names + your GitHub username). Neither is sensitive.
- **GitHub → Azure auth** is OIDC federation. No `client_secret` exists for an attacker to steal.
- **One real secret in GitHub Actions:** `AZURE_STATIC_WEB_APPS_API_TOKEN`, the SWA deploy token. Rotated by re-running the Bicep deploy.
- **Domain registration contact info** (`contact.json`, contains your real address and phone) is gitignored.
- **Dependabot** is enabled for the `npm` and `github-actions` ecosystems, auto-PRs when a dependency has a CVE.

### Supply chain

| Surface | Mitigation |
|---|---|
| Malicious npm package | `npm ci` against committed `package-lock.json`; Dependabot alerts; no autopilot updates. |
| Compromised GitHub Action version | All third-party actions pinned to major version (e.g. `@v4`). Consider full SHA pinning if you become more paranoid. |
| Compromised npm registry mirror | Currently we trust the public registry; nothing avoids this at this scale. |

### Data we collect

- **No analytics on visitors** unless `APPINSIGHTS_CONNECTION_STRING` is set. Even then, the snippet respects `navigator.doNotTrack`.
- **No cookies.** Theme preference uses `localStorage`, which is client-only.
- **No user accounts, no PII.**

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
# Should return AuthorizationFailure or AuthenticationFailed
```

Aim for an A or A+ on both securityheaders.com and ssllabs.com on first deploy.

---

## What I'd add later if the project grew

In rough order:
1. **CSP `'unsafe-inline'` tightening** via Astro's hash mode, easy win once we stop iterating on styles.
2. **Subresource Integrity (SRI)** on App Insights script tag, pinned hash so a CDN compromise can't inject malicious JS.
3. **`Cross-Origin-Opener-Policy: same-origin`** + **`Cross-Origin-Embedder-Policy: require-corp`** if we ever need full cross-origin isolation.
4. **WAF + rate limiting** the moment the site gets any kind of upload endpoint or login.
