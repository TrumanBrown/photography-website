// Emails me a copy of each message from the contact form, through Azure
// Communication Services. The message is already safe in Table Storage by the
// time this runs, so sending is best effort: a failure is logged and the
// visitor still sees "Message sent".
//
// Settings (SWA app settings, never in the repo):
//   CONTACT_EMAIL_CONNECTION_STRING  the Communication Services resource
//   CONTACT_EMAIL_FROM               its sender, DoNotReply@<id>.azurecomm.net
//   CONTACT_NOTIFY_TO                where the copy goes (my inbox)
// Without all three, nothing is sent.

const SITE = "trumanbrown.com";
const MAX_SUBJECT_NAME = 60;
/** Emails a whole hour may send, across every visitor: a ceiling on the bill,
    and the most an Azure-managed sending domain allows anyway. */
const MAX_PER_HOUR = 10;
const SEND_TIMEOUT_MS = 8000;

/** One line, no control characters, so a name can't break the subject. */
function oneLine(value, max) {
  const flat = Array.from(String(value ?? ""), (char) => {
    const code = char.codePointAt(0);
    return code < 32 || code === 127 ? " " : char;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

/** The page the form was sent from, if it looks like a path on the site. */
function cleanPage(page) {
  const value = String(page ?? "").trim();
  return /^\/[\w\-./#%~]*$/.test(value) && value.length <= 300 ? value : "";
}

/** The email for one message: to me, with the visitor as the reply-to. */
function buildNotification(
  { name, email, message, page, submittedAt },
  { from, to },
) {
  const who = oneLine(name, MAX_SUBJECT_NAME) || "someone";
  const where = cleanPage(page);
  const when = new Date(submittedAt || Date.now()).toUTCString();
  const plainText = [
    message,
    "",
    "---",
    `From ${oneLine(name, 200)} <${oneLine(email, 254)}>`,
    `Sent ${when}${where ? ` from https://${SITE}${where}` : ` from ${SITE}`}`,
    "Reply to this email to answer them.",
  ].join("\n");
  return {
    senderAddress: from,
    recipients: { to: [{ address: to }] },
    replyTo: [
      { address: oneLine(email, 254), displayName: oneLine(name, 200) },
    ],
    content: {
      subject: `New message from ${who} on ${SITE}`,
      plainText,
    },
  };
}

/** The three settings, or null when any is missing. */
function readSettings(env = process.env) {
  const connectionString = (env.CONTACT_EMAIL_CONNECTION_STRING || "").trim();
  const from = (env.CONTACT_EMAIL_FROM || "").trim();
  const to = (env.CONTACT_NOTIFY_TO || "").trim();
  return connectionString && from && to ? { connectionString, from, to } : null;
}

let client = null;
let clientFor = "";
// Loaded on first use: a top-level require of an Azure SDK once crashed a
// function at load, and SWA answered 404 with no logs (docs/azure.md).
function getClient(connectionString) {
  if (!client || clientFor !== connectionString) {
    const { EmailClient } = require("@azure/communication-email");
    client = new EmailClient(connectionString);
    clientFor = connectionString;
  }
  return client;
}

/**
 * Send the copy. Resolves to "sent", "skipped" (not configured or over the
 * hourly ceiling) or "failed"; never throws.
 * `limit` is an async function returning true when the ceiling is reached.
 */
async function notify(entry, { env = process.env, limit, log, send } = {}) {
  const settings = readSettings(env);
  if (!settings) return "skipped";
  try {
    if (limit && (await limit(MAX_PER_HOUR))) return "skipped";
  } catch {
    // The ceiling is a guard on cost, not on the message: carry on.
  }
  const email = buildNotification(entry, settings);
  const deliver =
    send ||
    ((message) => getClient(settings.connectionString).beginSend(message));
  try {
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
      `Contact email failed: ${error && error.message ? error.message : error}`,
    );
    return "failed";
  }
}

module.exports = {
  notify,
  buildNotification,
  readSettings,
  cleanPage,
  oneLine,
  MAX_PER_HOUR,
};
