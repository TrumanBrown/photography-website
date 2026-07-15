// Privacy-friendly analytics beacon. Records pageviews and time-on-page to
// Table Storage. No IP is ever stored — unique visitors are counted via a
// daily-rotating salted hash (the hash changes each day by design, so a
// visitor cannot be tracked across days). No cookies, no third parties.

const { todayUtc, visitorHash } = require('../shared/visitor-hash');
const { clientIp } = require('../shared/client-ip');
const { externalReferrerHost } = require('../shared/referrer');

let TableClient;
const TABLE = 'pageviews';
const MAX_PATH = 300;
const SALT = process.env.ANALYTICS_SALT || process.env.AZURE_STORAGE_CONNECTION_STRING || '';

function getTableClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return null;
  if (!TableClient) {
    TableClient = require('@azure/data-tables').TableClient;
  }
  return TableClient.fromConnectionString(conn, TABLE);
}

// Common bot/crawler user-agents we don't want inflating the numbers.
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|preview|monitor|curl|wget|python-requests|headless/i;

module.exports = async function (context, req) {
  // Always return 204 quickly; analytics must never break the page.
  context.res = { status: 204 };

  try {
    const ua = req.headers['user-agent'] || '';
    if (BOT_RE.test(ua)) return; // skip bots

    const body = req.body || {};
    const type = body.type === 'dur' ? 'dur' : 'pv';
    const sid = typeof body.sid === 'string' ? body.sid.slice(0, 40) : '';
    const pvid = typeof body.pvid === 'string' ? body.pvid.slice(0, 40) : '';
    if (!sid || !pvid) return;

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
      await client.createEntity({
        partitionKey: `pv-${date}`,
        rowKey,
        type: 'pv',
        path,
        ref,
        vh: visitorHash(clientIp(req), ua, date, SALT),
        sid,
        pvid,
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
