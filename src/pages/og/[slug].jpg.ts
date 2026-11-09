/**
 * Each hobby's stipple drawing as a link preview image (/og/<slug>.jpg). The
 * drawings are transparent WebP, which LinkedIn won't take and which would
 * show dark dots on a dark chat background, so this flattens them onto the
 * paper colour as a 1200 x 630 JPEG at build time.
 */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { hobbySlug } from "@/lib/hobbies";

const PAPER = "#fbfaf8";

function platePath(slug: string): string {
  return join(process.cwd(), "src", "assets", "plates", `${slug}-card.webp`);
}

export async function getStaticPaths() {
  const hobbies = await getCollection("hobbies");
  return hobbies
    .map((entry) => hobbySlug(entry))
    .filter((slug) => existsSync(platePath(slug)))
    .map((slug) => ({ params: { slug } }));
}

export const GET: APIRoute = async ({ params }) => {
  const image = await sharp(platePath(String(params.slug)))
    .flatten({ background: PAPER })
    .resize(1200, 630, { fit: "contain", background: PAPER })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": "image/jpeg" },
  });
};
