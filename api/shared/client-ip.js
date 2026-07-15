function clientIp(req) {
  const forwarded = req.headers && req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = String(value || "")
    .split(",")[0]
    .trim();
  if (!first) return "unknown";

  if (first.startsWith("[")) {
    const closingBracket = first.indexOf("]");
    return closingBracket > 1 ? first.slice(1, closingBracket) : "unknown";
  }

  const firstColon = first.indexOf(":");
  const lastColon = first.lastIndexOf(":");
  if (firstColon > -1 && firstColon === lastColon) {
    return first.slice(0, firstColon) || "unknown";
  }

  return first;
}

module.exports = { clientIp };
