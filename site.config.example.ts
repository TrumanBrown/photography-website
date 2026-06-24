/**
 * Documented template for site.config.ts. Safe to commit. Copy this file to
 * site.config.ts and replace placeholders if you ever need to recreate the
 * config from scratch.
 */
export const siteConfig = {
  ownerName: 'Jane Doe',
  copyrightStartYear: 2026,
  siteTitle: 'Jane Doe — Photography',
  siteDescription: 'Personal photography by Jane Doe.',
  domain: 'janedoe.com',
  defaultLocale: 'en-US',
  sessionsSort: 'orderThenDateDesc' as 'orderThenDateDesc' | 'dateDesc',
  sections: {
    hobbies: true,
  },
  blobHost: 'stphotographyprodxyz.blob.core.windows.net',
} as const;

export type SiteConfig = typeof siteConfig;
