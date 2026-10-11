#!/usr/bin/env node
/**
 * Private helper for the photo pipeline, run on your own machine.
 *
 *   npm run photos -- status                 what's analysed, matched and written
 *   npm run photos -- preview [session]      write .cache/photos/preview.html: every
 *                                            photo with its caption, and each description
 *   npm run photos -- redo <photo>           look at this photo again on the next run
 *   npm run photos -- redo --session <slug>  ...or every photo in a session
 *   npm run photos -- redescribe <slug>      rewrite this session's description next run
 *
 * <photo> is a session/file id ("gunn-peak-june-2026/DSC01234.JPEG") or any
 * unique part of a filename. Reads private state with your `az login`
 * (AZURE_STORAGE_ACCOUNT must be set), or the trial state with --local.
 * The next run is the nightly one, or start it from the Actions tab
 * (Photo captions -> Run workflow).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, photoSettings } from "./settings.mjs";
import { blobStore, localStore, updateJson } from "./store.mjs";
import { loadSessionsFromIndex } from "./sessions.mjs";

const local = process.argv.includes("--local");
const args = process.argv.slice(2).filter((a) => a !== "--local");
const [command, ...rest] = args;
const settings = photoSettings();

const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function openStores() {
  const remote = await blobStore({
    account: settings.storageAccount,
    prefix: "photos/",
  });
  return {
    remote,
    store: local ? localStore(join(ROOT, ".cache/photos/state")) : remote,
  };
}

function findShots(catalog, needle) {
  const matches = Object.entries(catalog.shots ?? {}).filter(
    ([key, s]) =>
      key === needle || s.files.some((f) => f === needle || f.includes(needle)),
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? `"${needle}" matches ${matches.length} photos: ${matches
            .map(([, s]) => s.pick)
            .slice(0, 8)
            .join(", ")}`
        : `No photo matches "${needle}".`,
    );
  }
  return matches;
}

async function status(store) {
  const catalog = (await store.readJson("catalog.json"))?.data;
  if (!catalog)
    return console.log(
      "No catalog yet. Run the Photo captions workflow first.",
    );
  const shots = Object.values(catalog.shots);
  const sessions = Object.values(catalog.sessions ?? {});
  const count = (fn) => shots.filter(fn).length;
  console.log(
    `Photos: ${Object.keys(catalog.files).length} files, ${shots.length} shots`,
  );
  console.log(`Analysed: ${count((s) => s.analysis)}`);
  console.log(
    `Matched to iNaturalist: ${count((s) => s.inat)} (${count((s) => s.inat?.quality === "research")} research grade)`,
  );
  console.log(
    `Flagged as not matching their iNaturalist ID: ${count((s) => s.analysis?.idCheck === "conflict")}`,
  );
  console.log(
    `Sessions with a written description: ${sessions.filter((r) => r.description).length}`,
  );
  const stuck = Object.entries(catalog.sessions ?? {}).filter(
    ([, r]) => r.problem,
  );
  for (const [slug, r] of stuck)
    console.log(`  ${slug}: description failed its checks (${r.problem})`);
}

async function preview(store, remote, only) {
  const catalog = (await store.readJson("catalog.json"))?.data;
  if (!catalog)
    return console.log(
      "No catalog yet. Run the Photo captions workflow first.",
    );
  const sessions = (await loadSessionsFromIndex(remote)).filter(
    (s) => !only || s.slug === only,
  );
  const blocks = sessions.map((s) => {
    const rec = catalog.sessions?.[s.slug] ?? {};
    const cards = s.photos
      .map((p) => {
        const caption = rec.captions?.[p.file];
        return `<figure><img src="${escape(p.url)}" loading="lazy" alt=""><figcaption>${caption ? escape(caption) : "<i>no caption yet</i>"}<small>${escape(p.file)} · ${caption?.length ?? 0} chars</small></figcaption></figure>`;
      })
      .join("\n");
    return `<section><h2>${escape(s.title)}</h2><p class="desc">${escape(rec.description ?? s.description ?? "")}${rec.problem ? `<br><b>Problem:</b> ${escape(rec.problem)}` : ""}</p><div class="grid">${cards}</div></section>`;
  });
  const html = `<!doctype html><meta charset="utf-8"><title>Photo captions</title>
<style>body{font:15px system-ui;margin:2rem;max-width:1300px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem}
figure{margin:0}img{width:100%;height:220px;object-fit:cover;background:#eee}figcaption{font-size:14px;margin-top:.3rem}small{display:block;color:#888;font-size:12px}
.desc{max-width:70ch;font-size:16px;line-height:1.5}h2{margin-top:2.5rem}</style>
<h1>Captions and descriptions</h1>${blocks.join("\n")}`;
  const out = join(ROOT, ".cache/photos/preview.html");
  await mkdir(join(ROOT, ".cache/photos"), { recursive: true });
  await writeFile(out, html);
  console.log(`Wrote ${out}`);
}

async function main() {
  const { store, remote } = await openStores();
  if (command === "status") return status(store);
  if (command === "preview") return preview(store, remote, rest[0]);
  if (command === "redo") {
    if (!rest[0])
      throw new Error(
        "Usage: npm run photos -- redo <photo> | --session <slug>",
      );
    const at = new Date().toISOString();
    let n = 0;
    await updateJson(store, "catalog.json", (catalog) => {
      const targets =
        rest[0] === "--session"
          ? Object.entries(catalog.shots).filter(([, s]) =>
              s.files.some((f) => f.startsWith(`${rest[1]}/`)),
            )
          : findShots(catalog, rest[0]);
      for (const [, s] of targets) s.redo = at;
      n = targets.length;
      return catalog;
    });
    console.log(
      `Marked ${n} ${n === 1 ? "photo" : "photos"} to be looked at again on the next run.`,
    );
    return;
  }
  if (command === "redescribe") {
    if (!rest[0]) throw new Error("Usage: npm run photos -- redescribe <slug>");
    await updateJson(store, "catalog.json", (catalog) => {
      const rec = catalog.sessions?.[rest[0]];
      if (!rec) throw new Error(`No session "${rest[0]}" in the catalog.`);
      delete rec.inputs;
      return catalog;
    });
    console.log(
      "The next run rewrites its description, unless you've edited it in /admin.",
    );
    return;
  }
  console.log(
    "Commands: status, preview [session], redo <photo> | --session <slug>, redescribe <slug>. Add --local for trial state.",
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
