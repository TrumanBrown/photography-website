/**
 * Shot identity: one press of the shutter, however many files it became.
 *
 * The archive holds crops, "-1" re-exports, .JPG/.JPEG pairs and the same frame
 * copied into two sessions. "Never post the same photo twice" has to mean the
 * shot, not the file, so files are grouped by camera + capture clock reading
 * (+ sub-second when recorded). Files without a capture time fall back to their
 * perceptual hash, which still catches straight copies.
 */
export const IG_MIN_RATIO = 0.8;
export const IG_MAX_RATIO = 1.91;

export function shotKey(facts, hash) {
  if (facts?.clock) {
    return `${facts.model || "camera"}|${facts.clock}|${facts.subsec || ""}`;
  }
  return `hash:${hash}`;
}

/** Formats the site shows as a JPEG the build makes, which carries no camera data. */
export const CONVERTED =
  /\.(?:heic|heif|tiff?|dng|arw|nef|cr2|cr3|raf|orf|rw2)$/i;

/**
 * A file's camera facts: its own, or for a photo the site shows converted
 * (HEIC, TIFF, RAW), the ones read from its original (`file.capture`).
 * Shot keys deliberately keep using the file's own facts, so a shot that
 * gains a capture time this way keeps its key, and with it its record and
 * its place in the posting history.
 */
export function cameraFacts(file) {
  if (!file) return null;
  if (file.facts?.clock || !file.capture) return file.facts ?? null;
  return { ...file.facts, ...file.capture };
}

/**
 * The original a converted photo was made from: same session folder and
 * name, any converted format. `names` lists the originals container.
 */
export function originalFor(prefix, file, names) {
  const stem =
    `${prefix}/${String(file).replace(/\.[^.]+$/, "")}`.toLowerCase();
  return (
    names.find(
      (n) =>
        CONVERTED.test(n) && n.replace(/\.[^.]+$/, "").toLowerCase() === stem,
    ) ?? null
  );
}

/**
 * How much of a photo Instagram's shape can't hold: the share cropped off to
 * fit it (or, with borders, the share of the frame that's border). 0 when the
 * photo fits as it is.
 */
export function cropFraction(width, height) {
  const r = width / height;
  if (r < IG_MIN_RATIO) return 1 - r / IG_MIN_RATIO;
  if (r > IG_MAX_RATIO) return 1 - IG_MAX_RATIO / r;
  return 0;
}

/**
 * Among the files of one shot, pick the one to post: the version Instagram's
 * shape cuts least (ideally not at all), then the most pixels. Nothing here
 * crops anything; render.mjs crops a frame that doesn't fit when it's posted.
 */
export function chooseVersion(files) {
  return [...files].sort((a, b) => {
    const cut =
      cropFraction(a.width, a.height) - cropFraction(b.width, b.height);
    if (Math.abs(cut) > 0.001) return cut;
    return b.width * b.height - a.width * a.height || a.id.localeCompare(b.id);
  })[0];
}

const clockMs = (clock) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    clock ?? "",
  );
  return m
    ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
    : null;
};

export { clockMs };

/**
 * Burst groups: shots from the same session taken within `gapSeconds` of the
 * previous one. Near-identical frames shouldn't run on consecutive posts.
 */
export function burstGroups(shots, gapSeconds = 60) {
  const bySession = new Map();
  for (const s of shots) {
    const t = clockMs(s.clock);
    if (t == null) continue;
    if (!bySession.has(s.session)) bySession.set(s.session, []);
    bySession.get(s.session).push({ key: s.key, t });
  }
  const groups = new Map();
  for (const [session, list] of bySession) {
    list.sort((a, b) => a.t - b.t);
    let group = null;
    let last = -Infinity;
    for (const item of list) {
      if (item.t - last > gapSeconds * 1000) group = `${session}@${item.t}`;
      groups.set(item.key, group);
      last = item.t;
    }
  }
  return groups;
}
