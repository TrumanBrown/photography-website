/**
 * The Instagram profile the site links to, from the INSTAGRAM_URL build
 * secret. The account isn't named anywhere in the repository (docs/social.md,
 * "What stays private"), so it reaches the footer and the home page's
 * structured data only at build time. Anything that isn't a plain profile
 * address is ignored, and without the secret there's no link.
 */
const PROFILE =
  /^https:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?$/;

export function instagramUrl(
  raw: string | undefined = process.env.INSTAGRAM_URL,
): string | null {
  const handle = PROFILE.exec((raw ?? "").trim())?.[1];
  return handle ? `https://www.instagram.com/${handle}/` : null;
}
