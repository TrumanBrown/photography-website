// The Analytics tab's newer sections (docs/analytics.md), built from the same
// rows as the rest: companies coming back, what gets read on Weekdays, link
// shares, resume PDF opens, real visitors' speed, errors, theme and screens,
// and photo and hobby use. buildAnalytics in analytics.js calls these.

const { sourceName } = require("../shared/hiring-system");

const DAY_MS = 86400000;

function p75(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.75) - 1)];
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Companies: network owners that can name an employer, across the range.
// ---------------------------------------------------------------------------
function buildCompanies(records, weekdays) {
  const visits = new Map();
  for (const record of records) {
    if (!record.sid) continue;
    const visit = visits.get(record.sid) || {
      first: record,
      org: null,
      via: "",
    };
    if (record.timestamp < visit.first.timestamp) visit.first = record;
    if (!visit.org && record.org) visit.org = record;
    if (record.via && !visit.via) visit.via = record.via;
    visits.set(record.sid, visit);
  }
  const companies = new Map();
  for (const [sid, visit] of visits) {
    const owner = visit.org;
    if (!owner || (owner.orgKind !== "org" && owner.orgKind !== "mixed"))
      continue;
    if (weekdays.scannerSids.has(sid)) continue;
    const row = companies.get(owner.org) || {
      org: owner.org,
      orgKind: owner.orgKind,
      visits: 0,
      days: new Set(),
      resumeVisits: 0,
      weekdaysMs: 0,
      lastSeen: 0,
      places: new Map(),
    };
    row.visits++;
    row.days.add(visit.first.day);
    if (visit.via === "resume") row.resumeVisits++;
    row.weekdaysMs += weekdays.weekdaysMsBySid.get(sid) || 0;
    row.lastSeen = Math.max(row.lastSeen, visit.first.timestamp);
    const place = [owner.city, owner.region].filter(Boolean).join(", ");
    if (place) row.places.set(place, (row.places.get(place) || 0) + 1);
    companies.set(owner.org, row);
  }
  return [...companies.values()]
    .map((row) => ({
      org: row.org,
      orgKind: row.orgKind,
      visits: row.visits,
      days: row.days.size,
      resumeVisits: row.resumeVisits,
      weekdaysMs: row.weekdaysMs,
      lastSeen: iso(row.lastSeen),
      place:
        [...row.places.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "",
    }))
    .sort((a, b) => b.days - a.days || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// What gets read: time each Weekdays section spent across the middle of the
// screen, summed over visits (dwell events; the last total per pageview wins).
// ---------------------------------------------------------------------------
function dwellByPageview(events) {
  const sections = new Map();
  for (const event of events || []) {
    if (event.k !== "dwell") continue;
    const ms = Number(event.d) || 0;
    if (ms > (sections.get(event.v) || 0)) sections.set(event.v, ms);
  }
  return sections;
}

function buildRead(pvids, eventsByPageview) {
  const sections = new Map();
  for (const pvid of pvids) {
    for (const [name, ms] of dwellByPageview(eventsByPageview.get(pvid))) {
      const row = sections.get(name) || {
        name,
        visits: 0,
        totalMs: 0,
        samples: [],
      };
      row.visits++;
      row.totalMs += ms;
      row.samples.push(ms);
      sections.set(name, row);
    }
  }
  return [...sections.values()]
    .map((row) => ({
      name: row.name,
      visits: row.visits,
      totalMs: row.totalMs,
      medianMs: median(row.samples),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

// ---------------------------------------------------------------------------
// Link shares and resume PDF opens.
// ---------------------------------------------------------------------------
function buildShares(rows) {
  const people = rows.filter((row) => row.app !== "Search engine");
  const byApp = new Map();
  for (const row of people) byApp.set(row.app, (byApp.get(row.app) || 0) + 1);
  return {
    total: people.length,
    searchFetches: rows.length - people.length,
    byApp: [...byApp.entries()]
      .map(([app, count]) => ({ app, count }))
      .sort((a, b) => b.count - a.count || a.app.localeCompare(b.app)),
    rows: people
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 200)
      .map((row) => ({
        at: iso(row.timestamp),
        app: row.app,
        page: row.page,
        agent: row.agent || "",
      })),
  };
}

// Email security tools open a PDF link the moment the email arrives, from a
// server: a mail-security owner, or a cloud or mixed owner with no referrer.
function isPdfScanner(row) {
  if (row.orgKind === "scanner") return true;
  if (row.fromSite) return false;
  return (row.orgKind === "cloud" || row.orgKind === "mixed") && !row.ref;
}

function buildPdf(rows) {
  const opens = rows
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((row) => ({
      at: iso(row.timestamp),
      fromSite: Boolean(row.fromSite),
      via: row.via || "",
      source: row.fromSite ? "" : row.ref || "",
      sourceName: row.fromSite ? "This site" : sourceName(row.ref) || "",
      org: row.org || "",
      orgKind: row.orgKind || "",
      city: row.city || "",
      region: row.region || "",
      country: row.country || "",
      device: row.device || "",
      os: row.os || "",
      browser: row.browser || "",
      scanner: isPdfScanner(row),
    }));
  const people = opens.filter((row) => !row.scanner);
  return {
    totals: {
      opens: people.length,
      outside: people.filter((row) => !row.fromSite).length,
      fromSite: people.filter((row) => row.fromSite).length,
      scanners: opens.length - people.length,
    },
    rows: opens.slice(0, 200),
  };
}

// ---------------------------------------------------------------------------
// Site health: Core Web Vitals at the 75th percentile, errors, theme, screens.
// ---------------------------------------------------------------------------
const THRESHOLDS = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};
const METRICS = Object.keys(THRESHOLDS);

function rating(metric, value) {
  if (value === null) return "";
  const [good, poor] = THRESHOLDS[metric];
  return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor";
}

function pageGroup(path) {
  if (path === "/") return "Front door";
  if (path === "/photographs/") return "Photographs";
  if (path.startsWith("/sessions/")) return "Sessions";
  if (path === "/hobbies/narrow-nature/") return "Narrow nature";
  if (path.startsWith("/hobbies/")) return "Things to try";
  if (path.startsWith("/places/")) return "Places";
  return "Other";
}

function buildVitals(records, eventsByPageview) {
  const buckets = new Map();
  for (const record of records) {
    const vitals = new Map();
    for (const event of eventsByPageview.get(record.pvid) || []) {
      if (event.k === "vital" && THRESHOLDS[event.v])
        vitals.set(event.v, Number(event.d));
    }
    if (!vitals.size) continue;
    const device = record.device === "phone" ? "Phone" : "Desktop";
    for (const group of ["All pages", pageGroup(record.path)]) {
      const key = `${group}|${device}`;
      const bucket = buckets.get(key) || {
        group,
        device,
        pageviews: 0,
        values: Object.fromEntries(METRICS.map((m) => [m, []])),
      };
      bucket.pageviews++;
      for (const [metric, value] of vitals)
        if (Number.isFinite(value)) bucket.values[metric].push(value);
      buckets.set(key, bucket);
    }
  }
  const order = [
    "All pages",
    "Front door",
    "Photographs",
    "Sessions",
    "Places",
    "Things to try",
    "Narrow nature",
    "Other",
  ];
  return [...buckets.values()]
    .map((bucket) => ({
      group: bucket.group,
      device: bucket.device,
      pageviews: bucket.pageviews,
      metrics: Object.fromEntries(
        METRICS.map((metric) => {
          const value = p75(bucket.values[metric]);
          return [
            metric,
            {
              p75: value,
              samples: bucket.values[metric].length,
              rating: rating(metric, value),
            },
          ];
        }),
      ),
    }))
    .sort(
      (a, b) =>
        order.indexOf(a.group) - order.indexOf(b.group) ||
        a.device.localeCompare(b.device),
    );
}

function buildErrors(records, eventsByPageview) {
  const groups = new Map();
  for (const record of records) {
    for (const event of eventsByPageview.get(record.pvid) || []) {
      if (event.k !== "err") continue;
      const key = `${event.v}|${event.s || ""}`;
      const row = groups.get(key) || {
        message: event.v,
        source: event.s || "",
        line: event.l ?? null,
        count: 0,
        pages: new Set(),
        browsers: new Set(),
        lastSeen: 0,
      };
      row.count++;
      row.pages.add(record.path);
      if (record.browser) row.browsers.add(record.browser);
      row.lastSeen = Math.max(
        row.lastSeen,
        record.timestamp + (Number(event.t) || 0),
      );
      groups.set(key, row);
    }
  }
  return [...groups.values()]
    .map((row) => ({
      message: row.message,
      source: row.source,
      line: row.line,
      count: row.count,
      pages: [...row.pages].slice(0, 5),
      browsers: [...row.browsers],
      lastSeen: iso(row.lastSeen),
    }))
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, 50);
}

const BANDS = ["<480", "480-767", "768-1023", "1024-1439", "1440+"];

function buildLooks(records, eventsByPageview) {
  const firstBySid = new Map();
  for (const record of records) {
    if (!record.sid || !record.theme) continue;
    const first = firstBySid.get(record.sid);
    if (!first || record.timestamp < first.timestamp)
      firstBySid.set(record.sid, record);
  }
  const theme = { light: 0, dark: 0 };
  const from = { device: 0, choice: 0 };
  const bands = Object.fromEntries(BANDS.map((band) => [band, 0]));
  for (const record of firstBySid.values()) {
    if (record.theme in theme) theme[record.theme]++;
    if (record.themeFrom in from) from[record.themeFrom]++;
    if (record.vw in bands) bands[record.vw]++;
  }
  const toggles = { light: 0, dark: 0 };
  for (const record of records) {
    for (const event of eventsByPageview.get(record.pvid) || []) {
      if (event.k === "theme" && event.v in toggles) toggles[event.v]++;
    }
  }
  return {
    visits: firstBySid.size,
    theme,
    from,
    toggles,
    viewports: BANDS.map((band) => ({ band, visits: bands[band] })),
  };
}

// ---------------------------------------------------------------------------
// Photos and hobbies.
// ---------------------------------------------------------------------------
function buildPlay(records, eventsByPageview, durations) {
  const photos = new Map();
  const galleries = new Map();
  const nn = {
    visits: new Set(),
    played: new Set(),
    daily: 0,
    extra: 0,
    scores: [],
    more: 0,
  };
  const hobbies = new Map();

  for (const record of records) {
    const events = eventsByPageview.get(record.pvid) || [];
    const hobby = /^\/hobbies\/([a-z0-9-]+)\/$/.exec(record.path)?.[1];
    if (hobby) {
      const row = hobbies.get(hobby) || {
        slug: hobby,
        visits: new Set(),
        played: new Set(),
        times: [],
        playedTimes: [],
      };
      if (record.sid) row.visits.add(record.sid);
      const dur = durations.get(record.pvid);
      const played = events.some(
        (event) => event.k === "toy" && event.v === hobby,
      );
      if (played && record.sid) row.played.add(record.sid);
      if (Number.isFinite(dur)) {
        row.times.push(dur);
        if (played) row.playedTimes.push(dur);
      }
      hobbies.set(hobby, row);
    }
    if (record.path === "/hobbies/narrow-nature/" && record.sid)
      nn.visits.add(record.sid);
    for (const event of events) {
      if (event.k === "photo") {
        const row = photos.get(event.v) || {
          key: event.v,
          opens: 0,
          totalMs: 0,
          zooms: 0,
        };
        row.opens++;
        row.totalMs += Number(event.d) || 0;
        if (event.z) row.zooms++;
        photos.set(event.v, row);
        const page = event.v.split("/")[0];
        const gallery = galleries.get(page) || {
          page,
          opens: 0,
          photos: new Set(),
          totalMs: 0,
        };
        gallery.opens++;
        gallery.photos.add(event.v);
        gallery.totalMs += Number(event.d) || 0;
        galleries.set(page, gallery);
      }
      if (event.k === "toy" && event.v === "narrow-nature" && record.sid)
        nn.played.add(record.sid);
      if (event.k === "nn") {
        if (event.v === "more") nn.more++;
        else {
          nn[event.v === "extra" ? "extra" : "daily"]++;
          nn.scores.push(Number(event.d) || 0);
        }
      }
    }
  }

  return {
    photos: [...photos.values()]
      .sort((a, b) => b.opens - a.opens || b.totalMs - a.totalMs)
      .slice(0, 25),
    galleries: [...galleries.values()]
      .map((row) => ({
        page: row.page,
        opens: row.opens,
        photos: row.photos.size,
        totalMs: row.totalMs,
      }))
      .sort((a, b) => b.opens - a.opens)
      .slice(0, 25),
    narrowNature: {
      visits: nn.visits.size,
      played: nn.played.size,
      dailyFinished: nn.daily,
      extraFinished: nn.extra,
      averageScore: nn.scores.length
        ? Math.round(nn.scores.reduce((a, b) => a + b, 0) / nn.scores.length)
        : 0,
      moreLists: nn.more,
    },
    hobbies: [...hobbies.values()]
      .map((row) => ({
        slug: row.slug,
        visits: row.visits.size,
        played: row.played.size,
        medianMs: median(row.times),
        medianPlayedMs: median(row.playedTimes),
      }))
      .sort((a, b) => b.visits - a.visits),
  };
}

module.exports = {
  buildCompanies,
  buildErrors,
  buildLooks,
  buildPdf,
  buildPlay,
  buildRead,
  buildShares,
  buildVitals,
  dwellByPageview,
  isPdfScanner,
  pageGroup,
  p75,
  rating,
  DAY_MS,
};
