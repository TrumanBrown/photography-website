import type { CollectionEntry } from "astro:content";
import { coverFileOf } from "../archive";
import { formatDate, sessionSlug, splitSessionTitle } from "../sessions";

type Session = CollectionEntry<"sessions">;
export type Hike = NonNullable<
  CollectionEntry<"hobbies">["data"]["trails"]
>["hikes"][number];

/** One card under "Trails I've walked" on the hiking page. */
export interface TrailCard {
  slug: string;
  /** The session's title without its month ("Gunn Peak, Washington"). */
  place: string;
  /** YYYY-MM-DD, and as the session page prints it ("June 13, 2026"). */
  date: string;
  dateText: string;
  /** The photograph the card shows, a file in the session's images. */
  file: string;
  alt: string;
  /** Miles and gain as Truman gave them, or "" when he gave neither. */
  stats: string;
}

/** "9.5 mi · 4,300 ft gain", from the numbers given and nothing else. */
export function trailStats({
  miles,
  gainFt,
}: Pick<Hike, "miles" | "gainFt">): string {
  return [
    miles
      ? `${miles.toLocaleString("en-US", { maximumFractionDigits: 1 })} mi`
      : "",
    gainFt ? `${gainFt.toLocaleString("en-US")} ft gain` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The hikes whose sessions are in this build, newest first. A hike whose
 * session isn't here (a fixture build, or a session renamed since) is left
 * out, and a `photo` its session doesn't have falls back to the cover, each
 * with a warning in the build log.
 */
export function trailCards(
  hikes: Hike[],
  sessions: Session[],
  warn: (message: string) => void = console.warn,
): TrailCard[] {
  const bySlug = new Map(sessions.map((entry) => [sessionSlug(entry), entry]));
  const missing: string[] = [];
  const cards: TrailCard[] = [];
  for (const hike of hikes) {
    const entry = bySlug.get(hike.session);
    if (!entry) {
      missing.push(hike.session);
      continue;
    }
    const { title, date, images } = entry.data;
    let photo = images.find((image) => image.file === hike.photo);
    if (hike.photo && !photo)
      warn(
        `Trails I've walked: ${hike.session} has no photo ${hike.photo}, so its card shows the cover.`,
      );
    photo ??=
      images.find((image) => image.file === coverFileOf(entry)) ?? images[0];
    const place = splitSessionTitle(title).label;
    cards.push({
      slug: hike.session,
      place,
      date,
      dateText: formatDate(date),
      file: photo.file,
      alt: photo.alt || photo.caption || place,
      stats: trailStats(hike),
    });
  }
  if (missing.length)
    warn(
      `Trails I've walked: left out ${missing.length} hike(s) whose session isn't in this build: ${missing.join(", ")}.`,
    );
  return cards.sort((a, b) => b.date.localeCompare(a.date));
}
