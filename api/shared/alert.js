// Emails Truman while someone is reading his resume (docs/analytics.md, "Email
// alerts"). /api/track calls maybeAlert after storing a batch of events.
//
// Who sets it off, once they're really reading (Weekdays on screen for 15
// seconds, or a click or copy on the front door):
//   - anyone who came in on the resume's links (?via=resume), on any network
//     except a mail scanner's
//   - anyone on a company's own network (orgKind "org"), without the tag
// Microsoft, Google and Amazon ("mixed") only count through the resume rule,
// so coworkers browsing don't set it off.
//
// Limits: one email per network owner and city a day, four an hour, ten a
// day, and never more than six of the hour's shared email budget, so a
// visitor's contact message always gets through (api/contact/notify.js).
//
// Anyone can send /api/track a beacon, so the email never prints anything the
// browser wrote: no copied text, link names, ?via tags or referrer hosts. It
// says what was done as counts ("copied 2 things") and where the visit came
// from in its own words. The admin panel keeps the full detail.

const crypto = require("node:crypto");
const { consumeRateLimit, hasStatus } = require("../contact/rate-limit");
const { hiringSystem } = require("./hiring-system");
const {
  readSettings,
  getClient,
  oneLine,
  SEND_TIMEOUT_MS,
} = require("../contact/notify");

const SITE = "trumanbrown.com";
const ENGAGED_MS = 15000;
const MAX_PER_HOUR = 4;
const MAX_PER_DAY = 10;
const SHARED_CEILING = 6;
const LIMIT_TABLE = "contactratelimit";

const KIND_WORDS = {
  org: "company network",
  mixed: "also a cloud: an employee, a server or a link scanner",
  home: "home or mobile internet",
  relay: "VPN or privacy relay",
  proxy: "company proxy, company hidden",
  cloud: "server or cloud",
};

/**
 * What a batch of events says about how engaged the reader is, as numbers
 * only: time on Weekdays, how many different links were clicked and how many
 * times text was copied. The text itself never leaves this function.
 */
function engagement(events) {
  let weekdaysMs = 0;
  const clicked = new Set();
  let copies = 0;
  for (const event of events || []) {
    if (event.k === "wd")
      weekdaysMs = Math.max(weekdaysMs, Number(event.v) || 0);
    if (event.k === "click") clicked.add(String(event.v));
    if (event.k === "copy") copies += 1;
  }
  return { weekdaysMs, clicks: clicked.size, copies };
}

/** Whether this pageview and batch should email Truman. */
function shouldAlert(pageview, events) {
  if (!pageview) return false;
  const { weekdaysMs, clicks, copies } = engagement(events);
  const engaged = weekdaysMs >= ENGAGED_MS || clicks > 0 || copies > 0;
  if (!engaged) return false;
  if (pageview.via === "resume") return pageview.orgKind !== "scanner";
  return pageview.orgKind === "org";
}

/** One email per network owner and city a day. */
function alertKey(pageview) {
  return `${pageview.org || "unknown network"}|${pageview.city || ""}`;
}

function placeOf(pageview) {
  return [pageview.city, pageview.region, pageview.country]
    .filter(Boolean)
    .join(", ");
}

function deviceOf(pageview) {
  const device = pageview.device
    ? pageview.device[0].toUpperCase() + pageview.device.slice(1)
    : "";
  return [device, pageview.os, pageview.browser].filter(Boolean).join(" · ");
}

/** Where the visit came from, in our own words. The browser sends both the
    tag and the referrer, so neither is printed. */
function sourceOf(pageview) {
  if (pageview.via === "resume") return "a link in your resume";
  if (pageview.via) return "a tagged link";
  if (pageview.ref) return hiringSystem(pageview.ref) || "another site";
  return "typed in, or a link that doesn't say";
}

function counted(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function buildAlert(pageview, events, { from, to }) {
  const { weekdaysMs, clicks, copies } = engagement(events);
  const org = oneLine(pageview.org, 80);
  const place = placeOf(pageview);
  const subject =
    pageview.orgKind === "org" && org
      ? `Someone at ${org} is reading your resume`
      : `Someone from your resume is reading it${pageview.city ? ` in ${oneLine(pageview.city, 60)}` : ""}`;
  const done = [
    weekdaysMs ? `${Math.round(weekdaysMs / 1000)}s on Weekdays` : "",
    clicks ? `clicked ${counted(clicks, "link", "links")}` : "",
    copies ? `copied ${counted(copies, "thing", "things")}` : "",
  ].filter(Boolean);
  const kind = KIND_WORDS[pageview.orgKind];
  const details = [
    `From: ${sourceOf(pageview)}`,
    `Network: ${org || "unknown"}${kind ? ` (${kind})` : ""}`,
    place ? `Place: ${oneLine(place, 120)}` : "",
    deviceOf(pageview) ? `Device: ${deviceOf(pageview)}` : "",
    done.length ? `So far: ${done.join(", ")}` : "",
  ].filter(Boolean);
  const lines = [
    `${subject}.`,
    "",
    ...details,
    "",
    `Every step, and where they go next: https://${SITE}/admin`,
    "You get one of these per network and place a day.",
  ];
  return {
    senderAddress: from,
    recipients: { to: [{ address: to }] },
    content: { subject, plainText: lines.join("\n") },
  };
}

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

// True when another alert may go out now. The first check also claims the
// day's slot for this network and place, so two batches at once can't both send.
async function claimSlot(table, key, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  try {
    await table.createEntity({
      partitionKey: `alert-${day}`,
      rowKey: hashKey(key),
      sentAt: now.toISOString(),
    });
  } catch (error) {
    if (hasStatus(error, 409)) return false;
    throw error;
  }
  const updatedAt = now.toISOString();
  if (
    await consumeRateLimit(table, {
      partitionKey: hour,
      rowKey: "alert-hour",
      maxCount: MAX_PER_HOUR,
      updatedAt,
    })
  )
    return false;
  if (
    await consumeRateLimit(table, {
      partitionKey: `alert-${day}`,
      rowKey: "count",
      maxCount: MAX_PER_DAY,
      updatedAt,
    })
  )
    return false;
  // The contact form's hourly email count (api/contact/index.js, "notify-all").
  if (
    await consumeRateLimit(table, {
      partitionKey: hour,
      rowKey: "notify-all",
      maxCount: SHARED_CEILING,
      updatedAt,
    })
  )
    return false;
  return true;
}

const decided = new Set();

/**
 * Looks up the pageview behind a batch and emails Truman if it qualifies.
 * Never throws. `pageviews` is the pageviews TableClient.
 */
async function maybeAlert({
  pageviews,
  pvid,
  events,
  log,
  env = process.env,
  send,
}) {
  try {
    if (!/^[a-z0-9]{1,40}$/.test(pvid) || decided.has(pvid)) return "skipped";
    const { weekdaysMs, clicks, copies } = engagement(events);
    if (weekdaysMs < ENGAGED_MS && !clicks && !copies) return "skipped";
    const settings = readSettings(env);
    if (!settings) return "skipped";

    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    let pageview = null;
    for (const day of [today, yesterday]) {
      const filter = `PartitionKey eq 'pv-${day.toISOString().slice(0, 10)}' and pvid eq '${pvid}' and type eq 'pv'`;
      for await (const entity of pageviews.listEntities({
        queryOptions: { filter },
      })) {
        pageview = entity;
        break;
      }
      if (pageview) break;
    }
    if (!shouldAlert(pageview, events)) return "skipped";
    decided.add(pvid);

    const TableClient = require("@azure/data-tables").TableClient;
    const limits = TableClient.fromConnectionString(
      env.AZURE_STORAGE_CONNECTION_STRING,
      LIMIT_TABLE,
    );
    await limits.createTable().catch(() => {});
    if (!(await claimSlot(limits, alertKey(pageview)))) return "limited";

    const email = buildAlert(pageview, events, settings);
    const deliver =
      send ||
      ((message) => getClient(settings.connectionString).beginSend(message));
    let timer;
    await Promise.race([
      deliver(email),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("timed out")),
          SEND_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    return "sent";
  } catch (error) {
    log?.(
      `Resume alert failed: ${error && error.message ? error.message : error}`,
    );
    return "failed";
  }
}

module.exports = {
  alertKey,
  buildAlert,
  claimSlot,
  engagement,
  maybeAlert,
  shouldAlert,
  ENGAGED_MS,
};
