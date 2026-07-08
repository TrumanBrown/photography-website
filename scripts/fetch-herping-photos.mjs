#!/usr/bin/env node
/**
 * Fetch CC-licensed reference photos for the herping species from iNaturalist
 * and stage them for review, with full attribution. Nothing is uploaded or
 * committed automatically.
 *
 * Why: the "night drive" reveal card shows a pixel sprite by default and a real
 * photo when one is available (src/lib/hobbies/herping-photos.json). This finds
 * properly-licensed candidates so you can drop real photos into those tiles.
 *
 * Usage:
 *   node scripts/fetch-herping-photos.mjs [options]
 *   npm run fetch:herping-photos -- [options]
 *
 * Options:
 *   --limit N       Only process the first N species (default: all)
 *   --only a,b,c    Only these species ids
 *   --licenses x,y  Allowed photo licenses, in priority order
 *                   (default: cc0,cc-by,cc-by-nc)
 *   --size S        Photo size to download/link: small|medium|large (default: medium)
 *   --place N       Prefer observations from this iNat place id (e.g. 46 = WA)
 *   --wire MODE     Also write src/lib/hobbies/herping-photos.json:
 *                     inat -> point at the iNaturalist photo URL (works now)
 *                     blob -> point at the hobby-media blob URL (after you upload)
 *                   Default: don't wire — just stage files + write the manifest.
 *   --force         Re-download even if the staged file already exists
 *
 * Output:
 *   staging/herping/photos/<id>.<ext>   downloaded photo (gitignored)
 *   staging/herping/photos.json         review manifest with attribution
 *
 * Next steps after reviewing the manifest:
 *   - hotlink iNaturalist:  re-run with `--wire inat`
 *   - host them yourself:   upload staging/herping/photos/* to
 *                           hobby-media/herping/species/, then `--wire blob`
 *
 * Public API — no credentials needed. Courtesy rate-limit ~1 request/second.
 */
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const API = "https://api.inaturalist.org/v1";
const UA =
  "photography-website herping photo fetcher (+https://trumanbrown.com)";
const DATASET = "src/lib/hobbies/herping-species.ts";
const OUT_DIR = join("staging", "herping", "photos");
const MANIFEST = join("staging", "herping", "photos.json");
const WIRING = "src/lib/hobbies/herping-photos.json";
const BLOB_BASE = "hobby-media/herping/species";

const LICENSE_LABEL = {
  cc0: "CC0",
  "cc-by": "CC BY",
  "cc-by-nc": "CC BY-NC",
  "cc-by-sa": "CC BY-SA",
  "cc-by-nd": "CC BY-ND",
  "cc-by-nc-sa": "CC BY-NC-SA",
  "cc-by-nc-nd": "CC BY-NC-ND",
};

function parseArgs(argv) {
  const a = {
    limit: Infinity,
    only: null,
    licenses: ["cc0", "cc-by", "cc-by-nc"],
    size: "medium",
    place: null,
    wire: null,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--limit") a.limit = Number(argv[++i]) || Infinity;
    else if (k === "--only")
      a.only = new Set(
        argv[++i]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    else if (k === "--licenses")
      a.licenses = argv[++i]
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    else if (k === "--size") a.size = argv[++i];
    else if (k === "--place") a.place = Number(argv[++i]) || null;
    else if (k === "--wire") a.wire = argv[++i];
    else if (k === "--force") a.force = true;
  }
  return a;
}

/**
 * Pull { id, common, scientific } from the dataset. The file keeps these three
 * fields together on one line per entry, so a tolerant regex is enough (and it
 * avoids having to load TypeScript from Node).
 */
function parseSpecies(src) {
  const re =
    /id:\s*["']([^"']+)["'][\s\S]*?common:\s*["']([^"']*)["'][\s\S]*?scientific:\s*["']([^"']+)["']/g;
  const out = [];
  let m;
  while ((m = re.exec(src)))
    out.push({ id: m[1], common: m[2], scientific: m[3] });
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function apiJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function sizeUrl(squareUrl, size) {
  return squareUrl.replace(/\/square\.(\w+)/, `/${size}.$1`);
}
function extOf(url) {
  const m = url.match(/\.(\w+)(?:\?|$)/);
  return (m && m[1].toLowerCase()) || "jpg";
}

/**
 * Prefer the taxon's **default photo** — the community-curated, representative
 * ID shot for the species — since that's the clearest, most-obviously-the-animal
 * image. Only used when it carries an allowed CC license; otherwise we fall back
 * to the observation search below.
 */
async function findTaxonPhoto(name, licenses) {
  let data;
  try {
    data = await apiJson(
      `${API}/taxa?${new URLSearchParams({
        q: name,
        rank: "species",
        is_active: "true",
        per_page: "10",
        locale: "en",
      })}`,
    );
  } catch {
    return null;
  }
  const results = data.results ?? [];
  // Prefer an exact scientific-name match, else the most-observed candidate.
  const exact = results.find(
    (t) => (t.name || "").toLowerCase() === name.toLowerCase(),
  );
  const taxon = exact || results[0];
  const dp = taxon?.default_photo;
  if (!dp || !dp.url) return null;
  const lic = (dp.license_code || "").toLowerCase();
  if (!licenses.includes(lic)) return null;
  return {
    license: lic,
    attribution: dp.attribution || "",
    squareUrl: dp.url,
    observationUrl: `https://www.inaturalist.org/taxa/${taxon.id}`,
    observationId: taxon.id,
  };
}

/** Find the best CC-licensed, clearly-representative photo for a scientific name. */
async function findPhoto(scientific, licenses, place) {
  // Drop an unresolved "sp."/"spp." suffix so genus-only names still match.
  const name = scientific.replace(/\s+spp?\.?$/i, "").trim();

  // 1) The curated taxon default photo — clearest ID shot when it's CC.
  const taxonHit = await findTaxonPhoto(name, licenses);
  await sleep(600);
  if (taxonHit) return taxonHit;

  // 2) Fall back to research-grade, most-faved observations (prefer local).
  const base = {
    taxon_name: name,
    photo_license: licenses.join(","),
    photos: "true",
    quality_grade: "research",
    order_by: "votes",
    order: "desc",
    per_page: "10",
    locale: "en",
  };
  // Prefer local (e.g. Washington) photos when a place is given, then fall back.
  const attempts = place
    ? [{ ...base, place_id: String(place) }, base]
    : [base];
  for (const params of attempts) {
    let data;
    try {
      data = await apiJson(
        `${API}/observations?${new URLSearchParams(params)}`,
      );
    } catch {
      continue;
    }
    for (const obs of data.results ?? []) {
      for (const p of obs.photos ?? []) {
        const lic = (p.license_code || "").toLowerCase();
        if (!licenses.includes(lic) || !p.url) continue;
        return {
          license: lic,
          attribution: p.attribution || "",
          squareUrl: p.url,
          observationUrl:
            obs.uri || `https://www.inaturalist.org/observations/${obs.id}`,
          observationId: obs.id,
        };
      }
    }
    await sleep(600);
  }
  return null;
}

function creditFrom(found) {
  const label = LICENSE_LABEL[found.license] || found.license.toUpperCase();
  const attr = (found.attribution || "").replace(/\s+/g, " ").trim();
  return attr ? `${attr} via iNaturalist` : `iNaturalist (${label})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = await readFile(DATASET, "utf8");
  let species = parseSpecies(src);
  if (species.length === 0) {
    console.error(`No species parsed from ${DATASET}.`);
    process.exit(1);
  }
  if (args.only) species = species.filter((s) => args.only.has(s.id));
  species = species.slice(0, args.limit);

  await mkdir(OUT_DIR, { recursive: true });

  const manifest = {};
  let found = 0;
  let missed = 0;
  let downloaded = 0;
  const misses = [];

  for (const sp of species) {
    process.stdout.write(`• ${sp.common} (${sp.scientific}) … `);
    const hit = await findPhoto(sp.scientific, args.licenses, args.place);
    await sleep(1100); // courtesy rate limit
    if (!hit) {
      console.log("no CC photo");
      missed++;
      misses.push(sp.id);
      continue;
    }

    const url = sizeUrl(hit.squareUrl, args.size);
    const ext = extOf(url);
    const localRel = join(OUT_DIR, `${sp.id}.${ext}`);
    let localOk = await fileExists(localRel);
    if (!localOk || args.force) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await writeFile(localRel, Buffer.from(await res.arrayBuffer()));
        localOk = true;
        downloaded++;
      } catch (e) {
        console.log(`(download failed: ${e.message})`);
      }
    }

    manifest[sp.id] = {
      common: sp.common,
      scientific: sp.scientific,
      license: hit.license,
      credit: creditFrom(hit),
      attribution: hit.attribution,
      observationUrl: hit.observationUrl,
      inatPhotoUrl: url,
      localFile: localOk ? localRel : null,
      blobUrl: `${BLOB_BASE}/${sp.id}.${ext}`,
    };
    found++;
    console.log(LICENSE_LABEL[hit.license] || hit.license);
  }

  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  if (args.wire === "inat" || args.wire === "blob") {
    const blobHost = (
      await readFile("site.config.ts", "utf8").catch(() => "")
    ).match(/blobHost:\s*'([^']+)'/)?.[1];
    const wiring = {
      $comment:
        "id -> { photo, credit }. Used by the herping reveal card; falls back to the pixel sprite if a photo fails to load. Generated/updated by scripts/fetch-herping-photos.mjs.",
      species: {},
    };
    if (await fileExists(WIRING)) {
      try {
        Object.assign(wiring, JSON.parse(await readFile(WIRING, "utf8")));
        wiring.species ??= {};
      } catch {
        /* start fresh */
      }
    }
    let wired = 0;
    for (const [id, m] of Object.entries(manifest)) {
      let photo = null;
      if (args.wire === "inat") photo = m.inatPhotoUrl;
      else if (args.wire === "blob" && blobHost)
        photo = `https://${blobHost}/${m.blobUrl}`;
      if (photo) {
        wiring.species[id] = { photo, credit: m.credit };
        wired++;
      }
    }
    await writeFile(WIRING, JSON.stringify(wiring, null, 2) + "\n");
    console.log(`\nWired ${wired} photo(s) into ${WIRING} (${args.wire}).`);
    if (args.wire === "blob" && !blobHost) {
      console.log(
        "  (could not read blobHost from site.config.ts — nothing wired)",
      );
    }
  }

  console.log(
    `\nDone. ${found} found, ${missed} missing, ${downloaded} downloaded.`,
  );
  console.log(`Manifest: ${MANIFEST}`);
  if (misses.length) console.log(`No CC photo for: ${misses.join(", ")}`);
  if (!args.wire) {
    console.log("\nReview the manifest, then either:");
    console.log("  • hotlink iNaturalist:  re-run with --wire inat");
    console.log(
      `  • host them yourself:   upload ${OUT_DIR}/* to ${BLOB_BASE}/, then --wire blob`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
