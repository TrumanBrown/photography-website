// Names the app behind a link-preview fetch. When someone pastes a link into
// Slack, Teams, LinkedIn and the like, that app's servers fetch the page's
// preview image (/api/og) or, for a pasted PDF link, the PDF (/api/resume).
// The fetcher's user agent says which app it was. Search engines fetch the
// same files while indexing, and are named so they aren't counted as shares.

const APPS = [
  // iMessage sends this exact pair, so it has to come before Facebook and X.
  [/facebookexternalhit\/1\.1 Facebot Twitterbot\/1\.0/i, "iMessage"],
  [/Slackbot|Slack-ImgProxy/i, "Slack"],
  [/SkypeUriPreview/i, "Teams"],
  [/MicrosoftPreview/i, "Outlook or Teams"],
  [/LinkedInBot/i, "LinkedIn"],
  [/Discordbot/i, "Discord"],
  [/WhatsApp/i, "WhatsApp"],
  [/TelegramBot/i, "Telegram"],
  [/Twitterbot/i, "X"],
  [/facebookexternalhit|Facebot|meta-externalagent/i, "Facebook"],
  [/redditbot/i, "Reddit"],
  [/Mastodon/i, "Mastodon"],
  [/Pinterest/i, "Pinterest"],
  [/Embedly|Iframely/i, "Link preview service"],
  [/Google-PageRenderer|GoogleImageProxy|Google-Read-Aloud/i, "Google"],
];

const SEARCH =
  /Googlebot|bingbot|BingPreview|DuckDuckBot|YandexBot|Baiduspider|Applebot|PetalBot|Amazonbot|Bytespider|GPTBot|ClaudeBot|PerplexityBot|CCBot|AhrefsBot|SemrushBot|MJ12bot/i;

/** The app's name, "Search engine", or "" for anything else. */
function shareApp(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  if (!ua) return "";
  for (const [pattern, app] of APPS) if (pattern.test(ua)) return app;
  if (SEARCH.test(ua)) return "Search engine";
  return "";
}

module.exports = { shareApp };
