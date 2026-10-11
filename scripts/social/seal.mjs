/**
 * AES-256-GCM sealing for the one secret the poster has to store itself: the
 * refreshed Instagram access token. The key lives only in GitHub secrets
 * (SOCIAL_SECRET_KEY), so a copy of the private storage container alone is not
 * enough to use the token.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

export function keyFromBase64(text) {
  const key = Buffer.from(String(text || "").trim(), "base64");
  if (key.length !== 32) {
    throw new Error(
      "SOCIAL_SECRET_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32).",
    );
  }
  return key;
}

export function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

export function unseal(box, key) {
  if (!box || box.v !== 1) throw new Error("Unrecognised sealed value.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(box.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const text = Buffer.concat([
    decipher.update(Buffer.from(box.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(text);
}

/** Short, non-reversible fingerprint used to notice when the seed token changes. */
export function fingerprint(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
}
