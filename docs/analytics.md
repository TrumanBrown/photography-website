# Analytics: privacy-friendly traffic metrics

> Audience: site owner. Explains how the built-in analytics work, what's collected (and deliberately not), and how to read the numbers in `/admin`.

## What it does

A lightweight, self-hosted analytics pipeline that records pageviews and time-on-page, then shows them in the **Analytics tab** of `/admin`. No Google Analytics, no third parties, no cookies.

Metrics shown:
- **Pageviews**: total page loads in the selected range.
- **Unique visitors**: distinct visitors per day (see privacy note below).
- **Avg. time on page**: how long visitors stay.
- **Pageviews per day**: a simple bar chart over the range.
- **Top pages**: most-viewed pages.
- **Top referrers**: where visitors came from (hostname only).

Range is selectable: last 7, 30, or 90 days.

## How it works

```
Visitor loads a page
  ↓
analytics.ts (in BaseLayout) fires a beacon:
  POST /api/track  { type:'pv', path, ref, sid, pvid }
  ↓
/api/track function (anonymous):
  - skips bots and /admin
  - computes a daily-salted visitor hash (NO raw IP stored)
  - writes a row to the "pageviews" Table Storage table
  ↓
Visitor leaves / switches tabs
  ↓
navigator.sendBeacon → POST /api/track { type:'dur', sid, pvid, dur }
  - writes a duration row
  ↓
/admin Analytics tab:
  GET /api/sessionmgr?type=analytics&days=30  (admin-only)
  - reads the date-partitioned rows, aggregates in memory
  - returns totals, unique count, avg duration, time series, top lists
```

## Privacy model

This follows the **cookieless, no-PII** approach used by privacy-first analytics tools (Plausible, Fathom):

- **No IP address is ever stored.** To count unique visitors, the `/api/track` function computes `sha256(ip + user-agent + date + salt)` and stores only the first 16 hex chars. The raw IP is used for the hash and immediately discarded.
- **No cross-day tracking.** The hash includes the current date, so the same visitor produces a *different* hash tomorrow, by design. This means "unique visitors" is counted per-day; a visitor returning on a later day counts again. This is the privacy feature, not a bug.
- **No cookies / no localStorage identifiers.** The only client state is an ephemeral `sessionStorage` session id used to correlate a pageview with its duration beacon; it's cleared when the tab closes.
- **Referrers stored as hostname only** (e.g. `google.com`, capped at 100 characters), never full URLs with query strings.
- **Bots are filtered** by user-agent so they don't inflate the numbers.
- **No cookie identifier or raw network address is retained.** Local legal requirements still depend on jurisdiction and site use.

## Storage

- Table: `pageviews` (auto-created on first write).
- Partition key: `pv-YYYY-MM-DD` (one partition per day → efficient range queries).
- Row types: `pv` (pageview: path, ref, visitor hash, session id) and `dur` (duration in ms).
- Volume is tiny for a personal site; the admin aggregation fetches the range and computes in memory.

## Configuration

- **`ANALYTICS_SALT`** is set automatically by the Infra workflow and mixed into visitor hashes. Manual deployments may omit it; the Functions then derive a secret fallback from the required storage connection string rather than using a public constant. Changing either value can split unique-visitor counts for that day.
- `/api/track` uses the same `AZURE_STORAGE_CONNECTION_STRING` app setting as the contact form.

## Files

- [api/track/index.js](../api/track/index.js), the anonymous beacon endpoint.
- [src/lib/analytics.ts](../src/lib/analytics.ts), the client beacon (bundled into every page via BaseLayout).
- [api/sessionmgr/index.js](../api/sessionmgr/index.js), `?type=analytics` aggregation (admin-only).
- [src/lib/admin.ts](../src/lib/admin.ts), the Analytics tab rendering.

## Reading the numbers honestly

- **Unique visitors** is per-day-unique. Over a 30-day range it's the sum of daily-distinct hashes, so a person who visits 5 different days counts as 5. It's a consistent relative measure, not a deduplicated headcount.
- **Avg. time on page** depends on the leave beacon firing; some browsers drop it (e.g. hard crashes), so it's a good estimate, not exact.
- Numbers exclude bots and `/admin` views.

## Alternative considered: Azure App Insights

App Insights would auto-collect sessions and duration, but surfacing that data in
`/admin` would require another API credential and tolerate ingestion latency.
The custom pipeline keeps everything in Table Storage, shows data immediately,
and avoids loading a third-party telemetry SDK. App Insights is therefore not
provisioned or allowlisted by the CSP.
