// A page's preview image (og:image), by way of a redirect. When someone pastes
// a link to the site into Slack, Teams, LinkedIn and the like, the app fetches
// this to draw the preview, and its user agent says which app it was. Each
// fetch is a `share` row (docs/analytics.md, "Link shares"). The image itself
// is served by Blob or the site, as before.
//
// GET /api/og?p=<page path>&i=<image path or Blob URL>

const { shareApp } = require("../shared/share-app");
const { cleanPage, writeRow } = require("../shared/rows");
const { blobHostFrom, imageTarget } = require("./target");

module.exports = async function (context, req) {
  const query = req.query || {};
  const target = imageTarget(
    query.i,
    blobHostFrom(process.env.AZURE_STORAGE_CONNECTION_STRING),
  );
  if (!target) {
    context.res = { status: 404, headers: { "Cache-Control": "no-store" } };
    return;
  }
  if (req.method === "GET") {
    const ua = (req.headers && req.headers["user-agent"]) || "";
    const app = shareApp(ua);
    await writeRow(
      "share",
      {
        app: app || "Other",
        page: cleanPage(query.p),
        // Only for fetchers not named yet, so the list can grow.
        agent: app ? "" : ua.slice(0, 120),
      },
      (message) => context.log.warn(message),
    );
  }
  context.res = {
    status: 302,
    headers: { Location: target, "Cache-Control": "public, max-age=300" },
  };
};
