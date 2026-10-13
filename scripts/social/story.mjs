#!/usr/bin/env node
/**
 * Stories: one a day, a photo from the archive with nothing added.
 *
 * Usage:
 *   node scripts/social/story.mjs [--local] [--force]
 *
 * The day's story goes out at a time picked within the story window, different
 * each day (schedule.mjs), from the same half-hourly runs as the feed posts.
 * --force posts today's story now, whatever the time, but never a second one.
 *
 * Which photo: vertical ones first, while any are left, so the 9:16 frame
 * needs as little fill as possible (render.mjs). Never one already used for a
 * story, one queued for the feed, or one the feed posted in the last month,
 * and nothing the photo checks left out or you skipped. Outings rotate.
 *
 * Instagram's API can't add music, a location or any sticker to a story, so
 * a story is the photo alone. Exactly-once and failures work like feed posts
 * (post.mjs), with their own day records (story-days/) and ledger
 * (stories.json). SOCIAL_STORIES=true publishes (only while SOCIAL_LIVE is
 * true); "rehearse" does everything but publish.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./settings.mjs";
import { updateJson } from "../photos/store.mjs";
import { decideStory, localParts, previousDay } from "./schedule.mjs";
import {
  NotDue,
  PAUSE_MS,
  busyShots,
  openPoster,
  reconcile,
  recordPosted,
  recordStrike,
} from "./post.mjs";
import { resolveToken } from "./token.mjs";
import { notReadyToPublish } from "./instagram.mjs";
import { renderStory } from "./render.mjs";
import { info, redact, registerSecret } from "../photos/redact.mjs";

export const STORY_LEDGER = "stories.json";
export const storyDayFile = (day) => `story-days/${day}.json`;
const FEED_RECENT_MS = 30 * 24 * 3600 * 1000;
/** A story is 1080 px wide; anything smaller would be upscaled. */
const MIN_SIDE = 1080;
/** 3:2 turned on its side and anything taller counts as vertical. */
const VERTICAL = 1.2;

const tallness = (file) => file.height / file.width;

function jitter(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * The photos a story may still use: not used for a story already, not queued
 * for the feed or posted there in the last month, and nothing the photo
 * checks left out (blurry, people, low resolution, a mismatched ID) or you
 * skipped. Each with `vertical` set.
 */
export function storyCandidates({
  catalog,
  storyLedger = {},
  feedLedger = {},
  queue = [],
  busy = new Set(),
  now = new Date(),
}) {
  const queued = new Set(queue);
  const out = [];
  for (const [key, s] of Object.entries(catalog.shots ?? {})) {
    const file = catalog.files?.[s.pick];
    if (!file?.width || !file?.height || !file.url) continue;
    if (!s.analysis || s.analysis.skip || s.analysis.idCheck === "conflict")
      continue;
    if (s.skip || s.unreadable) continue;
    if (Math.min(file.width, file.height) < MIN_SIDE) continue;
    if (storyLedger.posted?.[key] || busy.has(key)) continue;
    if ((storyLedger.failed?.[key]?.count ?? 0) >= 2) continue;
    if (queued.has(key)) continue;
    const fed = feedLedger.posted?.[key];
    if (fed && now - new Date(fed.at) < FEED_RECENT_MS) continue;
    out.push({ key, s, file, vertical: tallness(file) >= VERTICAL });
  }
  return out;
}

/**
 * The photo for the next story, or null when none is left. Vertical photos
 * first while any are left, the closest to 9:16 first among similar ratings;
 * not the same outing as the last two stories, nor a frame from the same
 * burst as one in the last ten.
 *
 * @param recent shot keys of recent stories, oldest first
 * @param day    today, which varies the order a little from day to day
 */
export function pickStory({
  catalog,
  storyLedger = {},
  feedLedger = {},
  queue = [],
  recent = [],
  busy = new Set(),
  now = new Date(),
  day = "",
}) {
  const lately = recent.map((k) => catalog.shots?.[k]).filter(Boolean);
  const lastSessions = new Set(lately.slice(-2).map((s) => s.session));
  const lastBursts = new Set(
    lately
      .slice(-10)
      .map((s) => s.burst)
      .filter(Boolean),
  );
  const candidates = storyCandidates({
    catalog,
    storyLedger,
    feedLedger,
    queue,
    busy,
    now,
  });
  const vertical = candidates.filter((c) => c.vertical);
  const pool = vertical.length ? vertical : candidates;
  const score = (c) => {
    let x = Number(c.s.analysis.appeal) || 5;
    // Closer to the story's 9:16 means less of the frame is fill.
    x += Math.min(tallness(c.file), 16 / 9) - 1;
    if (lastSessions.has(c.s.session)) x -= 3;
    if (c.s.burst && lastBursts.has(c.s.burst)) x -= 10;
    // Already seen in the feed, more than a month ago.
    if (feedLedger.posted?.[c.key]) x -= 2;
    return x + jitter(`${day}|${c.key}`) * 0.8;
  };
  const best = pool
    .map((c) => ({ c, x: score(c) }))
    .sort((a, b) => b.x - a.x || a.c.key.localeCompare(b.c.key))[0]?.c;
  return best
    ? {
        key: best.key,
        shot: best.s,
        file: { ...best.file, id: best.s.pick },
        vertical: best.vertical,
      }
    : null;
}

export async function runStory({
  settings,
  store,
  // Where the photo catalog lives (metadata/photos/); the stories' own state is in `store`.
  photos = store,
  makeClient,
  env = process.env,
  now = new Date(),
  force = false,
  readImage,
  render = renderStory,
  log = info,
}) {
  if (settings.stories === "off") {
    log("Stories are off.");
    return { outcome: "off" };
  }
  const publishing = settings.live && settings.stories === "on";
  const today = localParts(now, settings.timezone).day;
  const yesterday = previousDay(today);

  // Like the feed's dry run, a rehearsal hands the story to Instagram exactly
  // as a real one and stops before publishing. It needs the token and an
  // image link Instagram can reach, so local runs skip that part.
  const rehearse =
    !publishing && store.kind === "blob" && Boolean(env.IG_ACCESS_TOKEN);
  let client = null;
  if (publishing || rehearse) {
    const token = await resolveToken({
      settings,
      env,
      store,
      makeClient,
      allowRefresh: true,
      now,
    });
    client = makeClient(token);
  }

  for (const day of [yesterday, today])
    await reconcile({
      store,
      client: publishing ? client : null,
      day,
      today,
      now,
      dayPath: storyDayFile,
      ledger: STORY_LEDGER,
    });

  // --force skips the wait for the day's time, never the one-a-day rule.
  const allowed = (d) => {
    const decision = decideStory({ now, settings, day: d });
    return decision.due ||
      (force && decision.reason !== "today's story is done")
      ? null
      : decision.reason;
  };
  const todayRec = (await store.readJson(storyDayFile(today)))?.data ?? {
    date: today,
    attempts: [],
  };
  const notYet = allowed(todayRec);
  if (notYet) {
    log(`No story due: ${notYet}.`);
    return { outcome: "not-due" };
  }

  const catalog = (await photos.readJson("catalog.json"))?.data;
  const storyLedger = (await store.readJson(STORY_LEDGER))?.data ?? {};
  const recent = Object.entries(storyLedger.posted ?? {})
    .sort((a, b) => String(a[1].at).localeCompare(String(b[1].at)))
    .map(([k]) => k);
  const pick = catalog
    ? pickStory({
        catalog,
        storyLedger,
        feedLedger: (await store.readJson("ledger.json"))?.data ?? {},
        queue: (await store.readJson("queue.json"))?.data?.items ?? [],
        recent,
        busy: busyShots([
          (await store.readJson(storyDayFile(yesterday)))?.data,
          todayRec,
        ]),
        now,
        day: today,
      })
    : null;
  if (!pick) {
    log("No photo is left for a story.");
    return { outcome: "nothing-ready" };
  }

  let n;
  try {
    await updateJson(
      store,
      storyDayFile(today),
      (d) => {
        d.date = today;
        d.attempts = d.attempts ?? [];
        if (allowed(d)) throw new NotDue();
        if (busyShots([d]).has(pick.key)) throw new NotDue();
        n = d.attempts.length;
        d.attempts.push({
          n,
          shot: pick.key,
          state: publishing ? "claimed" : "dry-run",
          claimedAt: now.toISOString(),
        });
        return d;
      },
      { fallback: { date: today, attempts: [] } },
    );
  } catch (e) {
    if (e instanceof NotDue) {
      log("Another run already took today's story.");
      return { outcome: "not-due" };
    }
    throw e;
  }

  const setAttempt = (patch) =>
    updateJson(store, storyDayFile(today), (d) => {
      Object.assign(d.attempts[n], patch);
      return d;
    });

  const media = `media/${randomUUID()}.jpg`;
  let containerId = null;
  let keepMedia = false;
  try {
    let rendered;
    try {
      rendered = await render(await readImage(pick.file));
    } catch (e) {
      e.photoProblem = true;
      throw e;
    }
    await store.putMedia(media, rendered.buffer);
    const shape = `${rendered.photo.width}x${rendered.photo.height} photo on ${rendered.width}x${rendered.height}`;

    if (!publishing) {
      let checked = "";
      if (client) {
        // Made exactly as a real story is, then never published: Instagram
        // lets an unpublished container expire on its own within a day.
        const rehearsal = await client.createStoryContainer({
          imageUrl: await store.mediaUrl(media),
        });
        registerSecret(rehearsal);
        const status = await client.waitUntilReady(rehearsal);
        if (status !== "FINISHED") {
          const e = new Error(`Instagram didn't accept the story (${status}).`);
          e.photoProblem = status === "ERROR";
          throw e;
        }
        await setAttempt({ rehearsed: true });
        checked = " Instagram accepted it as a story.";
      }
      log(
        `Story rehearsal: today's story is ready (${shape}).${checked} Nothing was published.`,
      );
      keepMedia = store.kind === "local";
      return { outcome: "dry-run", media, rehearsed: Boolean(client) };
    }

    const limit = await client.publishingLimit();
    if (limit.used >= limit.total)
      throw new Error("Instagram's daily publishing limit is used up.");
    containerId = await client.createStoryContainer({
      imageUrl: await store.mediaUrl(media),
    });
    registerSecret(containerId);
    await setAttempt({ state: "container", containerId, media });
    const status = await client.waitUntilReady(containerId);
    if (status !== "FINISHED")
      throw new Error(`The story container ended as ${status}.`);
    const mediaId = await client.publish(containerId);
    registerSecret(mediaId);
    const publishedAt = new Date().toISOString();
    await setAttempt({ state: "published", mediaId, publishedAt });
    await recordPosted(
      store,
      pick.key,
      { at: publishedAt, day: today, mediaId },
      STORY_LEDGER,
    );
    log(`Published today's story (${shape}).`);
    return { outcome: "published" };
  } catch (e) {
    const status = containerId
      ? await client.containerStatus(containerId).catch(() => null)
      : "NONE";
    if (status === "PUBLISHED") {
      const publishedAt = new Date().toISOString();
      await setAttempt({ state: "published", publishedAt });
      await recordPosted(
        store,
        pick.key,
        { at: publishedAt, day: today, mediaId: null },
        STORY_LEDGER,
      );
      log("Published today's story.");
      return { outcome: "published" };
    }
    const reason = redact(e).slice(0, 300);
    if (status === "ERROR" || (status === "NONE" && e.photoProblem)) {
      // The photo itself is the problem: another one gets a turn today.
      await setAttempt({ state: "failed", error: reason });
      if (publishing) await recordStrike(store, pick.key, reason, STORY_LEDGER);
    } else if (status === "NONE" || status === "EXPIRED") {
      // Token, limits, network, storage: not the photo's fault. Back off.
      await updateJson(store, storyDayFile(today), (d) => {
        Object.assign(d.attempts[n], { state: "failed", error: reason });
        d.pausedUntil = new Date(now.getTime() + PAUSE_MS).toISOString();
        return d;
      });
    }
    // Otherwise the container stays in flight for the next run to settle.
    if (
      notReadyToPublish(e) &&
      (status === "FINISHED" || status === "IN_PROGRESS")
    )
      log(
        "Instagram accepted the story but wouldn't publish it yet. It's kept as it is, and the next run publishes it.",
      );

    // Fail the run (GitHub emails) once a day; later failures that day are quiet.
    const alreadyReported = (await store.readJson(storyDayFile(today)))?.data
      ?.failureAlerted;
    await updateJson(store, storyDayFile(today), (d) => ({
      ...d,
      failureAlerted: true,
    }));
    if (!alreadyReported) throw e;
    log(`The story failed again today; already reported. ${reason}`);
    return { outcome: "failed" };
  } finally {
    if (!keepMedia) await store.remove(media).catch(() => {});
  }
}

async function main() {
  const local = process.argv.includes("--local");
  const force = process.argv.includes("--force");
  const { settings, store, photos, makeClient, readImage } = await openPoster({
    local,
  });
  const result = await runStory({
    settings,
    store,
    photos,
    makeClient,
    force,
    readImage,
  });
  if (local && result.media)
    info(`Rendered file: ${join(ROOT, ".cache/social/state", result.media)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(redact(e?.stack ?? e));
    process.exit(1);
  });
}
