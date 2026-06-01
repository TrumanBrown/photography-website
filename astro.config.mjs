// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import { siteConfig } from './site.config';

export default defineConfig({
  site: `https://${siteConfig.domain}`,
  trailingSlash: 'never',
  build: {
    format: 'directory',
    assets: '_astro',
  },
  image: {
    // Astro's built-in sharp service. AVIF + WebP + JPEG variants emitted by <Picture>.
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
  integrations: [tailwind({ applyBaseStyles: false })],
  vite: {
    build: {
      // Avoid bundling massive image binaries into JS chunks.
      assetsInlineLimit: 0,
    },
  },
});
