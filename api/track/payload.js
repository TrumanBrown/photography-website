// Rules for what /api/track accepts beyond a plain pageview: the `via` tag on
// links Truman hands out (the resume's links carry ?via=resume), the theme and
// viewport band on a pageview, and batches of events from src/lib/analytics.ts
// (docs/analytics.md lists each kind). Everything is checked against a short
// pattern or capped. The only free text stored is up to 100 characters copied
// from the page itself and the browser's own error messages, cut to 200
// characters with any address reduced to its path.

const NAME = /^[a-z0-9][a-z0-9:._-]{0,59}$/;
const KINDS = new Set([
  "show",
  "hide",
  "wd",
  "reach",
  "click",
  "copy",
  "dwell",
  "vital",
  "err",
  "theme",
  "photo",
  "nn",
  "toy",
]);
const VITALS = new Set(["LCP", "INP", "CLS", "FCP", "TTFB"]);
const PHOTO =
  /^[a-z0-9][a-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._() -]{0,119}$/;
const VIEWPORTS = new Set([
  "<480",
  "480-767",
  "768-1023",
  "1024-1439",
  "1440+",
]);
const MAX_ERROR = 200;
const MAX_BATCH = 20;
const MAX_MS = 60 * 60 * 1000;
const MAX_COPY = 100;

function cleanVia(value) {
  if (typeof value !== "string") return "";
  const via = value.trim().toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(via) ? via : "";
}

function cleanMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_MS) return null;
  return Math.round(ms);
}

function cleanCopy(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COPY);
}

// A browser error message, without control characters and with any URL cut to
// its path, so a query string can never carry anything along.
function cleanError(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\p{Cc}/gu, " ")
    .replace(
      /\b(?:https?|blob|chrome-extension|moz-extension):\/\/[^\s/]+(\/[^\s?#]*)?[^\s]*/gi,
      (_, path) => path || "/",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR);
}

function cleanPath(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    return "";
  return value.split(/[?#]/, 1)[0].slice(0, 150);
}

function cleanTheme(value) {
  return value === "light" || value === "dark" ? value : "";
}

function cleanThemeFrom(value) {
  return value === "device" || value === "choice" ? value : "";
}

function cleanViewport(value) {
  return VIEWPORTS.has(value) ? value : "";
}

function cleanEvent(raw) {
  if (!raw || typeof raw !== "object" || !KINDS.has(raw.k)) return null;
  const t = cleanMs(raw.t);
  if (t === null) return null;
  const event = { k: raw.k, t };
  switch (raw.k) {
    case "show":
    case "hide":
      return event;
    case "wd": {
      const v = cleanMs(raw.v);
      return v === null ? null : { ...event, v };
    }
    case "reach": {
      const n = Number(raw.n);
      if (typeof raw.v !== "string" || !NAME.test(raw.v)) return null;
      if (!Number.isInteger(n) || n < 0 || n > 99) return null;
      return { ...event, v: raw.v, n };
    }
    case "click":
      return typeof raw.v === "string" && NAME.test(raw.v)
        ? { ...event, v: raw.v }
        : null;
    case "copy": {
      const v = cleanCopy(raw.v);
      const s =
        typeof raw.s === "string" && NAME.test(raw.s) ? raw.s : "weekdays";
      return v ? { ...event, v, s } : null;
    }
    case "dwell": {
      const d = cleanMs(raw.d);
      if (typeof raw.v !== "string" || !NAME.test(raw.v) || d === null)
        return null;
      return { ...event, v: raw.v, d };
    }
    case "vital": {
      const d = Number(raw.d);
      if (!VITALS.has(raw.v) || !Number.isFinite(d) || d < 0) return null;
      if (raw.v === "CLS")
        return d > 10
          ? null
          : { ...event, v: raw.v, d: Math.round(d * 1000) / 1000 };
      return d > 120000 ? null : { ...event, v: raw.v, d: Math.round(d) };
    }
    case "err": {
      const v = cleanError(raw.v);
      if (!v) return null;
      const out = { ...event, v };
      const s = cleanPath(raw.s);
      if (s) out.s = s;
      const l = Number(raw.l);
      const c = Number(raw.c);
      if (Number.isInteger(l) && l >= 0 && l < 1e7) out.l = l;
      if (Number.isInteger(c) && c >= 0 && c < 1e7) out.c = c;
      return out;
    }
    case "theme": {
      const v = cleanTheme(raw.v);
      return v ? { ...event, v } : null;
    }
    case "photo": {
      const d = cleanMs(raw.d);
      if (typeof raw.v !== "string" || !PHOTO.test(raw.v) || d === null)
        return null;
      return { ...event, v: raw.v, d, z: raw.z === true };
    }
    case "nn": {
      if (raw.v === "more") return { ...event, v: "more" };
      if (raw.v !== "daily" && raw.v !== "extra") return null;
      const d = Number(raw.d);
      if (!Number.isInteger(d) || d < 0 || d > 100000) return null;
      return { ...event, v: raw.v, d };
    }
    case "toy":
      return typeof raw.v === "string" && NAME.test(raw.v)
        ? { ...event, v: raw.v }
        : null;
    default:
      return null;
  }
}

function cleanEvents(list) {
  if (!Array.isArray(list)) return [];
  const events = [];
  for (const raw of list.slice(0, MAX_BATCH)) {
    const event = cleanEvent(raw);
    if (event) events.push(event);
  }
  return events;
}

module.exports = {
  cleanError,
  cleanEvents,
  cleanTheme,
  cleanThemeFrom,
  cleanViewport,
  cleanVia,
  MAX_BATCH,
};
