const DAY_MS = 86400000;
const REVERSE_TIMESTAMP_MAX = 9999999999999;
const { canonicalHost } = require('../shared/referrer');

function isoDay(now, offset = 0) {
  const date = new Date(now);
  const midnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return new Date(midnight - offset * DAY_MS).toISOString().slice(0, 10);
}

function analyticsDayKeys(days, now = Date.now()) {
  const current = [];
  const previous = [];
  for (let offset = days - 1; offset >= 0; offset--) current.push(isoDay(now, offset));
  for (let offset = days * 2 - 1; offset >= days; offset--) previous.push(isoDay(now, offset));
  return { current, previous };
}

function normalizePath(value) {
  let path = typeof value === 'string' && value.startsWith('/') ? value : '/';
  path = path.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/');
  if (path !== '/') path = path.replace(/\/+$/, '') + '/';
  return path.slice(0, 300);
}

function rowTimestamp(rowKey) {
  const reversed = Number(String(rowKey || '').split('-', 1)[0]);
  if (!Number.isFinite(reversed)) return Number.MAX_SAFE_INTEGER;
  return REVERSE_TIMESTAMP_MAX - reversed;
}

function percentage(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function summarize(records, durations, days, ownHost) {
  const daySet = new Set(days);
  const pageviews = records.filter((record) => daySet.has(record.day));
  const visitors = new Set();
  const visits = new Set();
  const visitCounts = new Map();
  const firstPageByVisit = new Map();
  const daily = new Map(
    days.map((day) => [day, {
      date: day,
      views: 0,
      visitors: new Set(),
      visits: new Set(),
      durationSum: 0,
      durationSamples: 0,
    }]),
  );
  const pages = new Map();
  const sources = new Map();
  let durationSum = 0;
  let durationSamples = 0;

  for (const record of pageviews) {
    if (record.vh) visitors.add(record.vh);
    if (record.sid) {
      visits.add(record.sid);
      visitCounts.set(record.sid, (visitCounts.get(record.sid) || 0) + 1);
      const first = firstPageByVisit.get(record.sid);
      if (!first || record.timestamp < first.timestamp) {
        firstPageByVisit.set(record.sid, { path: record.path, timestamp: record.timestamp });
      }
    }

    const day = daily.get(record.day);
    day.views++;
    if (record.vh) day.visitors.add(record.vh);
    if (record.sid) day.visits.add(record.sid);

    const page = pages.get(record.path) || {
      path: record.path,
      views: 0,
      visitors: new Set(),
      visits: new Set(),
      entries: 0,
      durationSum: 0,
      durationSamples: 0,
    };
    page.views++;
    if (record.vh) page.visitors.add(record.vh);
    if (record.sid) page.visits.add(record.sid);

    const duration = durations.get(record.pvid);
    if (Number.isFinite(duration)) {
      durationSum += duration;
      durationSamples++;
      day.durationSum += duration;
      day.durationSamples++;
      page.durationSum += duration;
      page.durationSamples++;
    }
    pages.set(record.path, page);

    const ref = canonicalHost(record.ref);
    const source = !ref || ref === ownHost ? 'Direct / internal' : ref;
    sources.set(source, (sources.get(source) || 0) + 1);
  }

  for (const entry of firstPageByVisit.values()) {
    const page = pages.get(entry.path);
    if (page) page.entries++;
  }

  const totalPageviews = pageviews.length;
  const visitCount = visits.size;
  const singlePageVisits = [...visitCounts.values()].filter((count) => count === 1).length;

  return {
    totalPageviews,
    uniqueVisitors: visitors.size,
    visits: visitCount,
    avgTimeOnPageMs: durationSamples ? Math.round(durationSum / durationSamples) : 0,
    durationSamples,
    durationCoveragePct: percentage(durationSamples, totalPageviews),
    pagesPerVisit: visitCount ? Math.round((totalPageviews / visitCount) * 100) / 100 : 0,
    singlePageVisitRatePct: percentage(singlePageVisits, visitCount),
    series: [...daily.values()].map((day) => ({
      date: day.date,
      views: day.views,
      visitors: day.visitors.size,
      visits: day.visits.size,
      avgTimeOnPageMs: day.durationSamples
        ? Math.round(day.durationSum / day.durationSamples)
        : 0,
      durationCoveragePct: percentage(day.durationSamples, day.views),
    })),
    pages: [...pages.values()]
      .map((page) => ({
        path: page.path,
        views: page.views,
        visitors: page.visitors.size,
        visits: page.visits.size,
        entries: page.entries,
        avgTimeOnPageMs: page.durationSamples
          ? Math.round(page.durationSum / page.durationSamples)
          : 0,
        durationCoveragePct: percentage(page.durationSamples, page.views),
        sharePct: percentage(page.views, totalPageviews),
      }))
      .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path)),
    referrers: [...sources.entries()]
      .map(([source, views]) => ({ source, views, sharePct: percentage(views, totalPageviews) }))
      .sort((a, b) => b.views - a.views || a.source.localeCompare(b.source)),
  };
}

function parseEvents(value) {
  try {
    const list = JSON.parse(String(value || '[]'));
    return Array.isArray(list) ? list.filter((event) => event && typeof event.k === 'string') : [];
  } catch {
    return [];
  }
}

const PDF_CLICKS = new Set(['resume-pdf', 'rail:resume-pdf']);
const SCANNER_SECONDS = 5;
const MAX_VISIT_ROWS = 300;

// Email security tools (Safe Links, Proofpoint, Mimecast) open every link in
// a message in a real browser from a server. Such a visit comes from a mail
// security owner, or from a cloud or mixed owner with no click or copy, one
// page and under five seconds on Weekdays. Decided here rather than when the
// row is written, so the rule can change without losing anything.
function isLikelyScanner(visit) {
  if (visit.orgKind === 'scanner') return true;
  if (visit.orgKind !== 'cloud' && visit.orgKind !== 'mixed') return false;
  return (
    visit.clicks.length === 0 &&
    visit.copies.length === 0 &&
    visit.pages.length <= 1 &&
    visit.weekdaysMs < SCANNER_SECONDS * 1000
  );
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

// One row per visit that showed the Weekdays side or came in on a tagged link
// (?via=resume), with who, where, how long, what they did and where they went.
function buildWeekdays(records, eventsByPageview, days, ownHost) {
  const daySet = new Set(days);
  const byVisit = new Map();
  for (const record of records) {
    if (!record.sid || !daySet.has(record.day)) continue;
    const list = byVisit.get(record.sid) || [];
    list.push(record);
    byVisit.set(record.sid, list);
  }

  const rows = [];
  for (const pageviews of byVisit.values()) {
    pageviews.sort((a, b) => a.timestamp - b.timestamp);
    const via = (pageviews.find((pv) => pv.via) || {}).via || '';
    const shownAt = pageviews.findIndex((pv) =>
      (eventsByPageview.get(pv.pvid) || []).some((event) => event.k === 'show'),
    );
    if (shownAt === -1 && !via) continue;

    const first = pageviews[0];
    const start = first.timestamp;
    const who = pageviews.find((pv) => pv.org || pv.city) || first;
    const steps = [];
    const reached = new Map();
    const clicks = [];
    const copies = [];
    let weekdaysMs = 0;

    for (const pv of pageviews) {
      steps.push({ at: Math.max(0, pv.timestamp - start), kind: 'page', value: pv.path });
      let pageWeekdaysMs = 0;
      for (const event of eventsByPageview.get(pv.pvid) || []) {
        const t = Number(event.t) || 0;
        if (event.k === 'wd') {
          pageWeekdaysMs = Math.max(pageWeekdaysMs, Number(event.v) || 0);
          continue;
        }
        const step = { at: Math.max(0, pv.timestamp + t - start), kind: event.k };
        if (event.v !== undefined) step.value = String(event.v);
        if (event.k === 'copy') step.section = event.s || 'weekdays';
        steps.push(step);
        if (event.k === 'reach' && !reached.has(event.v)) reached.set(event.v, Number(event.n) || 0);
        if (event.k === 'click') clicks.push(String(event.v));
        if (event.k === 'copy') copies.push({ section: event.s || 'weekdays', text: String(event.v) });
      }
      weekdaysMs += pageWeekdaysMs;
    }
    steps.sort((a, b) => a.at - b.at);

    let furthest = '';
    let furthestIndex = -1;
    for (const [name, index] of reached) {
      if (index > furthestIndex) {
        furthest = name;
        furthestIndex = index;
      }
    }

    const ref = canonicalHost(first.ref);
    const visit = {
      start: new Date(start).toISOString(),
      via,
      source: via || (ref && ref !== ownHost ? ref : ''),
      org: who.org,
      orgKind: who.orgKind,
      city: who.city,
      region: who.region,
      country: who.country,
      device: first.device,
      os: first.os,
      browser: first.browser,
      weekdays: shownAt !== -1,
      weekdaysMs,
      furthest,
      clicks,
      copies,
      pages: pageviews.map((pv) => pv.path),
      next: shownAt === -1 ? '' : (pageviews[shownAt + 1] || {}).path || '',
      steps,
    };
    visit.scanner = isLikelyScanner(visit);
    rows.push(visit);
  }

  rows.sort((a, b) => b.start.localeCompare(a.start));
  const people = rows.filter((row) => !row.scanner);
  const owners = new Map();
  for (const row of people) {
    if (!row.org) continue;
    const owner = owners.get(row.org) || { org: row.org, orgKind: row.orgKind, visits: 0 };
    owner.visits++;
    owners.set(row.org, owner);
  }

  return {
    totals: {
      weekdaysVisits: people.filter((row) => row.weekdays).length,
      resumeVisits: people.filter((row) => row.via === 'resume').length,
      scannerVisits: rows.length - people.length,
      medianWeekdaysMs: median(people.filter((row) => row.weekdaysMs > 0).map((row) => row.weekdaysMs)),
      pdfClicks: people.filter((row) => row.clicks.some((click) => PDF_CLICKS.has(click))).length,
      copyVisits: people.filter((row) => row.copies.length > 0).length,
    },
    owners: [...owners.values()]
      .sort((a, b) => b.visits - a.visits || a.org.localeCompare(b.org))
      .slice(0, 8),
    visits: rows.slice(0, MAX_VISIT_ROWS),
  };
}

function buildAnalytics(entities, options) {
  const { current, previous } = options.dayKeys;
  const ownHost = canonicalHost(options.ownHost);
  const durations = new Map();
  const eventsByPageview = new Map();
  const records = [];

  for (const entity of entities) {
    if (entity.type === 'dur') {
      const duration = Number(entity.dur);
      if (entity.pvid && Number.isFinite(duration)) durations.set(entity.pvid, duration);
      continue;
    }
    if (entity.type === 'ev') {
      if (!entity.pvid) continue;
      const list = eventsByPageview.get(entity.pvid) || [];
      list.push(...parseEvents(entity.evs));
      eventsByPageview.set(entity.pvid, list);
      continue;
    }
    records.push({
      day: String(entity.partitionKey || '').replace(/^pv-/, ''),
      path: normalizePath(entity.path),
      ref: entity.ref || '',
      vh: entity.vh || '',
      sid: entity.sid || '',
      pvid: entity.pvid || '',
      timestamp: rowTimestamp(entity.rowKey),
      via: entity.via || '',
      org: entity.org || '',
      orgKind: entity.orgKind || '',
      city: entity.city || '',
      region: entity.region || '',
      country: entity.country || '',
      device: entity.device || '',
      os: entity.os || '',
      browser: entity.browser || '',
    });
  }

  const currentSummary = summarize(records, durations, current, ownHost);
  const previousSummary = summarize(records, durations, previous, ownHost);
  return {
    days: current.length,
    period: {
      start: current[0],
      end: current[current.length - 1],
      previousStart: previous[0],
      previousEnd: previous[previous.length - 1],
    },
    ...currentSummary,
    previous: {
      totalPageviews: previousSummary.totalPageviews,
      uniqueVisitors: previousSummary.uniqueVisitors,
      visits: previousSummary.visits,
      avgTimeOnPageMs: previousSummary.avgTimeOnPageMs,
      durationCoveragePct: previousSummary.durationCoveragePct,
      pagesPerVisit: previousSummary.pagesPerVisit,
      singlePageVisitRatePct: previousSummary.singlePageVisitRatePct,
    },
    weekdays: buildWeekdays(records, eventsByPageview, current, ownHost),
  };
}

module.exports = {
  analyticsDayKeys,
  buildAnalytics,
  buildWeekdays,
  canonicalHost,
  isLikelyScanner,
  normalizePath,
};