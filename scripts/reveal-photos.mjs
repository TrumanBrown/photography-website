#!/usr/bin/env node
/**
 * Pick the photo each reveal card shows, by eye.
 *
 * The tide pool and herping cards show one CC-licensed iNaturalist photo per
 * species. Taking whatever iNaturalist serves first gave blurry shots, animals
 * in someone's hand and a Dunn's salamander that was a sliver beside a rock
 * (November 2026). So this stages the candidates for a person to look at, and
 * wires the ones they pick.
 *
 * 1. Candidates: for each species, the photos on its iNaturalist taxon page
 *    (curated by the community) and the first photos of its most-faved
 *    research-grade observations, CC0, CC BY or CC BY-NC only. Each gets
 *    downloaded at 500 px, and a numbered contact sheet per species is written
 *    next to them.
 *
 *      node scripts/reveal-photos.mjs herping candidates [--only a,b] [--count 24]
 *
 *    Output (gitignored): staging/<hobby>/candidates/<id>.jpg (the sheet),
 *    staging/<hobby>/candidates/<id>/<n>.jpg and staging/<hobby>/candidates.json.
 *
 * 2. Look at every sheet. Pick the sharpest photo that shows the whole animal
 *    clearly: no hands holding it, no watermark, no tank or ruler, and ideally
 *    the feature its fact describes. A sheet's numbers marked T are taxon
 *    photos.
 *
 * 3. Wire the picks into the hobby's photos JSON:
 *
 *      node scripts/reveal-photos.mjs herping pick ensatina=2,dunns-salamander=0
 *
 *    The JSON keeps the 500 px copy, which the toy preloads; the card swaps in
 *    the 1024 px copy when it opens (largePhoto in src/lib/hobbies/specimen.ts).
 *
 * Public API, no credentials. About one request a second.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import sharp from "sharp";

const API = "https://api.inaturalist.org/v1";
const UA = "photography-website reveal photo picker (+https://trumanbrown.com)";
const LICENSES = ["cc0", "cc-by", "cc-by-nc"];

const HOBBIES = {
  herping: {
    dataset: "src/lib/hobbies/herping-species.ts",
    wiring: "src/lib/hobbies/herping-photos.json",
    staging: join("staging", "herping"),
  },
  "tide-pooling": {
    dataset: "src/lib/hobbies/tidepool-species.ts",
    wiring: "src/lib/hobbies/tidepool-photos.json",
    staging: join("staging", "tide-pooling"),
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await sleep(1000);
  return res.json();
}

/** { id, common, scientific } from a species file, whichever quotes it uses. */
export function parseSpecies(src) {
  const str = `(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')`;
  const re = new RegExp(
    `id:\\s*${str}[\\s\\S]*?common:\\s*${str}[\\s\\S]*?scientific:\\s*${str}`,
    "g",
  );
  return [...src.matchAll(re)].map((m) => ({
    id: m[1] ?? m[2],
    common: m[3] ?? m[4],
    scientific: m[5] ?? m[6],
  }));
}

/** iNaturalist's attribution, minus an "uploaded by" that repeats the photographer. */
export function creditFrom(attribution) {
  const attr = (attribution || "").replace(/\s+/g, " ").trim();
  const tidy = attr.replace(
    /^\(c\) ([^,]+), (.*?), uploaded by \1$/,
    "(c) $1, $2",
  );
  return tidy ? `${tidy} via iNaturalist` : "iNaturalist";
}

const sized = (url, size) => url.replace(/\/square\.(\w+)/, `/${size}.$1`);

async function findTaxon(scientific) {
  const name = scientific.replace(/\s+spp?\.?$/i, "").trim();
  const data = await apiJson(
    `${API}/taxa?${new URLSearchParams({ q: name, per_page: "10", locale: "en" })}`,
  );
  const results = data.results ?? [];
  return (
    results.find((t) => (t.name || "").toLowerCase() === name.toLowerCase()) ??
    results[0]
  );
}

async function candidatesFor(sp, count) {
  const taxon = await findTaxon(sp.scientific);
  if (!taxon) return null;
  const full = (await apiJson(`${API}/taxa/${taxon.id}`)).results?.[0];
  const out = [];
  const seen = new Set();
  const add = (photo, source, observation) => {
    const license = (photo?.license_code || "").toLowerCase();
    if (!photo?.url || !LICENSES.includes(license) || seen.has(photo.id))
      return;
    seen.add(photo.id);
    out.push({
      source,
      photoId: photo.id,
      license,
      attribution: photo.attribution || "",
      url: sized(photo.url, "medium"),
      observation,
    });
  };
  for (const tp of full?.taxon_photos ?? []) add(tp.photo, "taxon", null);
  const obs = await apiJson(
    `${API}/observations?${new URLSearchParams({
      taxon_id: String(taxon.id),
      photo_license: LICENSES.join(","),
      photos: "true",
      quality_grade: "research",
      order_by: "votes",
      order: "desc",
      per_page: "30",
      locale: "en",
    })}`,
  );
  for (const o of obs.results ?? [])
    for (const p of (o.photos ?? []).slice(0, 2))
      add(p, "observation", `https://www.inaturalist.org/observations/${o.id}`);
  return { taxonId: taxon.id, candidates: out.slice(0, count) };
}

/** A numbered grid of the candidates, 6 across. */
async function contactSheet(files, labels, path) {
  const W = 300;
  const H = 225;
  const COLS = 6;
  const rows = Math.ceil(files.length / COLS);
  const tiles = await Promise.all(
    files.map(async (file, i) => {
      const photo = await sharp(file)
        .resize(W - 6, H - 6, { fit: "contain", background: "#282828" })
        .toBuffer();
      const tag = Buffer.from(
        `<svg width="${W}" height="${H}"><rect x="2" y="2" width="54" height="28" fill="#000"/><text x="8" y="23" font-family="sans-serif" font-size="20" font-weight="bold" fill="#ff0">${labels[i]}</text></svg>`,
      );
      return {
        input: await sharp({
          create: { width: W, height: H, channels: 3, background: "#282828" },
        })
          .composite([{ input: photo, top: 3, left: 3 }, { input: tag }])
          .jpeg()
          .toBuffer(),
        left: (i % COLS) * W,
        top: Math.floor(i / COLS) * H,
      };
    }),
  );
  await sharp({
    create: {
      width: COLS * W,
      height: rows * H,
      channels: 3,
      background: "#282828",
    },
  })
    .composite(tiles)
    .jpeg({ quality: 82 })
    .toFile(path);
}

async function runCandidates(hobby, species, count) {
  const dir = join(hobby.staging, "candidates");
  await mkdir(dir, { recursive: true });
  const manifestPath = join(hobby.staging, "candidates.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8").catch(() => "{}"),
  );
  for (const sp of species) {
    process.stdout.write(`${sp.common} (${sp.scientific}) ... `);
    const found = await candidatesFor(sp, count);
    if (!found || found.candidates.length === 0) {
      console.log("no CC photos");
      continue;
    }
    await mkdir(join(dir, sp.id), { recursive: true });
    const files = [];
    for (const [n, c] of found.candidates.entries()) {
      const file = join(dir, sp.id, `${n}.jpg`);
      const res = await fetch(c.url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      files.push({ file, label: `${n}${c.source === "taxon" ? "T" : ""}` });
    }
    await contactSheet(
      files.map((f) => f.file),
      files.map((f) => f.label),
      join(dir, `${sp.id}.jpg`),
    );
    manifest[sp.id] = { ...sp, ...found };
    console.log(`${files.length} candidates`);
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nContact sheets: ${dir}/<id>.jpg. Manifest: ${manifestPath}`);
}

async function runPick(hobby, picks) {
  const manifest = JSON.parse(
    await readFile(join(hobby.staging, "candidates.json"), "utf8"),
  );
  const wiring = JSON.parse(await readFile(hobby.wiring, "utf8"));
  wiring.species ??= {};
  for (const [id, n] of picks) {
    const c = manifest[id]?.candidates?.[n];
    if (!c)
      throw new Error(`No candidate ${n} for ${id}. Run candidates first.`);
    wiring.species[id] = { photo: c.url, credit: creditFrom(c.attribution) };
    console.log(`${id}: ${c.url}`);
  }
  await writeFile(hobby.wiring, JSON.stringify(wiring, null, 2) + "\n");
  console.log(`\nWired ${picks.length} photo(s) into ${hobby.wiring}.`);
}

async function main() {
  const [name, command, ...rest] = process.argv.slice(2);
  const hobby = HOBBIES[name];
  if (!hobby || !["candidates", "pick"].includes(command)) {
    console.error(
      "Usage: node scripts/reveal-photos.mjs <herping|tide-pooling> candidates [--only a,b] [--count 24]\n" +
        "       node scripts/reveal-photos.mjs <herping|tide-pooling> pick id=n[,id=n...]",
    );
    process.exit(1);
  }
  if (command === "pick") {
    const picks = rest
      .join(",")
      .split(",")
      .filter(Boolean)
      .map((p) => {
        const [id, n] = p.split("=");
        return [id.trim(), Number(n)];
      });
    await runPick(hobby, picks);
    return;
  }
  const flag = (k) => {
    const i = rest.indexOf(k);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const only = flag("--only")
    ?.split(",")
    .map((s) => s.trim());
  const count = Number(flag("--count")) || 24;
  let species = parseSpecies(await readFile(hobby.dataset, "utf8"));
  if (only) species = species.filter((s) => only.includes(s.id));
  await runCandidates(hobby, species, count);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
