/**
 * Log scrubbing for the photo pipeline and the Instagram poster.
 *
 * The repository and its Actions logs are public, and the account this posts to
 * must not be discoverable from either. Every message they print goes
 * through redact(): registered secrets (tokens, account ids) are replaced, and
 * so is anything shaped like a Graph API id, an access_token parameter, or a
 * signed URL. Callers still avoid printing captions, ids and URLs at all; this
 * is the backstop for error messages that come back from remote APIs.
 */
const secrets = new Set();

/** Remember a value that must never appear in output, and mask it in Actions logs. */
export function registerSecret(value) {
  const text = value == null ? "" : String(value);
  if (text.length < 6 || secrets.has(text)) return;
  secrets.add(text);
  if (process.env.GITHUB_ACTIONS === "true") {
    // The runner swallows this line and masks the value in every later log line.
    process.stdout.write(`::add-mask::${text}\n`);
  }
}

export function redact(input) {
  let text = input instanceof Error ? input.message : String(input);
  for (const secret of secrets) text = text.split(secret).join("***");
  return (
    text
      .replace(
        /(access_token|client_secret|fb_exchange_token)=[^&\s"'<>]+/gi,
        "$1=***",
      )
      .replace(
        /([?&](sig|skoid|sktid|skt|ske|sks|skv|se|st|sv|sp|sr)=)[^&\s"'<>]+/gi,
        "$1***",
      )
      // Graph API object ids (accounts, containers, media) are long digit runs.
      .replace(/\b\d{11,}\b/g, "<id>")
      // Entra ID access tokens (JWTs).
      .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<jwt>")
      // Model-provider errors can echo organisation/project ids or key prefixes.
      .replace(
        /\b(org|proj|sk|sk-ant|sk-proj)[-_][A-Za-z0-9_-]{6,}/g,
        "<redacted>",
      )
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***")
  );
}

export function info(message) {
  console.log(redact(message));
}

export function warn(message) {
  console.warn(redact(message));
}

/** For tests. */
export function _resetSecrets() {
  secrets.clear();
}
