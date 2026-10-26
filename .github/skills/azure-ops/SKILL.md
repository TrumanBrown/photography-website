---
name: azure-ops
description: "The Azure side of the site: Bicep in infra/ and the manual Infra workflow, the two GitHub OIDC identities and their federated credentials, GitHub secrets and Static Web Apps app settings, the SWA Free app and its managed Functions in api/ (lazy SDK loading, auth through x-ms-client-principal), Blob containers and CORS, the Logic App timer, the custom domain, the monthly bill and the security posture. Use when: changing infra or running infra.yml; an API function returns 404, or HTML instead of JSON; adding an API function, a role or an app setting; OIDC login, role or token problems; investigating an Azure cost spike or the Bandwidth meter; deciding whether something is worth the money (Truman's monthly credit, performance first); domain or certificate trouble; or a security or secrets pass."
argument-hint: 'the change or question, e.g. "why is Bandwidth so high this month" or "add an API for print requests"'
---

# Azure operations

Everything runs in one resource group, `rg-photography-prod`, defined in Bicep and deployed by the manual Infra workflow (`infra.yml`). GitHub Actions signs in with OIDC, so no long-lived Azure secret exists anywhere. The reference docs are [docs/azure.md](../../../docs/azure.md), [docs/iac-bicep.md](../../../docs/iac-bicep.md), [docs/cicd.md](../../../docs/cicd.md) and [docs/security.md](../../../docs/security.md), and the long list of early Azure surprises is in [docs/session-handoff.md](../../../docs/session-handoff.md#hard-won-lessons-in-the-order-they-bit-us).

| Piece                                        | Defined in                                                              | Notes                                                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage account                              | `infra/modules/storage.bicep`                                           | `originals`, `derivatives`, `variants`, `hobby-media` (read by URL, no listing), `metadata` and `incoming` (private), tables for contact messages, page views and rate limits, CORS for the site's own hosts only |
| Static Web App `swa-photography-prod` (Free) | `infra/modules/swa.bicep`                                               | the site plus managed Functions in `api/`. 250 MB and 15,000 files per deploy, three preview environments                                                                                                         |
| Identities                                   | `infra/modules/identity.bicep`, `scripts/setup-federated-credential.sh` | a bootstrap identity for the Infra workflow only, and a limited build identity for everything else ([why](../../../docs/cicd.md#two-identities-least-privilege-by-job))                                           |
| Azure OpenAI                                 | `infra/modules/ai.bicep`                                                | keyless, used only by the Photo captions workflow                                                                                                                                                                 |
| Logic App timer                              | `infra/modules/scheduler.bicep`                                         | starts Photo captions and Social post, because GitHub's scheduler skips runs                                                                                                                                      |
| Domain and DNS                               | `infra/modules/domain.bicep`, `scripts/bind-domain.sh`                  | custom-domain bindings are done by the script after Infra, never in Bicep                                                                                                                                         |
| API                                          | `api/contact/`, `api/track/`, `api/sessionmgr/`, `api/shared/`          | CommonJS, `function.json` per function, tests as `*.test.cjs`                                                                                                                                                     |
| Headers and CSP                              | `staticwebapp.config.json`                                              | copied into `dist/` by the workflow; see ship-and-ci for inline-script hashes                                                                                                                                     |

Secrets and settings are listed in the [secrets cheat sheet](../../../docs/cicd.md#secrets-cheat-sheet) and docs/session-handoff.md. Runtime settings for the Functions (`AZURE_STORAGE_CONNECTION_STRING`, `ADMIN_GITHUB_USERS`, `ANALYTICS_SALT`, and `GITHUB_TOKEN` for Rebuild and the timer) live only as SWA app settings.

## Truman's rules

- **Performance and quality first; he has a monthly Azure credit.** "I want performance over cost efficiency always" (2026-06-27); "dont limit or bottleneck these possible features or tools based on that. I get $150 a month in azure credits and I use basically 0" (2026-09-27). Upgrading the SWA tier is on the table if it helps.
- **But cut waste nobody sees.** The build's own downloads were most of the bill, and he approved the fix because it made "no visible difference to customers" (2026-10-15). Explain any cost change very simply, in the README too.
- **No paid call a visitor can trigger.** He turned down a cloud model for the birding selfie because "a couple users could spam that and immedaitely eat my credits" (2026-06-28).
- **Nothing secret in the public repo**: no tokens, subscription, tenant or identity ids, personal email, or the Instagram account. He asked for scrubs twice (2026-10-10, 2026-10-12). Docs use placeholders for ids.
- **Ask before account-level changes**: deleting resources, moving workflows to a different identity, rotating storage keys, rewriting git history.

## Change infra

1. Edit `infra/`, then `az bicep build --file infra/subscription.bicep --stdout > /dev/null`.
2. `az deployment sub what-if --location westus3 --template-file infra/subscription.bicep --parameters @infra/main.parameters.json`.
3. A new role assignment in Bicep needs its role id in `ASSIGNABLE_ROLES` in `scripts/setup-federated-credential.sh`, and that script run again first, or the bootstrap identity can't assign it.
4. Commit and push, then `gh workflow run infra.yml -f environment=prod` and watch it. The run rewrites `AZURE_STORAGE_CONNECTION_STRING` and `ANALYTICS_SALT` and keeps the other settings. If it can't write GitHub secrets, run `./scripts/bootstrap-swa-token.sh` afterwards.
5. Incremental deploys never delete. Remove retired resources and role assignments by hand, after asking.

## Add an API function

1. `api/<name>/function.json` (HTTP trigger, `authLevel: anonymous`, a flat route) and `index.js` exporting `async function (context, req)`.
2. Load Azure SDKs lazily inside a getter, as `getService()` does in `api/sessionmgr/index.js`. A top-level `require('@azure/storage-blob')` crashed the function at load, and SWA answered 404 with no logs.
3. Put the logic in its own module with a `*.test.cjs` next to it; shared helpers go in `api/shared/`.
4. A new dependency: `cd api && npm install <pkg>` and commit `api/package.json` with `api/package-lock.json`.
5. Settings go in SWA app settings and the docs, never in code. Admin-only routes reuse `auth.js` and check the `x-ms-client-principal` header; never put `allowedRoles` on `/api` routes, because SWA's 401 override is global and turns API errors into a login page.
6. After the deploy, `curl -i https://trumanbrown.com/api/<name>`. A function that crashed on its first deploy can stay 404 for good: rename its folder to make SWA register it again.

## Investigate the bill

1. Find the meter in Cost Management. "Bandwidth" is data leaving the storage account: internet egress, and transfer to GitHub's runners, which are Azure VMs in other regions.
2. Split storage egress by who asked: `az monitor metrics list --resource "<storage account id>/blobServices/default" --metric Egress --interval P1D --aggregation Total --filter "Authentication eq '*'" --start-time <iso> --end-time <iso>`. `OAuth` is builds and agents, `Anonymous` is visitors. On WSL, pipe `az` output through `tr -d '\r'`.
3. Check GitHub's caches (`gh cache list`). Over 10 GB, GitHub evicts one and the next build downloads everything again; Build and Deploy runs over 20 minutes give it away.
4. Propose a fix with what a visitor would notice spelled out, prove it, measure before and after, and update README "What it costs" and docs/azure.md.
5. Open levers noted in October 2026: about 15,000 per-file property checks per build in `sync-variants.mjs` (most of the request cost), about 1.7 GB of orphaned variants, and no budget alert.

## Truman's verdicts

- 2026-06-27: "we can go over SWA free tier... I want performance over cost efficiency always."
- 2026-07-09: "if this is a limitation on the azure static web app or anything in azure REMEMBER WE CAN ALWYAS IMPROVE IT."
- 2026-09-27: "i dont know how this keeps getting lost, but you need to rememebr this - i have more money credits in azure I can spend."
- 2026-10-12: "I just want to reduce the number of local dependencies so I can easily work on this repo from a different machine", which is why location stripping runs in CI and not on the uploader's machine.
- 2026-10-15: "what is this bandwidth majority cost?", then the build copies once he knew visitors would see no difference.

## Hard-won lessons

1. **OIDC subjects are literal strings.** A job with `environment: prod` signs in as `...:environment:prod`, not as the branch, and each subject needs its own federated credential. Azure also rejects two federated-credential writes on one identity at the same time, so they're chained with `dependsOn`.
2. **Owner isn't data access.** Reading blobs needs a Storage Blob Data role on the account, even for the subscription owner.
3. **Domain bindings and Bicep deadlock**: the apex TXT token only exists after the binding starts. `scripts/bind-domain.sh` does it afterwards.
4. **SWA managed Functions can't use the OIDC identity**, so they get a storage connection string as an app setting, never in git or a GitHub secret.
5. **`skip_app_build` makes `app_location` the deploy root**, so the workflow deploys `dist` directly.
6. **The caption model returned 401** because workflows sign in as whichever identity `AZURE_DEPLOY_CLIENT_ID` or its fallback names. The OpenAI role is granted to both (`a6e759b`). Check which identity a run used before blaming a role.
7. **The Logic App reads the SWA `GITHUB_TOKEN` setting at deploy time.** When that token expires, the timer and the Rebuild button both stop: replace the setting, then run Infra again.
8. **The October 2026 security review** found photos with GPS, globe pins precise to a metre and a herp map precise to 50 m. It led to the private inbox, the coarse gazetteer and 0.1° map grid, and a CSP pinned to one storage account (`79259d2`, `c33d9e4`). Keep any new feature inside those lines.
9. **The Windows `az` CLI under WSL appends `\r`** to its output, which broke string comparisons in scripts until it was stripped.
10. **Re-running `scripts/bind-domain.sh` would have removed Google's Search Console verification.** It deleted the whole apex TXT record set before writing the Static Web Apps token, and Google's value lives in the same set. It now adds the token beside what's there (2026-10-25). Never delete the apex TXT set.
11. **"Failed to fetch federated token from GitHub" doesn't always mean a missing `id-token: write`.** It's what `azure/login` says about any failure to get GitHub's OIDC token, including GitHub's token service not answering. On 2026-10-26 it failed the hourly build's second sign-in while the first, five minutes earlier, had worked. Every workflow now signs in through `.github/actions/azure-login`, which retries twice. If all three tries fail, then check the permission and the federated credential's subject.

## Gotchas

- SWA runs in West US 2 while the resource group and storage are in westus3; the module maps it.
- `ANALYTICS_SALT` is derived from the storage connection string, so rotating storage keys and running Infra splits that day's unique visitors.
- `az costmanagement` needs an extension that prompts to install; Cost Management in the portal is simpler.
- Some resources were made outside Bicep (an alert rule and older monitoring). Ask before removing anything.
- The free SWA plan includes 100 GB of its own bandwidth with no overage; Blob egress is billed separately.

Add new verdicts and lessons here, dated, in the commit that acts on them.
