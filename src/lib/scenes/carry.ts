/**
 * Carrying a scene's working data to the next page: the plate's dots and
 * the scene's props, so the hobby page can pick the scene up without
 * decoding the plate and stippling the props again. Float32 arrays go as
 * base64 of their bytes, so they arrive exactly as they left; the rest as
 * JSON. It goes in sessionStorage under its own key, apart from the landing
 * note, so the page's head script never has to parse it.
 */

/** sessionStorage key for the data; the landing note is LANDING_KEY. */
export const CARRY_KEY = "globe-landing-data";

export function packFloats(a: Float32Array): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x6000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x6000));
  return btoa(text);
}

export function unpackFloats(text: string): Float32Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

interface Packed {
  $f32: string;
}

const isPacked = (v: unknown): v is Packed =>
  typeof v === "object" && v !== null && "$f32" in v;

/** A value made JSON-safe: Float32 arrays packed, everything else as is. */
export function pack(value: unknown): unknown {
  if (value instanceof Float32Array) return { $f32: packFloats(value) };
  if (Array.isArray(value)) return value.map(pack);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, pack(v)]),
    );
  if (typeof value === "function") throw new Error("Can't carry a function.");
  return value;
}

export function unpack(value: unknown): unknown {
  if (isPacked(value)) return unpackFloats(value.$f32);
  if (Array.isArray(value)) return value.map(unpack);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, unpack(v)]),
    );
  return value;
}

export interface Carried {
  /** Which landing it's for: the note's path and time. */
  path: string;
  at: number;
  dots: unknown;
  prep: unknown;
}

/** Leave the data for the next page; false if there's no room for it. */
export function leaveData(data: Carried): boolean {
  try {
    sessionStorage.setItem(
      CARRY_KEY,
      JSON.stringify({ ...data, dots: pack(data.dots), prep: pack(data.prep) }),
    );
    return true;
  } catch {
    try {
      sessionStorage.removeItem(CARRY_KEY);
    } catch {
      // Nothing to clear.
    }
    return false;
  }
}

/** Take the data left for this landing, if it's there; it's used up either way. */
export function takeData(path: string, at: number): Carried | null {
  try {
    const raw = sessionStorage.getItem(CARRY_KEY);
    sessionStorage.removeItem(CARRY_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Carried;
    if (data.path !== path || data.at !== at) return null;
    return { ...data, dots: unpack(data.dots), prep: unpack(data.prep) };
  } catch {
    return null;
  }
}
