let BlobServiceClient;

const CONTAINER = 'originals';
const SESSION_JSON = '_session.json';
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

async function handleGet(context) {
  const service = getService();
  if (!service) {
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Storage not configured.' } };
    return;
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
      title: sidecar.title || humanize(prefix),
      date: sidecar.date || '',
      location: sidecar.location || '',
      description: sidecar.description || '',
      cover: sidecar.cover || '',
      order: sidecar.order != null ? sidecar.order : null,
      images: images,
    });
  }

  var blobHost = process.env.AZURE_STORAGE_ACCOUNT
    ? process.env.AZURE_STORAGE_ACCOUNT + '.blob.core.windows.net'
    : 'stphotoprodnowiur.blob.core.windows.net';

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
  if (order !== undefined) sidecar.order = order;
  if (location !== undefined) sidecar.location = location;
  if (description !== undefined) sidecar.description = description;

  var data = JSON.stringify(sidecar, null, 2);
  var blockBlob = container.getBlockBlobClient(slug + '/' + SESSION_JSON);
  await blockBlob.upload(data, Buffer.byteLength(data), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });

  context.res = { status: 200, headers: json(), body: { ok: true, sidecar: sidecar } };
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
      await handleGet(context);
    } else if (req.method === 'PUT') {
      await handlePut(context, req);
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
