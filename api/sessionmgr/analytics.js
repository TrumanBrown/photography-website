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

function buildAnalytics(entities, options) {
  const { current, previous } = options.dayKeys;
  const ownHost = canonicalHost(options.ownHost);
  const durations = new Map();
  const records = [];

  for (const entity of entities) {
    if (entity.type === 'dur') {
      const duration = Number(entity.dur);
      if (entity.pvid && Number.isFinite(duration)) durations.set(entity.pvid, duration);
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
  };
}

module.exports = { analyticsDayKeys, buildAnalytics, canonicalHost, normalizePath };