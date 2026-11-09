// Where /api/og may send a preview fetch: an image on the site itself, or on
// the site's own Blob storage. Anything else is refused, so the function can't
// be used to bounce people to another site.

const IMAGE_PATH = /^\/[A-Za-z0-9._~%/-]+\.(?:jpe?g|png|webp|avif|gif)$/i;

function blobHostFrom(connectionString) {
  const match = /(?:^|;)AccountName=([a-z0-9]{3,24})(?:;|$)/.exec(
    connectionString || "",
  );
  return match ? `${match[1]}.blob.core.windows.net` : "";
}

function imageTarget(value, blobHost) {
  if (typeof value !== "string" || !value) return null;
  if (value.startsWith("/")) {
    return !value.startsWith("//") &&
      IMAGE_PATH.test(value) &&
      !value.includes("..")
      ? value
      : null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !blobHost || url.hostname !== blobHost)
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

module.exports = { blobHostFrom, imageTarget };
