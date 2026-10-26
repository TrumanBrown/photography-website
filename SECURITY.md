# Security Policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue for anything exploitable.

- Preferred: use GitHub's private vulnerability reporting on this repository (the **Security** tab, then **Report a vulnerability**). This opens a private advisory visible only to the maintainer. The site's [security.txt](https://trumanbrown.com/.well-known/security.txt) points to the same place.
- If private reporting is not available, open a minimal public issue that says only that you have a security report and would like a private channel. Do not include exploit details in the public issue.

Where possible, include:

- A description of the issue and its impact.
- Steps to reproduce, or a proof of concept.
- The affected URLs, endpoints, or components.

## Scope

This is a personal static website hosted on Azure Static Web Apps. The surfaces most worth looking at are:

- The Azure Functions API under `api/` (contact form, analytics beacon, admin session manager).
- The Static Web Apps configuration in `staticwebapp.config.json` (response headers, Content Security Policy, auth and role gating).
- The infrastructure-as-code in `infra/` (Bicep).
- The GitHub Actions workflows in `.github/workflows/` and the scripts they run, including the Azure identities they sign in as.
- Anything published that shouldn't be: a photo that still records where it was taken, an exact location on a hobby map, or contact messages or analytics readable without the admin sign-in.

Out of scope: denial-of-service and volumetric attacks, automated scanner output without a concrete finding, missing best-practice headers with no demonstrated impact, and anything requiring privileged access to the maintainer's accounts or devices.

## What to expect

This project is maintained by one person as a personal site, so responses are best effort. Verified, in-scope reports will be acknowledged and addressed as quickly as is practical.

## How the site is hardened

The full security model (CSP, HSTS, OIDC federation and least-privilege identities between GitHub and Azure, Blob access posture, photo location removal, and admin authentication) is documented in [docs/security.md](docs/security.md). What personal information is public by design is listed in [docs/privacy.md](docs/privacy.md).
