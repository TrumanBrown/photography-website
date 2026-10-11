/**
 * Turn an original into the file Instagram receives, without cropping it.
 *
 * Instagram's publishing API only accepts JPEGs between 4:5 and 1.91:1, at most
 * 1440 px wide (anything wider is downscaled on their side) and 8 MB. So:
 *   - the photo is auto-oriented from EXIF first, exactly like the site does;
 *   - it's sent at the full width Instagram keeps (1440 px), never upscaled;
 *   - a frame inside the allowed shape is sent whole, with nothing added;
 *   - a frame outside it gets plain borders (never a crop), black or white to
 *     match its own edges.
 * Output is sRGB, 4:4:4 chroma, quality 95, with camera metadata stripped.
 */
import sharp from "sharp";
import { IG_MAX_RATIO, IG_MIN_RATIO } from "./shots.mjs";

export const IG_MAX_WIDTH = 1440;
export const IG_MAX_BYTES = 8 * 1024 * 1024;

/** Canvas for a w×h photo: the largest Instagram-legal size that needs no upscaling. */
export function canvasFor(width, height, maxWidth = IG_MAX_WIDTH) {
  const r = width / height;
  if (r < IG_MIN_RATIO) {
    const h = Math.min(height, Math.floor(maxWidth / IG_MIN_RATIO));
    return {
      width: Math.ceil(h * IG_MIN_RATIO),
      height: h,
      padded: true,
      side: "x",
    };
  }
  if (r > IG_MAX_RATIO) {
    const w = Math.min(width, maxWidth);
    return {
      width: w,
      height: Math.ceil(w / IG_MAX_RATIO),
      padded: true,
      side: "y",
    };
  }
  const w = Math.min(width, maxWidth);
  let h = Math.round(w / r);
  if (w / h < IG_MIN_RATIO) h = Math.floor(w / IG_MIN_RATIO);
  if (w / h > IG_MAX_RATIO) h = Math.ceil(w / IG_MAX_RATIO);
  return { width: w, height: h, padded: false, side: null };
}

/** Width and height after EXIF orientation is applied. */
export async function orientedSize(input) {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  return swap
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}

/** Black or white, whichever is closer to the edges the border will touch. */
export async function borderColour(input, side) {
  const { data, info } = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(48, 48, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let n = 0;
  const band = 3;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const edge =
        side === "y"
          ? y < band || y >= info.height - band
          : x < band || x >= info.width - band;
      if (!edge) continue;
      const i = (y * info.width + x) * info.channels;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++;
    }
  }
  return sum / n >= 128 ? "#ffffff" : "#000000";
}

export async function renderForInstagram(
  input,
  { padColor = "auto", maxWidth = IG_MAX_WIDTH } = {},
) {
  const { width, height } = await orientedSize(input);
  const canvas = canvasFor(width, height, maxWidth);
  const background = canvas.padded
    ? padColor === "auto"
      ? await borderColour(input, canvas.side)
      : padColor
    : "#000000";

  for (const quality of [95, 92, 88, 84, 80]) {
    const { data, info } = await sharp(input, { failOn: "none" })
      .rotate()
      .resize(canvas.width, canvas.height, {
        fit: "contain",
        background,
        kernel: "lanczos3",
      })
      .withIccProfile("srgb")
      .jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (data.length <= IG_MAX_BYTES) {
      return {
        buffer: data,
        width: info.width,
        height: info.height,
        padded: canvas.padded,
        background: canvas.padded ? background : null,
        quality,
      };
    }
  }
  throw new Error("Rendered image is still over Instagram's 8 MB limit.");
}
