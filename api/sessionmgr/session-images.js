const MAX_IMAGES = 500;
const MAX_FILENAME = 255;
const MAX_CAPTION = 500;

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

module.exports = { MAX_CAPTION, captionsFromImages, normalizeSessionImages };
