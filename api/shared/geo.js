// Looks up who owns a visitor's network and roughly where it is, from DB-IP's
// free Lite databases (IP to City Lite and IP to ASN Lite, CC BY 4.0,
// https://db-ip.com). The lookup happens here, inside the site's own
// Functions, so no visitor IP is sent to anyone. Only the answer is kept.
//
// The two files (about 65 MB gzipped together, 137 MB unpacked) are too big for
// the API's deploy zip, so the build uploads them to the private `metadata`
// container under geo/ each month (scripts/sync-geo-db.mjs) with a pointer,
// geo/current.json, naming the current pair. They load on first use and stay
// in memory for the life of the Functions instance.

const zlib = require("zlib");
const { orgKind } = require("./org-kind");

const POINTER = "geo/current.json";
const RETRY_AFTER_MS = 10 * 60 * 1000;
const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 100;

function isPublicIp(ip) {
  if (typeof ip !== "string" || !ip || ip === "unknown") return false;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (!ip.includes(":")) return false;
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return false;
  if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower)) return false;
  return true;
}

function text(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

// Turns the two database records into the fields stored on a pageview row.
function describeRecords(cityRecord, asnRecord) {
  const org = text(asnRecord && asnRecord.autonomous_system_organization);
  const subdivisions = (cityRecord && cityRecord.subdivisions) || [];
  return {
    org,
    orgKind: orgKind(org),
    city: text(
      cityRecord &&
        cityRecord.city &&
        cityRecord.city.names &&
        cityRecord.city.names.en,
    ),
    region: text(
      subdivisions[0] && subdivisions[0].names && subdivisions[0].names.en,
    ),
    country: text(
      cityRecord && cityRecord.country && cityRecord.country.iso_code,
    ).slice(0, 2),
  };
}

function validPointer(pointer) {
  return (
    pointer &&
    typeof pointer.month === "string" &&
    typeof pointer.city === "string" &&
    typeof pointer.asn === "string" &&
    pointer.city.startsWith("geo/") &&
    pointer.asn.startsWith("geo/")
  );
}

// `download(name)` resolves to a Buffer, or null when the blob doesn't exist.
// `openReader(buffer)` builds a MaxMind reader (injected so tests can fake it).
function createGeo({ download, openReader, now = Date.now, log = () => {} }) {
  let readers = null;
  let month = "";
  let loadedAt = 0;
  let failedAt = null;
  let loading = null;

  async function load() {
    const pointerBuffer = await download(POINTER);
    if (!pointerBuffer) throw new Error("no geo/current.json yet");
    const pointer = JSON.parse(pointerBuffer.toString("utf8"));
    if (!validPointer(pointer))
      throw new Error("geo/current.json is malformed");
    if (readers && pointer.month === month) {
      loadedAt = now();
      return;
    }
    const [cityGz, asnGz] = await Promise.all([
      download(pointer.city),
      download(pointer.asn),
    ]);
    if (!cityGz || !asnGz)
      throw new Error("geo files named in geo/current.json are missing");
    readers = {
      city: openReader(zlib.gunzipSync(cityGz)),
      asn: openReader(zlib.gunzipSync(asnGz)),
    };
    month = pointer.month;
    loadedAt = now();
    failedAt = null;
  }

  // Starts a load when there's nothing in memory, or a re-check once a day so
  // a long-lived instance picks up next month's files. A failed load waits ten
  // minutes before trying again rather than downloading on every beacon.
  function ensureLoaded() {
    const time = now();
    const stale = readers && time - loadedAt > RECHECK_AFTER_MS;
    const mayTry = failedAt === null || time - failedAt > RETRY_AFTER_MS;
    if ((!readers || stale) && !loading && mayTry) {
      loading = load()
        .catch((err) => {
          failedAt = now();
          if (readers) loadedAt = now();
          log(`geo load failed: ${err.message}`);
        })
        .finally(() => {
          loading = null;
        });
    }
    // With readers already in memory, a background re-check doesn't hold up
    // the lookup.
    return readers ? null : loading;
  }

  async function lookup(ip) {
    if (!isPublicIp(ip)) return null;
    const pending = ensureLoaded();
    if (pending) await pending;
    if (!readers) return null;
    try {
      return describeRecords(readers.city.get(ip), readers.asn.get(ip));
    } catch {
      return null;
    }
  }

  return { lookup };
}

module.exports = { createGeo, describeRecords, isPublicIp, POINTER };
