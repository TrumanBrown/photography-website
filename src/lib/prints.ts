import { siteConfig } from "../../site.config";

/** The page that explains prints and how to license a photo. */
export const PRINTS_PATH = "/prints/";

/** Anchor of the licensing section on the prints page. */
export const LICENSING_ID = "licensing";

/**
 * Image-metadata fields that make a photo eligible for the "Licensable" badge
 * in Google Images. Both point at the licensing section of the prints page,
 * which states the terms (all rights reserved) and how to ask. Empty when
 * prints are switched off, so the structured data stays as it was.
 */
export function licenseFields(
  origin: string | URL,
  enabled: boolean = siteConfig.prints,
): { license?: string; acquireLicensePage?: string } {
  if (!enabled) return {};
  const url = new URL(`${PRINTS_PATH}#${LICENSING_ID}`, origin).toString();
  return { license: url, acquireLicensePage: url };
}

/** How a print inquiry starts in the contact form: the photo's own address. */
export function printInquiry(photoUrl: string): string {
  return `I'd like to ask about a print of this photo:\n${photoUrl}`;
}
