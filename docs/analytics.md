# Analytics: privacy-friendly traffic metrics

> Audience: site owner. Explains how the built-in analytics work, what's collected (and deliberately not), and how to read the numbers in `/admin`.

## What it does

A lightweight, self-hosted analytics pipeline that records pageviews, time-on-page and what visitors do on the front door's Weekdays side (the resume), then shows them in the **Analytics tab** of `/admin`. It's there so Truman can see whether the portfolio is doing anything for his resume: who opens it, for how long, and where they go next. No Google Analytics, no third parties, no cookies.

The tab has four sub-tabs that share one range picker (last 7, 30 or 90 days).

**Job hunt**
- **Weekdays and resume visits**: one row per visit that opened the Weekdays side of the front door (the resume) or came in on a tagged link such as the resume PDF's `?via=resume`. Each row shows when, where it came from (a hiring system by name, like Greenhouse), the network owner and its kind, the network's city, the device, how long Weekdays was on screen, how far down they got, what they clicked and copied, and where they went next. A row opens to show every step with its time from arrival and the three sections read longest. Totals above it count Weekdays visits, resume visits, the median time on Weekdays, Resume (PDF) clicks, visits that copied something and likely email link scanners, and list the network owners seen most.
- **Companies coming back**: company networks (`org` and `mixed` owners) that visited in the range, with visits, distinct days, resume visits, total time on Weekdays, their usual place and when they were last seen. Two or more days is marked "came back".
- **What gets read**: how long each Weekdays section, job and project spent across the middle of the screen, summed over visits, with the median.
- **Link shares**: each time Slack, Teams, LinkedIn, iMessage, WhatsApp, Discord, X or Facebook fetched a page's preview image or the PDF, with the app and the page.
- **Resume PDF opens**: every open of `/Truman-Brown-Resume.pdf`, from the site's buttons or any link elsewhere, with source, network owner, place and device. Likely email scanners are greyed.

**Traffic**
- **Pageviews**, **Daily unique visitors** (the sum of each day's distinct privacy hashes), **Visits** (tab-scoped sessions) and **Avg. measured time**, each compared with the preceding range of the same length.
- **Traffic over time**: labeled pageview and daily-visitor lines. Hover or focus a day to inspect it. A screen-reader table has the same data.
- **Visit quality**: pages per visit, single-page visit rate, and measured-time coverage.
- **Page performance**: views, daily visitors, entry visits, measured time, and timing coverage for every viewed route.
- **Acquisition**: pageview share by external referrer, with hiring systems and job boards named. Direct traffic and same-site navigation are grouped together.

**Site health**
- **Speed for real visitors**: Core Web Vitals (LCP, INP, CLS, FCP, TTFB) at the 75th percentile, by page group and phone or desktop, coloured by Google's good and poor thresholds, with "N only" when there are fewer than five samples.
- **Errors visitors hit**: JavaScript errors from the site's own files and unhandled promise rejections, grouped by message and file, with count, pages, browsers and last seen.
- **Light, dark and screens**: by visit, the share in dark mode, whether the theme came from the device or an earlier toggle, toggle presses, and viewport width bands.

**Photos and hobbies**
- **Photos opened** and **By gallery**: lightbox opens per photo and per session or hobby gallery, with time on screen and zooms.
- **Narrow nature**: visits, players, rounds finished from today's list and More lists, More lists dealt, and the average score.
- **Things to try**: per hobby page, visits, how many pressed something in its toy, and median time on the page.

Truman's own visits are left out: signing in to `/admin` sets a `tb_owner` flag in that browser's localStorage, and the beacon sends nothing while it's `"1"`. The Job hunt sub-tab says whether the current browser is counted and has a button to switch it. Sign in to `/admin` once on each device you browse the site from.

## How it works

```
Visitor loads a page
  ↓
analytics.ts (in BaseLayout) fires a beacon:
  POST /api/track  { type:'pv', path, ref, via, sid, pvid, theme, themeFrom, vw }
  (via comes from ?via= on the address, which the beacon then removes)
  ↓
/api/track function (anonymous):
  - skips bots and /admin
  - takes the IP from the X-Forwarded-For entry Static Web Apps added, never
    one the browser sent (api/shared/client-ip.js, docs/security.md)
  - computes a daily-salted visitor hash (NO raw IP stored)
  - looks the IP up in DB-IP's City and ASN Lite databases, held in memory
    (network owner, its kind, city, region, country), then drops the IP
  - reads device, system and browser from the user agent
  - writes a row to the "pageviews" Table Storage table
  ↓
Any page: analytics.ts batches events → POST /api/track { type:'ev', sid, pvid, events }
  vital (Core Web Vitals), err (script errors), theme (toggle pressed),
  photo (lightbox), nn (Narrow nature), toy (first press in a hobby's toy)
On the front door, while the Weekdays side shows, also:
  show / hide (the switch), reach (a section or job comes up the screen),
  dwell (running total per section across the middle of the screen),
  click (anything with data-track), copy (first 100 characters), and
  wd (running total of time Weekdays was on screen in a visible tab,
  sent at once when it passes 15 seconds)
  - a batch that shows real reading can email Truman (Email alerts)
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
    measurement coverage, previous-period summaries, the Weekdays visits and
    the Job hunt, Site health and Photos and hobbies sections
    (api/sessionmgr/insights.js)

Someone pastes a link into Slack / Teams / LinkedIn
  ↓
the app fetches og:image = /api/og?p=<page>&i=<image>
  - writes a "share" row with the app's name, redirects to the image
  (a pasted PDF link is fetched from /api/resume and counted the same way)

Someone opens /Truman-Brown-Resume.pdf, from anywhere
  ↓
staticwebapp.config.json rewrites it to /api/resume
  - writes a "pdf" row (source, network, place, device), serves the PDF

Logic App, every five minutes
  ↓
GET /api/track?warm=1 loads the lookup so no visitor waits for it
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

### Email alerts

[api/shared/alert.js](../api/shared/alert.js) emails Truman while someone is reading the resume. `/api/track` checks each event batch after storing it. A batch counts as reading when Weekdays has been on screen 15 seconds (the beacon sends its running total the moment it passes 15 seconds) or it has a click or a copy on the front door. Then it reads the visit's pageview row and sends an email when:

- the visit came from the resume link (`via=resume`), on any network except a mail scanner's, or
- the network is a company's own (`orgKind` `org`), with or without the tag.

`mixed` owners (Microsoft, Google, Amazon, Oracle, IBM) only count through the resume rule, so coworkers browsing don't set it off. The email says where the visit came from, the network and its kind, the place, the device and what they've done so far, and links to `/admin`.

Anyone can send `/api/track` a beacon, including one that claims `via=resume`, so the email never prints anything the browser sent. What they've done is counts: "16s on Weekdays, clicked 2 links, copied 1 thing". Where they came from is "a link in your resume", "a tagged link", a hiring system's name from [hiring-system.js](../api/shared/hiring-system.js), "another site", or "typed in, or a link that doesn't say". The copied text, link names, tags and referrer hosts are only in the Analytics tab, which escapes them. [api/track/index.test.cjs](../api/track/index.test.cjs) sends beacons through the endpoint with a copied link, a URL-like link name, a referrer and a tag, and checks none of them reach the email.

Limits, kept in the `contactratelimit` table: one email per network owner and city a day (`alert-YYYY-MM-DD` rows keyed by a hash), four an hour, ten a day, and never more than six of the hour's shared `notify-all` count. The contact form allows ten an hour on that count, so a visitor's message always has room. It sends through the contact form's Communication Services settings (`CONTACT_EMAIL_CONNECTION_STRING`, `CONTACT_EMAIL_FROM`, `CONTACT_NOTIFY_TO`); without them nothing is sent.

### Link shares

Every page's `og:image` and `twitter:image` is `https://trumanbrown.com/api/og?p=<page>&i=<image>` ([src/lib/og.ts](../src/lib/og.ts), [src/layouts/BaseLayout.astro](../src/layouts/BaseLayout.astro)). Chat and social apps fetch it to draw a preview. [api/og](../api/og/index.js) names the app from its user agent ([api/shared/share-app.js](../api/shared/share-app.js)), writes a `share` row, and answers 302 to the image. It only redirects to an image path on the site or to the site's own Blob account, so it can't be used to bounce people elsewhere. Search engines are recorded as "Search engine" and left out of the shares; fetchers not named yet are kept as "Other" with their user agent, so the list can grow.

Every page has a preview: session, place and archive pages use their cover photo, each hobby page uses its stipple drawing flattened onto the paper colour at build ([src/pages/og/[slug].jpg.ts](../src/pages/og/[slug].jpg.ts), `/og/<slug>.jpg`, 1200 × 630), and everything else uses the front door's photo.

Apps cache previews (LinkedIn for about a week), so repeat shares of a page may not show. The server never sees `#weekdays`, so a share of `/#weekdays` shows as `/`. These fetches come from the app's servers, so they carry no company or place.

### Resume PDF opens

`staticwebapp.config.json` rewrites `/Truman-Brown-Resume.pdf` to [api/resume](../api/resume/index.js), so every link to the PDF keeps working and each open is counted. The function serves a copy of `public/Truman-Brown-Resume.pdf` that Build and Deploy puts beside it (`api/resume/resume.pdf`, gitignored), with `Cache-Control: no-store` so each open reaches it. A `pdf` row keeps `via`, the referrer host (or `fromSite` when it was the site's own button), the network owner and place (the lookup waits at most two seconds) and the device. Bots are dropped; preview fetches by chat apps become `share` rows. An open is greyed as a likely scanner when the owner is a mail-security service, or a cloud or mixed owner with no referrer.

To replace the PDF, replace `public/Truman-Brown-Resume.pdf` only; the build copies it.

### Hiring systems

[api/shared/hiring-system.js](../api/shared/hiring-system.js) names referrers from applicant tracking systems and job boards (Greenhouse, Lever, Workday, Ashby, SmartRecruiters, iCIMS, Indeed, LinkedIn and others) in the panel. It's display only, so it applies to past rows as well. Add a host there when one shows up as a bare domain.

### Speed, errors, theme and screens

Every page loads Google's [web-vitals](https://github.com/GoogleChrome/web-vitals) library (bundled, about 2 KB) and reports LCP, INP, CLS, FCP and TTFB as `vital` events when the page is hidden. Script errors from the site's own files and unhandled promise rejections become `err` events, at most five a pageview, with messages cut to 200 characters and any address reduced to its path; extension errors, other origins' errors, bare "Script error." and `AbortError` are dropped. The pageview row carries `theme` (`light` or `dark`), `themeFrom` (`device`, or `choice` when the visitor has pressed the toggle before) and `vw`, a viewport width band. Pressing the toggle is a `theme` event.

### Photos and hobbies

[Lightbox.astro](../src/components/Lightbox.astro) announces each photograph looked at (`tb:photo`: page slug and file name, time up, zoomed or not) when the visitor moves on or closes it. [day-list.ts](../src/lib/hobbies/day-list.ts) announces a finished round with its score (`tb:nn`, not for a round restored from storage) and each More list dealt. Each hobby page wraps its toy in `<div class="toy" data-toy="<slug>">` (`display: contents`, so the layout doesn't change), and the first press inside it is a `toy` event. A new hobby toy goes inside that wrapper.

### Warm-up ping

The lookup takes about five seconds to load on a cold Functions instance, and the PDF goes through a function, so a Logic App ([infra/modules/warmup.bicep](../infra/modules/warmup.bicep), `enableApiWarmup`) calls `GET /api/track?warm=1` every five minutes. It loads the lookup if needed and records nothing. It holds no secrets, so it keeps running when the scheduler's GitHub token expires. All the Functions share one process, so `/api/resume` uses the same loaded copy ([api/shared/geo-service.js](../api/shared/geo-service.js)).

### Names on the Weekdays side

Sections carry `data-track-section` and links and buttons carry `data-track`. The names come from [src/lib/track-names.ts](../src/lib/track-names.ts) (`job:<org>-<role>`, `project:<repo>:<part>`, `rail:<label>`), which the admin panel also uses to turn them back into words. A new link on the Weekdays side or in the rail needs a `data-track` name, and a new kind of name needs a label in `trackLabel`. Names must match `^[a-z0-9][a-z0-9:._-]{0,59}$`, which [api/track/payload.js](../api/track/payload.js) checks.

## Privacy model

This follows the **cookieless, no-PII** approach used by privacy-first analytics tools (Plausible, Fathom):

- **No IP address is ever stored.** To count unique visitors, the `/api/track` function computes `sha256(ip + user-agent + date + salt)` and stores only the first 16 hex chars. The same IP is looked up in the local DB-IP databases for the network owner and city. Then the raw IP is discarded.
- **Network owner and place, not identity.** Each pageview keeps the owner of the visitor's network, its kind, and the network's city, region and country. For most visitors that's their internet provider and a nearby city. It's a company's name only when they browse from a network that company owns.
- **Device class only.** Phone, tablet or desktop, the operating system's name and the browser's family. No versions, screen sizes or other fingerprinting detail.
- **Weekdays events are about the page, not the person.** Which sections came up the screen and for how long, which named links were pressed, and up to 100 characters of text copied from the page. Nothing typed by the visitor is recorded.
- **Site health is about the page too.** Load and response times, the browser's own error messages (cut to 200 characters, addresses reduced to their path), light or dark mode and a viewport band, never an exact screen size.
- **Shares come from apps, not people.** A preview fetch is the app's server; it carries no visitor data.
- **Alerts go to one inbox, as counts.** The email holds where the visit came from, the network, place and device, the time on Weekdays, and how many links were clicked and how many times text was copied. It never holds the copied text, link names, tags or referrer hosts.
- **No cross-day tracking.** The hash includes the current date, so the same visitor produces a *different* hash tomorrow, by design. This means "unique visitors" is counted per-day; a visitor returning on a later day counts again. This is the privacy feature, not a bug.
- **No cookies / no localStorage identifiers.** The only client state is an ephemeral `sessionStorage` session id used to correlate a pageview with its duration beacon and events; it's cleared when the tab closes. The `tb_owner` flag exists only in browsers that have signed in to `/admin`, and it turns tracking off rather than identifying anyone.
- **Referrers stored as hostname only** (e.g. `google.com`, capped at 100 characters), never full URLs with query strings.
- **Bots are filtered** by user-agent so they don't inflate the numbers.
- **No cookie identifier or raw network address is retained.** Local legal requirements still depend on jurisdiction and site use.

Visitors get the plain-language version of this on the site's privacy page ([src/pages/privacy.astro](../src/pages/privacy.astro)). If anything above changes, change that page and its date too.

## Storage

- Table: `pageviews` (auto-created on first write).
- Partition key: `pv-YYYY-MM-DD` (one partition per day → efficient range queries). Rows are kept with no expiry.
- Row types: `pv` (pageview: path, ref, `via`, visitor hash, session id, `theme`, `themeFrom`, `vw`, and when the lookup worked `org`, `orgKind`, `city`, `region`, `country`, plus `device`, `os`, `browser`), `dur` (duration in ms), `ev` (a batch of up to 20 events as JSON in `evs`, each `{ k, t, v?, n?, s?, d?, l?, c?, z? }` with `t` in ms since the pageview started; the kinds and their checks are in [api/track/payload.js](../api/track/payload.js)), `share` (`app`, `page`, and `agent` for unnamed fetchers) and `pdf` (`via`, `ref`, `fromSite`, the network and place fields and the device). Rows from before November 9, 2026 have no network, device or `via` fields, and theme, speed, error, photo and hobby data starts later the same day.
- The largest dashboard request is 90 days plus the preceding 90-day comparison period. Volume is currently small enough for one bounded in-memory aggregation; revisit daily rollups if traffic grows by orders of magnitude.

## Configuration

- **`ANALYTICS_SALT`** is set automatically by the Infra workflow and mixed into visitor hashes. Manual deployments may omit it; the Functions then derive a secret fallback from the required storage connection string rather than using a public constant. Changing either value can split unique-visitor counts for that day.
- `/api/track` uses the same `AZURE_STORAGE_CONNECTION_STRING` app setting as the contact form.
- Email alerts use the contact form's `CONTACT_EMAIL_CONNECTION_STRING`, `CONTACT_EMAIL_FROM` and `CONTACT_NOTIFY_TO` settings.
- The warm-up ping is `enableApiWarmup` in [infra/main.parameters.json](../infra/main.parameters.json); the Infra workflow deploys it.

## Files

- [api/track/index.js](../api/track/index.js), the anonymous beacon endpoint, and [api/track/payload.js](../api/track/payload.js), what it accepts for `via` and events.
- [api/shared/geo.js](../api/shared/geo.js), [org-kind.js](../api/shared/org-kind.js) and [user-agent.js](../api/shared/user-agent.js), the network, place and device lookups.
- [scripts/sync-geo-db.mjs](../scripts/sync-geo-db.mjs), the monthly DB-IP refresh run by Build and Deploy.
- [src/lib/analytics.ts](../src/lib/analytics.ts), the client beacon (bundled into every page via BaseLayout), with [src/lib/beacon.ts](../src/lib/beacon.ts) and [src/lib/track-names.ts](../src/lib/track-names.ts).
- [api/sessionmgr/analytics.js](../api/sessionmgr/analytics.js), `?type=analytics` aggregation (admin-only), including `buildWeekdays`.
- [api/sessionmgr/insights.js](../api/sessionmgr/insights.js), the Job hunt, Site health and Photos and hobbies sections.
- [api/shared/alert.js](../api/shared/alert.js), [share-app.js](../api/shared/share-app.js), [hiring-system.js](../api/shared/hiring-system.js), [geo-service.js](../api/shared/geo-service.js), [rows.js](../api/shared/rows.js), [bots.js](../api/shared/bots.js) and [own-host.js](../api/shared/own-host.js).
- [api/og](../api/og/index.js) and [api/resume](../api/resume/index.js), the preview-image redirect and the PDF.
- [src/lib/og.ts](../src/lib/og.ts) and [src/pages/og/[slug].jpg.ts](../src/pages/og/[slug].jpg.ts), preview images.
- [infra/modules/warmup.bicep](../infra/modules/warmup.bicep), the warm-up Logic App.
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
- **Speed numbers need volume.** A 75th percentile from three pageviews says little; the panel marks fewer than five samples. Reports arrive as visitors leave a page, so a browser that dies without hiding the page reports nothing.
- **Shares are a floor.** Apps cache previews and some fetch from the sender's device without a recognisable user agent ("Other"), so real shares are at least what's shown.
- **Alerts can be early.** Fifteen seconds is enough to rule out a scanner, not to say the visit was thorough. The panel row has the full story.
- **Content blockers.** As of November 2026, EasyList, EasyPrivacy and uBlock Origin's own lists don't block `/api/track` (checked with Ghostery's blocker engine; they do block `/api/collect`). Stricter lists or browser settings may still drop the beacon, and those visits don't appear at all.

## Alternative considered: Azure App Insights

App Insights would auto-collect sessions and duration, but surfacing that data in
`/admin` would require another API credential and tolerate ingestion latency.
The custom pipeline keeps everything in Table Storage, shows data immediately,
and avoids loading a third-party telemetry SDK. App Insights is therefore not
provisioned or allowlisted by the CSP.
