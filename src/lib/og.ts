/**
 * Preview images (og:image) for links pasted into Slack, Teams, LinkedIn and
 * the like. Every page's preview goes through /api/og, which notes which app
 * fetched it and redirects to the image (docs/analytics.md, "Link shares").
 * Pages without a photo of their own use the front door's.
 */
import { getCollection } from "astro:content";
import { sortSessions } from "./sessions";
import { coverFileOf } from "./archive";

/** The address apps fetch for a page's preview image. */
export function previewUrl(
  siteOrigin: string | URL,
  pagePath: string,
  image: string,
): string {
  const url = new URL("/api/og", siteOrigin);
  url.searchParams.set("p", pagePath);
  url.searchParams.set("i", image);
  return url.toString();
}

let fallback: Promise<{ src?: string; alt?: string }> | undefined;

/** The front door's photo: the newest session's cover. */
export function defaultPreview(): Promise<{ src?: string; alt?: string }> {
  fallback ??= getCollection("sessions").then((all) => {
    const first = sortSessions(all)[0];
    const cover = first?.data.images.find(
      (image) => image.file === coverFileOf(first),
    );
    return {
      src: cover?.fullUrl,
      alt: first ? `${first.data.title} cover photograph` : undefined,
    };
  });
  return fallback;
}
