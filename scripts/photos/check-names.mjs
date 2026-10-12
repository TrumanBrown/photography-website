#!/usr/bin/env node
/**
 * Spots a misspelled state, province, country or island in session folder
 * names before they're uploaded, because a folder name becomes the session's
 * web address:
 *
 *   node scripts/photos/check-names.mjs crater-lake-oreogn-sep-2025
 *   crater-lake-oreogn-sep-2025: "oreogn" looks like a typo for "oregon". Rename it crater-lake-oregon-sep-2025.
 *
 * Exits 1 when it finds one. upload-session.sh runs it first.
 */
import { fixSlug, slugTypos } from "./placenames.mjs";

let found = 0;
for (const name of process.argv.slice(2)) {
  const typos = slugTypos(name);
  if (!typos.length) continue;
  found++;
  const words = typos
    .map(({ word, fix }) => `"${word}" looks like a typo for "${fix}"`)
    .join(", ");
  console.error(`${name}: ${words}. Rename it ${fixSlug(name)}.`);
}
process.exit(found ? 1 : 0);
