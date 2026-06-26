// Shared, dependency-free hashing for privacy-preserving identifiers.
//
// Used by the analytics beacon (a per-day visitor hash) and the contact form
// rate limiter (a per-IP bucket). No raw IP address is ever stored anywhere;
// only this salted, truncated, non-reversible hash is.
const crypto = require("crypto");

/** UTC calendar day as YYYY-MM-DD. */
function todayUtc(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Salted, truncated SHA-256 of the inputs. Deterministic for the same inputs
 * and not reversible. `bucket` is whatever scope the caller wants to rotate on:
 * a UTC day for analytics (so a visitor cannot be tracked across days), or a
 * fixed label for rate limiting (so the same IP maps to a stable row).
 */
function visitorHash(ip, ua, bucket, salt) {
  return crypto
    .createHash("sha256")
    .update(`${ip}|${ua}|${bucket}|${salt}`)
    .digest("hex")
    .slice(0, 16);
}

module.exports = { todayUtc, visitorHash };
