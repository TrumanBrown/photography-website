let BlobServiceClient;
let TableClient;
const { allowedUsers, principalUserId } = require('./auth');
const { captionsFromImages, normalizeSessionImages } = require('./session-images');
const { analyticsDayKeys, buildAnalytics } = require('./analytics');

const CONTAINER = 'originals';
const SESSION_JSON = '_session.json';
const MESSAGES_TABLE = 'contactmessages';
const PAGEVIEWS_TABLE = 'pageviews';
const METADATA = 'metadata';
const ADMIN_INDEX = 'admin-index.json';
const MAX_TITLE = 200;
const MAX_LOCATION = 200;
const MAX_DESCRIPTION = 1000;

const ALLOWED_USERS = allowedUsers(process.env.ADMIN_GITHUB_USERS);

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
  if (days > 90) days = 90;

  // Query the selected period plus the immediately preceding period so the
  // dashboard can show meaningful comparisons without another storage scan.
  const dayKeys = analyticsDayKeys(days);
  const minKey = 'pv-' + dayKeys.previous[0];
  const maxKey = 'pv-' + dayKeys.current[dayKeys.current.length - 1];
  const entities = [];

  try {
    const filter = `PartitionKey ge '${minKey}' and PartitionKey le '${maxKey}'`;
    for await (const e of client.listEntities({ queryOptions: { filter } })) {
      entities.push(e);
    }
  } catch (e) {
    if (e.statusCode === 404) {
      context.res = {
        status: 200,
        headers: json(),
        body: {
          ok: true,
          analytics: buildAnalytics([], {
            dayKeys,
            ownHost: (req.headers && req.headers.host) || '',
          }),
        },
      };
      return;
    }
    context.log.error('analytics query failed:', e.message);
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Failed to read analytics.' } };
    return;
  }

  context.res = {
    status: 200,
    headers: json(),
    body: {
      ok: true,
      analytics: buildAnalytics(entities, {
        dayKeys,
        ownHost: (req.headers && req.headers.host) || '',
      }),
    },
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

  var blobHost = new URL(service.url).host;

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
        captions: s.captions || {},
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
      captions: captionsFromImages(sidecar.images),
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
  var normalizedImages = normalizeSessionImages(body.images);

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
  errors.push(...normalizedImages.errors);
  if (slug && (slug.includes('/') || slug.includes('\\') || slug.includes('..') || slug.startsWith('.'))) {
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
  if (normalizedImages.images !== undefined) sidecar.images = normalizedImages.images;

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
    var userId = principalUserId(req.headers['x-ms-client-principal']);
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
