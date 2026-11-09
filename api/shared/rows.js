// Row keys and the small extra row types (`share`, `pdf`) written to the
// pageviews table next to pageviews, so the admin's one analytics query reads
// them too (docs/analytics.md, "Storage").

const { todayUtc } = require("./visitor-hash");

function partitionKey(date = todayUtc()) {
  return `pv-${date}`;
}

// Newest first: the key starts with a reversed timestamp, as pageviews do.
function rowKey(type, now = Date.now()) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${String(9999999999999 - now).padStart(13, "0")}-${random}-${type}`;
}

function cleanPage(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    return "/";
  return value.split(/[?#]/, 1)[0].slice(0, 300) || "/";
}

let TableClient;
function pageviewsTable() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return null;
  if (!TableClient) TableClient = require("@azure/data-tables").TableClient;
  return TableClient.fromConnectionString(conn, "pageviews");
}

/** Writes one row; never throws. */
async function writeRow(type, fields, log) {
  try {
    const table = pageviewsTable();
    if (!table) return false;
    await table.createEntity({
      partitionKey: partitionKey(),
      rowKey: rowKey(type),
      type,
      ...fields,
    });
    return true;
  } catch (error) {
    if (error && error.statusCode === 404) {
      try {
        await pageviewsTable().createTable();
        await pageviewsTable().createEntity({
          partitionKey: partitionKey(),
          rowKey: rowKey(type),
          type,
          ...fields,
        });
        return true;
      } catch {}
    }
    log?.(
      `${type} row failed: ${error && error.message ? error.message : error}`,
    );
    return false;
  }
}

module.exports = { cleanPage, partitionKey, rowKey, writeRow };
