/**
 * Turn an original into the file Instagram receives.
 *
 * Instagram's publishing API only accepts JPEGs between 4:5 and 1.91:1, at most
 * 1440 px wide (anything wider is downscaled on their side) and 8 MB. So:
 *   - the photo is auto-oriented from EXIF first, exactly like the site does;
 *   - it's sent at the full width Instagram keeps (1440 px), never upscaled;
 *   - a frame inside the allowed shape is sent whole, with nothing added;
 *   - a frame outside it is cropped to the nearest allowed shape (a 2:3
 *     portrait loses a sixth of its height), from the middle unless one end is
 *     empty (see cropPosition). With SOCIAL_TALL_IMAGES=pad it's kept whole
 *     inside plain borders instead, black or white to match its own edges.
 *     Borders can't follow the viewer's light or dark mode: they're part of
 *     the JPEG, and Instagram has no transparency.
 * Output is sRGB, 4:4:4 chroma, quality 95, with camera metadata stripped.
 */
import sharp from "sharp";
import { IG_MAX_RATIO, IG_MIN_RATIO } from "../photos/shots.mjs";
import { orientedSize } from "../photos/exif.mjs";
import { dhash } from "../photos/hash.mjs";

export const IG_MAX_WIDTH = 1440;
export const IG_MAX_BYTES = 8 * 1024 * 1024;

/** Bump when cropPosition changes, so planned photos get their crops placed again. */
export const CROP_VERSION = 1;

/**
 * The frame Instagram gets for a w×h photo: the largest legal size that needs
 * no upscaling. Inside 4:5 to 1.91:1 the photo keeps its shape. Outside it,
 * fit "crop" trims it to the nearest legal shape (`crop.side` "y" trims the
 * top and bottom, "x" the left and right; `crop.keep` is the photo's height,
 * or width, left after trimming), and fit "pad" keeps it whole with borders
 * on the `side` edges instead (`padded`).
 */
export function canvasFor(
  width,
  height,
  { fit = "crop", maxWidth = IG_MAX_WIDTH } = {},
) {
  const r = width / height;
  if (r < IG_MIN_RATIO && fit === "pad") {
    const h = Math.min(height, Math.floor(maxWidth / IG_MIN_RATIO));
    return {
      width: Math.ceil(h * IG_MIN_RATIO),
      height: h,
      padded: true,
      side: "x",
      crop: null,
    };
  }
  if (r > IG_MAX_RATIO && fit === "pad") {
    const w = Math.min(width, maxWidth);
    return {
      width: w,
      height: Math.ceil(w / IG_MAX_RATIO),
      padded: true,
      side: "y",
      crop: null,
    };
  }
  if (r < IG_MIN_RATIO) {
    const w = Math.min(width, maxWidth);
    const h = Math.floor(w / IG_MIN_RATIO);
    const keep = Math.min(height, Math.round((width * h) / w));
    return {
      width: w,
      height: h,
      padded: false,
      side: null,
      crop: { side: "y", keep },
    };
  }
  if (r > IG_MAX_RATIO) {
    const w = Math.min(Math.floor(height * IG_MAX_RATIO), maxWidth);
    const h = Math.ceil(w / IG_MAX_RATIO);
    const keep = Math.min(width, Math.round((height * w) / h));
    return {
      width: w,
      height: h,
      padded: false,
      side: null,
      crop: { side: "x", keep },
    };
  }
  const w = Math.min(width, maxWidth);
  let h = Math.round(w / r);
  if (w / h < IG_MIN_RATIO) h = Math.floor(w / IG_MIN_RATIO);
  if (w / h > IG_MAX_RATIO) h = Math.ceil(w / IG_MAX_RATIO);
  return { width: w, height: h, padded: false, side: null, crop: null };
}

// cropPosition's tuning, measured on the archive's tall frames and panoramas.
const LOOK = 384; // analysis size, long side
const EDGE = 4; // a Laplacian this strong, in grey levels, is an edge
const BUSY = 0.03; // a row with this share of edge pixels holds something
const ROOM = 0.03; // space left around what's there, as a share of the length
const CENTRE = 0.5; // moving the crop a row off-centre costs half a row of content

/**
 * Where to crop a frame that's outside Instagram's shape, along its long side:
 * 0 keeps the top (or left) edge, 1 the bottom (or right), 0.5 the middle.
 * Null when the frame fits as it is.
 *
 * A row (a column, in a panorama) with edges in it holds something; plain
 * sky, still water and out-of-focus background don't. The crop comes from the
 * middle unless one end is empty and the other isn't, and then it comes off
 * the empty end, stopping a little short of whatever's there. A row that
 * holds something counts the same however busy it is, so a heron's head near
 * the top isn't traded for the tangle of twigs at the bottom.
 */
export async function cropPosition(input, size = null) {
  const { width, height } = size ?? (await orientedSize(input));
  const r = width / height;
  if (r >= IG_MIN_RATIO && r <= IG_MAX_RATIO) return null;
  const tall = r < IG_MIN_RATIO;
  const { data, info } = await sharp(input, { failOn: "none" })
    .rotate()
    .flatten({ background: "#000000" })
    .resize(LOOK, LOOK, { fit: "inside" })
    .greyscale()
    .blur(1)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const len = tall ? h : w;
  const across = tall ? w : h;
  const edges = new Array(len).fill(0);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * c;
      const laplacian =
        4 * data[i] -
        data[i - c] -
        data[i + c] -
        data[i - w * c] -
        data[i + w * c];
      if (Math.abs(laplacian) > EDGE) edges[tall ? y : x]++;
    }
  edges[0] = edges[1];
  edges[len - 1] = edges[len - 2];
  const held = edges.map((n) => Math.min(1, n / (BUSY * across)));
  const room = Math.round(ROOM * len);
  const content = held.map((_, i) =>
    Math.max(...held.slice(Math.max(0, i - room), i + room + 1)),
  );
  const keep = Math.round(len * (tall ? r / IG_MIN_RATIO : IG_MAX_RATIO / r));
  const spare = len - keep;
  if (spare <= 0) return 0.5;
  const before = [0];
  for (const v of content) before.push(before[before.length - 1] + v);
  let best = spare / 2;
  let lowest = Infinity;
  for (let t = 0; t <= spare; t++) {
    const lost = before[t] + before[len] - before[t + keep];
    const cost = lost + CENTRE * Math.abs(t - spare / 2);
    if (cost < lowest - 1e-9) {
      lowest = cost;
      best = t;
    }
  }
  return Math.round((best / spare) * 100) / 100;
}

/** The part of the oriented photo a crop keeps, `at` as from cropPosition. */
function cropRegion(width, height, { side, keep }, at) {
  return side === "y"
    ? { left: 0, top: Math.round(at * (height - keep)), width, height: keep }
    : { left: Math.round(at * (width - keep)), top: 0, width: keep, height };
}

/**
 * A planned photo's crop, worked out once for the catalog: where it sits, and
 * the cropped frame's fingerprint, so the post is still recognised once it's
 * on the account (a fingerprint doesn't survive a crop). It's taken the way
 * the account's posts are fingerprinted: at the 1080 px Instagram serves,
 * uniform edges trimmed. Null when the photo fits as it is.
 */
export async function placeCrop(input, size = null) {
  const { width, height } = size ?? (await orientedSize(input));
  const at = await cropPosition(input, { width, height });
  if (at === null) return null;
  const region = cropRegion(width, height, canvasFor(width, height).crop, at);
  const cropped = await sharp(input, { failOn: "none" })
    .rotate()
    .extract(region)
    .resize({ width: 1080, withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { v: CROP_VERSION, at, hash: await dhash(cropped, { trim: true }) };
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

/**
 * `fit` is "crop" or "pad" (SOCIAL_TALL_IMAGES). `at` is where the catalog
 * placed the crop (placeCrop); without it, the crop is placed here.
 */
export async function renderForInstagram(
  input,
  { fit = "crop", at = null, padColor = "auto", maxWidth = IG_MAX_WIDTH } = {},
) {
  const size = await orientedSize(input);
  const canvas = canvasFor(size.width, size.height, { fit, maxWidth });
  let region = null;
  let position = null;
  if (canvas.crop) {
    position = Number.isFinite(at)
      ? Math.min(1, Math.max(0, at))
      : await cropPosition(input, size);
    region = cropRegion(size.width, size.height, canvas.crop, position);
  }
  const background = canvas.padded
    ? padColor === "auto"
      ? await borderColour(input, canvas.side)
      : padColor
    : "#000000";

  for (const quality of [95, 92, 88, 84, 80]) {
    const photo = sharp(input, { failOn: "none" }).rotate();
    if (region) photo.extract(region);
    const { data, info } = await photo
      .resize(canvas.width, canvas.height, {
        fit: region ? "fill" : "contain",
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
        crop: region ? { side: canvas.crop.side, at: position } : null,
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
