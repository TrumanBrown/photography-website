#!/usr/bin/env node
/**
 * Keeps this month's DB-IP Lite databases in the private `metadata` container
 * for /api/track's network and place lookup (api/shared/geo.js).
 *
 * DB-IP publishes IP to City Lite and IP to ASN Lite once a month under CC BY
 * 4.0 (https://db-ip.com/db/lite.php, no account). The pair is about 65 MB
 * gzipped, too big for the API's deploy zip, so it lives in Blob instead:
 *
 *   metadata/geo/dbip-city-lite-YYYY-MM.mmdb.gz
 *   metadata/geo/dbip-asn-lite-YYYY-MM.mmdb.gz
 *   metadata/geo/current.json   { month, city, asn, updatedAt }
 *
 * Run by every Build and Deploy (hourly). When current.json already names this
 * month it does nothing but read that one small file. Early on the 1st, before
 * DB-IP has published, it falls back to last month. It never fails the build:
 * any problem is logged and the Functions keep using the files they have.
 *
 * Auth: DefaultAzureCredential (az login locally, OIDC in GitHub Actions).
 * Env: AZURE_STORAGE_ACCOUNT must be set.
 */
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STORAGE = process.env.AZURE_STORAGE_ACCOUNT;
const CONTAINER = "metadata";
export const POINTER = "geo/current.json";
const SOURCE = "https://download.db-ip.com/free";
const KINDS = ["city", "asn"];
const MAXMIND_MARKER = Buffer.from([
  0xab,
  0xcd,
  0xef,
  ...Buffer.from("MaxMind.com"),
]);

export function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

export function previousMonth(month) {
  const [year, mon] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(year, mon - 2, 1)));
}

export function fileName(kind, month) {
  return `dbip-${kind}-lite-${month}.mmdb.gz`;
}

export function blobName(kind, month) {
  return `geo/${fileName(kind, month)}`;
}

// A gzipped MaxMind DB unpacks to a file with the metadata marker near its end.
export function isMaxMindGzip(buffer) {
  try {
    const db = gunzipSync(buffer);
    return (
      db.length > 1_000_000 && db.subarray(-256 * 1024).includes(MAXMIND_MARKER)
    );
  } catch {
    return false;
  }
}

// Old months to delete: everything under geo/ except the pair being kept.
export function staleBlobs(names, keepMonths) {
  const keep = new Set(
    keepMonths.flatMap((month) => KINDS.map((kind) => blobName(kind, month))),
  );
  return names.filter(
    (name) => name.startsWith("geo/dbip-") && !keep.has(name),
  );
}

async function fetchMonth(month) {
  const files = {};
  for (const kind of KINDS) {
    const res = await fetch(`${SOURCE}/${fileName(kind, month)}`);
    if (res.status === 404) return null;
    if (!res.ok)
      throw new Error(
        `DB-IP answered ${res.status} for ${fileName(kind, month)}`,
      );
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!isMaxMindGzip(buffer))
      throw new Error(`${fileName(kind, month)} isn't a MaxMind database`);
    files[kind] = buffer;
  }
  return files;
}

async function readPointer(container) {
  try {
    const buffer = await container.getBlobClient(POINTER).downloadToBuffer();
    return JSON.parse(buffer.toString("utf8"));
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function main() {
  if (!STORAGE) {
    console.error("AZURE_STORAGE_ACCOUNT env var is required.");
    process.exit(2);
  }
  const { BlobServiceClient } = await import("@azure/storage-blob");
  const { DefaultAzureCredential } = await import("@azure/identity");
  const service = new BlobServiceClient(
    `https://${STORAGE}.blob.core.windows.net`,
    new DefaultAzureCredential(),
  );
  const container = service.getContainerClient(CONTAINER);

  const thisMonth = monthKey(new Date());
  const current = await readPointer(container);
  if (current && current.month === thisMonth) {
    console.log(`Geo databases are current (${thisMonth}).`);
    return;
  }

  let month = thisMonth;
  let files = await fetchMonth(month);
  if (!files) {
    month = previousMonth(thisMonth);
    if (current && current.month === month) {
      console.log(`DB-IP hasn't published ${thisMonth} yet; keeping ${month}.`);
      return;
    }
    files = await fetchMonth(month);
  }
  if (!files) throw new Error(`DB-IP has neither ${thisMonth} nor ${month}`);

  for (const kind of KINDS) {
    await container
      .getBlockBlobClient(blobName(kind, month))
      .uploadData(files[kind], {
        blobHTTPHeaders: { blobContentType: "application/gzip" },
      });
    console.log(
      `Uploaded ${blobName(kind, month)} (${(files[kind].length / 1e6).toFixed(1)} MB)`,
    );
  }
  const pointer = {
    month,
    city: blobName("city", month),
    asn: blobName("asn", month),
    updatedAt: new Date().toISOString(),
  };
  const body = Buffer.from(JSON.stringify(pointer, null, 2));
  await container.getBlockBlobClient(POINTER).uploadData(body, {
    blobHTTPHeaders: { blobContentType: "application/json" },
  });
  console.log(`Pointed ${POINTER} at ${month}.`);

  // Keep last month's pair too: an instance may still be loading it.
  const names = [];
  for await (const blob of container.listBlobsFlat({ prefix: "geo/" }))
    names.push(blob.name);
  for (const name of staleBlobs(names, [month, previousMonth(month)])) {
    await container.deleteBlob(name);
    console.log(`Deleted ${name}`);
  }
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err) => {
    // Never fail the build over this: the Functions keep their current files.
    console.log(`::warning::Geo database refresh skipped: ${err.message}`);
  });
}
