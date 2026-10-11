/**
 * Website copy goes where the site already reads it: each session's
 * `_session.json` in the `originals` container, the same file /admin edits.
 *
 * Only `description`, per-photo `caption`s, and a `title` or `location` that's
 * still blank are ever written. Everything else (photo order, cover, banner,
 * showcase) is left exactly as it was.
 *
 * Your edits win. The catalog remembers what the pipeline last wrote to each
 * field, and a later run only replaces text that still matches it, so anything
 * you've changed in /admin stays. `--overwrite` ignores that, once, for
 * replacing copy that was never yours to begin with.
 */
import { humanize } from "./website.mjs";

const SIDECAR = "_session.json";

/** _session.json files in Blob Storage, read and written with ETags so a concurrent /admin save isn't lost. */
export async function blobSidecars({ account, container = "originals" }) {
  const { BlobServiceClient } = await import("@azure/storage-blob");
  const { DefaultAzureCredential } = await import("@azure/identity");
  const client = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    new DefaultAzureCredential(),
  ).getContainerClient(container);
  const blob = (prefix) => client.getBlockBlobClient(`${prefix}/${SIDECAR}`);
  return {
    async read(prefix) {
      try {
        const res = await blob(prefix).download();
        const chunks = [];
        for await (const c of res.readableStreamBody) chunks.push(c);
        return {
          data: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          etag: res.etag,
        };
      } catch (e) {
        if (e?.statusCode === 404) return { data: {}, etag: null };
        throw e;
      }
    },
    async write(prefix, data, etag) {
      const body = `${JSON.stringify(data, null, 2)}\n`;
      await blob(prefix).upload(body, Buffer.byteLength(body), {
        blobHTTPHeaders: { blobContentType: "application/json" },
        conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
      });
    },
  };
}

/** A sidecar entry's published filename: RAW and HEIC sources publish as .jpg. */
export function targetOf(file, targets) {
  if (targets.has(file)) return file;
  const jpg = `${String(file).replace(/\.[^.]+$/, "")}.jpg`;
  return targets.has(jpg) ? jpg : null;
}

/**
 * Merge new website copy into a sidecar.
 *
 * @param sidecar   current _session.json contents ({} when there isn't one)
 * @param slug      the session's URL slug, to recognise an untitled session
 * @param order     the session's photos in display order (published filenames)
 * @param captions  Map of published filename -> caption
 * @param text      { description, title, location }; title and location only
 *                  fill blanks, never replace
 * @param written   what the pipeline last wrote here
 * @param overwrite replace descriptions and captions even if they were edited
 * @returns { sidecar, changed, written, kept } where `kept` counts fields left
 *          alone because someone edited them
 */
export function mergeWebsiteText({
  sidecar = {},
  slug,
  order = [],
  captions = new Map(),
  text = {},
  written = {},
  overwrite = false,
}) {
  const next = structuredClone(sidecar ?? {});
  const was = { captions: {}, ...written };
  const now = { ...was, captions: { ...(was.captions ?? {}) } };
  let kept = 0;
  const ours = (current, last) => !current || current === last || overwrite;

  if (text.description) {
    if (ours(next.description, was.description)) {
      next.description = text.description;
      now.description = text.description;
      delete next.descriptionSource;
    } else if (next.description !== text.description) kept++;
  }
  if (
    text.title &&
    (!next.title || next.title === humanize(slug) || next.title === was.title)
  ) {
    next.title = text.title;
    now.title = text.title;
  }
  if (text.location && (!next.location || next.location === was.location)) {
    next.location = text.location;
    now.location = text.location;
  }

  const targets = new Set(order);
  const place = (file, current) => {
    const caption = captions.get(file);
    if (!caption) return current;
    if (!ours(current, was.captions[file])) {
      if (current !== caption) kept++;
      return current;
    }
    now.captions[file] = caption;
    return caption;
  };
  if (Array.isArray(next.images)) {
    const covered = new Set();
    next.images = next.images.map((entry) => {
      const name = typeof entry === "string" ? entry : entry?.file;
      const target = name ? targetOf(name, targets) : null;
      if (!target || covered.has(target)) return entry;
      covered.add(target);
      const current = typeof entry === "string" ? "" : (entry.caption ?? "");
      const caption = place(target, current);
      if (!caption) return entry;
      return typeof entry === "string"
        ? { file: entry, caption }
        : { ...entry, caption };
    });
    // Photos the list doesn't mention are shown after it, in `order`'s order,
    // so appending them here keeps the page exactly as it was.
    for (const file of order) {
      if (covered.has(file)) continue;
      const caption = place(file, "");
      if (caption) next.images.push({ file, caption });
    }
  } else if (order.some((file) => captions.has(file))) {
    next.images = order.map((file) => {
      const caption = place(file, "");
      return caption ? { file, caption } : file;
    });
  }

  const changed = JSON.stringify(next) !== JSON.stringify(sidecar ?? {});
  return { sidecar: next, changed, written: now, kept };
}
