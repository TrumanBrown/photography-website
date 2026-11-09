# Analytics: privacy-friendly traffic metrics

> Audience: site owner. Explains how the built-in analytics work, what's collected (and deliberately not), and how to read the numbers in `/admin`.

## What it does

A lightweight, self-hosted analytics pipeline that records pageviews, time-on-page and what visitors do on the front door's Weekdays side (the resume), then shows them in the **Analytics tab** of `/admin`. It's there so Truman can see whether the portfolio is doing anything for his resume: who opens it, for how long, and where they go next. No Google Analytics, no third parties, no cookies.

Metrics shown:
- **Pageviews**: total page loads in the selected range.
- **Daily unique visitors**: the sum of each day's distinct privacy hashes (see privacy note below).
- **Visits**: distinct tab-scoped browsing sessions in the selected range.
- **Avg. measured time**: average duration among pageviews whose leave beacon arrived.
- **Period comparison**: each headline metric is compared with the immediately preceding range of the same length.
- **Traffic over time**: labeled pageview and daily-visitor lines. Hover or focus a day to inspect pageviews, visitors, visits, average measured time, and timing coverage. A screen-reader table contains the same data.
- **Visit quality**: pages per visit, single-page visit rate, and measured-time coverage.
- **Page performance**: views, daily visitors, entry visits, measured time, and timing coverage for every viewed route.
- **Acquisition**: pageview share by external referrer; direct traffic and same-site navigation are grouped together.
- **Weekdays and resume visits** (at the top of the tab): one row per visit that opened the Weekdays side of the front door (the resume) or came in on a tagged link such as the resume PDF's `?via=resume`. Each row shows when, where it came from, the network owner and its kind, the network's city, the device, how long Weekdays was on screen, how far down they got, what they clicked and copied, and where they went next. A row opens to show every step with its time from arrival. Totals above it count Weekdays visits, resume visits, the median time on Weekdays, Resume (PDF) clicks, visits that copied something and likely email link scanners, and list the network owners seen most.

Range is selectable: last 7, 30, or 90 days.

Truman's own visits are left out: signing in to `/admin` sets a `tb_owner` flag in that browser's localStorage, and the beacon sends nothing while it's `"1"`. The Weekdays section says whether the current browser is counted and has a button to switch it. Sign in to `/admin` once on each device you browse the site from.

## How it works

```
Visitor loads a page
  ↓
analytics.ts (in BaseLayout) fires a beacon:
  POST /api/track  { type:'pv', path, ref, via, sid, pvid }
  (via comes from ?via= on the address, which the beacon then removes)
  ↓
/api/track function (anonymous):
  - skips bots and /admin
  - computes a daily-salted visitor hash (NO raw IP stored)
  - looks the IP up in DB-IP's City and ASN Lite databases, held in memory
    (network owner, its kind, city, region, country), then drops the IP
  - reads device, system and browser from the user agent
  - writes a row to the "pageviews" Table Storage table
  ↓
On the front door, while the Weekdays side shows:
  analytics.ts batches events → POST /api/track { type:'ev', sid, pvid, events }
  show / hide (the switch), reach (a section or job comes up the screen),
  click (anything with data-track), copy (first 100 characters), and
  wd (running total of time Weekdays was on screen in a visible tab)
  ↓
Visitor leaves / switches tabs
  ↓
navigator.sendBeacon → POST /api/track { type:'dur', sid, pvid, dur }
  - writes a duration row
  ↓
/admin Analytics tab:
  GET /api/sessionmgr?type=analytics&days=30  (admin-only)
  - reads the selected date partitions plus the preceding comparison period
  - pairs duration rows to pageviews by pageview id
  - groups each visit's pageviews and events into a Weekdays row
  - returns totals, daily trends, visit quality, page engagement, acquisition,
    measurement coverage, previous-period summaries and the Weekdays visits
```

### The network and place lookup

`api/shared/geo.js` reads DB-IP's free **IP to City Lite** and **IP to ASN Lite** databases (CC BY 4.0, monthly, no account, [db-ip.com/db/lite.php](https://db-ip.com/db/lite.php)). ASN Lite names the network's owner ("Comcast Cable Communications, LLC", "Microsoft Corporation"); City Lite gives the city, region and country. The lookup runs inside the site's own Functions, so a visitor's IP is never sent to anyone.

The pair is about 65 MB gzipped and 137 MB unpacked, too big for the API's deploy zip (managed Functions are capped at 100 MB zipped), so the files live in the private `metadata` container:

```
metadata/geo/dbip-city-lite-YYYY-MM.mmdb.gz
metadata/geo/dbip-asn-lite-YYYY-MM.mmdb.gz
metadata/geo/current.json   { month, city, asn, updatedAt }
```

[scripts/sync-geo-db.mjs](../scripts/sync-geo-db.mjs) keeps them current. Every Build and Deploy run (hourly) calls it after the prebuild. When `current.json` already names this month, it reads only that file and stops. Otherwise it downloads the month's pair from DB-IP, checks each is a MaxMind database, uploads both, points `current.json` at them and deletes anything older than last month. Early on the 1st, before DB-IP publishes, it keeps last month. It never fails the build.

The function loads the pair from Blob on its first pageview after a cold start (under a second to unpack, roughly 300 MB of memory), shares that one load between concurrent requests, and keeps it for the life of the instance. Once a day it re-reads `current.json` in the background and swaps in a new month. If the files are missing or the load fails, rows are written without the network fields and it tries again ten minutes later. The first beacon waits for the load for at most 15 seconds.

`api/shared/org-kind.js` sorts each owner into a kind, so the panel can grey out everything that can't name an employer:

| Kind | Means | Examples |
| --- | --- | --- |
| `org` | probably the organization itself | a company or school network |
| `mixed` | offices and clouds on the same network numbers: an employee, a server or a link scanner | Microsoft, Google, Amazon, Oracle, IBM |
| `home` | home broadband or a mobile carrier | Comcast, T-Mobile, Ziply, Starlink |
| `relay` | privacy relay or VPN | Cloudflare (WARP, iCloud Private Relay), Akamai, M247, Mullvad |
| `proxy` | corporate web proxy that hides the company | Zscaler, Netskope, Palo Alto Networks |
| `scanner` | email security service | Proofpoint, Mimecast, Barracuda |
| `cloud` | hosting | DigitalOcean, Hetzner, OVH |

The lists are name patterns; add to them when an owner lands in the wrong kind. The kind is stored on the row when it's written, so a change applies to new visits only.

### Link scanners

Email security tools (Microsoft Safe Links, Proofpoint, Mimecast) open every link in a message in a real browser, so a resume sent by email can produce a `?via=resume` visit nobody made. `isLikelyScanner` in [api/sessionmgr/analytics.js](../api/sessionmgr/analytics.js) marks a visit as one when its owner is a `scanner`, or when it's `cloud` or `mixed` with no click, no copy, one page and under five seconds on Weekdays. Those rows are greyed and left out of the totals. The rule runs when the panel loads, so changing it reclassifies old visits too.

### Tagged links

Any link to the site can carry `?via=<tag>` (lowercase letters, digits and dashes, up to 32). The resume PDF's two site links use `?via=resume`; a LinkedIn profile could use `?via=linkedin`. The beacon sends the tag with the pageview and removes it from the address bar with `history.replaceState`, so a copied link doesn't carry it on. The panel shows `resume` as "Resume" and any other tag as "Link: <tag>".

### Names on the Weekdays side

Sections carry `data-track-section` and links and buttons carry `data-track`. The names come from [src/lib/track-names.ts](../src/lib/track-names.ts) (`job:<org>-<role>`, `project:<repo>:<part>`, `rail:<label>`), which the admin panel also uses to turn them back into words. A new link on the Weekdays side or in the rail needs a `data-track` name, and a new kind of name needs a label in `trackLabel`. Names must match `^[a-z0-9][a-z0-9:._-]{0,59}$`, which [api/track/payload.js](../api/track/payload.js) checks.

## Privacy model

This follows the **cookieless, no-PII** approach used by privacy-first analytics tools (Plausible, Fathom):

- **No IP address is ever stored.** To count unique visitors, the `/api/track` function computes `sha256(ip + user-agent + date + salt)` and stores only the first 16 hex chars. The same IP is looked up in the local DB-IP databases for the network owner and city. Then the raw IP is discarded.
- **Network owner and place, not identity.** Each pageview keeps the owner of the visitor's network, its kind, and the network's city, region and country. For most visitors that's their internet provider and a nearby city. It's a company's name only when they browse from a network that company owns.
- **Device class only.** Phone, tablet or desktop, the operating system's name and the browser's family. No versions, screen sizes or other fingerprinting detail.
- **Weekdays events are about the page, not the person.** Which sections came up the screen, which named links were pressed, and up to 100 characters of text copied from the page. Nothing typed by the visitor is recorded.
- **No cross-day tracking.** The hash includes the current date, so the same visitor produces a *different* hash tomorrow, by design. This means "unique visitors" is counted per-day; a visitor returning on a later day counts again. This is the privacy feature, not a bug.
- **No cookies / no localStorage identifiers.** The only client state is an ephemeral `sessionStorage` session id used to correlate a pageview with its duration beacon and events; it's cleared when the tab closes. The `tb_owner` flag exists only in browsers that have signed in to `/admin`, and it turns tracking off rather than identifying anyone.
- **Referrers stored as hostname only** (e.g. `google.com`, capped at 100 characters), never full URLs with query strings.
- **Bots are filtered** by user-agent so they don't inflate the numbers.
- **No cookie identifier or raw network address is retained.** Local legal requirements still depend on jurisdiction and site use.

Visitors get the plain-language version of this on the site's privacy page ([src/pages/privacy.astro](../src/pages/privacy.astro)). If anything above changes, change that page and its date too.

## Storage

- Table: `pageviews` (auto-created on first write).
- Partition key: `pv-YYYY-MM-DD` (one partition per day → efficient range queries). Rows are kept with no expiry.
- Row types: `pv` (pageview: path, ref, `via`, visitor hash, session id, and when the lookup worked `org`, `orgKind`, `city`, `region`, `country`, plus `device`, `os`, `browser`), `dur` (duration in ms) and `ev` (a batch of up to 20 Weekdays events as JSON in `evs`, each `{ k, t, v?, n?, s? }` with `t` in ms since the pageview started). Rows from before November 9, 2026 have no network, device or `via` fields.
- The largest dashboard request is 90 days plus the preceding 90-day comparison period. Volume is currently small enough for one bounded in-memory aggregation; revisit daily rollups if traffic grows by orders of magnitude.

## Configuration

- **`ANALYTICS_SALT`** is set automatically by the Infra workflow and mixed into visitor hashes. Manual deployments may omit it; the Functions then derive a secret fallback from the required storage connection string rather than using a public constant. Changing either value can split unique-visitor counts for that day.
- `/api/track` uses the same `AZURE_STORAGE_CONNECTION_STRING` app setting as the contact form.

## Files

- [api/track/index.js](../api/track/index.js), the anonymous beacon endpoint, and [api/track/payload.js](../api/track/payload.js), what it accepts for `via` and events.
- [api/shared/geo.js](../api/shared/geo.js), [org-kind.js](../api/shared/org-kind.js) and [user-agent.js](../api/shared/user-agent.js), the network, place and device lookups.
- [scripts/sync-geo-db.mjs](../scripts/sync-geo-db.mjs), the monthly DB-IP refresh run by Build and Deploy.
- [src/lib/analytics.ts](../src/lib/analytics.ts), the client beacon (bundled into every page via BaseLayout), with [src/lib/beacon.ts](../src/lib/beacon.ts) and [src/lib/track-names.ts](../src/lib/track-names.ts).
- [api/sessionmgr/analytics.js](../api/sessionmgr/analytics.js), `?type=analytics` aggregation (admin-only), including `buildWeekdays`.
- [src/lib/admin.ts](../src/lib/admin.ts), the Analytics tab rendering.

## Reading the numbers honestly

- **Unique visitors** is per-day-unique. Over a 30-day range it's the sum of daily-distinct hashes, so a person who visits 5 different days counts as 5. It's a consistent relative measure, not a deduplicated headcount.
- **Visits** are tab-scoped, not an identity. A new tab starts a new visit; a tab kept open can span multiple pages and, rarely, midnight. This is intentionally less persistent than cookie-based sessions.
- **Entries** identify the earliest recorded page in each visit within the queried data. They are useful directionally, not as an advertising-attribution model.
- **Avg. measured time** depends on the leave beacon firing; some browsers drop it (for example, a hard crash). Always read it together with **Measured time coverage**.
- **Single-page visits** means a tab-scoped visit with one recorded pageview. It is not automatically bad: a visitor may find one photograph or page and leave satisfied.
- **Comparisons** use the immediately preceding period of the same length. “Last 7 days” compares with the prior 7 days; “Last 90 days” scans 180 daily partitions in total.
- **Acquisition** counts pageviews by stored referrer host. New events drop apex/www self-referrals at ingestion, and the dashboard reclassifies historical self-referrals as `Direct / internal`.
- Numbers exclude bots and `/admin` views.
- **A company name needs a company network.** Home wifi, phones, VPNs, iCloud Private Relay and companies behind Zscaler-type proxies don't reveal the company, and recruiting agencies rarely own networks. `mixed` owners (Microsoft, Google, Amazon) may be an employee, a server or a link scanner. Truman works at Microsoft, so coworkers show up as Microsoft too.
- **The place is the network's, not the person's.** DB-IP Lite often gives the provider's nearby hub city, and it's less accurate than the paid data.
- **"From the resume" means a link in the PDF was clicked.** Typing the address shows as Direct. Someone who downloads the PDF from the site and then clicks its link also counts.
- **Time on Weekdays** counts only while Weekdays is showing in a visible tab, and arrives when the visitor switches sides, hides the tab or leaves. A browser that dies without any of those reports nothing for that pageview.
- **Content blockers.** As of November 2026, EasyList, EasyPrivacy and uBlock Origin's own lists don't block `/api/track` (checked with Ghostery's blocker engine; they do block `/api/collect`). Stricter lists or browser settings may still drop the beacon, and those visits don't appear at all.

## Alternative considered: Azure App Insights

App Insights would auto-collect sessions and duration, but surfacing that data in
`/admin` would require another API credential and tolerate ingestion latency.
The custom pipeline keeps everything in Table Storage, shows data immediately,
and avoids loading a third-party telemetry SDK. App Insights is therefore not
provisioned or allowlisted by the CSP.
