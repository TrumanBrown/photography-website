/**
 * Deciding the order photos go out in.
 *
 * Not chronological: each next post is the best-scoring photo that doesn't
 * repeat something recent. Constraints, relaxed in steps when nothing fits:
 *   - the same session not within the last day's posts
 *   - the same species not within about five days
 *   - frames from the same burst not within about ten days
 * Score: the analysis's appeal rating, a bump for photos identified to species (they're
 * what people search for), a bump for sessions from the last 45 days, and a
 * small penalty for repeating the previous post's kind of subject. A seeded
 * jitter breaks ties so the order is stable but not alphabetical.
 */
const DAY_MS = 24 * 3600 * 1000;

function jitter(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function facts(key, shot) {
  return {
    key,
    session: shot.session,
    taxon: shot.speciesOk ? shot.inat?.taxon : null,
    burst: shot.burst ?? null,
    group: shot.analysis?.group ?? shot.post?.group ?? null,
    location: shot.location ?? null,
    appeal: Number(shot.analysis?.appeal ?? shot.post?.appeal) || 5,
    speciesOk: Boolean(shot.speciesOk),
    sessionDate: shot.sessionDate ?? null,
  };
}

function violates(c, seq, w) {
  const tail = (n) => (n > 0 ? seq.slice(-n) : []);
  if (tail(w.session).some((s) => s.session === c.session)) return true;
  if (c.taxon && tail(w.taxon).some((s) => s.taxon === c.taxon)) return true;
  if (c.burst && tail(w.burst).some((s) => s.burst === c.burst)) return true;
  return false;
}

function score(c, seq, now) {
  const prev = seq.at(-1);
  const before = seq.at(-2);
  let s = c.appeal;
  if (c.speciesOk) s += 1.5;
  if (c.sessionDate && now - new Date(c.sessionDate) < 45 * DAY_MS) s += 0.5;
  if (prev && c.group && prev.group === c.group) s -= 1;
  // Keep places rotating: several sessions can share one location string.
  if (prev && c.location && prev.location === c.location) s -= 1.5;
  if (before && c.location && before.location === c.location) s -= 0.75;
  return s + jitter(c.key) * 0.6;
}

/** Ready to post now: analysed, written up, and not held back. */
export function isPostable(shot) {
  return shot?.status === "ready" && !shot.skip && !shot.blocked;
}

/** Can go in the plan: analysed and not held back. Its post is written once it's planned. */
export function isPlannable(shot) {
  return (
    (shot?.status === "ready" || shot?.status === "new") &&
    !shot.skip &&
    !shot.blocked
  );
}

/**
 * @param shots    catalog shots, keyed by shot key
 * @param posted   Set of shot keys already published (or failed for good)
 * @param recent   shot keys posted most recently, oldest first
 */
export function planQueue({
  shots,
  posted,
  recent = [],
  count,
  postsPerDay,
  now = new Date(),
}) {
  const remaining = new Map(
    Object.entries(shots)
      .filter(([key, shot]) => isPlannable(shot) && !posted.has(key))
      .map(([key, shot]) => [key, facts(key, shot)]),
  );
  const seq = recent.filter((k) => shots[k]).map((k) => facts(k, shots[k]));
  const steps = [
    { session: postsPerDay, taxon: postsPerDay * 5, burst: postsPerDay * 10 },
    { session: postsPerDay, taxon: postsPerDay * 2, burst: postsPerDay * 3 },
    { session: 1, taxon: 1, burst: 1 },
    { session: 0, taxon: 0, burst: 0 },
  ];
  const picked = [];
  while (picked.length < count && remaining.size) {
    let choice = null;
    for (const w of steps) {
      let best = null;
      for (const c of remaining.values()) {
        if (violates(c, seq, w)) continue;
        const s = score(c, seq, now);
        if (!best || s > best.s || (s === best.s && c.key < best.c.key))
          best = { c, s };
      }
      if (best) {
        choice = best.c;
        break;
      }
    }
    if (!choice) break;
    picked.push(choice.key);
    seq.push(choice);
    remaining.delete(choice.key);
  }
  return picked;
}
