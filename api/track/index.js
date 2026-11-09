// Privacy-friendly analytics beacon. Records pageviews, time-on-page and the
// Weekdays side's events to Table Storage. No IP is ever stored: it's used for
// a daily-rotating salted hash (so a visitor can't be tracked across days) and
// for a network and place lookup against a local copy of DB-IP's data
// (api/shared/geo.js), then dropped. No cookies, no third parties.

const { todayUtc, visitorHash } = require('../shared/visitor-hash');
const { clientIp } = require('../shared/client-ip');
const { externalReferrerHost } = require('../shared/referrer');
const { describeAgent } = require('../shared/user-agent');
const { createGeo } = require('../shared/geo');
const { cleanEvents, cleanVia } = require('./payload');

let TableClient;
let BlobServiceClient;
const TABLE = 'pageviews';
const METADATA = 'metadata';
const MAX_PATH = 300;
const GEO_WAIT_MS = 15000;
const SALT = process.env.ANALYTICS_SALT || process.env.AZURE_STORAGE_CONNECTION_STRING || '';

function getTableClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return null;
  if (!TableClient) {
    TableClient = require('@azure/data-tables').TableClient;
  }
  return TableClient.fromConnectionString(conn, TABLE);
}

async function downloadMetadata(name) {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return null;
  if (!BlobServiceClient) {
    BlobServiceClient = require('@azure/storage-blob').BlobServiceClient;
  }
  const blob = BlobServiceClient.fromConnectionString(conn)
    .getContainerClient(METADATA)
    .getBlobClient(name);
  try {
    return await blob.downloadToBuffer(undefined, undefined, { concurrency: 8 });
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

let geo;
function getGeo(context) {
  if (!geo) {
    geo = createGeo({
      download: downloadMetadata,
      openReader: (buffer) => new (require('mmdb-lib').Reader)(buffer),
      log: (message) => context.log.warn(message),
    });
  }
  return geo;
}

// The first beacon on a cold instance waits for the databases to load (a few
// seconds). Past GEO_WAIT_MS the row is written without them and the load
// carries on for the next beacon.
async function lookupPlace(context, ip) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), GEO_WAIT_MS);
  });
  try {
    return await Promise.race([getGeo(context).lookup(ip), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
      const place = await lookupPlace(context, ip);
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
