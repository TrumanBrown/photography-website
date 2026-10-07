import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { sessionSlug, sortSessions } from "@/lib/sessions";
import { siteConfig } from "../../site.config";

/**
 * Image sitemap for the full-resolution originals.
 *
 * The gallery thumbnails are plain <img src> tags that Google finds by normal
 * crawling, but the full-resolution files only ever appear as lightbox <a>
 * hrefs, which is not a discovery path Google uses for Image Search. Declaring
 * them here is the documented way to surface them.
 *
 * Google deprecated <image:caption>, <image:title>, <image:geo_location> and
 * <image:license> in 2022, so <image:loc> is the only element still read.
 * Cross-domain image URLs (the Blob Storage host) are explicitly allowed.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const GET: APIRoute = async ({ site }) => {
  const origin = site ?? new URL(`https://${siteConfig.domain}`);
  const sessions = sortSessions(await getCollection("sessions"));

  const entries = sessions
    .map((entry) => {
      // Trailing slash matches the canonical URL (Astro trailingSlash: 'always').
      const loc = new URL(`/sessions/${sessionSlug(entry)}/`, origin).toString();
      const images = entry.data.images
        .map((image) => image.fullUrl)
        .filter((url): url is string => Boolean(url))
        .map(
          (url) =>
            `    <image:image><image:loc>${escapeXml(url)}</image:loc></image:image>`,
        );

      // A <url> with no images carries no information an image sitemap can use.
      if (images.length === 0) return "";
      return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n${images.join("\n")}\n  </url>`;
    })
    .filter(Boolean);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join("\n")}
</urlset>
`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
