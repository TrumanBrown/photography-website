/**
 * Generate fixture sessions (synthetic JPEGs + session JSON) under
 * src/content/sessions/ so local dev / build works without any Blob access.
 *
 * Idempotent: skips if fixtures already exist.
 * Usage: `node scripts/generate-fixtures.mjs` (or `npm run fixtures`).
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SESSIONS_DIR = join(ROOT, 'src', 'content', 'sessions');

const argv = new Set(process.argv.slice(2));
const MANY = argv.has('--many');

const baseFixtures = [
  {
    slug: 'tidepools-spring-2026',
    data: {
      title: 'Tidepools, Spring 2026',
      date: '2026-04-18',
      location: 'Northern California coast',
      description: 'An afternoon of low-tide poking around.',
      order: 1,
    },
    images: [
      { name: 'anemone.jpg', color: '#0e7490', w: 1600, h: 1067, caption: 'Green anemone' },
      { name: 'crab.jpg', color: '#b91c1c', w: 1067, h: 1600, caption: 'Hermit crab' },
      { name: 'kelp.jpg', color: '#4d7c0f', w: 1600, h: 1067, caption: 'Bull kelp wash' },
      { name: 'shells.jpg', color: '#a16207', w: 1600, h: 1067 },
    ],
  },
  {
    slug: 'china-spring-2025',
    data: {
      title: 'China, Spring 2025',
      date: '2025-04-12',
      location: 'Beijing → Xi\u2019an → Chengdu',
      description: 'Three weeks across three cities.',
    },
    images: [
      { name: 'great-wall.jpg', color: '#7c2d12', w: 1600, h: 900, caption: 'Mutianyu' },
      { name: 'terracotta.jpg', color: '#92400e', w: 1600, h: 1067 },
      { name: 'panda.jpg', color: '#171717', w: 1067, h: 1600, caption: 'Chengdu research base' },
      { name: 'hutong.jpg', color: '#525252', w: 1600, h: 1067 },
      { name: 'lantern.jpg', color: '#dc2626', w: 1067, h: 1600 },
    ],
  },
];

// Synthetic "many" set so you can see how the sidebar feels at scale.
const places = [
  'Yosemite', 'Big Sur', 'Joshua Tree', 'Death Valley', 'Mt. Rainier',
  'Olympic NP', 'Glacier NP', 'Banff', 'Iceland Ring Road', 'Norway Fjords',
  'Tokyo', 'Kyoto', 'Hokkaido', 'Seoul', 'Hong Kong',
  'Paris', 'Rome', 'Lisbon', 'Barcelona', 'Amsterdam',
  'NYC Winter', 'Chicago Skyline', 'Seattle Rain', 'PNW Coast', 'Cascades',
  'Backyard Birds', 'Holiday Lights', 'Studio Portraits', 'Friends Wedding', 'Family Reunion',
  'Sailing Trip', 'Cherry Blossoms', 'Autumn Leaves', 'Alpine Lakes', 'Volcano Hike',
  'City at Night', 'Street Market', 'Botanical Garden', 'Tide Pools', 'Storm Clouds',
];
const swatches = ['#1f2937', '#7c2d12', '#0e7490', '#4d7c0f', '#92400e', '#b91c1c', '#1e40af', '#7e22ce', '#0f766e', '#a16207'];

function manyFixtures() {
  const out = [];
  let i = 0;
  for (const place of places) {
    const year = 2020 + (i % 6);
    const month = String(((i * 3) % 12) + 1).padStart(2, '0');
    const day = String(((i * 7) % 27) + 1).padStart(2, '0');
    const slug = place.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + `-${year}`;
    out.push({
      slug,
      data: {
        title: `${place}, ${year}`,
        date: `${year}-${month}-${day}`,
        location: place,
        description: '',
      },
      images: [0, 1, 2].map((k) => {
        const isPortrait = (i + k) % 3 === 0;
        return {
          name: `img-${k + 1}.jpg`,
          color: swatches[(i + k) % swatches.length],
          w: isPortrait ? 1067 : 1600,
          h: isPortrait ? 1600 : 1067,
        };
      }),
    });
    i++;
  }
  return out;
}

const fixtures = MANY ? manyFixtures() : baseFixtures;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function buildJpeg(color, w, h, label) {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: color,
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
             <text x="50%" y="50%" font-family="sans-serif" font-size="${Math.round(Math.min(w, h) / 12)}"
                   fill="rgba(255,255,255,0.85)" text-anchor="middle" dominant-baseline="middle">${label}</text>
           </svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function main() {
  let createdAny = false;
  for (const session of fixtures) {
    const sessionDir = join(SESSIONS_DIR, session.slug, 'images');
    const jsonPath = join(SESSIONS_DIR, `${session.slug}.json`);

    if (await exists(jsonPath)) {
      console.log(`skip  ${session.slug} (exists)`);
      continue;
    }

    await mkdir(sessionDir, { recursive: true });

    const images = [];
    for (const img of session.images) {
      const outPath = join(sessionDir, img.name);
      const label = `${session.slug}/${img.name}`;
      const buf = await buildJpeg(img.color, img.w, img.h, label);
      await writeFile(outPath, buf);
      images.push({
        file: img.name,
        width: img.w,
        height: img.h,
        ...(img.caption ? { caption: img.caption } : {}),
      });
      console.log(`write ${session.slug}/${img.name} (${img.w}x${img.h})`);
    }

    const payload = {
      ...session.data,
      cover: session.images[0].name,
      images,
    };
    await writeFile(jsonPath, JSON.stringify(payload, null, 2) + '\n');
    console.log(`write ${session.slug}.json`);
    createdAny = true;
  }

  if (!createdAny) {
    console.log('All fixtures already exist. Nothing to do.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
