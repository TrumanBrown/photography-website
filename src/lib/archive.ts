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
    const coords = coordsFor(location);
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
  /** Alt text: the fuller line when the pipeline wrote one, else the caption. */
  alt?: string;
}

/**
 * Pick the photographs that rotate at the top of the home page.
 *
 * Only frames picked in the admin panel (a session's `showcase`) go in. A
 * session with nothing picked sits the rotation out rather than having a frame
 * chosen for it, and with nothing picked anywhere the home page goes without a
 * lead photo.
 *
 * A pick still has to be close to 3:2 landscape, because the lead box is a
 * fixed 3:2 and nothing there is allowed to be cropped.
 */
export function buildLeadFrames(sessions: Session[]): LeadFrame[] {
  const perSession: { region: string; frames: LeadFrame[] }[] = [];

  for (const entry of sessions) {
    const slug = sessionSlug(entry);
    const { title, location, images, showcase } = entry.data;
    if (!showcase?.length) continue;

    const picked = images.filter((image) => {
      const r = ratio(image);
      return showcase.includes(image.file) && r >= LEAD_RATIO.min && r <= LEAD_RATIO.max;
    });
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
        alt: image.alt || image.caption,
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

export interface SitePhoto {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * The photo that stands for the site (`sitePhoto` in site.config.ts). If it
 * isn't in the archive, as on a fresh clone or after a session is renamed,
 * the newest session's cover stands in. `sessions` is newest first.
 */
export function sitePhotoOf(
  sessions: Session[],
  pin: { session: string; file: string },
): SitePhoto | undefined {
  const pinned = sessions.find((entry) => sessionSlug(entry) === pin.session);
  const image = pinned?.data.images.find((i) => i.file === pin.file);
  if (pinned && image?.fullUrl) return photoOf(pinned, image);
  const newest = sessions[0];
  const cover = newest?.data.images.find((i) => i.file === coverFileOf(newest));
  if (!newest || !cover?.fullUrl) return undefined;
  return {
    ...photoOf(newest, cover),
    alt: `${newest.data.title} cover photograph`,
  };
}

function photoOf(entry: Session, image: SessionImage): SitePhoto {
  return {
    src: image.fullUrl ?? "",
    alt: image.alt || image.caption || `${entry.data.title} photograph`,
    width: image.width,
    height: image.height,
  };
}
