// Rules for what /api/track accepts beyond a plain pageview: the `via` tag on
// links Truman hands out (the resume's links carry ?via=resume), and batches of
// Weekdays events from src/lib/analytics.ts. Everything is checked against a
// short pattern or capped, so the only free text stored is up to 100
// characters of text copied from the page itself.

const NAME = /^[a-z0-9][a-z0-9:._-]{0,59}$/;
const KINDS = new Set(["show", "hide", "wd", "reach", "click", "copy"]);
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

module.exports = { cleanEvents, cleanVia, MAX_BATCH };
