// Compute the SHA-256 CSP hash of the inline theme bootstrap script.
// Run: node scripts/csp-hash.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';

const src = fs.readFileSync('src/lib/theme.ts', 'utf8');
const m = src.match(/`([\s\S]*?)`\.trim\(\)/);
if (!m) {
  console.error('Could not find theme bootstrap template literal in src/lib/theme.ts');
  process.exit(1);
}
const content = m[1].trim();
const hash = crypto.createHash('sha256').update(content).digest('base64');
console.log('Inline script content length:', content.length, 'bytes');
console.log('CSP token:                    ', `'sha256-${hash}'`);
