/**
 * When to post. Pure functions, no dependencies, so the workflow's cheap
 * "is anything due?" check can run before npm install.
 *
 * GitHub's scheduler drops and delays runs, so the workflow fires every half
 * hour and this decides. Posts are a daily quota with pacing: post number N
 * becomes due at slot N's time and stays due until it's done, the day ends,
 * or the minimum gap since the last post hasn't passed yet. A dropped run just
 * means the next one catches up.
 */
import { clockMinutes } from "./settings.mjs";

export function localParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(
    fmt.formatToParts(date).map((x) => [x.type, x.value]),
  );
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

export function previousDay(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const IN_FLIGHT = new Set(["claimed", "container"]);

/** Attempts that use up one of today's posts. Dry runs count only while not live. */
export function countsToward(attempt, live) {
  return (
    attempt.state === "published" ||
    IN_FLIGHT.has(attempt.state) ||
    (!live && attempt.state === "dry-run")
  );
}

export function lastPostAt(day, live) {
  const times = (day?.attempts ?? [])
    .filter((a) => countsToward(a, live))
    .map((a) => a.publishedAt ?? a.claimedAt)
    .filter(Boolean)
    .sort();
  return times.at(-1) ?? null;
}

export function decide({ now, settings, day }) {
  const { minutes } = localParts(now, settings.timezone);
  if (day?.pausedUntil && now < new Date(day.pausedUntil)) {
    return { due: false, reason: "paused after a failed attempt" };
  }
  const used = (day?.attempts ?? []).filter((a) =>
    countsToward(a, settings.live),
  ).length;
  if (used >= settings.postsPerDay)
    return { due: false, reason: "today's posts are done" };
  const slot = clockMinutes(settings.slots[used] ?? settings.slots.at(-1));
  if (minutes < slot)
    return { due: false, reason: "the next slot is later today" };
  if (minutes >= settings.dayEnd)
    return { due: false, reason: "the posting day is over" };
  const last = lastPostAt(day, settings.live);
  if (last && now - new Date(last) < settings.minGapMinutes * 60000) {
    return { due: false, reason: "too soon after the last post" };
  }
  return { due: true, slot: used };
}
