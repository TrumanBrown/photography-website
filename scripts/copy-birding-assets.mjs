/**
 * Copy the MediaPipe vision WASM runtime needed by the Birding hobby island
 * from node_modules into public/birding/wasm/ so it ships as same-origin static
 * files (the CSP is script-src 'self'; nothing is fetched from a CDN).
 *
 * The WASM is reproducible from the pinned @mediapipe/tasks-vision dependency,
 * so public/birding/wasm/ is gitignored and regenerated on every build/dev run.
 * The model file (public/birding/face_landmarker.task) is NOT produced here.
 * It isn't published to npm, so it is committed to the repo to keep builds
 * offline and reproducible.
 *
 * Runs before `astro build` and `astro dev` (wired into package.json). Idempotent.
 */
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const DEST = join(ROOT, 'public', 'birding', 'wasm');

// Only the SIMD build + its no-SIMD fallback are needed. FilesetResolver picks
// vision_wasm_internal.* when WASM SIMD is available, else the nosimd pair.
const FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

if (!existsSync(SRC)) {
  console.error(
    `[birding] MediaPipe WASM not found at ${SRC}.\n` +
      `Run "npm ci" first (the @mediapipe/tasks-vision dependency provides it).`,
  );
  process.exit(1);
}

mkdirSync(DEST, { recursive: true });

let copied = 0;
let skipped = 0;
for (const name of FILES) {
  const from = join(SRC, name);
  const to = join(DEST, name);
  if (!existsSync(from)) {
    console.error(`[birding] expected WASM asset missing: ${from}`);
    process.exit(1);
  }
  // Skip files that are already present and the same size (fast no-op on rebuilds).
  if (existsSync(to) && statSync(to).size === statSync(from).size) {
    skipped += 1;
    continue;
  }
  copyFileSync(from, to);
  copied += 1;
}

console.log(`[birding] WASM assets ready in public/birding/wasm/ (${copied} copied, ${skipped} up-to-date).`);
