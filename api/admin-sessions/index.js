const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER = 'originals';
const SESSION_JSON = '_session.json';
const MAX_TITLE = 200;
const MAX_LOCATION = 200;
const MAX_DESCRIPTION = 1000;

// Image extensions the prebuild script recognises.
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
  return BlobServiceClient.fromConnectionString(conn);
}

// ---------------------------------------------------------------------------
// GET /api/admin/sessions — list all sessions with metadata + image filenames
// ---------------------------------------------------------------------------
async function handleGet(context) {
  const service = getService();
  if (!service) {
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Storage not configured.' } };
    return;
  }

  const container = service.getContainerClient(CONTAINER);
  const prefixes = new Set();
  const imagesByPrefix = {};

  // Single pass: discover prefixes and images.
  for await (const blob of container.listBlobsFlat()) {
    const parts = blob.name.split('/');
    if (parts.length !== 2) continue;
    const [prefix, file] = parts;
    prefixes.add(prefix);
    if (file === SESSION_JSON) continue;
    if (!IMG_EXTS.has(extOf(file))) continue;
    (imagesByPrefix[prefix] ??= []).push(file);
  }

  const sessions = [];
  for (const prefix of [...prefixes].sort()) {
    let sidecar = {};
    try {
      const buf = await container.getBlobClient(`${prefix}/${SESSION_JSON}`).downloadToBuffer();
      sidecar = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      if (e.statusCode !== 404) context.log.warn(`Could not read ${prefix}/${SESSION_JSON}:`, e.message);
    }

    const images = (imagesByPrefix[prefix] ?? []).sort();
    sessions.push({
      slug: prefix,
      title: sidecar.title ?? humanize(prefix),
      date: sidecar.date ?? '',
      location: sidecar.location ?? '',
      description: sidecar.description ?? '',
      cover: sidecar.cover ?? '',
      order: sidecar.order ?? null,
      images,
    });
  }

  context.res = { status: 200, headers: json(), body: { ok: true, sessions } };
}

// ---------------------------------------------------------------------------
// PUT /api/admin/sessions — update a single session's _session.json sidecar
// ---------------------------------------------------------------------------
async function handlePut(context, req) {
  const { slug, title, cover, order, location, description } = req.body ?? {};

  // Validate
  const errors = [];
  if (!slug || typeof slug !== 'string') errors.push('slug is required.');
  if (title !== undefined && typeof title !== 'string') errors.push('title must be a string.');
  if (title && title.length > MAX_TITLE) errors.push(`title must be under ${MAX_TITLE} chars.`);
  if (cover !== undefined && typeof cover !== 'string') errors.push('cover must be a string.');
  if (location !== undefined && typeof location !== 'string') errors.push('location must be a string.');
  if (location && location.length > MAX_LOCATION) errors.push(`location must be under ${MAX_LOCATION} chars.`);
  if (description !== undefined && typeof description !== 'string') errors.push('description must be a string.');
  if (description && description.length > MAX_DESCRIPTION) errors.push(`description must be under ${MAX_DESCRIPTION} chars.`);
  if (order !== undefined && order !== null && (typeof order !== 'number' || !Number.isInteger(order))) {
    errors.push('order must be an integer or null.');
  }
  // Prevent path traversal in slug
  if (slug && (/[\/\\]/.test(slug) || slug.includes('..') || slug.startsWith('.'))) {
    errors.push('Invalid slug.');
  }
  if (errors.length) {
    context.res = { status: 400, headers: json(), body: { ok: false, errors } };
    return;
  }

  const service = getService();
  if (!service) {
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Storage not configured.' } };
    return;
  }

  const container = service.getContainerClient(CONTAINER);

  // Read existing sidecar (preserve fields we don't edit).
  let sidecar = {};
  try {
    const buf = await container.getBlobClient(`${slug}/${SESSION_JSON}`).downloadToBuffer();
    sidecar = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    if (e.statusCode !== 404) {
      context.res = { status: 500, headers: json(), body: { ok: false, error: 'Failed to read session metadata.' } };
      return;
    }
  }

  // Merge only provided fields.
  if (title !== undefined) sidecar.title = title;
  if (cover !== undefined) sidecar.cover = cover;
  if (order !== undefined) sidecar.order = order;
  if (location !== undefined) sidecar.location = location;
  if (description !== undefined) sidecar.description = description;

  // Write back.
  const data = JSON.stringify(sidecar, null, 2);
  const blockBlob = container.getBlockBlobClient(`${slug}/${SESSION_JSON}`);
  await blockBlob.upload(data, Buffer.byteLength(data), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });

  context.res = { status: 200, headers: json(), body: { ok: true, sidecar } };
}

// ---------------------------------------------------------------------------
module.exports = async function (context, req) {
  try {
    if (req.method === 'GET') {
      await handleGet(context);
    } else if (req.method === 'PUT') {
      await handlePut(context, req);
    } else {
      context.res = { status: 405, headers: json(), body: { ok: false, error: 'Method not allowed.' } };
    }
  } catch (err) {
    context.log.error('admin-sessions error:', err);
    context.res = { status: 500, headers: json(), body: { ok: false, error: 'Internal error.' } };
  }
};

function json() {
  return { 'Content-Type': 'application/json' };
}

function humanize(slug) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
