// The Functions' one copy of the network and place lookup (geo.js), shared by
// /api/track, /api/resume and the warm-up ping. Managed Functions run every
// function in one process, so whichever loads it first loads it for all.

const { createGeo } = require("./geo");

const METADATA = "metadata";
let BlobServiceClient;
let geo;

async function downloadMetadata(name) {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return null;
  if (!BlobServiceClient) {
    BlobServiceClient = require("@azure/storage-blob").BlobServiceClient;
  }
  const blob = BlobServiceClient.fromConnectionString(conn)
    .getContainerClient(METADATA)
    .getBlobClient(name);
  try {
    return await blob.downloadToBuffer(undefined, undefined, {
      concurrency: 8,
    });
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

function getGeo(log) {
  if (!geo) {
    geo = createGeo({
      download: downloadMetadata,
      openReader: (buffer) => new (require("mmdb-lib").Reader)(buffer),
      log: (message) => log && log(message),
    });
  }
  return geo;
}

/**
 * The lookup for `ip`, or null. Waits at most `waitMs` for a cold load; past
 * that the caller carries on without it and the load finishes for the next.
 */
async function lookupPlace(ip, { waitMs, log } = {}) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs ?? 15000);
  });
  try {
    return await Promise.race([getGeo(log).lookup(ip), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Loads the lookup if it isn't in memory yet (the warm-up ping). */
async function warmGeo(log) {
  await getGeo(log).warm();
}

module.exports = { lookupPlace, warmGeo };
