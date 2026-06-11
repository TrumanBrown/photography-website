let BlobServiceClient;
let TableClient;

const CONTAINER = 'originals';
const SESSION_JSON = '_session.json';
const MESSAGES_TABLE = 'contactmessages';
const PAGEVIEWS_TABLE = 'pageviews';
const METADATA = 'metadata';
const ADMIN_INDEX = 'admin-index.json';
const MAX_TITLE = 200;
const MAX_LOCATION = 200;
const MAX_DESCRIPTION = 1000;

const ALLOWED_USERS = new Set(
  (process.env.ADMIN_GITHUB_USERS || 'trumanbrown').toLowerCase().split(',').map(s => s.trim())
);

const IMG_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif',
  '.tif', '.tiff', '.heic', '.heif',
  '.arw', '.nef', '.cr2', '.cr3', '.dng', '.raf',
]);

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > -1 ? name.slice(i).toLowerCase() : '';
}

function getService() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return null;
  if (!BlobServiceClient) {
    BlobServiceClient = require('@azure/storage-blob').BlobServiceClient;
  }
  return BlobServiceClient.fromConnectionString(conn);
}

function getTableClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return null;
  if (!TableClient) {
    TableClient = require('@azure/data-tables').TableClient;
  }
  return TableClient.fromConnectionString(conn, MESSAGES_TABLE);
}

function getPageviewsClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return null;
  if (!TableClient) {
    TableClient = require('@azure/data-tables').TableClient;
  }
  return TableClient.fromConnectionString(conn, PAGEVIEWS_TABLE);
}

// ---------------------------------------------------------------------------
// GET /api/sessionmgr?type=analytics&days=30 — aggregated traffic metrics
// ---------------------------------------------------------------------------
async function handleGetAnalytics(context, req) {
  const client = getPageviewsClient();
  if (!client) {
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Storage not configured.' } };
    return;
  }

  let days = parseInt((req.query && req.query.days) || '30', 10);
  if (!Number.isFinite(days) || days < 1) days = 30;
  if (days > 365) days = 365;

  // Build the inclusive set of date-partition keys for the range.
  const dayKeys = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    dayKeys.push('pv-' + d);
  }
  const minKey = dayKeys[dayKeys.length - 1];
  const maxKey = dayKeys[0];

  let totalPageviews = 0;
  const visitors = new Set();
  const byDay = {};
  const byPath = {};
  const byRef = {};
  let durSum = 0;
  let durCount = 0;

  try {
    const filter = `PartitionKey ge '${minKey}' and PartitionKey le '${maxKey}'`;
    for await (const e of client.listEntities({ queryOptions: { filter } })) {
      const day = (e.partitionKey || '').replace(/^pv-/, '');
      if (e.type === 'dur') {
        if (typeof e.dur === 'number') { durSum += e.dur; durCount++; }
        continue;
      }
      // pageview row
      totalPageviews++;
      byDay[day] = (byDay[day] || 0) + 1;
      if (e.vh) visitors.add(e.vh);
      const p = e.path || '/';
      byPath[p] = (byPath[p] || 0) + 1;
      if (e.ref) byRef[e.ref] = (byRef[e.ref] || 0) + 1;
    }
  } catch (e) {
    if (e.statusCode === 404) {
      context.res = { status: 200, headers: json(), body: { ok: true, analytics: emptyAnalytics(dayKeys) } };
      return;
    }
    context.log.error('analytics query failed:', e.message);
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Failed to read analytics.' } };
    return;
  }

  // Time series oldest -> newest.
  const series = dayKeys
    .map((k) => k.replace(/^pv-/, ''))
    .reverse()
    .map((d) => ({ date: d, views: byDay[d] || 0 }));

  const topPages = Object.entries(byPath)
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topReferrers = Object.entries(byRef)
    .map(([ref, count]) => ({ ref, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  context.res = {
    status: 200,
    headers: json(),
    body: {
      ok: true,
      analytics: {
        days,
        totalPageviews,
        uniqueVisitors: visitors.size,
        avgTimeOnPageMs: durCount ? Math.round(durSum / durCount) : 0,
        series,
        topPages,
        topReferrers,
      },
    },
  };
}

function emptyAnalytics(dayKeys) {
  return {
    days: dayKeys.length,
    totalPageviews: 0,
    uniqueVisitors: 0,
    avgTimeOnPageMs: 0,
    series: dayKeys.map((k) => k.replace(/^pv-/, '')).reverse().map((d) => ({ date: d, views: 0 })),
    topPages: [],
    topReferrers: [],
  };
}

// ---------------------------------------------------------------------------
// GET /api/sessionmgr?type=messages — list contact form submissions (read-only)
// ---------------------------------------------------------------------------
async function handleGetMessages(context) {
  const client = getTableClient();
  if (!client) {
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Storage not configured.' } };
    return;
  }

  const messages = [];
  try {
    // Row keys are reverse-timestamped, so entities sort newest-first per
    // partition. We sort the combined list explicitly to be safe.
    for await (const entity of client.listEntities()) {
      messages.push({
        id: (entity.partitionKey || '') + '|' + (entity.rowKey || ''),
        name: entity.name || '',
        email: entity.email || '',
        message: entity.message || '',
        submittedAt: entity.submittedAt || '',
        read: entity.read === true,
      });
    }
  } catch (e) {
    if (e.statusCode === 404) {
      // Table doesn't exist yet (no messages ever submitted).
      context.res = { status: 200, headers: json(), body: { ok: true, messages: [] } };
      return;
    }
    context.log.error('listEntities failed:', e.message);
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Failed to read messages.' } };
    return;
  }

  messages.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  context.res = { status: 200, headers: json(), body: { ok: true, messages: messages } };
}

async function handleGet(context) {
  const service = getService();
  if (!service) {
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Storage not configured.' } };
    return;
  }

  var blobHost = process.env.AZURE_STORAGE_ACCOUNT
    ? process.env.AZURE_STORAGE_ACCOUNT + '.blob.core.windows.net'
    : 'stphotoprodnowiur.blob.core.windows.net';

  // Preferred path: read the consolidated admin index written by prebuild. It
  // has the SAME resolved metadata as the public site (including EXIF-derived
  // dates) and is a single fast read. Fall back to scanning originals/ if the
  // index doesn't exist yet (e.g. before the first build with this feature).
  try {
    const metaClient = service.getContainerClient(METADATA);
    const buf = await metaClient.getBlobClient(ADMIN_INDEX).downloadToBuffer();
    const index = JSON.parse(buf.toString('utf8'));
    const sessions = (index.sessions || []).map(function (s) {
      return {
        slug: s.prefix || s.slug,
        thumbSlug: s.slug,
        title: s.title || '',
        date: s.date || '',
        location: s.location || '',
        description: s.description || '',
        cover: s.cover || '',
        order: s.order != null ? s.order : null,
        images: s.images || [],
      };
    });
    context.res = { status: 200, headers: json(), body: { ok: true, sessions: sessions, blobHost: blobHost } };
    return;
  } catch (e) {
    if (e.statusCode !== 404) {
      context.log.warn('admin-index read failed, falling back to scan:', e.message);
    }
  }

  const container = service.getContainerClient(CONTAINER);
  const prefixes = new Set();
  const imagesByPrefix = {};

  for await (const blob of container.listBlobsFlat()) {
    const parts = blob.name.split('/');
    if (parts.length !== 2) continue;
    const [prefix, file] = parts;
    prefixes.add(prefix);
    if (file === SESSION_JSON) continue;
    if (!IMG_EXTS.has(extOf(file))) continue;
    (imagesByPrefix[prefix] = imagesByPrefix[prefix] || []).push(file);
  }

  const sessions = [];
  for (const prefix of [...prefixes].sort()) {
    let sidecar = {};
    try {
      const buf = await container.getBlobClient(prefix + '/' + SESSION_JSON).downloadToBuffer();
      sidecar = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      if (e.statusCode !== 404) context.log.warn('Could not read ' + prefix + '/' + SESSION_JSON + ':', e.message);
    }

    const images = (imagesByPrefix[prefix] || []).sort();
    sessions.push({
      slug: prefix,
      // Sanitized slug matches prebuild's output — used for thumbnail URLs in
      // variants/thumbs/<thumbSlug>/ and the public /sessions/<thumbSlug> path.
      thumbSlug: sanitizeSlug(prefix),
      title: sidecar.title || humanize(prefix),
      date: sidecar.date || '',
      location: sidecar.location || '',
      description: sidecar.description || '',
      cover: sidecar.cover || '',
      order: sidecar.order != null ? sidecar.order : null,
      images: images,
    });
  }

  context.res = { status: 200, headers: json(), body: { ok: true, sessions: sessions, blobHost: blobHost } };
}

async function handlePut(context, req) {
  var body = req.body || {};
  var slug = body.slug;
  var title = body.title;
  var cover = body.cover;
  var order = body.order;
  var location = body.location;
  var description = body.description;

  var errors = [];
  if (!slug || typeof slug !== 'string') errors.push('slug is required.');
  if (title !== undefined && typeof title !== 'string') errors.push('title must be a string.');
  if (title !== undefined && !title.trim()) errors.push('title cannot be empty.');
  if (title && title.length > MAX_TITLE) errors.push('title too long.');
  if (cover !== undefined && typeof cover !== 'string') errors.push('cover must be a string.');
  if (location !== undefined && typeof location !== 'string') errors.push('location must be a string.');
  if (location && location.length > MAX_LOCATION) errors.push('location too long.');
  if (description !== undefined && typeof description !== 'string') errors.push('description must be a string.');
  if (description && description.length > MAX_DESCRIPTION) errors.push('description too long.');
  if (order !== undefined && order !== null && (typeof order !== 'number' || !Number.isInteger(order))) {
    errors.push('order must be an integer or null.');
  }
  if (slug && (/[\/\\]/.test(slug) || slug.indexOf('..') !== -1 || slug.charAt(0) === '.')) {
    errors.push('Invalid slug.');
  }
  if (errors.length) {
    context.res = { status: 400, headers: json(), body: { ok: false, errors: errors } };
    return;
  }

  var service = getService();
  if (!service) {
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Storage not configured.' } };
    return;
  }

  var container = service.getContainerClient(CONTAINER);

  var sidecar = {};
  try {
    var buf = await container.getBlobClient(slug + '/' + SESSION_JSON).downloadToBuffer();
    sidecar = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    if (e.statusCode !== 404) {
      context.res = { status: 500, headers: json(), body: { ok: false, error: 'Failed to read session metadata.' } };
      return;
    }
  }

  if (title !== undefined) sidecar.title = title;
  if (cover !== undefined) sidecar.cover = cover;
  if (order !== undefined) {
    if (order === null) { delete sidecar.order; } else { sidecar.order = order; }
  }
  if (location !== undefined) sidecar.location = location;
  if (description !== undefined) sidecar.description = description;

  var data = JSON.stringify(sidecar, null, 2);
  var blockBlob = container.getBlockBlobClient(slug + '/' + SESSION_JSON);
  await blockBlob.upload(data, Buffer.byteLength(data), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });

  context.res = { status: 200, headers: json(), body: { ok: true, sidecar: sidecar } };
}

// ---------------------------------------------------------------------------
// POST /api/sessionmgr — trigger a rebuild via GitHub Actions workflow_dispatch
// ---------------------------------------------------------------------------
async function handlePost(context) {
  var token = process.env.GITHUB_TOKEN;
  var repo = process.env.GITHUB_REPO || 'TrumanBrown/photography-website';
  if (!token) {
    context.res = { status: 501, headers: json(), body: { ok: false, error: 'Rebuild not configured (no GITHUB_TOKEN).' } };
    return;
  }

  var https = require('https');
  var data = JSON.stringify({ ref: 'main' });
  var result = await new Promise(function (resolve, reject) {
    var req = https.request({
      hostname: 'api.github.com',
      path: '/repos/' + repo + '/actions/workflows/build-and-deploy.yml/dispatches',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'photography-admin',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, function (res) {
      var body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () { resolve({ status: res.statusCode, body: body }); });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });

  if (result.status === 204) {
    context.res = { status: 200, headers: json(), body: { ok: true, message: 'Build triggered. Site will update in ~5 minutes.' } };
  } else {
    context.log.error('GitHub dispatch failed:', result.status, result.body);
    context.res = { status: 502, headers: json(), body: { ok: false, error: 'Failed to trigger build (HTTP ' + result.status + ').' } };
  }
}

module.exports = async function (context, req) {
  try {
    var header = req.headers['x-ms-client-principal'];
    var userId = '';
    if (header) {
      try {
        var decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
        userId = (decoded.userDetails || '').toLowerCase();
      } catch (_) {}
    }
    if (!ALLOWED_USERS.has(userId)) {
      context.res = { status: 403, headers: json(), body: { ok: false, error: 'Not authorized.' } };
      return;
    }

    if (req.method === 'GET') {
      var type = (req.query && req.query.type) || '';
      if (type === 'messages') {
        await handleGetMessages(context);
      } else if (type === 'analytics') {
        await handleGetAnalytics(context, req);
      } else {
        await handleGet(context);
      }
    } else if (req.method === 'PUT') {
      await handlePut(context, req);
    } else if (req.method === 'POST') {
      await handlePost(context);
    } else {
      context.res = { status: 405, headers: json(), body: { ok: false, error: 'Method not allowed.' } };
    }
  } catch (err) {
    context.log.error('sessionmgr error:', err);
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Internal error.' } };
  }
};

function json() {
  return { 'Content-Type': 'application/json' };
}

function humanize(slug) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

// Mirrors scripts/prebuild.mjs sanitizeSlug() so thumbnail URLs and public
// session paths match what prebuild generated (lowercase, dash-separated).
function sanitizeSlug(prefix) {
  return prefix
    .toLowerCase()
    .replace(/[^a-z0-9-_/]+/g, '-')
    .replace(/\/+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
