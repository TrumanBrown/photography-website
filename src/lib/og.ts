/**
 * Preview images (og:image) for links pasted into Slack, Teams, LinkedIn and
 * the like. Every page's preview goes through /api/og, which notes which app
 * fetched it and redirects to the image (docs/analytics.md, "Link shares").
 * Pages without a photo of their own use the front door's.
 */
import { getCollection } from "astro:content";
import { sortSessions } from "./sessions";
import { sitePhotoOf, type SitePhoto } from "./archive";
import { siteConfig } from "../../site.config";

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

let fallback: Promise<SitePhoto | undefined> | undefined;

/** The front door's photo: `sitePhoto` in site.config.ts. */
export function defaultPreview(): Promise<SitePhoto | undefined> {
  fallback ??= getCollection("sessions").then((all) =>
    sitePhotoOf(sortSessions(all), siteConfig.sitePhoto),
  );
  return fallback;
}
