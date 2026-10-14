#!/usr/bin/env node
/**
 * Private helper for the social auto-poster, run on your own machine.
 *
 *   npm run social -- status              counts, and roughly when the archive runs out
 *   npm run social -- preview [count]     open the next story and the upcoming posts as a page in your browser
 *                                         (.cache/social/preview.html; --no-open just writes it)
 *   npm run social -- skip <photo> [why]  never post this shot, as a post or a story
 *   npm run social -- unskip <photo>
 *   npm run social -- redraft <photo>     new opening and a different fact on the next Photo captions run
 *   npm run social -- opening <photo> <text...>
 *                                         your own words for the start of a planned post, used exactly as
 *                                         written (end it with an emoji, or one is added); --clear goes back
 *   npm run social -- note <trip|photo> <text...>
 *                                         what you were doing there ("canal boat tour", "pulled over on the
 *                                         drive up"), for the post openings and the trip's session
 *                                         description; --clear removes it
 *   npm run social -- notes               every trip with its note and how many photos it has left to post
 *   npm run social -- approve <photo>     only matters with SOCIAL_REQUIRE_APPROVAL=true
 *   npm run social -- retry <photo>|--all clear failed attempts so a photo can be tried again
 *
 * <photo> is a session/file id ("gunn-peak-june-2026/DSC01234.JPEG") or any
 * unique part of a filename ("DSC01234"). Reads private state with your
 * `az login`, from the storage account in site.config.ts (or
 * AZURE_STORAGE_ACCOUNT), or the local dry-run state with --local. Nothing here is uploaded anywhere except the catalog flags.
 *
 * The photo catalog (metadata/photos/) is shared with the website pipeline;
 * the poster's own ledger and queue live in metadata/social/.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, loadSettings } from "./settings.mjs";
import { blobStore, localStore, updateJson } from "../photos/store.mjs";
import { isPlannable, isPostable } from "./plan.mjs";
import { CROP_VERSION, canvasFor } from "./render.mjs";
import { STORY_LEDGER, pickStory, storyCandidates } from "./story.mjs";
import { localParts } from "./schedule.mjs";
import { showPage } from "../photos/open.mjs";

const args = process.argv
  .slice(2)
  .filter((a) => a !== "--local" && a !== "--no-open");
const local = process.argv.includes("--local");
const openPage = !process.argv.includes("--no-open");
const [command, ...rest] = args;
const settings = loadSettings();

const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function openStores() {
  return local
    ? {
        social: localStore(join(ROOT, ".cache/social/state")),
        photos: localStore(join(ROOT, ".cache/photos/state")),
      }
    : {
        social: await blobStore({
          account: settings.storageAccount,
          prefix: "social/",
        }),
        photos: await blobStore({
          account: settings.storageAccount,
          prefix: "photos/",
        }),
      };
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

async function status({ social, photos }) {
  const catalog = (await photos.readJson("catalog.json"))?.data;
  const ledger = (await social.readJson("ledger.json"))?.data ?? { posted: {} };
  if (!catalog)
    return console.log(
      "No catalog yet. Run the Photo captions workflow first.",
    );
  const shots = Object.entries(catalog.shots);
  const posted = new Set(Object.keys(ledger.posted ?? {}));
  const ready = shots.filter(
    ([k, s]) => isPostable(s) && !posted.has(k),
  ).length;
  const open = shots.filter(
    ([k, s]) => (!s.status || s.status === "new") && !s.skip && !posted.has(k),
  );
  const waiting = open.length;
  const unanalysed = open.filter(([, s]) => !s.analysis).length;
  const left = ready + waiting;
  const days = Math.ceil(left / settings.postsPerDay);
  const end = new Date(Date.now() + days * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  console.log(`Shots: ${shots.length}`);
  console.log(`Posted: ${posted.size}`);
  console.log(`Ready to post: ${ready}`);
  console.log(
    `Waiting their turn: ${waiting - unanalysed} (each post is written the week it's planned)`,
  );
  if (unanalysed)
    console.log(
      `Not analysed yet: ${unanalysed} (the next Photo captions run)`,
    );
  console.log(
    `Needs review: ${shots.filter(([, s]) => s.status === "needs_review").length}`,
  );
  const skipped = shots.filter(([, s]) => s.status === "skipped" || s.skip);
  const why = {};
  for (const [, s] of skipped) {
    const reason = s.skip ? "skipped by you" : (s.skipReason ?? "other");
    why[reason] = (why[reason] ?? 0) + 1;
  }
  console.log(
    `Skipped: ${skipped.length}${
      skipped.length
        ? ` (${Object.entries(why)
            .map(([r, n]) => `${r.replaceAll("-", " ")} ${n}`)
            .join(", ")})`
        : ""
    }`,
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
  const stories = (await social.readJson(STORY_LEDGER))?.data ?? {};
  const forStories = storyCandidates({
    catalog,
    storyLedger: stories,
    feedLedger: ledger,
    queue: (await social.readJson("queue.json"))?.data?.items ?? [],
  });
  const vertical = forStories.filter((c) => c.vertical).length;
  console.log(
    `Stories posted: ${Object.keys(stories.posted ?? {}).length}. Photos left for stories: ${vertical} vertical, ${forStories.length - vertical} others (one a day, vertical first).`,
  );
}

async function preview({ social, photos }, count) {
  const catalog = (await photos.readJson("catalog.json"))?.data;
  const queue = (await social.readJson("queue.json"))?.data?.items ?? [];
  if (!catalog)
    return console.log(
      "No catalog yet. Run the Photo captions workflow first.",
    );
  const card = (key, i) => {
    const s = catalog.shots[key];
    const f = catalog.files[s.pick];
    const src = local
      ? `file://${join(ROOT, "src/content/sessions", f.session, "images", f.file)}`
      : f.url;
    const id = s.inat
      ? `iNaturalist ${s.speciesOk ? "species" : "group-level"} ID`
      : "no iNaturalist match";
    // The photo inside the frame Instagram will show: cropped where the
    // catalog placed the crop (the middle until it has), or with borders.
    const fit = settings.tallImages === "pad" ? "pad" : "crop";
    const frame = canvasFor(f.width || 1, f.height || 1, { fit });
    const placed = f.crop?.v === CROP_VERSION ? f.crop.at : null;
    const at = `${Math.round((placed ?? 0.5) * 100)}%`;
    const fill = frame.crop
      ? ` style="object-fit:cover;object-position:${frame.crop.side === "y" ? `50% ${at}` : `${at} 50%`}"`
      : "";
    const number = i === undefined ? "" : `Post ${i + 1} · `;
    const shape = frame.padded
      ? " · posted whole, with borders"
      : frame.crop
        ? ` · cropped to fit${placed === null ? " (from the middle until the next Photo captions run places it)" : ""}`
        : "";
    const own = s.post?.own ? " · your words" : "";
    return `<article><div class="frame" style="aspect-ratio:${frame.width}/${frame.height}"><img src="${escape(src)}" loading="lazy" alt=""${fill}></div><div>
<p class="meta">${number}${escape(s.pick)} · appeal ${escape(s.post?.appeal ?? s.analysis?.appeal ?? "?")} · ${escape(id)}${shape}${own}${s.problem ? ` · ${escape(s.problem)}` : ""}</p>
<pre>${escape(s.post?.caption ?? "(no caption yet)")}</pre>
<p class="alt"><b>Alt text:</b> ${escape(s.post?.alt ?? "")}</p></div></article>`;
  };
  const review = Object.keys(catalog.shots).filter(
    (k) => catalog.shots[k].status === "needs_review",
  );
  const shown = queue.slice(0, count);
  // The photo the next story would use, shown in the story's 9:16 frame.
  const storyLedger = (await social.readJson(STORY_LEDGER))?.data ?? {};
  const story = pickStory({
    catalog,
    storyLedger,
    feedLedger: (await social.readJson("ledger.json"))?.data ?? {},
    queue,
    recent: Object.entries(storyLedger.posted ?? {})
      .sort((a, b) => String(a[1].at).localeCompare(String(b[1].at)))
      .map(([k]) => k),
    day: localParts(new Date(), settings.timezone).day,
  });
  const storySrc = story
    ? local
      ? `file://${join(ROOT, "src/content/sessions", story.file.session, "images", story.file.file)}`
      : story.file.url
    : "";
  const storyCard = story
    ? `<h1>Next story</h1><article><div class="frame" style="aspect-ratio:9/16"><img src="${escape(storySrc)}" loading="lazy" alt=""></div><div>
<p class="meta">${escape(story.shot.pick)} · ${story.vertical ? "vertical" : "not vertical: no vertical photos are left"}</p>
<p class="lede">One a day, at a different time each day. The photo alone: where it isn't 9:16, a blurred copy of it fills the rest of the frame.</p></div></article>`
    : "";
  const html = `<!doctype html><meta charset="utf-8"><title>Upcoming posts</title>
<style>body{font:15px system-ui;margin:2rem;max-width:1100px}article{display:grid;grid-template-columns:340px 1fr;gap:1.4rem;margin:0 0 2.2rem}
.frame{width:340px;background:#1b1b1b;display:flex}.frame img{width:100%;height:100%;object-fit:contain}
pre{white-space:pre-wrap;font:15px system-ui;margin:.4rem 0}.meta{color:#666;font-size:13px;margin:0}.alt{color:#444;font-size:13px}.lede{color:#444;max-width:70ch}</style>
${storyCard}
<h1>Next ${shown.length} posts</h1>
<p class="lede">In the order they'll go out, ${settings.postsPerDay} a day. Each photo is shown in the frame Instagram will use. ${settings.tallImages === "pad" ? "Where it doesn't fit, it's posted whole with plain borders (black or white, matched to the photo when it's posted)." : "Where it's taller than 4:5 or wider than 1.91:1 it's cropped to fit, from the middle unless one end is empty sky, water or blur."}</p>
${shown.map((key, i) => card(key, i)).join("\n")}
${
  review.length
    ? `<h1>Needs review (${review.length})</h1>${review
        .slice(0, 50)
        .map((key) => card(key))
        .join("\n")}`
    : ""
}`;
  const out = join(ROOT, ".cache/social/preview.html");
  await mkdir(join(ROOT, ".cache/social"), { recursive: true });
  await writeFile(out, html);
  showPage(out, { open: openPage });
}

/** Every trip's slug, from the catalog. */
const tripSlugs = (catalog) => [
  ...new Set(Object.values(catalog.shots ?? {}).map((s) => s.session)),
];

/**
 * A note on a trip (any unique part of its slug) or a photo. Notes are
 * private: the openings may draw on them, but they're never posted as is.
 */
async function setNote(stores, target, text, clear) {
  const catalog = (await stores.photos.readJson("catalog.json"))?.data ?? {
    shots: {},
  };
  const slugs = tripSlugs(catalog);
  const trips = slugs.filter((s) => s === target || s.includes(target));
  const exact = slugs.find((s) => s === target);
  let where;
  let id;
  if (exact || trips.length === 1) {
    where = "trips";
    id = exact ?? trips[0];
  } else if (trips.length > 1) {
    throw new Error(
      `"${target}" matches ${trips.length} trips: ${trips.slice(0, 8).join(", ")}`,
    );
  } else {
    where = "photos";
    [id] = findShot(catalog, target);
  }
  const note = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!clear && !note)
    throw new Error("Usage: npm run social -- note <trip|photo> <text...>");
  await updateJson(
    stores.social,
    "notes.json",
    (n) => {
      n.trips = n.trips ?? {};
      n.photos = n.photos ?? {};
      if (clear) delete n[where][id];
      else n[where][id] = note;
      return n;
    },
    { fallback: { trips: {}, photos: {} } },
  );
  const which = where === "trips" ? id : catalog.shots[id].pick;
  console.log(
    clear
      ? `${which}: note removed.`
      : `${which}: saved. The next Photo captions run rewrites ${where === "trips" ? "this trip's session description and its planned posts" : "this photo's post, if it's planned,"} with it.`,
  );
}

async function listNotes(stores) {
  const catalog = (await stores.photos.readJson("catalog.json"))?.data ?? {
    shots: {},
  };
  const ledger = (await stores.social.readJson("ledger.json"))?.data ?? {
    posted: {},
  };
  const notes = (await stores.social.readJson("notes.json"))?.data ?? {};
  const left = new Map(tripSlugs(catalog).map((slug) => [slug, 0]));
  for (const [key, s] of Object.entries(catalog.shots ?? {}))
    if (isPlannable(s) && !ledger.posted?.[key])
      left.set(s.session, left.get(s.session) + 1);
  const rows = [...left.entries()].sort((a, b) => b[1] - a[1]);
  for (const [slug, n] of rows)
    console.log(`${slug} (${n} to post): ${notes.trips?.[slug] ?? "-"}`);
  const photos = Object.entries(notes.photos ?? {});
  if (photos.length) {
    console.log("\nPhotos:");
    for (const [key, note] of photos)
      console.log(`${catalog.shots?.[key]?.pick ?? key}: ${note}`);
  }
  console.log(
    `\n${Object.keys(notes.trips ?? {}).length} of ${rows.length} trips have a note. Add one with: npm run social -- note <trip> "what you were doing there"`,
  );
}

async function main() {
  const stores = await openStores();
  if (command === "status") return status(stores);
  if (command === "preview")
    return preview(stores, Number(rest[0]) || settings.postsPerDay * 7);
  if (["skip", "unskip", "approve", "redraft"].includes(command)) {
    if (!rest[0])
      throw new Error(`Usage: npm run social -- ${command} <photo>`);
    const pick = await setFlag(stores.photos, rest[0], (shot) => {
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
      skip: "Skipped it. It won't be posted, as a post or a story.",
      unskip:
        "Unskipped it. The next Photo captions run puts it back in the plan.",
      redraft:
        "The next Photo captions run writes it a new opening and first line (the website's caption changes too) and gives its post a different fact.",
    }[command];
    console.log(`${pick}: ${done}`);
    return;
  }
  if (command === "opening") {
    const clear = rest.includes("--clear");
    const [needle, ...words] = rest.filter((a) => a !== "--clear");
    const text = words.join(" ").replace(/\s+/g, " ").trim();
    if (!needle || (!clear && !text))
      throw new Error(
        'Usage: npm run social -- opening <photo> "your words" (or --clear)',
      );
    const pick = await setFlag(stores.photos, needle, (shot) => {
      if (clear) delete shot.opening;
      else shot.opening = { text, at: new Date().toISOString() };
    });
    console.log(
      clear
        ? `${pick}: back to a written opening on the next Photo captions run.`
        : `${pick}: saved. The next Photo captions run puts your words at the start of its post.`,
    );
    return;
  }
  if (command === "note") {
    const clear = rest.includes("--clear");
    const words = rest.filter((a) => a !== "--clear");
    if (!words[0])
      throw new Error(
        "Usage: npm run social -- note <trip|photo> <text...> (or --clear)",
      );
    return setNote(stores, words[0], words.slice(1).join(" "), clear);
  }
  if (command === "notes") return listNotes(stores);
  if (command === "retry") {
    if (!rest[0])
      throw new Error("Usage: npm run social -- retry <photo> | --all");
    const catalog = (await stores.photos.readJson("catalog.json"))?.data ?? {
      shots: {},
    };
    const key = rest[0] === "--all" ? null : findShot(catalog, rest[0])[0];
    let cleared = 0;
    for (const file of ["ledger.json", STORY_LEDGER])
      await updateJson(
        stores.social,
        file,
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
    "Commands: status, preview [count], skip <photo> [why], unskip <photo>, redraft <photo>, opening <photo> <text>, note <trip|photo> <text>, notes, approve <photo>, retry <photo>|--all. Add --local for dry-run state.",
  );
}

main().catch((e) => {
  const message = String(e?.message ?? e);
  if (
    /DefaultAzureCredential|CredentialUnavailable|AADSTS|az login/i.test(
      message,
    )
  )
    console.error("Sign in to Azure first with `az login`, then try again.");
  console.error(message.split("\n")[0]);
  process.exit(1);
});
