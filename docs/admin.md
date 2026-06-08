# Admin panel — editing session metadata from the browser

> Audience: site owner (you). Explains what `/admin` does, how SWA auth protects it, and how to set it up on a fresh deployment.

## What it does

The admin page at `https://trumanbrown.com/admin` lets you edit session metadata without touching VS Code:

- **Title** — the display name shown on cards and the session page.
- **Cover / thumbnail** — which image from the session to use as the card image on the home page.
- **Location** — where the session was shot.
- **Description** — a short blurb shown on the session page.
- **Display order** — explicit sort priority (lower numbers first; blank = sort by date).

Changes are written to a `_session.json` sidecar file in `originals/<session>/` in Blob Storage. The next build (hourly cron, or manual trigger) reads this sidecar and applies the metadata to the site.

## How to use it

1. Go to `https://trumanbrown.com/admin`.
2. You'll be redirected to GitHub OAuth — sign in with your GitHub account.
3. The page lists all sessions found in Blob Storage.
4. Click **Edit** on any session → modal opens with current values.
5. Change what you want → click **Save**.
6. A toast confirms the save. Changes go live on the next build (~1 hr cron, or trigger manually from GitHub Actions).

## How authentication works

This uses **Azure Static Web Apps built-in authentication**, not custom code.

### The flow

```
Browser → /admin
  ↓ (no session cookie)
SWA returns 401
  ↓ (responseOverrides in staticwebapp.config.json)
Redirect to /.auth/login/github?post_login_redirect_uri=/admin
  ↓
GitHub OAuth consent screen
  ↓ (user grants)
SWA creates a session cookie, attaches the user's roles
  ↓
Browser → /admin (with cookie)
  ↓
SWA checks: does user have "admin" role?
  YES → serve the page
  NO  → 403 Forbidden
```

### Where the roles come from

SWA has a concept of **role invitations**. In the Azure Portal:

1. Go to your **Static Web App** resource.
2. Left sidebar → **Role Management**.
3. **Invite** a user by GitHub username, assign them the `admin` role.
4. The invited user opens the generated link once to accept.

Only invited users with the `admin` role can access `/admin` and `/api/admin/*`. Everyone else — even authenticated GitHub users — gets a 403.

### What's in the config

In [`staticwebapp.config.json`](../staticwebapp.config.json):

```json
{
  "routes": [
    { "route": "/admin", "allowedRoles": ["admin"] },
    { "route": "/admin/*", "allowedRoles": ["admin"] },
    { "route": "/api/admin/*", "allowedRoles": ["admin"] }
  ],
  "responseOverrides": {
    "401": {
      "redirect": "/.auth/login/github?post_login_redirect_uri=/admin"
    }
  }
}
```

The `authenticated` role is automatically assigned to any logged-in user. The `admin` role is only assigned via Portal invitation. Route protection happens at the SWA platform level — before any code runs.

### API protection

The API function at `/api/admin/sessions` is also behind the `admin` role. Even if someone crafts a direct `PUT` request, SWA blocks it unless the request carries a valid session cookie with the `admin` role.

## Architecture

```
Browser ──GET /admin──▶ SWA ──(auth check)──▶ Static HTML + JS
Browser ──GET /api/admin/sessions──▶ SWA Functions ──▶ Blob Storage (list originals/)
Browser ──PUT /api/admin/sessions──▶ SWA Functions ──▶ Blob Storage (write _session.json)
                                                            │
                                                            ▼
                                                    Next build reads
                                                    _session.json sidecar
                                                    ──▶ site updated
```

The API function ([`api/admin-sessions/index.js`](../api/admin-sessions/index.js)) uses the same `AZURE_STORAGE_CONNECTION_STRING` env var as the contact form function to access Blob Storage.

## Fresh deployment setup

After deploying the SWA infrastructure (Bicep), do these steps once:

1. **Set the `AZURE_STORAGE_CONNECTION_STRING` app setting** on the SWA resource if not already done (needed by both the contact form and admin API).
2. **Invite yourself** in the Azure Portal:
   - Static Web App → Role Management → Invite.
   - Provider: **GitHub**, Username: **your GitHub handle**, Domain: your custom domain, Role: **admin**.
   - Set expiration (max 8760 hours = 1 year).
   - Open the generated invite link in your browser to accept.
3. Visit `https://yourdomain.com/admin` — you'll authenticate via GitHub and see the session manager.

### Re-inviting after expiration

Invitations expire. When yours does, `/admin` will return 403 after your next login. Just create a new invitation in the Portal with the same settings.

## What the admin panel cannot do

By design, the admin panel only edits metadata. It cannot:

- Upload, delete, or reorder images.
- Delete sessions.
- Change site configuration or code.
- Access other Azure resources.
- Grant admin access to other users (that's Portal-only).

For anything beyond metadata edits, use VS Code + the CLI tools (`upload-session.sh`, etc.).
