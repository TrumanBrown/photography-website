// The resume PDF. staticwebapp.config.json rewrites /Truman-Brown-Resume.pdf
// here, so the address everyone already has keeps working while each open is
// counted, wherever the link was: a `pdf` row with where it came from, the
// network owner and place, and the device (docs/analytics.md, "PDF opens").
// When Slack, Teams or LinkedIn fetch it to preview a pasted link, that's a
// `share` row instead. The file is a copy of public/Truman-Brown-Resume.pdf
// that the build puts next to this file (build-and-deploy.yml).
//
// The PDF goes out before the open is counted, and a browser that already has
// it gets a 304. When the response waited on the count, the new tab sat blank
// for seconds on any process that hadn't loaded the lookup or the Table SDK.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { shareApp } = require("../shared/share-app");
const { isBot } = require("../shared/bots");
const { clientIp } = require("../shared/client-ip");
const { externalReferrerHost, canonicalHost } = require("../shared/referrer");
const { describeAgent } = require("../shared/user-agent");
const { lookupPlace } = require("../shared/geo-service");
const { isOwnHost } = require("../shared/own-host");
const { writeRow } = require("../shared/rows");
const { cleanVia } = require("../track/payload");

const PAGE = "/Truman-Brown-Resume.pdf";
// Long enough for a cold load (about five seconds), since nobody waits on it.
const LOOKUP_WAIT_MS = 10000;
const COUNT_AFTER_MS = 1000;

let pdf;
let etag;
function loadPdf() {
  if (pdf === undefined) {
    try {
      pdf = fs.readFileSync(path.join(__dirname, "resume.pdf"));
      const hash = crypto.createHash("sha256").update(pdf).digest("base64url");
      etag = `"${hash.slice(0, 22)}"`;
    } catch {
      pdf = null;
    }
  }
  return pdf;
}

function alreadyHas(req) {
  const asked = (req.headers || {})["if-none-match"];
  if (typeof asked !== "string") return false;
  return asked
    .split(",")
    .some(
      (tag) => tag.trim().replace(/^W\//, "") === etag || tag.trim() === "*",
    );
}

async function record(req, log) {
  const headers = req.headers || {};
  const ua = headers["user-agent"] || "";
  const app = shareApp(ua);
  if (app && app !== "Search engine") {
    await writeRow("share", { app, page: PAGE, agent: "" }, log);
    return;
  }
  if (app || isBot(ua)) return;
  const referrer = headers.referer || headers.referrer || "";
  const fromSite = isOwnHost(referrer, req);
  const place = await lookupPlace(clientIp(req), {
    waitMs: LOOKUP_WAIT_MS,
    log,
  });
  await writeRow(
    "pdf",
    {
      via: cleanVia((req.query || {}).via),
      ref: fromSite
        ? canonicalHost(referrer)
        : externalReferrerHost(referrer, headers.host || ""),
      fromSite,
      ...(place || {}),
      ...describeAgent(ua),
    },
    log,
  );
}

module.exports = async function (context, req) {
  const body = loadPdf();
  if (!body) {
    context.res = {
      status: 404,
      headers: { "Cache-Control": "no-store" },
      body: "Not found",
    };
    return;
  }
  if (req.method === "GET") {
    // Counting must never stand between someone and the resume. It waits a
    // second after the response is handed back, so nothing heavy runs in the
    // process while the file is still going out. The first count on a process
    // loads the Table SDK, a second or more on the Functions' disk. The
    // context can't log once the call has ended.
    setTimeout(() => {
      record(req, (message) => console.warn(message)).catch(() => {});
    }, COUNT_AFTER_MS);
  }
  const headers = {
    "Content-Type": "application/pdf",
    "Content-Disposition": 'inline; filename="Truman-Brown-Resume.pdf"',
    // Every open still comes here to be counted, but a browser that already
    // has this copy gets a 304 instead of the whole file again, which a phone
    // on a slow connection notices.
    "Cache-Control": "no-cache",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (alreadyHas(req)) {
    context.res = { status: 304, headers };
    return;
  }
  context.res = {
    status: 200,
    isRaw: true,
    headers,
    body: req.method === "HEAD" ? undefined : body,
  };
};
