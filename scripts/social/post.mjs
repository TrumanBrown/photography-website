#!/usr/bin/env node
/**
 * Social post: publish the next queued photo when one of today's slots is due.
 *
 * Usage:
 *   node scripts/social/post.mjs [--local] [--force]
 *
 * Exactly-once, even when GitHub drops, delays or overlaps runs:
 *   - each day has one private record; a post is claimed in it with a
 *     conditional write before anything is sent to Instagram
 *   - the media container id is saved before publishing; the next run asks
 *     Instagram what became of it. Only ERROR or EXPIRED count as "not
 *     posted"; an unknown status keeps the slot blocked rather than risk a repeat
 *   - a shot that's posted or in flight today or yesterday can't be picked again
 *   - the ledger of posted shots is the source of truth for "never twice"
 *
 * Failures: only a problem with the photo itself (Meta rejecting the image, a
 * missing or unreadable file) counts against the photo; two strikes and it's
 * left out (`npm run social -- retry` clears them). Anything else (expired
 * token, rate limits, outages) pauses posting for two hours and alerts at most
 * once a day, without blaming the photo.
 *
 * When SOCIAL_LIVE isn't "true" it does everything except publish.
 * Logs say what happened, never what was posted or where.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ROOT, loadSettings } from "./settings.mjs";
import { blobStore, localStore, updateJson } from "../photos/store.mjs";
import { IN_FLIGHT, decide, localParts, previousDay } from "./schedule.mjs";
import { isPostable, planQueue } from "./plan.mjs";
import { resolveToken } from "./token.mjs";
import { createClient } from "./instagram.mjs";
import { renderForInstagram } from "./render.mjs";
import { info, redact, registerSecret } from "../photos/redact.mjs";

const dayFile = (day) => `days/${day}.json`;
const STALE_CLAIM_MS = 20 * 60 * 1000;
const PAUSE_MS = 2 * 3600 * 1000;

class NotDue extends Error {}

const emptyLedger = () => ({ posted: {}, failed: {} });

async function recordPosted(store, key, entry) {
  // Runs re-confirm recent posts every time; only write when something's new.
  if ((await store.readJson("ledger.json"))?.data?.posted?.[key]) return;
  await updateJson(
    store,
    "ledger.json",
    (l) => {
      l.posted = l.posted ?? {};
      if (!l.posted[key]) l.posted[key] = entry;
      return l;
    },
    { fallback: emptyLedger() },
  );
}

/** A strike against the photo itself. Two and it's left out until retried. */
async function recordStrike(store, key, reason) {
  await updateJson(
    store,
    "ledger.json",
    (l) => {
      l.failed = l.failed ?? {};
      const prev = l.failed[key];
      l.failed[key] = {
        count: (prev?.count ?? 0) + 1,
        at: new Date().toISOString(),
        reason: String(reason).slice(0, 200),
      };
      return l;
    },
    { fallback: emptyLedger() },
  );
}

/** Shots posted or still in flight in these day records. */
function busyShots(records) {
  const busy = new Set();
  for (const rec of records) {
    for (const a of rec?.attempts ?? []) {
      if (a.state === "published" || IN_FLIGHT.has(a.state)) busy.add(a.shot);
    }
  }
  return busy;
}

/** Up to two tag-able feature accounts for this kind of subject (Facebook Login only). */
function userTagsFor(config, shot) {
  const community = shot.post?.hashtags?.[1]?.replace(/^#/, "");
  const accounts = (config.hubAccounts?.[community] ?? []).slice(0, 2);
  return accounts.map((username, i) => ({
    username,
    x: 0.25 + i * 0.5,
    y: 0.9,
  }));
}

async function nextShot(store, photos, settings, busy) {
  const catalog = (await photos.readJson("catalog.json"))?.data;
  if (!catalog) return null;
  const queue = (await store.readJson("queue.json"))?.data?.items ?? [];
  const ledger = (await store.readJson("ledger.json"))?.data ?? emptyLedger();
  const config = (await store.readJson("config.json"))?.data ?? {};
  const usable = (key) => {
    const s = catalog.shots?.[key];
    return (
      s &&
      isPostable(s) &&
      s.post?.caption &&
      !ledger.posted?.[key] &&
      !busy.has(key) &&
      (ledger.failed?.[key]?.count ?? 0) < 2 &&
      // An approval covers the exact draft it was given to, not a rewrite.
      (!settings.requireApproval ||
        (s.approved && s.approved === s.post.draftedAt))
    );
  };
  let key = queue.find(usable);
  if (!key) {
    // The plan ran out (or was never made); pick directly from the catalog.
    const posted = new Set(Object.keys(ledger.posted ?? {}));
    key = planQueue({
      shots: catalog.shots,
      posted,
      count: 50,
      postsPerDay: settings.postsPerDay,
    }).find(usable);
  }
  if (!key) return null;
  const shot = catalog.shots[key];
  return {
    key,
    shot,
    file: { ...catalog.files[shot.pick], id: shot.pick },
    locationId: config.locations?.[shot.session] ?? null,
    userTags: userTagsFor(config, shot),
  };
}

/** Finish, or write off, anything an earlier run left half done. */
async function reconcile({ store, client, day, today, now }) {
  const rec = (await store.readJson(dayFile(day)))?.data;
  for (const a of rec?.attempts ?? []) {
    let patch = null;
    let strike = null;
    if (a.state === "claimed" && now - new Date(a.claimedAt) > STALE_CLAIM_MS) {
      patch = { state: "abandoned" };
    } else if (a.state === "container" && client) {
      const status = await client
        .containerStatus(a.containerId)
        .catch(() => null);
      if (status === "PUBLISHED") {
        patch = {
          state: "published",
          publishedAt: a.publishedAt ?? now.toISOString(),
        };
      } else if (status === "FINISHED" && day === today) {
        try {
          const mediaId = await client.publish(a.containerId);
          patch = {
            state: "published",
            mediaId,
            publishedAt: new Date().toISOString(),
          };
        } catch {
          // Leave it in flight; the next run asks again.
        }
      } else if (status === "FINISHED") {
        // Ready but never published, from an earlier day: let it lapse.
        patch = { state: "abandoned", error: "container from an earlier day" };
      } else if (status === "ERROR") {
        patch = {
          state: "failed",
          error: "Instagram could not process the image",
        };
        strike = patch.error;
      } else if (status === "EXPIRED") {
        patch = { state: "failed", error: "container expired" };
      }
      // Anything else (in progress, or the status couldn't be read) stays in
      // flight and keeps the slot blocked. Writing it off could post it twice.
    }
    if (patch) {
      await updateJson(store, dayFile(day), (d) => {
        Object.assign(d.attempts[a.n], patch);
        return d;
      });
      if (a.media) await store.remove(a.media).catch(() => {});
      if (strike) await recordStrike(store, a.shot, strike);
    }
    if ((patch?.state ?? a.state) === "published") {
      await recordPosted(store, a.shot, {
        at: patch?.publishedAt ?? a.publishedAt,
        day,
        mediaId: patch?.mediaId ?? a.mediaId ?? null,
      });
    }
  }
}

export async function runPost({
  settings,
  store,
  // Where the photo catalog lives (metadata/photos/); the poster's own state is in `store`.
  photos = store,
  makeClient,
  env = process.env,
  now = new Date(),
  force = false,
  readImage,
  render = renderForInstagram,
  log = info,
}) {
  const today = localParts(now, settings.timezone).day;
  const yesterday = previousDay(today);
  let alert = null;

  let state = (await store.readJson("state.json"))?.data ?? {};
  if (settings.live && !state.liveSince) {
    state = (
      await updateJson(store, "state.json", (s) => ({ ...s, liveSince: today }))
    ).data;
  }

  // A dry run rehearses everything short of publishing when it can reach
  // Instagram: the token (refreshed on schedule, so it can't lapse while you're
  // still trying things out), the account's permission to publish, and Instagram
  // fetching and accepting the image and caption. That needs the token and an
  // image link Instagram can reach, so local dry runs skip it.
  const rehearse =
    !settings.live && store.kind === "blob" && Boolean(env.IG_ACCESS_TOKEN);
  let client = null;
  if (settings.live || rehearse) {
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

  // Only a live run settles posts in flight. A dry run never publishes anything.
  for (const day of [yesterday, today])
    await reconcile({
      store,
      client: settings.live ? client : null,
      day,
      today,
      now,
    });

  // One email per missed day: a dropped schedule never fails on its own.
  // Only full days after going live count; the switch-on day may start late.
  if (settings.live && state.liveSince && yesterday > state.liveSince) {
    const y = (await store.readJson(dayFile(yesterday)))?.data;
    const published = (y?.attempts ?? []).some((a) => a.state === "published");
    if (!published && !y?.alerted && !state.exhausted) {
      await updateJson(
        store,
        dayFile(yesterday),
        (d) => ({
          ...d,
          date: yesterday,
          attempts: d.attempts ?? [],
          alerted: true,
        }),
        { fallback: { date: yesterday, attempts: [] } },
      );
      alert =
        "No post was published yesterday. Check this workflow's recent runs.";
    }
  }

  const todayRec = (await store.readJson(dayFile(today)))?.data ?? {
    date: today,
    attempts: [],
  };
  const yesterdayRec = (await store.readJson(dayFile(yesterday)))?.data;
  const decision = decide({ now, settings, day: todayRec });
  if (!decision.due && !force) {
    log(`Nothing due: ${decision.reason}.`);
    return { outcome: "not-due", alert };
  }

  const busy = busyShots([yesterdayRec, todayRec]);
  const pick = await nextShot(store, photos, settings, busy);
  if (!pick) {
    log("Nothing is ready to post.");
    if (settings.live)
      await updateJson(store, "state.json", (s) => ({ ...s, exhausted: true }));
    return { outcome: "nothing-ready", alert };
  }
  if (state.exhausted)
    await updateJson(store, "state.json", (s) => ({ ...s, exhausted: false }));

  let n;
  try {
    await updateJson(
      store,
      dayFile(today),
      (d) => {
        d.date = today;
        d.attempts = d.attempts ?? [];
        if (!force && !decide({ now, settings, day: d }).due)
          throw new NotDue();
        if (busyShots([d]).has(pick.key)) throw new NotDue();
        n = d.attempts.length;
        d.attempts.push({
          n,
          shot: pick.key,
          state: settings.live ? "claimed" : "dry-run",
          claimedAt: now.toISOString(),
        });
        return d;
      },
      { fallback: { date: today, attempts: [] } },
    );
  } catch (e) {
    if (e instanceof NotDue) {
      log("Another run already took this slot.");
      return { outcome: "not-due", alert };
    }
    throw e;
  }

  const setAttempt = (patch) =>
    updateJson(store, dayFile(today), (d) => {
      Object.assign(d.attempts[n], patch);
      return d;
    });

  const media = `media/${randomUUID()}.jpg`;
  let containerId = null;
  let keepMedia = false;
  try {
    let rendered;
    try {
      rendered = await render(await readImage(pick.file), {
        padColor: settings.padColor,
      });
    } catch (e) {
      e.photoProblem = true;
      throw e;
    }
    await store.putMedia(media, rendered.buffer);

    if (!settings.live) {
      let checked = "";
      if (client) {
        const limit = await client.publishingLimit();
        // Made exactly as a real post is, then never published: Instagram lets
        // an unpublished container expire on its own within a day.
        const rehearsal = await client.createImageContainer({
          imageUrl: await store.mediaUrl(media),
          caption: pick.shot.post.caption,
          altText: pick.shot.post.alt,
          locationId: pick.locationId,
          userTags: pick.userTags,
        });
        registerSecret(rehearsal);
        const status = await client.waitUntilReady(rehearsal);
        if (status !== "FINISHED") {
          const e = new Error(`Instagram didn't accept the post (${status}).`);
          e.photoProblem = status === "ERROR";
          throw e;
        }
        await setAttempt({ rehearsed: true });
        checked = ` Instagram accepted the image and caption, and the account can publish (${limit.used} of ${limit.total} posts used in the last 24 hours).`;
      }
      log(
        `Dry run: post ${n + 1} for today is ready (${rendered.width}x${rendered.height}${rendered.padded ? ", with borders" : ""}).${checked} ` +
          'Nothing was published because SOCIAL_LIVE is not "true".',
      );
      keepMedia = store.kind === "local";
      return { outcome: "dry-run", alert, media, rehearsed: Boolean(client) };
    }

    const limit = await client.publishingLimit();
    if (limit.used >= limit.total)
      throw new Error("Instagram's daily publishing limit is used up.");
    containerId = await client.createImageContainer({
      imageUrl: await store.mediaUrl(media),
      caption: pick.shot.post.caption,
      altText: pick.shot.post.alt,
      locationId: pick.locationId,
      userTags: pick.userTags,
    });
    registerSecret(containerId);
    await setAttempt({ state: "container", containerId, media });
    const status = await client.waitUntilReady(containerId);
    if (status !== "FINISHED")
      throw new Error(`The media container ended as ${status}.`);
    const mediaId = await client.publish(containerId);
    registerSecret(mediaId);
    const publishedAt = new Date().toISOString();
    await setAttempt({ state: "published", mediaId, publishedAt });
    await recordPosted(store, pick.key, {
      at: publishedAt,
      day: today,
      mediaId,
    });
    log("Published 1 post.");
    return { outcome: "published", alert };
  } catch (e) {
    const status = containerId
      ? await client.containerStatus(containerId).catch(() => null)
      : "NONE";
    if (status === "PUBLISHED") {
      const publishedAt = new Date().toISOString();
      await setAttempt({ state: "published", publishedAt });
      await recordPosted(store, pick.key, {
        at: publishedAt,
        day: today,
        mediaId: null,
      });
      log("Published 1 post.");
      return { outcome: "published", alert };
    }
    const reason = redact(e).slice(0, 300);
    if (status === "ERROR" || (status === "NONE" && e.photoProblem)) {
      // The photo itself is the problem.
      await setAttempt({ state: "failed", error: reason });
      if (settings.live) await recordStrike(store, pick.key, reason);
    } else if (status === "NONE" || status === "EXPIRED") {
      // Token, limits, network, storage: not the photo's fault. Back off.
      await updateJson(store, dayFile(today), (d) => {
        Object.assign(d.attempts[n], { state: "failed", error: reason });
        d.pausedUntil = new Date(now.getTime() + PAUSE_MS).toISOString();
        return d;
      });
    }
    // Otherwise the container stays in flight for the next run to settle.

    // Fail the run (GitHub emails) once a day; later failures that day are quiet.
    const alreadyReported = (await store.readJson(dayFile(today)))?.data
      ?.failureAlerted;
    await updateJson(store, dayFile(today), (d) => ({
      ...d,
      failureAlerted: true,
    }));
    if (!alreadyReported) throw e;
    log(`Posting failed again today; already reported. ${reason}`);
    return { outcome: "failed", alert };
  } finally {
    if (!keepMedia) await store.remove(media).catch(() => {});
  }
}

async function main() {
  const local = process.argv.includes("--local");
  const force = process.argv.includes("--force");
  const settings = loadSettings();
  const store = local
    ? localStore(join(ROOT, ".cache/social/state"))
    : await blobStore({ account: settings.storageAccount, prefix: "social/" });
  const photos = local
    ? localStore(join(ROOT, ".cache/photos/state"))
    : await blobStore({ account: settings.storageAccount, prefix: "photos/" });
  if (process.env.IG_USER_ID) registerSecret(process.env.IG_USER_ID);
  const makeClient = (token) =>
    createClient({
      mode: settings.loginMode,
      token,
      apiVersion: settings.apiVersion,
      userId: process.env.IG_USER_ID || null,
    });
  const readImage = async (file) => {
    const localPath = join(
      ROOT,
      "src/content/sessions",
      file.session,
      "images",
      file.file,
    );
    if (local && existsSync(localPath)) return readFile(localPath);
    const res = await fetch(file.url);
    if (!res.ok)
      throw new Error(`Could not download the photo (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  };
  const result = await runPost({
    settings,
    store,
    photos,
    makeClient,
    force,
    readImage,
  });
  if (local && result.media)
    info(`Rendered file: ${join(ROOT, ".cache/social/state", result.media)}`);
  if (result.alert) {
    console.error(result.alert);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(redact(e?.stack ?? e));
    process.exit(1);
  });
}
