const MAX_IMAGES = 500;
const MAX_FILENAME = 255;
const MAX_CAPTION = 500;

const ORIGINALS_CONTAINER = "originals";
const DERIVATIVES_CONTAINER = "derivatives";
// The formats a browser can display straight from the originals container.
// Everything else (RAW, HEIC, TIFF) is published as a JPEG derivative by
// scripts/prebuild.mjs, under the sanitized slug.
const WEB_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > -1 ? name.slice(dot).toLowerCase() : "";
}

function encodePath(value) {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

/**
 * Public URLs for the full-size frames, keyed by filename.
 *
 * The admin index records the real ones during a build. This rebuilds them the
 * same way for the fallback path that scans originals/ directly, so the admin
 * panel's preview still has something better than a thumbnail to show.
 */
function fullUrls({ blobHost, prefix, thumbSlug, files }) {
  const urls = {};
  if (!blobHost) return urls;

  for (const file of files) {
    const ext = extensionOf(file);
    if (WEB_EXTS.has(ext)) {
      urls[file] =
        `https://${blobHost}/${ORIGINALS_CONTAINER}/` +
        encodePath(`${prefix}/${file}`);
    } else {
      const base = `${file.slice(0, file.length - ext.length)}.jpg`;
      urls[file] =
        `https://${blobHost}/${DERIVATIVES_CONTAINER}/` +
        encodePath(`${thumbSlug}/${base}`);
    }
  }
  return urls;
}

function normalizeSessionImages(value) {
  if (value === undefined) return { images: undefined, errors: [] };
  if (!Array.isArray(value))
    return { images: undefined, errors: ["images must be an array."] };
  if (value.length > MAX_IMAGES) {
    return {
      images: undefined,
      errors: [`images must contain at most ${MAX_IMAGES} entries.`],
    };
  }

  const images = [];
  const errors = [];
  const seen = new Set();

  value.forEach((item, index) => {
    const file = typeof item === "string" ? item : item?.file;
    const caption =
      typeof item === "object" && item !== null ? item.caption : undefined;

    if (typeof file !== "string" || !file.trim()) {
      errors.push(`images[${index}].file must be a non-empty string.`);
      return;
    }

    const normalizedFile = file.trim();
    if (
      normalizedFile.length > MAX_FILENAME ||
      normalizedFile.includes("/") ||
      normalizedFile.includes("\\")
    ) {
      errors.push(`images[${index}].file is invalid.`);
      return;
    }
    if (seen.has(normalizedFile)) {
      errors.push(`images contains duplicate file "${normalizedFile}".`);
      return;
    }
    seen.add(normalizedFile);

    if (caption !== undefined && typeof caption !== "string") {
      errors.push(`images[${index}].caption must be a string.`);
      return;
    }
    if (typeof caption === "string" && caption.length > MAX_CAPTION) {
      errors.push(
        `images[${index}].caption must be at most ${MAX_CAPTION} characters.`,
      );
      return;
    }

    const normalizedCaption = typeof caption === "string" ? caption.trim() : "";
    images.push(
      normalizedCaption
        ? { file: normalizedFile, caption: normalizedCaption }
        : normalizedFile,
    );
  });

  return { images: errors.length ? undefined : images, errors };
}

function captionsFromImages(images) {
  const captions = {};
  if (!Array.isArray(images)) return captions;

  for (const item of images) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.file === "string" &&
      typeof item.caption === "string" &&
      item.caption.trim()
    ) {
      captions[item.file] = item.caption.trim();
    }
  }
  return captions;
}

module.exports = {
  MAX_CAPTION,
  captionsFromImages,
  fullUrls,
  normalizeSessionImages,
};
