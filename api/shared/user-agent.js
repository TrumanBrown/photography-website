// Coarse device, system and browser from a user-agent string, for the admin
// panel's visit rows. Deliberately rough: three device classes and the main
// browser families, nothing that narrows a visitor down further.

function deviceOf(ua) {
  if (/iPad|Tablet|Silk|Kindle|PlayBook/i.test(ua)) return "tablet";
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return "phone";
  return "desktop";
}

function osOf(ua) {
  if (/Windows/i.test(ua)) return "Windows";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "";
}

function browserOf(ua) {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/LinkedInApp/i.test(ua)) return "LinkedIn app";
  if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "";
}

function describeAgent(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  if (!ua) return { device: "", os: "", browser: "" };
  return { device: deviceOf(ua), os: osOf(ua), browser: browserOf(ua) };
}

module.exports = { describeAgent };
