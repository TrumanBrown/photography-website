// Generates src/lib/hobbies/bird-families.json: a static map of iNaturalist
// bird-family taxon id -> { common, sci } for every bird family on iNaturalist.
//
// The birding life list groups the author's species by family. species_counts
// already returns each species' ancestor_ids, so with this lookup the grouping
// is computed entirely client-side at zero network cost and stays live as new
// observations are added. Bird families change rarely; re-run this if iNat adds
// or renames one:
//
//   node scripts/fetch-bird-families.mjs
//
// (Aves is iNaturalist taxon id 3.)
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const AVES_TAXON_ID = 3;
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/lib/hobbies/bird-families.json",
);

async function main() {
  const families = {};
  let page = 1;
  for (;;) {
    const url = new URL("https://api.inaturalist.org/v1/taxa");
    url.search = new URLSearchParams({
      taxon_id: String(AVES_TAXON_ID),
      rank: "family",
      per_page: "200",
      page: String(page),
      order_by: "name",
      order: "asc",
      locale: "en",
    }).toString();

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok)
      throw new Error(
        `HTTP ${res.status} fetching bird families (page ${page})`,
      );
    const data = await res.json();

    for (const t of data.results ?? []) {
      families[t.id] = {
        common: t.preferred_common_name || t.name,
        sci: t.name,
      };
    }
    if (page * 200 >= data.total_results) break;
    page += 1;
  }

  const sortedIds = Object.keys(families)
    .map(Number)
    .sort((a, b) => families[a].sci.localeCompare(families[b].sci));
  const out = {};
  for (const id of sortedIds) out[id] = families[id];

  await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${sortedIds.length} bird families to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
