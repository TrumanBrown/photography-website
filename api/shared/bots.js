// User agents that aren't people: crawlers, link-preview fetchers, uptime
// monitors and scripts. Their requests never count as visits.
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|preview|monitor|curl|wget|python-requests|headless/i;

function isBot(userAgent) {
  return BOT_RE.test(typeof userAgent === "string" ? userAgent : "");
}

module.exports = { isBot };
