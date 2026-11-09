// The resume PDF. staticwebapp.config.json rewrites /Truman-Brown-Resume.pdf
// here, so the address everyone already has keeps working while each open is
// counted, wherever the link was: a `pdf` row with where it came from, the
// network owner and place, and the device (docs/analytics.md, "PDF opens").
// When Slack, Teams or LinkedIn fetch it to preview a pasted link, that's a
// `share` row instead. The file is a copy of public/Truman-Brown-Resume.pdf
// that the build puts next to this file (build-and-deploy.yml).

const fs = require("node:fs");
const path = require("node:path");
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
const LOOKUP_WAIT_MS = 2000;

let pdf;
function loadPdf() {
  if (pdf === undefined) {
    try {
      pdf = fs.readFileSync(path.join(__dirname, "resume.pdf"));
    } catch {
      pdf = null;
    }
  }
  return pdf;
}

async function record(context, req) {
  const headers = req.headers || {};
  const ua = headers["user-agent"] || "";
  const log = (message) => context.log.warn(message);
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
    try {
      await record(context, req);
    } catch {
      // Counting must never stand between someone and the resume.
    }
  }
  context.res = {
    status: 200,
    isRaw: true,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Truman-Brown-Resume.pdf"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
    body: req.method === "HEAD" ? undefined : body,
  };
};
