#!/usr/bin/env node
/**
 * Private helper for the social auto-poster, run on your own machine.
 *
 *   npm run social -- status              counts, and roughly when the archive runs out
 *   npm run social -- preview [count]     write .cache/social/preview.html with upcoming posts
 *   npm run social -- skip <photo> [why]  never post this shot
 *   npm run social -- unskip <photo>
 *   npm run social -- redraft <photo>     rewrite this post's caption on the next catalog run
 *   npm run social -- approve <photo>     only matters with SOCIAL_REQUIRE_APPROVAL=true
 *   npm run social -- retry <photo>|--all clear failed attempts so a photo can be tried again
 *
 * <photo> is a session/file id ("gunn-peak-june-2026/DSC01234.JPEG") or any
 * unique part of a filename ("DSC01234"). Reads private state with your
 * `az login` (AZURE_STORAGE_ACCOUNT must be set), or the local dry-run state
 * with --local. Nothing here is uploaded anywhere except the catalog flags.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, loadSettings } from "./settings.mjs";
import { blobStore, localStore, updateJson } from "./store.mjs";
import { isPostable } from "./plan.mjs";

const args = process.argv.slice(2).filter((a) => a !== "--local");
const local = process.argv.includes("--local");
const [command, ...rest] = args;
const settings = loadSettings();

const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function openStore() {
  return local
    ? localStore(join(ROOT, ".cache/social/state"))
    : blobStore({ account: settings.storageAccount });
}

function findShot(catalog, needle) {
  const matches = Object.entries(catalog.shots ?? {}).filter(
    ([key, s]) =>
      key === needle || s.files.some((f) => f === needle || f.includes(needle)),
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? `"${needle}" matches ${matches.length} shots: ${matches
            .map(([, s]) => s.pick)
            .slice(0, 8)
            .join(", ")}`
        : `No photo matches "${needle}".`,
    );
  }
  return matches[0];
}

async function setFlag(store, needle, apply) {
  const { data } = await updateJson(store, "catalog.json", (catalog) => {
    const [, shot] = findShot(catalog, needle);
    apply(shot);
    return catalog;
  });
  return findShot(data, needle)[1].pick;
}

async function status(store) {
  const catalog = (await store.readJson("catalog.json"))?.data;
  const ledger = (await store.readJson("ledger.json"))?.data ?? { posted: {} };
  if (!catalog)
    return console.log("No catalog yet. Run the catalog workflow first.");
  const shots = Object.entries(catalog.shots);
  const posted = new Set(Object.keys(ledger.posted ?? {}));
  const ready = shots.filter(
    ([k, s]) => isPostable(s) && !posted.has(k),
  ).length;
  const waiting = shots.filter(
    ([k, s]) => (!s.status || s.status === "new") && !posted.has(k),
  ).length;
  const left = ready + waiting;
  const days = Math.ceil(left / settings.postsPerDay);
  const end = new Date(Date.now() + days * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  console.log(`Shots: ${shots.length}`);
  console.log(`Posted: ${posted.size}`);
  console.log(`Ready to post: ${ready}`);
  console.log(`Waiting for a caption: ${waiting}`);
  console.log(
    `Needs review: ${shots.filter(([, s]) => s.status === "needs_review").length}`,
  );
  console.log(
    `Skipped: ${shots.filter(([, s]) => s.status === "skipped" || s.skip).length}`,
  );
  console.log(
    `Already on the account: ${shots.filter(([, s]) => s.blocked).length}`,
  );
  const leftOut = Object.values(ledger.failed ?? {}).filter(
    (f) => f.count >= 2,
  ).length;
  if (leftOut)
    console.log(
      `Left out after failing twice: ${leftOut} (npm run social -- retry --all)`,
    );
  console.log(
    `At ${settings.postsPerDay} a day, the archive lasts about ${days} more days (around ${end}).`,
  );
}

async function preview(store, count) {
  const catalog = (await store.readJson("catalog.json"))?.data;
  const queue = (await store.readJson("queue.json"))?.data?.items ?? [];
  if (!catalog)
    return console.log("No catalog yet. Run the catalog workflow first.");
  const card = (key) => {
    const s = catalog.shots[key];
    const f = catalog.files[s.pick];
    const src = local
      ? `file://${join(ROOT, "src/content/sessions", f.session, "images", f.file)}`
      : f.url;
    const id = s.inat
      ? `iNat ${s.inat.via} match, ${s.speciesOk ? "species named" : "group level"}`
      : "no iNat match";
    return `<article><img src="${escape(src)}" loading="lazy"><div>
<p class="meta">${escape(s.pick)} · appeal ${escape(s.post?.appeal ?? "?")} · ${escape(id)} · ${escape(s.status)}${s.problem ? ` · ${escape(s.problem)}` : ""}</p>
<pre>${escape(s.post?.caption ?? "(no caption yet)")}</pre>
<p class="alt"><b>Alt text:</b> ${escape(s.post?.alt ?? "")}</p></div></article>`;
  };
  const review = Object.keys(catalog.shots).filter(
    (k) => catalog.shots[k].status === "needs_review",
  );
  const html = `<!doctype html><meta charset="utf-8"><title>Upcoming posts</title>
<style>body{font:15px system-ui;margin:2rem;max-width:1100px}article{display:grid;grid-template-columns:340px 1fr;gap:1.2rem;margin:0 0 2rem}
img{width:340px;height:auto;background:#eee}pre{white-space:pre-wrap;font:15px system-ui;margin:.4rem 0}.meta{color:#666;font-size:13px;margin:0}.alt{color:#444;font-size:13px}</style>
<h1>Next ${Math.min(count, queue.length)} posts</h1>${queue.slice(0, count).map(card).join("\n")}
${review.length ? `<h1>Needs review (${review.length})</h1>${review.slice(0, 50).map(card).join("\n")}` : ""}`;
  const out = join(ROOT, ".cache/social/preview.html");
  await mkdir(join(ROOT, ".cache/social"), { recursive: true });
  await writeFile(out, html);
  console.log(`Wrote ${out}`);
}

async function main() {
  const store = await openStore();
  if (command === "status") return status(store);
  if (command === "preview")
    return preview(store, Number(rest[0]) || settings.postsPerDay * 7);
  if (["skip", "unskip", "approve", "redraft"].includes(command)) {
    if (!rest[0])
      throw new Error(`Usage: npm run social -- ${command} <photo>`);
    const pick = await setFlag(store, rest[0], (shot) => {
      if (command === "skip") {
        shot.skip = true;
        if (rest[1]) shot.note = rest.slice(1).join(" ");
      } else if (command === "unskip") {
        delete shot.skip;
        delete shot.note;
      } else if (command === "redraft") {
        shot.redraft = new Date().toISOString();
      } else {
        // Bound to this exact draft: a rewritten caption needs approving again.
        if (!shot.post?.draftedAt)
          throw new Error("That photo has no caption to approve yet.");
        shot.approved = shot.post.draftedAt;
      }
    });
    const done = {
      approve: "Approved it.",
      skip: "Skipped it. It won't be posted.",
      unskip: "Unskipped it. The next catalog run puts it back in the plan.",
      redraft: "The next catalog run rewrites its caption.",
    }[command];
    console.log(`${pick}: ${done}`);
    return;
  }
  if (command === "retry") {
    if (!rest[0])
      throw new Error("Usage: npm run social -- retry <photo> | --all");
    const catalog = (await store.readJson("catalog.json"))?.data ?? {
      shots: {},
    };
    const key = rest[0] === "--all" ? null : findShot(catalog, rest[0])[0];
    let cleared = 0;
    await updateJson(
      store,
      "ledger.json",
      (l) => {
        l.failed = l.failed ?? {};
        for (const k of Object.keys(l.failed)) {
          if (key === null || k === key) {
            delete l.failed[k];
            cleared++;
          }
        }
        return l;
      },
      { fallback: { posted: {}, failed: {} } },
    );
    console.log(
      `Cleared ${cleared} failed ${cleared === 1 ? "attempt" : "attempts"}. They can be posted again.`,
    );
    return;
  }
  console.log(
    "Commands: status, preview [count], skip <photo> [why], unskip <photo>, redraft <photo>, approve <photo>, retry <photo>|--all. Add --local for dry-run state.",
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
