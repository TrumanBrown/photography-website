// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import { siteConfig } from './site.config';

const SESSIONS_DIR = 'src/content/sessions';

/**
 * Map every session URL to its session date, used as the sitemap <lastmod>.
 * Google only trusts lastmod when it is stable and verifiable, so we use the
 * session's own date rather than the build timestamp (which would churn on
 * every deploy and make the signal worthless).
 */
function sessionLastmod() {
  /** @type {Map<string, string>} */
  const dates = new Map();
  let entries;
  try {
    entries = readdirSync(SESSIONS_DIR);
  } catch {
    return dates;
  }
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(SESSIONS_DIR, file), 'utf8'));
      if (typeof data.date !== 'string') continue;
      dates.set(`/sessions/${file.replace(/\.json$/, '')}`, data.date);
    } catch {
      // A malformed session file is the content schema's problem, not the
      // sitemap's — skip it rather than failing the build here.
    }
  }
  return dates;
}

const lastmodBySession = sessionLastmod();
const newestSession = [...lastmodBySession.values()].sort().pop();

export default defineConfig({
  site: `https://${siteConfig.domain}`,
  // Azure Static Web Apps serves directory-format pages at their trailing-slash
  // URL and 301s the bare path to it. Matching that here keeps the canonical
  // tag and the sitemap pointing at the URL that actually responds 200.
  // (SWA's own "trailingSlash": "never" is unreliable for nested directory
  // indexes — see Azure/static-web-apps#1262 — so we align with SWA instead.)
  trailingSlash: 'always',
  // Keep Astro's build cache (including optimized image variants) outside
  // node_modules so `npm ci` can't wipe it and CI can persist it between runs.
  cacheDir: './.cache/astro',
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
      serialize(item) {
        const path = new URL(item.url).pathname.replace(/\/$/, '');
        const lastmod = path === '' ? newestSession : lastmodBySession.get(path);
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
  ],
  vite: {
    build: {
      // Avoid bundling massive image binaries into JS chunks.
      assetsInlineLimit: 0,
    },
  },
});
