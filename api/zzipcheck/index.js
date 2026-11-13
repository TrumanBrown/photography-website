// Temporary, pull request preview only: shows which client IP headers Static
// Web Apps hands a managed function, so api/shared/client-ip.js can trust the
// right one. Echoes the caller's own headers back to the caller and nothing
// else. Never merged.

const HIDDEN = /principal|cookie|authorization|token|secret|key/i;
const IPISH = /ip|forward|real|socket|client|^via$|arr|azure|original|disguised|host/i;

module.exports = async function (context, req) {
  const headers = req.headers || {};
  const names = Object.keys(headers).sort();
  const values = {};
  for (const name of names) {
    if (IPISH.test(name) && !HIDDEN.test(name)) values[name] = headers[name];
  }
  context.res = {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({ names, values }, null, 2),
  };
};
