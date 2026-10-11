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

/** How much of the Instagram frame would be border (0 when the photo fits as-is). */
export function padFraction(width, height) {
  const r = width / height;
  if (r < IG_MIN_RATIO) return 1 - r / IG_MIN_RATIO;
  if (r > IG_MAX_RATIO) return 1 - IG_MAX_RATIO / r;
  return 0;
}

/**
 * Among the files of one shot, pick the one to post: the version that needs
 * the least border, then the most pixels. Your own crops are respected as-is;
 * nothing here crops anything.
 */
export function chooseVersion(files) {
  return [...files].sort((a, b) => {
    const pad = padFraction(a.width, a.height) - padFraction(b.width, b.height);
    if (Math.abs(pad) > 0.001) return pad;
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
