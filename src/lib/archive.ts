import type { CollectionEntry } from "astro:content";
import { sessionSlug } from "./sessions";
import { regionOf } from "./places";
import { coordsFor } from "./geo";
import type { GlobePlace } from "./globe";

type Session = CollectionEntry<"sessions">;
type SessionImage = Session["data"]["images"][number];

/** How far from 3:2 a frame may be and still fill the lead box exactly. */
const LEAD_RATIO = { min: 1.48, max: 1.52 };

function ratio(image: SessionImage): number {
  return image.height > 0 ? image.width / image.height : 0;
}

/**
 * Group sessions into the places the globe can turn to.
 *
 * Sessions sharing a `location` share a pin, so "Limón Province, Costa Rica"
 * is one dot rather than three stacked on top of each other.
 */
export function buildPlaces(sessions: Session[]): GlobePlace[] {
  const byLocation = new Map<string, GlobePlace>();

  for (const entry of sessions) {
    const location = entry.data.location?.trim();
    if (!location) continue;
    const coords = coordsFor(location, entry.data.coords ?? null);
    if (!coords) continue;

    const existing = byLocation.get(location);
    if (existing) {
      existing.slugs.push(sessionSlug(entry));
      continue;
    }
    byLocation.set(location, {
      name: location,
      lat: coords.lat,
      lon: coords.lon,
      region: regionOf(location) ?? "Elsewhere",
      slugs: [sessionSlug(entry)],
    });
  }

  return [...byLocation.values()];
}

/** One photograph in the rotating lead box on the home page. */
export interface LeadItem {
  slug: string;
  title: string;
  location: string;
  image: import("astro").ImageMetadata;
  alt: string;
}

export interface LeadFrame {
  slug: string;
  title: string;
  location: string;
  /** Filename within the session's images/ folder. */
  file: string;
  width: number;
  height: number;
  caption?: string;
}

/**
 * Pick the photographs that rotate at the top of the home page.
 *
 * A session's `showcase` list wins when it has one — that's the admin panel's
 * job. Otherwise one frame is chosen automatically so the rotation works on a
 * fresh archive without anyone curating it first.
 *
 * Only frames close to 3:2 landscape are eligible, because the lead box is a
 * fixed 3:2 and nothing there is allowed to be cropped. Sessions with no such
 * frame simply sit the rotation out.
 */
export function buildLeadFrames(sessions: Session[]): LeadFrame[] {
  const perSession: { region: string; frames: LeadFrame[] }[] = [];

  for (const entry of sessions) {
    const slug = sessionSlug(entry);
    const { title, location, images, showcase } = entry.data;
    const eligible = images.filter((image) => {
      const r = ratio(image);
      return r >= LEAD_RATIO.min && r <= LEAD_RATIO.max;
    });
    if (!eligible.length) continue;

    const picked = showcase?.length
      ? eligible.filter((image) => showcase.includes(image.file))
      : [eligible[Math.floor(eligible.length / 2)]];
    if (!picked.length) continue;

    perSession.push({
      region: regionOf(location ?? "") ?? "Elsewhere",
      frames: picked.map((image) => ({
        slug,
        title,
        location: location ?? "",
        file: image.file,
        width: image.width,
        height: image.height,
        caption: image.caption,
      })),
    });
  }

  // Deal them out region by region, so the first minute on the page shows the
  // range of the archive rather than three straight weeks of one trip.
  const buckets = new Map<string, LeadFrame[]>();
  for (const { region, frames } of perSession) {
    const bucket = buckets.get(region) ?? [];
    bucket.push(...frames);
    buckets.set(region, bucket);
  }

  const lists = [...buckets.values()];
  const out: LeadFrame[] = [];
  for (let i = 0; lists.some((list) => list[i]); i++) {
    for (const list of lists) if (list[i]) out.push(list[i]);
  }
  return out;
}

/** The frame a session card shows: its cover, or the first photograph. */
export function coverFileOf(entry: Session): string {
  return entry.data.cover ?? entry.data.images[0].file;
}
