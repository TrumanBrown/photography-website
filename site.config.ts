/**
 * Display-layer configuration for the site.
 *
 * This file IS committed. Long-lived display values (your name, copyright,
 * site title, domain) live here so changes are tracked in git and trigger a
 * redeploy. Secrets (Azure IDs, deploy tokens) do NOT live here — they live
 * in GitHub Actions secrets.
 */
export const siteConfig = {
  /** Your full name as it should appear in the footer, <meta author>, and structured data. */
  ownerName: "Truman Brown",

  /** First year the site went live. Footer renders e.g. "© 2026–2028 <Owner>". */
  copyrightStartYear: 2026,

  /** Browser tab title and <h1> on the home page. */
  siteTitle: "Truman Brown Pics and More",

  /** <meta description> for SEO and link previews. */
  siteDescription:
    "Wildlife, landscape and travel photography by Truman Brown. Washington, Costa Rica, China and Tibet.",

  /** Apex domain (no scheme, no www). www is bound automatically by SWA. */
  domain: "trumanbrown.com",

  /** BCP-47 locale for <html lang>. */
  defaultLocale: "en-US",

  /**
   * Sort policy for the session list on the home page.
   * - 'orderThenDateDesc': sessions with explicit `order` first (ascending),
   *   then sessions without `order` by date descending.
   * - 'dateDesc': always sort by date descending.
   */
  sessionsSort: "orderThenDateDesc" as "orderThenDateDesc" | "dateDesc",

  /**
   * Optional top-level sections beyond Photography (which is always the home
   * page). Toggling a flag shows/hides its co-equal nav link. Pages still
   * build when a section is off — the flag only controls header discoverability.
   */
  sections: {
    /** Show the "Hobbies" area + its nav link beside Photography. */
    hobbies: true,
  },

  /**
   * Prints and licensing inquiries. When true, session photos get a "Prints"
   * button in the lightbox that opens the contact form with the photo's link
   * already in the message, the footer links to /prints, and each photo's
   * structured data points Google Images at /prints for licensing (the
   * "Licensable" badge). Inquiries arrive through the existing contact form;
   * there is no shop or checkout. The /prints page still builds when false.
   */
  prints: true,

  /**
   * Public Blob Storage account hostname. Used to build full-res image URLs
   * for the lightbox. Set it by hand after the first infra deploy, and name
   * the same host in the Content-Security-Policy in staticwebapp.config.json:
   * `npm run check:csp` fails until they match. For local dev it can stay as
   * the placeholder.
   *
   * Format: '<storage-account>.blob.core.windows.net'
   */
  blobHost: "stphotoprodnowiur.blob.core.windows.net",
} as const;

export type SiteConfig = typeof siteConfig;
