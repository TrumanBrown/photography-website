#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function cspToken(content) {
  const hash = createHash('sha256').update(content).digest('base64');
  return `'sha256-${hash}'`;
}

const themeSource = read('src/lib/theme.ts');
const themeMatch = themeSource.match(/export const themeBootstrap = `([\s\S]*?)`\.trim\(\);/);
if (!themeMatch) {
  throw new Error('Could not find themeBootstrap in src/lib/theme.ts.');
}

const toggleSource = read('src/components/ThemeToggle.astro');
const toggleMatches = [...toggleSource.matchAll(/<script\s+is:inline>([\s\S]*?)<\/script>/g)];
if (toggleMatches.length !== 1) {
  throw new Error(`Expected one inline script in ThemeToggle.astro; found ${toggleMatches.length}.`);
}

const expected = [cspToken(themeMatch[1].trim()), cspToken(toggleMatches[0][1])];
const config = JSON.parse(read('staticwebapp.config.json'));
const policy = config.globalHeaders?.['Content-Security-Policy'];
if (typeof policy !== 'string') {
  throw new Error('staticwebapp.config.json has no Content-Security-Policy header.');
}

const configured = [...policy.matchAll(/'sha256-[A-Za-z0-9+/=]+'/g)].map((match) => match[0]);
const missing = expected.filter((token) => !configured.includes(token));
const stale = configured.filter((token) => !expected.includes(token));

if (missing.length || stale.length) {
  if (missing.length) console.error('Missing CSP token(s):', missing.join(' '));
  if (stale.length) console.error('Stale CSP token(s):', stale.join(' '));
  console.error('Update script-src in staticwebapp.config.json with the tokens above.');
  process.exitCode = 1;
} else {
  console.log(`CSP hashes match ${expected.length} inline theme scripts.`);
}
