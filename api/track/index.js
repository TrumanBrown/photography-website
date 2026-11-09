// Privacy-friendly analytics beacon. Records pageviews, time-on-page and page
// events to Table Storage. No IP is ever stored: it's used for a daily-rotating
// salted hash (so a visitor can't be tracked across days) and for a network and
// place lookup against a local copy of DB-IP's data (api/shared/geo.js), then
// dropped. No cookies, no third parties. A batch of events that shows someone
// reading the resume can email Truman (api/shared/alert.js).
//
// GET /api/track?warm=1 is the warm-up ping from the Logic App timer: it loads
// the lookup so no visitor waits for it, and records nothing.

const { todayUtc, visitorHash } = require("../shared/visitor-hash");
const { clientIp } = require("../shared/client-ip");
const { externalReferrerHost } = require("../shared/referrer");
const { describeAgent } = require("../shared/user-agent");
const { lookupPlace, warmGeo } = require("../shared/geo-service");
const { maybeAlert } = require("../shared/alert");
const { isBot } = require("../shared/bots");
const {
  cleanEvents,
  cleanTheme,
  cleanThemeFrom,
  cleanViewport,
  cleanVia,
} = require("./payload");

let TableClient;
const TABLE = "pageviews";
const MAX_PATH = 300;
const SALT =
  process.env.ANALYTICS_SALT ||
  process.env.AZURE_STORAGE_CONNECTION_STRING ||
  "";

function getTableClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return null;
  if (!TableClient) {
    TableClient = require("@azure/data-tables").TableClient;
  }
  return TableClient.fromConnectionString(conn, TABLE);
}


module.exports = async function (context, req) {
  // Always return 204 quickly; analytics must never break the page.
  context.res = { status: 204 };

  if (req.method === "GET") {
    try {
      await warmGeo((message) => context.log.warn(message));
    } catch {}
    context.res = { status: 204, headers: { "Cache-Control": "no-store" } };
    return;
  }

  try {
    const ua = req.headers['user-agent'] || '';
    if (isBot(ua)) return; // skip bots

    const body = req.body || {};
    const type = body.type === 'dur' || body.type === 'ev' ? body.type : 'pv';
    const sid = typeof body.sid === 'string' ? body.sid.slice(0, 40) : '';
    const pvid = typeof body.pvid === 'string' ? body.pvid.slice(0, 40) : '';
    if (!sid || !pvid) return;

    const events = type === 'ev' ? cleanEvents(body.events) : [];
    if (type === 'ev' && !events.length) return;

    const client = getTableClient();
    if (!client) return;
    await client.createTable();

    const date = todayUtc();
    const now = Date.now();
    const rowKey = `${String(9999999999999 - now).padStart(13, '0')}-${pvid}-${type}`;

    if (type === 'pv') {
      const path = typeof body.path === 'string' ? body.path.slice(0, MAX_PATH) : '/';
      const ref = externalReferrerHost(
        typeof body.ref === 'string' ? body.ref : '',
        req.headers['host'] || '',
      );
      const ip = clientIp(req);
      const place = await lookupPlace(ip, {
        log: (message) => context.log.warn(message),
      });
      await client.createEntity({
        partitionKey: `pv-${date}`,
        rowKey,
        type: 'pv',
        path,
        ref,
        via: cleanVia(body.via),
        vh: visitorHash(ip, ua, date, SALT),
        sid,
        pvid,
        ...(place || {}),
        ...describeAgent(ua),
        theme: cleanTheme(body.theme),
        themeFrom: cleanThemeFrom(body.themeFrom),
        vw: cleanViewport(body.vw),
      });
    } else if (type === 'ev') {
      // A random suffix keeps two batches in the same millisecond apart.
      await client.createEntity({
        partitionKey: `pv-${date}`,
        rowKey: `${rowKey}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'ev',
        sid,
        pvid,
        evs: JSON.stringify(events),
      });
      await maybeAlert({
        pageviews: client,
        pvid,
        events,
        log: (message) => context.log.warn(message),
      });
    } else {
      const dur = Number(body.dur);
      if (!Number.isFinite(dur) || dur < 0 || dur > 1000 * 60 * 60) return; // sanity: 0–1h
      await client.createEntity({
        partitionKey: `pv-${date}`,
        rowKey,
        type: 'dur',
        sid,
        pvid,
        dur: Math.round(dur),
      });
    }
  } catch (err) {
    context.log.warn('track error:', err.message);
    // Swallow — never surface analytics errors to the client.
  }
};
