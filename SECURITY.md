# Security Policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue for anything exploitable.

- Preferred: use GitHub's private vulnerability reporting on this repository (the **Security** tab, then **Report a vulnerability**). This opens a private advisory visible only to the maintainer.
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

Out of scope: denial-of-service and volumetric attacks, automated scanner output without a concrete finding, missing best-practice headers with no demonstrated impact, and anything requiring privileged access to the maintainer's accounts or devices.

## What to expect

This project is maintained by one person as a personal site, so responses are best effort. Verified, in-scope reports will be acknowledged and addressed as quickly as is practical.

## How the site is hardened

The full security model (CSP, HSTS, OIDC federation between GitHub and Azure, Blob access posture, and admin authentication) is documented in [docs/security.md](docs/security.md).
