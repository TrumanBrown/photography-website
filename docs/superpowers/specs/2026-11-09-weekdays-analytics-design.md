# Who reads the Weekdays side: design

Date: 2026-11-09. Status: approved by Truman ("Build it") and built the same day. Where the build differs, it says so at
the end.

## Why

Truman is applying for jobs. Every application gets the same resume PDF, and its two `trumanbrown.com` links go to the site
(`https://trumanbrown.com/#weekdays` in the contact line, `https://trumanbrown.com/` in the skills line). He wants to know
whether the portfolio is doing anything for the resume: which employers and recruiters open it, how long they stay, what they
do on the Weekdays side and where they go next. In his words, he wants to open "the same admin panel" and see "how long they
stayed, if they came from my resume, where they went from my experience page, what they did on the experience page, if they
copied anything".

"Experience page" means the Weekdays side of the front door (`/#weekdays`, [src/pages/index.astro](../../../src/pages/index.astro)).

## What exists today

The site has its own analytics ([docs/analytics.md](../../analytics.md)): a beacon in every page
([src/lib/analytics.ts](../../../src/lib/analytics.ts)) posts a pageview and a time-on-page row to
[api/track](../../../api/track/index.js), which writes to the `pageviews` table. The Analytics tab in `/admin`
([src/lib/admin.ts](../../../src/lib/admin.ts), aggregation in [api/sessionmgr/analytics.js](../../../api/sessionmgr/analytics.js))
shows totals, pages and referrer hosts.

It can't answer his questions:

- Both sides of the front door are recorded as `/`. Flipping the switch sends nothing, and time on page covers both sides.
- No IP is stored, on purpose. A visitor is a hash that changes daily.
- Links clicked in a PDF or an email arrive with no referrer, so resume clicks look like typed-in visits ("Direct").
- Clicks, scrolling and copying aren't recorded. Opening the resume PDF isn't counted (it's a static file).
- The next page in a visit is in the data (rows share a tab-scoped `sid`) but the dashboard doesn't show it.

Live data since the front door launched (2026-11-05 to 2026-11-09): 60 views of `/` across 37 visits, a median of 13 seconds
on `/`, referrers Google 3, Facebook 3, DuckDuckGo 1, none 23. No LinkedIn. Some of those are Truman.

## Goals

1. For every visit that shows the Weekdays side or arrives from the resume (my call: the skills-line link opens on Weekends,
   and those readers count too), one row in the Analytics tab with:
   - when it happened, in Truman's local time
   - where it came from: the resume, a referrer host (LinkedIn, Google, an applicant tracking system) or direct
   - who: the owner of the visitor's network (a company name when they browse from a company network), and whether that
     owner is a home or mobile internet provider, a privacy relay or a corporate proxy
   - where: city, region and country from the IP
   - device: phone, tablet or desktop, and the browser
   - time on Weekdays: only the time Weekdays was on screen in a visible tab
   - how far down they got: the furthest section reached (summary, each job, school, skills, side projects)
   - what they clicked: Resume (PDF), LinkedIn, GitHub, each side project and its live piece, the video, Write to me,
     the switch back to Weekends, and the rail's links
   - what they copied: which section, and the first 100 characters of the copied text
   - where they went next: the next page in the same visit, or "Left the site"
   - for resume visits that stay on Weekends, the pages they opened instead
2. Totals above the rows for the chosen range: Weekdays visits, visits from the resume (all of them, whichever side they
   saw, minus likely link scanners), median time on Weekdays, Resume (PDF) clicks, visits that copied something, and the
   network owners seen most.
3. Truman's own visits don't count.

## Non-goals

- A separate PDF or link per company. Truman: "i am not making a seperate pdf per company appliaction".
- Knowing who someone is by name or email. Raw IPs are still never stored.
- Following someone across days or devices, or cookies.
- Session replay, mouse movement or heatmaps (my call).
- The same detail for the Weekends side or other pages (my call). They keep today's pageview and time rows, plus the new
  network and place fields.

## Anti-goals

It fails, even if it works, if:

- the front door gets slower or less smooth. Nothing may block rendering, the switch or scrolling.
- any visitor's IP goes to a third party, or a visitor can trigger a paid call.
- the site needs a cookie banner.
- Truman's own visits fill the table.
- the panel shows a company with more certainty than the data has. A Comcast address is "Home internet", not a lead.

## Constraints

- The repo is public. No ids, keys or account names in code, docs or logs.
- Managed Functions: load SDKs lazily inside a getter ([azure-ops](../../../.github/skills/azure-ops/SKILL.md)). The API
  deploys as one zip with a 100 MB cap, and the whole app has a 250 MB cap on SWA Free. Today `api/node_modules` is 59 MB.
- No new hosts in the CSP for the page. Any new inline script needs its hash ([ship-and-ci](../../../.github/skills/ship-and-ci/SKILL.md)).
- The privacy page ([src/pages/privacy.astro](../../../src/pages/privacy.astro)) and its "Last updated" date change in the
  same commit, in Truman's plain voice ([site-copy](../../../.github/instructions/site-copy.instructions.md)).
- Analytics must never break a page. The endpoint answers 204 whatever happens.

## How it works

### Tagging the resume links (my call)

The resume's two site links become `https://trumanbrown.com/?via=resume#weekdays` and `https://trumanbrown.com/?via=resume`.
The beacon reads `via`, keeps only `[a-z0-9-]` up to 32 characters, sends it with the pageview, then removes it from the
address bar with `history.replaceState` so a copied or shared link doesn't carry it. Any other tag works the same way, so
Truman can use `?via=linkedin` on his LinkedIn profile later.

`public/Truman-Brown-Resume.pdf` gets the tagged links (PyMuPDF, keeping the rest of the file as it is, procedure in
[front-door](../../../.github/skills/front-door/SKILL.md)). Truman attaches that file, or changes the two links in his own
source document. Someone who downloads the PDF from the site and then clicks its link also counts as "from the resume".
That overlap is small and goes in the docs.

### The network and place lookup (my call)

Uses DB-IP's free Lite databases: IP to City Lite and IP to ASN Lite, monthly, CC BY 4.0, no account. ASN Lite gives the
network owner's name (for example "Microsoft Corporation", "Comcast Cable Communications, LLC"). City Lite gives city,
region and country. Sizes in November 2026: City about 60 MB gzipped (about 130 MB unpacked), ASN about 5 MB gzipped.

- The lookup runs inside `/api/track`, on the site's own Functions, so no third party ever sees a visitor's IP.
- The files live in the private `metadata` container under `geo/`, not in the API zip, so they stay clear of the 100 MB cap.
  A step in [build-and-deploy.yml](../../../.github/workflows/build-and-deploy.yml) (it runs hourly) checks whether this
  month's files are there and, if not, downloads them from DB-IP and uploads them, plus a small pointer file naming the
  current ones. The build identity already writes to `metadata`.
- The function loads both files from Blob on first use, unpacks them in memory, and keeps them for the life of the
  instance. Concurrent first requests share one load. A pure-JS MaxMind reader (`mmdb-lib` or similar) reads them.
- If the files are missing or the load fails, the row is written without the new fields.
- Each pageview row stores `org`, `orgKind`, `city`, `region`, `country`, `device` and `browser`. The IP is used for the
  lookup and the existing daily hash, then dropped, as today.
- `orgKind` comes from a small hand-kept list in `api/shared/`: home and mobile providers (Comcast, Charter/Spectrum, AT&T,
  Verizon, T-Mobile, Lumen/CenturyLink, Cox, Frontier, Ziply, Starlink and the like) are `home`, privacy relays and VPNs
  (iCloud Private Relay egress, Cloudflare WARP, common VPN hosts) are `relay`, corporate proxies (Zscaler, Netskope, Palo
  Alto Prisma) are `proxy`, cloud hosts are `cloud`, and anything else is `org`. The panel shows `org` names plainly and
  greys the others with a short label.
- Microsoft, Google and Amazon run their clouds and their offices on the same network numbers, so DB-IP can't tell an
  employee from a server or an email link scanner there. These are `mixed` (my call): the panel shows the name with
  "also a cloud" beside it. Truman works at Microsoft, so coworkers will show up as Microsoft too.

### Link scanners (my call)

When the resume goes by email, security tools (Microsoft Safe Links, Proofpoint, Mimecast and the like) often open every
link in a real browser. Those visits arrive tagged `via=resume`. A visit is marked "Likely a link scanner" when its network is
`cloud` or `mixed`, it has no clicks, scrolls or copies, and Weekdays was on screen under 5 seconds. Its row stays in the table,
greyed, and it's left out of the "from the resume" total. The rule lives in the aggregation, not at ingestion, so it can be
tuned later without losing data.
- DB-IP's license asks for a link to db-ip.com on pages that show its results: under the Weekdays table in `/admin` and on
  the privacy page.

### What the page records on Weekdays

In `src/lib/analytics.ts`, plus `data-track` attributes in the Weekdays markup ([index.astro](../../../src/pages/index.astro),
[Resume.astro](../../../src/components/about/Resume.astro), [Projects.astro](../../../src/components/about/Projects.astro),
[MeRail.astro](../../../src/components/about/MeRail.astro)):

- The index page tells the beacon when Weekdays shows or hides (on load from `#weekdays`, the switch, and `hashchange`).
- Time on Weekdays counts only while Weekdays shows and the tab is visible. It's sent as a running total for the pageview
  when Weekdays hides, the tab hides, or the page goes away. The last value wins.
- Scroll reach: an `IntersectionObserver` on each section and job. One event the first time each is reached.
- Clicks: one delegated listener for `[data-track]`. Each click is one event with the target's name.
- Copies: a `copy` listener on the Weekdays panel. It records the nearest section and the first 100 characters of
  `getSelection()`.
- Events go with `sendBeacon` (or `fetch` with `keepalive`), batched so a burst of scrolling is one request.
- No event is sent while the Weekends side shows.

### The endpoint

`/api/track` accepts a new type, `ev`, with `sid`, `pvid`, `kind` (`wd-time`, `reach`, `click`, `copy`) and a value. Values are
checked against allow lists (section and target names) or capped (copied text 100 characters, time up to an hour). A pageview
gets at most 50 events. Rows go in the same `pageviews` table and daily partition as today.

### Leaving out Truman's own visits (my call)

When Truman signs in to `/admin`, the admin page sets `localStorage.tb_owner = "1"`, and the beacon sends nothing while it's
set. The Analytics tab says "This browser isn't counted" with a button to undo it. He visits `/admin` once on each device.
This is a flag, not an identifier.

### The panel

A Weekdays section at the top of the Analytics tab, using the existing range picker: the totals, then one row per visit,
newest first, with the fields in Goals. A row opens to show the visit's steps in order with seconds from arrival
("0:00 opened Weekdays", "0:41 reached Microsoft", "1:12 copied 'Led migration...'", "1:30 clicked Resume (PDF)", "1:31 left").
The aggregation lives next to today's in `api/sessionmgr/analytics.js`, returned by the same `type=analytics` request.

### Privacy and docs

- Privacy page: a short paragraph in Truman's voice saying the site looks up which network a visitor is on and roughly
  where, from a copy of DB-IP's data kept on the site's own servers, that the address itself is still never saved, and that
  on the About me side it notes which parts are scrolled to, what's clicked and text copied from the page. The DB-IP link,
  and a new "Last updated" date.
- [docs/analytics.md](../../analytics.md) and [docs/privacy.md](../../privacy.md): what's collected, the lookup, the
  monthly refresh, and an honest "Reading the numbers" section with the limits below.
- [front-door](../../../.github/skills/front-door/SKILL.md): the tagged links in the PDF, and `data-track` on new Weekdays links.
- [azure-ops](../../../.github/skills/azure-ops/SKILL.md): the `geo/` files in `metadata` and their refresh.

## Honest limits (go in the docs and in a line under the table)

- A company name appears only when someone browses from a network their company owns. Home wifi, phones, VPNs, iCloud
  Private Relay, and companies behind Zscaler-type proxies don't reveal the company. Recruiting agencies rarely own networks.
- "Microsoft", "Google" or "Amazon" may be an employee, a server or a link scanner.
- City from an IP is often the provider's hub city, and the Lite data is less accurate than the paid one.
- "From the resume" means someone clicked a link in the PDF. Typing the address shows as Direct.
- Content blockers may block `/api/track`. The builder checks uBlock Origin's default lists against the path, and renames
  the endpoint if they block it.

## Keeping the data (my call)

Rows are kept as they are today, with no expiry. The new fields hold no visitor-written text (copied text is Truman's own page
text), so no cleanup job is added.

## Left to the builder

- Row and field names, the reader library, batching details, the exact section and target names.
- Whether `wd-time` and events share a row type.
- The panel's layout, matching the Analytics tab's existing look.
- Tests: `via` cleaning, event validation, `orgKind` classification, the visit aggregation, and the beacon's Weekdays timer.

## Where the build differs

- Clicks in the rail (Resume (PDF), LinkedIn, Write to me and the rest) are recorded on either side of the switch, since
  the rail isn't part of Weekends or Weekdays. Nothing in the Weekends panel itself is recorded.
- The panel sits between the range picker and the general traffic cards, which keeps it first on the tab while the range
  picker stays where it was.
- How it all works now is in [docs/analytics.md](../../analytics.md). That doc, not this one, is kept up to date.
