const { analyticsDayKeys, buildAnalytics, canonicalHost, normalizePath } = require('./analytics');

function row(day, rowKey, values) {
  return { partitionKey: `pv-${day}`, rowKey, ...values };
}

describe('analytics aggregation', () => {
  const dayKeys = {
    current: ['2026-07-13', '2026-07-14'],
    previous: ['2026-07-11', '2026-07-12'],
  };
  const entities = [
    row('2026-07-14', '9999999998999-a-pv', { type: 'pv', path: '/', ref: '', vh: 'a', sid: 's1', pvid: 'p1' }),
    row('2026-07-14', '9999999997999-b-pv', { type: 'pv', path: '/hobbies', ref: 'www.trumanbrown.com', vh: 'a', sid: 's1', pvid: 'p2' }),
    row('2026-07-14', '9999999996999-c-pv', { type: 'pv', path: '/hobbies/', ref: 'search.brave.com', vh: 'b', sid: 's2', pvid: 'p3' }),
    row('2026-07-13', '9999999995999-d-pv', { type: 'pv', path: '/', ref: '', vh: 'c', sid: 's3', pvid: 'p4' }),
    row('2026-07-12', '9999999994999-e-pv', { type: 'pv', path: '/', ref: '', vh: 'd', sid: 's4', pvid: 'p5' }),
    row('2026-07-14', '9999999993999-a-dur', { type: 'dur', sid: 's1', pvid: 'p1', dur: 1000 }),
    row('2026-07-14', '9999999992999-b-dur', { type: 'dur', sid: 's1', pvid: 'p2', dur: 3000 }),
    row('2026-07-14', '9999999991999-c-dur', { type: 'dur', sid: 's2', pvid: 'p3', dur: 5000 }),
    row('2026-07-12', '9999999990999-e-dur', { type: 'dur', sid: 's4', pvid: 'p5', dur: 2000 }),
  ];

  it('builds current and previous summaries with engagement coverage', () => {
    const result = buildAnalytics(entities, { dayKeys, ownHost: 'trumanbrown.com' });
    expect(result).toMatchObject({
      days: 2,
      totalPageviews: 4,
      uniqueVisitors: 3,
      visits: 3,
      avgTimeOnPageMs: 3000,
      durationCoveragePct: 75,
      pagesPerVisit: 1.33,
      singlePageVisitRatePct: 66.7,
      previous: {
        totalPageviews: 1,
        uniqueVisitors: 1,
        visits: 1,
        avgTimeOnPageMs: 2000,
      },
    });
  });

  it('combines trailing-slash variants and reports useful page metrics', () => {
    const result = buildAnalytics(entities, { dayKeys, ownHost: 'trumanbrown.com' });
    expect(result.pages).toEqual([
      {
        path: '/', views: 2, visitors: 2, visits: 2, entries: 2,
        avgTimeOnPageMs: 1000, durationCoveragePct: 50, sharePct: 50,
      },
      {
        path: '/hobbies/', views: 2, visitors: 2, visits: 2, entries: 1,
        avgTimeOnPageMs: 4000, durationCoveragePct: 100, sharePct: 50,
      },
    ]);
  });

  it('classifies historical self-referrals as direct/internal', () => {
    const result = buildAnalytics(entities, { dayKeys, ownHost: 'www.trumanbrown.com' });
    expect(result.referrers).toEqual([
      { source: 'Direct / internal', views: 3, sharePct: 75 },
      { source: 'search.brave.com', views: 1, sharePct: 25 },
    ]);
  });

  it('returns a complete zero-filled daily series', () => {
    const result = buildAnalytics(entities, { dayKeys, ownHost: 'trumanbrown.com' });
    expect(result.series).toEqual([
      {
        date: '2026-07-13', views: 1, visitors: 1, visits: 1,
        avgTimeOnPageMs: 0, durationCoveragePct: 0,
      },
      {
        date: '2026-07-14', views: 3, visitors: 2, visits: 2,
        avgTimeOnPageMs: 3000, durationCoveragePct: 100,
      },
    ]);
  });
});

describe('analytics normalization', () => {
  it('builds adjacent UTC periods without DST-sensitive local dates', () => {
    expect(analyticsDayKeys(2, Date.parse('2026-07-14T22:00:00Z'))).toEqual({
      current: ['2026-07-13', '2026-07-14'],
      previous: ['2026-07-11', '2026-07-12'],
    });
  });

  it('normalizes host and route variants', () => {
    expect(canonicalHost('https://www.TrumanBrown.com:443/path')).toBe('trumanbrown.com');
    expect(normalizePath('/hobbies')).toBe('/hobbies/');
    expect(normalizePath('/hobbies//birding/?x=1')).toBe('/hobbies/birding/');
  });
});