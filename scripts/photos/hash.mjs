/**
 * Perceptual "difference hash" fingerprints.
 *
 * A dHash survives resizing and recompression, which is what's needed to find
 * the same frame on iNaturalist (re-encoded, 240 px) or already on Instagram.
 * It does not survive crops; shot identity (camera + capture time) handles
 * those.
 *
 * Each hash is 128 bits (32 hex chars): 64 horizontal gradient bits plus 64
 * vertical ones. Horizontal bits alone put different shots from different
 * trips within 5 bits of each other (dark-background macro frames look alike
 * to it); the vertical half separates them.
 */
import sharp from "sharp";

function bitsToHex(bits) {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += (
      (bits[i] << 3) |
      (bits[i + 1] << 2) |
      (bits[i + 2] << 1) |
      bits[i + 3]
    ).toString(16);
  }
  return hex;
}

export async function dhash(input, { trim = false } = {}) {
  // Strip uniform borders first, so a padded copy hashes like the original.
  const src = trim
    ? await sharp(input, { failOn: "none" })
        .rotate()
        .trim({ threshold: 24 })
        .toBuffer()
    : input;
  const grid = (w, h) =>
    sharp(src, { failOn: "none" })
      .rotate()
      .greyscale()
      .resize(w, h, { fit: "fill" })
      .raw()
      .toBuffer();
  const [hp, vp] = await Promise.all([grid(9, 8), grid(8, 9)]);
  const bits = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      bits.push(hp[y * 9 + x] > hp[y * 9 + x + 1] ? 1 : 0);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      bits.push(vp[y * 8 + x] > vp[(y + 1) * 8 + x] ? 1 : 0);
  return bitsToHex(bits);
}

function popcount32(n) {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return Math.imul((n + (n >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** Bits that differ between two equal-length hex hashes (Infinity if they can't be compared). */
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let bits = 0;
  for (let i = 0; i < a.length; i += 8) {
    bits += popcount32(
      (parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0,
    );
  }
  return bits;
}
