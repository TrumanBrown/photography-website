import type { CollectionEntry } from "astro:content";

type Session = CollectionEntry<"sessions">;

/**
 * Group sessions by the place they were shot, so the archive has a way in
 * besides "newest first".
 *
 * The region is the last comma-separated part of a session's `location`, which
 * is written broadest-last ("Limón Province, Costa Rica" → Costa Rica,
 * "Eastern Washington" → Washington). That keeps the grouping driven by the
 * metadata rather than a hand-maintained list that drifts as sessions are added.
 */
export function regionOf(location: string): string | undefined {
  const last = location.split(",").pop()?.trim();
  if (!last) return undefined;
  // "Eastern Washington" and "Washington" should land in the same bucket.
  const words = last.split(/\s+/);
  const tail =
    words.length > 1 && /^(eastern|western|northern|southern)$/i.test(words[0])
      ? words.slice(1).join(" ")
      : last;
  return tail || undefined;
}

export function regionSlug(region: string): string {
  return region
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type RegionGroup = {
  region: string;
  slug: string;
  sessions: Session[];
};

/**
 * Build one group per region, largest first. Regions with a single session are
 * dropped: a hub page listing one link adds a crawlable URL with no content of
 * its own, which is the thin-content pattern worth avoiding.
 */
export function groupByRegion(
  sessions: Session[],
  minSessions = 2,
): RegionGroup[] {
  const byRegion = new Map<string, Session[]>();
  for (const entry of sessions) {
    const region = regionOf(entry.data.location ?? "");
    if (!region) continue;
    const bucket = byRegion.get(region) ?? [];
    bucket.push(entry);
    byRegion.set(region, bucket);
  }

  return [...byRegion.entries()]
    .filter(([, list]) => list.length >= minSessions)
    .map(([region, list]) => ({
      region,
      slug: regionSlug(region),
      sessions: list,
    }))
    .sort(
      (a, b) =>
        b.sessions.length - a.sessions.length ||
        a.region.localeCompare(b.region),
    );
}

export function countLine(group: RegionGroup): string {
  const photos = group.sessions.reduce(
    (total, s) => total + s.data.images.length,
    0,
  );
  const sessionWord = group.sessions.length === 1 ? "session" : "sessions";
  const photoWord = photos === 1 ? "photograph" : "photographs";
  return `${group.sessions.length} ${sessionWord} · ${photos} ${photoWord}`;
}
