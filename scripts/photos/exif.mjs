/**
 * Camera facts for one photograph, read from EXIF.
 *
 * Capture time is kept as the camera's own clock reading ("2026-09-04T17:22:40"),
 * never converted through a time zone. Cameras drift and get set to the wrong
 * zone; iNaturalist stores the same clock reading when it reads an uploaded
 * photo, so comparing readings directly is what lines the two up.
 */
import exifr from "exifr";
import sharp from "sharp";

function clockFrom(raw) {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
    String(raw ?? ""),
  );
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

export async function readFacts(buffer) {
  let tags = {};
  let raw = {};
  try {
    tags =
      (await exifr.parse(buffer, {
        tiff: true,
        ifd0: true,
        exif: true,
        gps: true,
        xmp: false,
        icc: false,
        iptc: false,
      })) ?? {};
    raw =
      (await exifr.parse(buffer, {
        pick: ["DateTimeOriginal", "CreateDate", "SubSecTimeOriginal"],
        reviveValues: false,
      })) ?? {};
  } catch {
    // Stripped or synthetic files simply have no facts.
  }
  const clock = clockFrom(raw.DateTimeOriginal) ?? clockFrom(raw.CreateDate);
  return {
    clock,
    subsec:
      raw.SubSecTimeOriginal != null
        ? String(raw.SubSecTimeOriginal).trim()
        : "",
    make: str(tags.Make),
    model: str(tags.Model),
    lens: str(tags.LensModel),
    focalLength: num(tags.FocalLength),
    fNumber: num(tags.FNumber),
    exposureTime: num(tags.ExposureTime),
    iso: num(tags.ISO),
    lat: Number.isFinite(tags.latitude) ? round5(tags.latitude) : null,
    lon: Number.isFinite(tags.longitude) ? round5(tags.longitude) : null,
  };
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round5 = (v) => Math.round(v * 1e5) / 1e5;

/** "ILCE-6700" -> "Sony a6700"; phones and other bodies keep their own names. */
export function cameraName({ make, model }) {
  if (!model) return "";
  const sony = /^ILCE-(\d+)(?:M(\d))?$/i.exec(model);
  if (sony)
    return sony[2] ? `Sony a${sony[1]} Mark ${sony[2]}` : `Sony a${sony[1]}`;
  if (/^ZV-/i.test(model)) return `Sony ${model}`;
  if (/^iphone/i.test(model)) return model;
  if (
    make &&
    !model.toLowerCase().startsWith(make.split(" ")[0].toLowerCase())
  ) {
    const brand = make.replace(
      /\s+(CORPORATION|Corporation|Inc\.?|Co\.,?\s*Ltd\.?)$/,
      "",
    );
    return `${brand.charAt(0).toUpperCase()}${brand.slice(1).toLowerCase()} ${model}`;
  }
  return model;
}

function shutter(t) {
  if (!t) return "";
  if (t >= 1) return `${Number(t.toFixed(1))}s`;
  return `1/${Math.round(1 / t)}s`;
}

/**
 * "Sony a6700 · FE 90mm F2.8 Macro G OSS · f/2.8 · 1/160s · ISO 3200".
 * Zoom lenses also get the focal length used; phone lens strings are dropped.
 */
export function gearLine(facts) {
  if (!facts) return "";
  const camera = cameraName(facts);
  if (!camera) return "";
  const parts = [camera];
  const isPhone = /iphone|pixel|galaxy/i.test(camera);
  const lens =
    facts.lens && !isPhone && !/^-+$/.test(facts.lens) ? facts.lens : "";
  if (lens) {
    const zoom = /\d+-\d+\s*mm/i.test(lens);
    parts.push(
      zoom && facts.focalLength
        ? `${lens} at ${Math.round(facts.focalLength)}mm`
        : lens,
    );
  }
  if (!isPhone) {
    if (facts.fNumber) parts.push(`f/${Number(facts.fNumber.toFixed(1))}`);
    if (facts.exposureTime) parts.push(shutter(facts.exposureTime));
    if (facts.iso) parts.push(`ISO ${facts.iso}`);
  }
  return parts.join(" · ");
}

/** Width and height after EXIF orientation is applied. */
export async function orientedSize(input) {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  return swap
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}
