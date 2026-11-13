// The visitor's IP address, for the contact form's rate limit and the
// analytics hash and network lookup. It's never stored.
//
// Static Web Apps passes on whatever client IP headers a browser makes up:
// X-Forwarded-For, X-Azure-ClientIP, X-Client-IP, X-Real-IP and Forwarded all
// reach the function as sent. Its edge then appends the address it saw to
// X-Forwarded-For, and App Service's front end appends the edge's own address,
// which it also puts in Client-IP, overwriting any the browser sent. So the
// visitor is the last X-Forwarded-For entry once the edge's is dropped, and
// everything before it is ignored. Checked on a preview environment on
// 2026-11-12 (docs/security.md, "Where the client IP comes from").

function headerText(value) {
  return Array.isArray(value) ? value.join(",") : String(value ?? "");
}

/** The address in one X-Forwarded-For entry, without its port or brackets. */
function addressOf(entry) {
  if (entry.startsWith("[")) {
    const closingBracket = entry.indexOf("]");
    return closingBracket > 1 ? entry.slice(1, closingBracket) : "";
  }
  const firstColon = entry.indexOf(":");
  const lastColon = entry.lastIndexOf(":");
  if (firstColon > -1 && firstColon === lastColon) {
    return entry.slice(0, firstColon);
  }
  return entry;
}

function clientIp(req) {
  const headers = (req && req.headers) || {};
  const hops = headerText(headers["x-forwarded-for"])
    .split(",")
    .map((entry) => addressOf(entry.trim()))
    .filter(Boolean);
  const edge = addressOf(headerText(headers["client-ip"]).trim());
  if (hops.length > 1 && edge && hops[hops.length - 1] === edge) hops.pop();
  return hops[hops.length - 1] || "unknown";
}

module.exports = { clientIp };
