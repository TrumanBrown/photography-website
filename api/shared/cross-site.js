// Whether the visitor's browser says another website started this request.
//
// Any page can make its visitors' browsers POST here: a no-cors fetch,
// sendBeacon or a form sends text/plain, and the Functions still parse a JSON
// body sent that way. The request then carries that visitor's address, so a
// stranger's page could plant pageviews and resume alerts from its readers'
// companies, send contact messages from their networks, or start a rebuild
// with Truman's admin cookie. Browsers have sent Sec-Fetch-Site since 2023 and
// a page can't set it. A request without it (curl, a server, an older
// browser) passes as before.

function fromOtherSite(req) {
  const value = ((req && req.headers) || {})["sec-fetch-site"];
  return String(value ?? "").toLowerCase() === "cross-site";
}

module.exports = { fromOtherSite };
