// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import { siteConfig } from './site.config';

export default defineConfig({
  site: `https://${siteConfig.domain}`,
  trailingSlash: 'never',
  build: {
    format: 'directory',
    assets: '_astro',
  },
  image: {
    // Astro's built-in sharp service. WebP + JPEG variants emitted by <Picture>.
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap({
      // Admin is a private tool — keep it out of search engines.
      filter: (page) => !page.includes('/admin'),
    }),
  ],
  vite: {
    build: {
      // Avoid bundling massive image binaries into JS chunks.
      assetsInlineLimit: 0,
    },
  },
});
