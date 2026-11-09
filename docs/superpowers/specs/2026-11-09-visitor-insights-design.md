# More from the analytics: job-hunt signals and site health

Date: 2026-11-09. Status: approved by Truman ("Build it", alerts "As described", preview images for every page). Builds on
[2026-11-09-weekdays-analytics-design.md](2026-11-09-weekdays-analytics-design.md), which is live
(`0773f1b`), and on [docs/analytics.md](../../analytics.md), which describes how analytics works today.

## Why

The Weekdays panel answers "did someone from the resume read it". Truman asked what else analytics could capture "for
anything", saw ten ideas and picked all ten. Six serve the job hunt: knowing in the moment that a company is reading,
seeing a company come back, seeing the link passed around, counting resume PDF opens wherever they come from, naming the
hiring systems, and seeing which jobs get read. Four are about the site itself: real visitors' speed, the errors they hit,
light or dark mode and screen sizes, and how photos and hobbies are used.

His standing rules apply: performance first ("I want performance over cost efficiency always"), he has Azure credit to
spend, no paid call a visitor can trigger without a cap, nothing secret in the public repo.

## Goals

1. **Email alert.** While a visit is happening, an email to Truman's inbox: "Someone at Contoso (Redmond, WA) is reading
   your resume", with the source, device, what they've done so far and a link to `/admin`.
2. **Companies.** A list of network owners that visited in the range, with visits, distinct days, resume visits, total
   time on Weekdays and last seen, so "Contoso, 3 visits over 5 days" stands out.
3. **Link shares.** When someone pastes a link to the site into Slack, Teams, LinkedIn, iMessage, WhatsApp, Discord, X or
   Facebook, that app fetches the page's preview image. Each fetch becomes a row: when, which app, which page.
4. **PDF opens from anywhere.** Every open of `/Truman-Brown-Resume.pdf`, including from LinkedIn or a job application,
   with source, network owner and place, device, and whether it looks like a link scanner.
5. **Hiring-system labels.** Referrers from applicant tracking systems show by name: Greenhouse, Lever, Workday, Ashby,
   SmartRecruiters, iCIMS, Jobvite, Taleo, SuccessFactors, BambooHR, Workable, Teamtailor and the like.
6. **Time per job.** How long each section, job and project on Weekdays was being read, per visit and summed across visits.
7. **Speed.** Core Web Vitals from real visitors (LCP, INP, CLS, plus FCP and TTFB) at the 75th percentile, per page group
   and per phone or desktop, against Google's good and poor thresholds.
8. **Errors.** JavaScript errors and unhandled promise rejections visitors hit, grouped by message and file, with count,
   pages, browsers and last seen.
9. **Light, dark and screens.** The share of visits in each theme, whether that came from the device or the toggle, how
   often the toggle is pressed, and viewport width bands.
10. **Photos and hobbies.** Lightbox opens per photo and session, time open and zooms. Narrow nature rounds started,
    finished, scores and More lists. For each hobby page, the share of visits that interacted with the toy and the time
    spent.

## Non-goals and anti-goals

- No session replay, mouse tracking, fingerprinting, cookies or cross-day identifiers. Truman agreed to skip these.
- Nothing that makes a page slower. Every new listener is passive and cheap, batched into the existing beacon, and sent
  with `sendBeacon`. The web-vitals library is the only new client code from outside (Google's `web-vitals`, about 2 KB,
  bundled, so no CSP change).
- An alert must never fire for Truman's own browsing, for a link scanner, or many times for one company in a day.
- No text a visitor typed is recorded (errors excepted, see below, and those are the browser's own messages).

## Decided

### Email alert (my call, confirmed with Truman)

- Sent from `/api/track` when an `ev` batch shows real reading on a pageview: Weekdays on screen 15 seconds or more, or
  a click or copy on Weekdays. By then a link scanner has gone. The client sends a `wd` total as soon as the Weekdays timer
  passes 15 seconds (today it only goes out on a click, copy, switch, hidden tab or leaving), so the alert comes during the
  visit. The network owner, kind, place and `via` come from the visit's pageview row, read by `pvid` from the same day's
  partition.
- Who triggers it: any engaged visit from the resume link (`via=resume`), whatever the network, and any engaged Weekdays
  visit from an `org` network. `mixed` networks (Microsoft, Google, Amazon, Oracle, IBM) only when they came from the
  resume, so coworkers browsing don't trigger it. Home, relay, proxy, cloud and scanner networks only through the resume
  rule.
- At most one email per network owner and city per day, four an hour and ten a day in total, recorded in a small
  `alerts` table. The Azure-managed sending domain allows about ten emails an hour across the site, and contact messages
  share it, so alerts stay under half of that and a visitor's message always gets through. Communication Services charges
  a fraction of a cent per email, so the cap also keeps a visitor from running up a bill.
- Reuses the contact form's sender (`api/contact/notify.js`: `CONTACT_EMAIL_CONNECTION_STRING`, `CONTACT_EMAIL_FROM`,
  `CONTACT_NOTIFY_TO`). Plain text, no visitor identity beyond what the panel shows.

### Keeping the Functions warm (my call)

The network lookup takes about five seconds to load on a cold Functions instance (measured on the live site). That's fine
for a beacon but not for the PDF, which goes through a function from now on. A Logic App recurrence in
`infra/modules/scheduler.bicep` calls `GET /api/track?warm=1` every five minutes, which loads the lookup if needed and
answers 204. Managed Functions share one process, so the PDF and preview-image functions use the same loaded data. Cost is
a few cents a month. The existing Logic App switches off without the GitHub token, so the ping is its own Logic App with
no secrets. Needs the Infra workflow run once.

### Link shares

- Pages' `og:image` (and `twitter:image`) becomes `https://trumanbrown.com/api/og?p=<page path>&i=<image URL>`. The
  function checks the image URL is on the site's own Blob host, records a `share` row, and answers 302 to the image. The
  builder confirms Slack, Teams and LinkedIn follow the redirect (their public preview debuggers, or a paste by Truman);
  if one doesn't, the function streams the image instead.
- The app is named from the fetcher's user agent: Slackbot, SkypeUriPreview / Teams (Teams), LinkedInBot,
  facebookexternalhit, Twitterbot, Discordbot, WhatsApp, TelegramBot, Applebot / iMessage previews, Google's chat
  fetchers. Search engine crawlers are recorded as "search engine", not as a share.
- These fetches come from the app's servers, so there's no company or place. The panel says which app and which page.
- Apps cache previews (LinkedIn for about a week), so repeat shares of one page may not show. The docs say so.
- The server never sees the part after `#`, so a share of `/#weekdays` shows as a share of `/`.
- When someone pastes the PDF's own link, the app fetches the PDF rather than a preview image. `/api/resume` checks the
  same app names before its bot filter and records those as shares of `/Truman-Brown-Resume.pdf` (my call: it's the most
  direct sign of the resume being passed around).
- The `share` rows bypass the bot filter on purpose; the existing pageview path still filters bots.

### PDF opens

- A route in `staticwebapp.config.json` rewrites `/Truman-Brown-Resume.pdf` to `/api/resume`, so the address everyone
  already has keeps working. The function serves the PDF itself: the workflow copies `public/Truman-Brown-Resume.pdf`
  into the function's folder before deploy, so the public file stays the one source. `Content-Type: application/pdf`,
  inline, with the same caching as today's static file.
- Each open is a `pdf` row: time, `via`, referrer host, network owner and kind, place, device. Bots are dropped. The
  lookup waits at most two seconds, so a cold start never holds the PDF up; with the warm-up ping that should be rare.
- The builder confirms SWA honours the rewrite to `/api` on the live site. If it doesn't, the static file moves to
  `/files/` and `/Truman-Brown-Resume.pdf` becomes a function route by name.
- Opens from the site's own Resume (PDF) buttons are already clicks. The panel shows PDF opens with "from the site"
  marked, so the outside ones stand out.

### Hiring-system labels

A host-to-name table in `api/shared/` used when the panel builds sources (Weekdays rows, Acquisition, PDF opens). It's
display only, so it applies to past rows too.

### Time per job

The Weekdays tracker adds an `IntersectionObserver` with a band across the middle of the viewport (`rootMargin` of
roughly -40% top and bottom). A section is "being read" while it crosses that band, Weekdays is showing and the tab is
visible. Running totals per section go in `dwell` events at each flush (last value wins). The visit row's steps get the
top three sections by time, and a new "What gets read" list sums time per section across visits.

### Speed

`web-vitals` reports on every page. Values go out as `vital` events with the pageview (path and device are already on
it). The panel groups pages (front door, archive, sessions, hobby pages, Narrow nature, other) and shows p75 per metric
for phones and desktops, coloured by Google's thresholds, with the sample count. Pages with fewer than five samples say so.

### Errors

`error` and `unhandledrejection` listeners on every page record up to five errors per pageview: the message (200
characters, URLs reduced to their path), the file's path on this site, line and column. Errors from browser extensions or
other origins, and bare "Script error.", are dropped. The panel groups by message and file.

### Light, dark and screens

The pageview gains `theme` (`light` or `dark`), `themeFrom` (`device` or `choice`, from whether `localStorage.theme` is
set) and a viewport band (`<480`, `480-767`, `768-1023`, `1024-1439`, `1440+`). Pressing the theme toggle is a `theme`
event. The panel shows shares by visit.

### Photos and hobbies

- Lightbox (`src/lib/lightbox.ts`): `photo` events with the session slug and file name, time open, and whether it was
  zoomed. The panel lists the most opened photos and sessions.
- Narrow nature (`src/lib/hobbies/day-list.ts` and its island): `nn` events for round started, round finished with score,
  and a More list started.
- Hobby pages: one `toy` event at the first interaction inside the hobby's island, plus the page's visible time (already
  measured). The panel shows, per hobby, visits, the share that played and the median time.

### Generalising events

Today `ev` rows only come from the Weekdays side. They now come from any page, with the kinds above added to the
allow list in `api/track/payload.js`, each with its own value checks and caps. A pageview keeps the 60-event client cap,
with vitals and the theme exempt. The Weekdays rule "nothing from the Weekends panel" still holds for clicks and reach.

### The panel

The Analytics tab gets four sub-tabs, sharing the range picker: **Job hunt** (Weekdays and resume visits, Companies,
Link shares, PDF opens, What gets read), **Traffic** (today's charts, pages and acquisition), **Site health** (Speed,
Errors, Light and dark, Screens) and **Photos and hobbies**. Same look as the existing tab.

### Privacy page and docs

`/privacy/` gains short lines on PDF opens being counted with the same network lookup, page speed and error reports,
light or dark and screen width, and photo and hobby use, in Truman's voice, with a new date. Preview fetches aren't
visitors, so they need no line. `docs/analytics.md`, `docs/privacy.md`, `docs/azure.md` (the warm-up ping and the
`alerts` table) and the front-door and azure-ops skills are updated in the same commit.

## Constraints

As in the first design: public repo, lazy SDK loading, 100 MB API zip, CSP inline-script hashes, analytics never breaks a
page. New: the PDF route must never make the PDF slower to open than it is today by more than a warm function's
response time, and must keep working if analytics storage is down.

## Left to the builder

Row and field names, event shapes, the exact thresholds' colours, sub-tab markup, how each hobby island exposes its
first interaction, and tests for every new module (alert rules, share app names, ATS names, payload checks per kind,
the aggregation of each panel section).

## Preview images for every page (Truman's call)

Pages without a preview image today (the hobbies index, each hobby page, Narrow nature, prints, privacy and the error
pages) get one, so shares of them can be counted and they don't paste as a bare link. Each hobby page uses its own stipple
drawing (`src/assets/plates/<slug>-card.webp`, converted to JPEG at build, since LinkedIn doesn't take WebP). Everything
else falls back to the front door's photo.

## Where the build differs

- The PDF is served with `Cache-Control: no-store` rather than today's 30-second cache, so a reopen is counted too. It's
  126 KB, so nobody notices.
- Narrow nature has no separate "round started" event. Starting is the first press on the board, the same `toy` event
  every hobby page sends, so the panel shows visits, players, finished rounds, More lists and the average score.
- Alerts use the contact form's `contactratelimit` table rather than a new `alerts` table.
- How it all works now is in [docs/analytics.md](../../analytics.md). That doc, not this one, is kept up to date.
