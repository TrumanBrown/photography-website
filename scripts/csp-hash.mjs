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

// A session page reached by spinning the globe opens on the photograph the
// spin landed on, so that has to be decided before the first paint too.
const landingSource = read('src/lib/landing.ts');
const landingMatch = landingSource.match(/export const landingBootstrap = `([\s\S]*?)`\.trim\(\);/);
if (!landingMatch) {
  throw new Error('Could not find landingBootstrap in src/lib/landing.ts.');
}

const toggleSource = read('src/components/ThemeToggle.astro');
const toggleMatches = [...toggleSource.matchAll(/<script\s+is:inline>([\s\S]*?)<\/script>/g)];
if (toggleMatches.length !== 1) {
  throw new Error(`Expected one inline script in ThemeToggle.astro; found ${toggleMatches.length}.`);
}

// The lead photograph picks its starting frame while the parser is still
// working, so that choice has to be inline rather than in a bundled module.
const leadSource = read('src/components/LeadPhoto.astro');
const leadMatches = [...leadSource.matchAll(/<script\s+is:inline>([\s\S]*?)<\/script>/g)];
if (leadMatches.length !== 1) {
  throw new Error(`Expected one inline script in LeadPhoto.astro; found ${leadMatches.length}.`);
}

const expected = [
  cspToken(themeMatch[1].trim()),
  cspToken(toggleMatches[0][1]),
  cspToken(leadMatches[0][1]),
  cspToken(landingMatch[1].trim()),
];
const config = JSON.parse(read('staticwebapp.config.json'));
const policy = config.globalHeaders?.['Content-Security-Policy'];
if (typeof policy !== 'string') {
  throw new Error('staticwebapp.config.json has no Content-Security-Policy header.');
}

const configured = [...policy.matchAll(/'sha256-[A-Za-z0-9+/=]+'/g)].map((match) => match[0]);
const missing = expected.filter((token) => !configured.includes(token));
const stale = configured.filter((token) => !expected.includes(token));

// Photos and downloads come from this site's storage account only, not from
// any account on blob.core.windows.net, so the policy has to name the same
// host as site.config.ts.
const blobHost = read('site.config.ts').match(/blobHost:\s*["']([^"']+)["']/)?.[1];
const blobSources = [...policy.matchAll(/https:\/\/[^\s;]*\.blob\.core\.windows\.net/g)].map((match) => match[0]);
const strayBlob = blobSources.filter((source) => source !== `https://${blobHost}`);
const blobProblem = !blobHost
  ? 'site.config.ts has no blobHost.'
  : blobSources.length === 0
    ? `Content-Security-Policy doesn't allow https://${blobHost}, where the photos are.`
    : strayBlob.length
      ? `Content-Security-Policy allows ${strayBlob.join(' ')}; it should name only https://${blobHost} (blobHost in site.config.ts).`
      : '';

if (missing.length || stale.length || blobProblem) {
  if (missing.length) console.error('Missing CSP token(s):', missing.join(' '));
  if (stale.length) console.error('Stale CSP token(s):', stale.join(' '));
  if (missing.length || stale.length) {
    console.error('Update script-src in staticwebapp.config.json with the tokens above.');
  }
  if (blobProblem) console.error(blobProblem);
  process.exitCode = 1;
} else {
  console.log(`CSP hashes match ${expected.length} inline scripts; photos load only from ${blobHost}.`);
}
