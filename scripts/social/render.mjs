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
import { IG_MAX_RATIO, IG_MIN_RATIO } from "../photos/shots.mjs";
import { orientedSize } from "../photos/exif.mjs";

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

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

/**
 * A story frame: 1080×1920 with nothing added, no text, no stickers. The
 * photo sits whole in the middle, never cropped; where it isn't 9:16, the
 * space around it is a blurred, dimmed copy of the same photo. A 2:3 vertical
 * leaves a band about 150 px deep above and below. sRGB, camera metadata
 * (and location) stripped.
 */
export async function renderStory(input) {
  const source = () =>
    sharp(input, { failOn: "none" })
      .rotate()
      .flatten({ background: "#000000" })
      .toColourspace("srgb");
  const photo = await source()
    .resize(STORY_WIDTH, STORY_HEIGHT, { fit: "inside", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const fill = await source()
    .resize(STORY_WIDTH, STORY_HEIGHT, { fit: "cover" })
    .blur(40)
    .modulate({ brightness: 0.6 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round((STORY_WIDTH - photo.info.width) / 2);
  const top = Math.round((STORY_HEIGHT - photo.info.height) / 2);
  for (const quality of [92, 88, 84, 80]) {
    const data = await sharp(fill.data, { raw: fill.info })
      .composite([{ input: photo.data, raw: photo.info, left, top }])
      .withIccProfile("srgb")
      .jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
    if (data.length <= IG_MAX_BYTES)
      return {
        buffer: data,
        width: STORY_WIDTH,
        height: STORY_HEIGHT,
        photo: { width: photo.info.width, height: photo.info.height },
        quality,
      };
  }
  throw new Error("Rendered story is still over Instagram's 8 MB limit.");
}
