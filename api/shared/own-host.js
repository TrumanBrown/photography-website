// Whether a referrer host is the site itself. The Functions don't always see
// the public host in `Host`, so the domain is listed too.
const { canonicalHost } = require("./referrer");

const SITE = "trumanbrown.com";

function isOwnHost(host, req) {
  const value = canonicalHost(host);
  if (!value) return false;
  const headers = (req && req.headers) || {};
  return (
    value === SITE ||
    value === canonicalHost(headers["x-forwarded-host"] || "") ||
    value === canonicalHost(headers.host || "")
  );
}

module.exports = { isOwnHost, SITE };
