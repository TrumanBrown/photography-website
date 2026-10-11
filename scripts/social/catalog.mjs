#!/usr/bin/env node
/**
 * Social catalog: keep a private, ready-to-post record of every photo on the site.
 *
 *   1. scan   fingerprint new photos and read their camera facts
 *   2. group  files into shots (one shutter press, however many files it became)
 *   3. iNat   refresh the observation index and match shots to it
 *   4. draft  write the post for shots that don't have one (vision model)
 *   5. block  fingerprint what's already on the Instagram account
 *   6. plan   choose the next week of posts
 *
 * Usage:
 *   node scripts/social/catalog.mjs [--local] [--limit 60] [--provider mock] [--no-instagram]
 *
 * --local reads src/content/sessions and keeps state in .cache/social/state, for
 * dry runs. Output is counts only: captions, account details and URLs are never
 * printed, because this runs in a public repository's Actions logs.
 */
import { join } from "node:path";
import { ROOT, loadSettings, siteOwner } from "./settings.mjs";
import { blobStore, localStore, updateJson } from "./store.mjs";
import {
  loadSessionsFromIndex,
  loadSessionsLocal,
  readPhoto,
} from "./sessions.mjs";
import { readFacts, gearLine } from "./exif.mjs";
import { dhash, hamming } from "./hash.mjs";
import { orientedSize } from "./render.mjs";
import { burstGroups, chooseVersion, padFraction, shotKey } from "./shots.mjs";
import {
  fetchTaxon,
  hashMatcher,
  learnOffset,
  pickObservation,
  refreshIndex,
  speciesUsable,
  timeCandidates,
} from "./inat.mjs";
import { askJson, encodeForModel, modelFor, providerFor } from "./model.mjs";
import {
  comparePrompt,
  compileLexicon,
  finishPost,
  loadVoiceRules,
  mockDraft,
  postPrompt,
} from "./compose.mjs";
import { GROUPS, buildHashtags } from "./hashtags.mjs";
import { planQueue } from "./plan.mjs";
import { resolveToken } from "./token.mjs";
import { createClient } from "./instagram.mjs";
import { info, redact, warn } from "./redact.mjs";

function parseArgs(argv) {
  const out = { local: false, limit: 60, provider: null, instagram: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--local") out.local = true;
    else if (argv[i] === "--limit")
      out.limit = Math.max(0, Number(argv[++i]) || 0);
    else if (argv[i] === "--provider") out.provider = argv[++i];
    else if (argv[i] === "--no-instagram") out.instagram = false;
  }
  return out;
}

async function pool(items, size, fn) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(size, items.length) },
    async () => {
      while (next < items.length) await fn(items[next++]);
    },
  );
  await Promise.all(workers);
}

const emptyCatalog = () => ({
  version: 1,
  files: {},
  shots: {},
  offsets: {},
  fingerprinted: {},
});

/** Fields only a person sets (via cli.mjs); the stored copy is always the source of truth for them. */
const USER_FIELDS = ["skip", "note", "approved", "redraft"];

async function saveCatalog(store, catalog) {
  await updateJson(
    store,
    "catalog.json",
    (stored) => {
      for (const [key, mine] of Object.entries(catalog.shots)) {
        const theirs = stored.shots?.[key];
        for (const field of USER_FIELDS) {
          if (theirs && field in theirs) mine[field] = theirs[field];
          else delete mine[field];
        }
      }
      return catalog;
    },
    { fallback: emptyCatalog() },
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settings = loadSettings();
  const store = args.local
    ? localStore(join(ROOT, ".cache/social/state"))
    : await blobStore({ account: settings.storageAccount });
  const sessions = args.local
    ? await loadSessionsLocal(ROOT)
    : await loadSessionsFromIndex(store);
  const sessionsBySlug = new Map(sessions.map((s) => [s.slug, s]));
  const photos = sessions.flatMap((s) => s.photos);
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const config = (await store.readJson("config.json"))?.data ?? {};
  const catalog =
    (await store.readJson("catalog.json"))?.data ?? emptyCatalog();
  const ledger = (await store.readJson("ledger.json"))?.data ?? {
    posted: {},
    failed: {},
  };

  // 1. scan
  for (const id of Object.keys(catalog.files))
    if (!photoById.has(id)) delete catalog.files[id];
  // Files fingerprinted with an older hash format are rescanned.
  const toScan = photos.filter((p) => catalog.files[p.id]?.hash?.length !== 32);
  let scanned = 0;
  let scanFailed = 0;
  await pool(toScan, 4, async (p) => {
    try {
      const buf = await readPhoto(p);
      const [facts, size, hash] = await Promise.all([
        readFacts(buf),
        orientedSize(buf),
        dhash(buf),
      ]);
      catalog.files[p.id] = {
        session: p.session,
        file: p.file,
        url: p.url,
        ...size,
        hash,
        facts,
      };
      if (++scanned % 100 === 0)
        info(`Scanned ${scanned} of ${toScan.length} new photos...`);
    } catch {
      scanFailed++;
    }
  });

  // 2. group into shots
  const groups = new Map();
  for (const [id, f] of Object.entries(catalog.files)) {
    const key = shotKey(f.facts, f.hash);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id, ...f });
  }
  const shots = {};
  for (const [key, files] of groups) {
    const pick = chooseVersion(files);
    shots[key] = {
      ...(catalog.shots[key] ?? { status: "new" }),
      files: files.map((f) => f.id).sort(),
      pick: pick.id,
      session: pick.session,
      location: sessionsBySlug.get(pick.session)?.location ?? null,
      clock: pick.facts?.clock ?? null,
      sessionDate: sessionsBySlug.get(pick.session)?.date ?? null,
    };
  }
  catalog.shots = shots;
  const bursts = burstGroups(
    Object.entries(shots).map(([key, s]) => ({
      key,
      session: s.session,
      clock: s.clock,
    })),
  );
  for (const [key, s] of Object.entries(shots))
    s.burst = bursts.get(key) ?? null;

  // 3. iNaturalist
  let index = (await store.readJson("inat-index.json"))?.data ?? null;
  const taxa = (await store.readJson("taxa.json"))?.data ?? {};
  if (settings.inatUser) {
    try {
      index = await refreshIndex(index, settings.inatUser, {
        onProgress: (n) => info(`Fingerprinted ${n} iNaturalist photos...`),
      });
      await store.writeJson("inat-index.json", index);
    } catch (e) {
      warn(`iNaturalist refresh failed; using the last index. ${redact(e)}`);
    }
  }
  const TAXON_MAX_AGE_MS = 60 * 24 * 3600 * 1000;
  const taxonFor = async (id) => {
    if (!id) return null;
    const cached = taxa[id];
    if (
      !cached ||
      Date.now() - new Date(cached.fetchedAt ?? 0) > TAXON_MAX_AGE_MS
    ) {
      try {
        taxa[id] = await fetchTaxon(id);
      } catch (e) {
        warn(`Taxon lookup failed. ${redact(e)}`);
        return cached ?? null;
      }
    }
    return taxa[id];
  };
  const matcher = index ? hashMatcher(index) : null;
  const offsetPairs = new Map();
  if (matcher) {
    for (const s of Object.values(shots)) {
      const hits = matcher(
        s.files.map((id) => catalog.files[id].hash),
        s.clock,
      );
      if (!hits.length) {
        if (s.inat?.via === "frame") delete s.inat;
        continue;
      }
      for (const h of hits) await taxonFor(index.observations[h.obsId]?.taxon);
      const best = pickObservation(hits, index, taxa);
      if (!best) continue;
      s.inat = {
        obs: best.obsId,
        taxon: best.obs.taxon,
        quality: best.obs.quality,
        via: "frame",
      };
      if (s.clock && best.obs.clock) {
        if (!offsetPairs.has(s.session)) offsetPairs.set(s.session, []);
        offsetPairs
          .get(s.session)
          .push({ shotClock: s.clock, obsClock: best.obs.clock });
      }
    }
    for (const [session, pairs] of offsetPairs)
      catalog.offsets[session] = learnOffset(pairs);
    // Same-moment matches are re-confirmed below only when a shot is (re)drafted.
    for (const s of Object.values(shots)) {
      if (s.inat?.via === "moment") {
        const obs = index.observations[s.inat.obs];
        if (!obs || obs.quality !== "research") delete s.inat;
        else s.inat.taxon = obs.taxon;
      }
    }
  }

  // 4. draft
  const provider = args.provider ?? providerFor(process.env);
  const model = modelFor(provider);
  const voiceRules = loadVoiceRules();
  const lexicon = compileLexicon(index?.names ?? []);
  const owner = siteOwner();
  const pointer =
    config.linkLine ??
    (settings.domain
      ? `The rest of this set is on ${settings.domain}, link in bio`
      : "");
  const posted = new Set(Object.keys(ledger.posted ?? {}));

  // A draft is stale when the identification it relied on has changed since,
  // or when someone asked for it to be rewritten (npm run social -- redraft).
  for (const s of Object.values(shots)) {
    if (s.redraft && (!s.post?.draftedAt || s.post.draftedAt < s.redraft)) {
      if (
        s.status === "ready" ||
        s.status === "needs_review" ||
        s.status === "skipped"
      ) {
        s.status = "new";
        delete s.skipReason;
      }
      continue;
    }
    if (s.status !== "ready" || !s.post) continue;
    const obs = s.inat ? index?.observations[s.inat.obs] : null;
    const taxon = s.inat ? taxa[s.inat.taxon] : null;
    const ok = Boolean(obs && taxon && speciesUsable(obs, taxon));
    if ((s.post.taxon ?? null) !== (ok ? taxon.id : null)) s.status = "new";
  }

  const pending = Object.entries(shots)
    .filter(([key, s]) => !posted.has(key) && (!s.status || s.status === "new"))
    .sort(
      ([ak, a], [bk, b]) =>
        (b.sessionDate ?? "").localeCompare(a.sessionDate ?? "") ||
        ak.localeCompare(bk),
    )
    .slice(0, args.limit);

  let drafted = 0;
  if (pending.length && !provider) {
    info(
      `${pending.length} photos are waiting for captions, but no model API key is set.`,
    );
  } else if (pending.length) {
    info(
      `Drafting up to ${pending.length} posts with ${provider === "mock" ? "the offline mock" : "the vision model"}...`,
    );
    const draftOne = async ([, s]) => {
      try {
        await draftShot(s);
      } catch (e) {
        s.status = "new";
        warn(`A draft failed and will be retried next run. ${redact(e)}`);
      }
      if (++drafted % 10 === 0) {
        await saveCatalog(store, catalog);
        await store.writeJson("taxa.json", taxa);
        info(`Drafted ${drafted} of ${pending.length}...`);
      }
    };
    await pool(pending, 3, draftOne);
  }

  async function draftShot(s) {
    const file = catalog.files[s.pick];
    const markSkip = (reason) => {
      s.status = "skipped";
      s.skipReason = reason;
    };
    if (file.width < settings.minWidth) return markSkip("low-resolution");
    if (
      settings.tallImages === "skip" &&
      padFraction(file.width, file.height) > 0
    ) {
      return markSkip("outside-instagram-shape");
    }
    const session = sessionsBySlug.get(s.session) ?? {
      title: s.session,
      location: "",
      description: "",
    };
    const buf = await readPhoto({
      ...(photoById.get(s.pick) ?? {}),
      url: file.url,
    });
    const photo64 = await encodeForModel(buf);

    // Tier 2: an observation made at the same moment, confirmed by eye (the model's).
    if (!s.inat && index && s.clock && provider !== "mock") {
      const cands = timeCandidates(
        s.clock,
        index,
        catalog.offsets[s.session] ?? 0,
      );
      const shown = [];
      for (const c of cands) {
        const taxon = await taxonFor(c.obs.taxon);
        const url = Object.values(c.obs.photos)[0]?.replace(
          "/square.",
          "/medium.",
        );
        if (!taxon || !url) continue;
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          shown.push({
            c,
            taxon,
            b64: await encodeForModel(
              Buffer.from(await res.arrayBuffer()),
              768,
            ),
          });
        } catch {
          // Skip a candidate whose photo won't load.
        }
      }
      if (shown.length) {
        const verdict = await askJson({
          provider,
          model,
          prompt: comparePrompt(
            shown.map((x) =>
              x.taxon.common
                ? `${x.taxon.common} (${x.taxon.name})`
                : x.taxon.name,
            ),
          ),
          images: [photo64, ...shown.map((x) => x.b64)],
        });
        const n = Number(verdict?.match);
        const hit =
          verdict?.confidence === "high" && Number.isInteger(n)
            ? shown[n - 2]
            : null;
        if (hit)
          s.inat = {
            obs: hit.c.obsId,
            taxon: hit.c.obs.taxon,
            quality: hit.c.obs.quality,
            via: "moment",
          };
      }
    }

    const obs = s.inat ? index?.observations[s.inat.obs] : null;
    const taxon = s.inat ? await taxonFor(s.inat.taxon) : null;
    const speciesOk = Boolean(obs && taxon && speciesUsable(obs, taxon));
    const gear = gearLine(file.facts);
    let feedback = null;
    let finished = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const draft = await askJson({
        provider,
        model,
        prompt: postPrompt({
          owner,
          session,
          facts: file.facts,
          gear,
          taxon,
          speciesOk,
          voiceRules,
          feedback,
        }),
        images: [photo64],
        mock: () => mockDraft({ session, speciesOk, taxon }),
      });
      if (["blurry", "people", "unclear"].includes(draft.skip))
        return markSkip(draft.skip);
      const group = GROUPS.includes(draft.group) ? draft.group : "other";
      const hashtags = buildHashtags({
        taxon,
        speciesOk,
        group,
        facts: file.facts,
        session,
        proposedPlace: draft.place_tag,
        landmark: draft.landmark,
        hubTags: config.hubHashtags ?? {},
      });
      finished = finishPost({
        draft,
        session,
        gear,
        taxon,
        speciesOk,
        hashtags,
        pointer,
        lexicon,
      });
      if (!finished.problem) {
        s.post = {
          caption: finished.caption,
          alt: finished.alt,
          hashtags,
          group,
          appeal: Math.min(
            10,
            Math.max(1, Math.round(Number(draft.appeal) || 5)),
          ),
          taxon: speciesOk ? taxon.id : null,
          model,
          draftedAt: new Date().toISOString(),
        };
        s.speciesOk = speciesOk;
        s.status = "ready";
        delete s.problem;
        return;
      }
      feedback = finished.problem;
    }
    s.status = "needs_review";
    s.problem = finished?.problem ?? "draft failed";
    s.speciesOk = speciesOk;
  }

  // 5. what's already on the account (posted by hand, or before this existed)
  if (args.instagram && !args.local && process.env.IG_ACCESS_TOKEN) {
    try {
      const makeClient = (token) =>
        createClient({
          mode: settings.loginMode,
          token,
          apiVersion: settings.apiVersion,
          userId: process.env.IG_USER_ID,
        });
      const token = await resolveToken({ settings, store, makeClient });
      const media = await makeClient(token).recentMedia({ max: 1000 });
      for (const m of media) {
        if (catalog.fingerprinted[m.id]?.length === 32) continue;
        const url = m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url;
        if (!url) continue;
        try {
          const res = await fetch(url);
          if (res.ok)
            catalog.fingerprinted[m.id] = await dhash(
              Buffer.from(await res.arrayBuffer()),
              { trim: true },
            );
        } catch {
          // Try again next run.
        }
      }
      const prints = Object.values(catalog.fingerprinted);
      for (const [key, s] of Object.entries(shots)) {
        if (posted.has(key)) continue;
        const onAccount = s.files.some((id) =>
          // Generous on purpose: a false match only skips a near-identical frame.
          prints.some((p) => hamming(catalog.files[id].hash, p) <= 12),
        );
        if (onAccount) s.blocked = "already-on-account";
        else delete s.blocked;
      }
    } catch (e) {
      warn(`Could not check the account's existing posts. ${redact(e)}`);
    }
  }

  // 6. plan the next week
  const failedForGood = Object.entries(ledger.failed ?? {})
    .filter(([, f]) => f.count >= 2)
    .map(([k]) => k);
  const recent = Object.entries(ledger.posted ?? {})
    .sort((a, b) => String(a[1].at).localeCompare(String(b[1].at)))
    .slice(-60)
    .map(([k]) => k);
  const items = planQueue({
    shots,
    posted: new Set([...posted, ...failedForGood]),
    recent,
    count: settings.postsPerDay * 7,
    postsPerDay: settings.postsPerDay,
  });

  await saveCatalog(store, catalog);
  await store.writeJson("taxa.json", taxa);
  await store.writeJson("queue.json", {
    plannedAt: new Date().toISOString(),
    items,
  });

  const all = Object.entries(shots);
  const count = (fn) => all.filter(([k, s]) => fn(s, k)).length;
  info(
    [
      `Photos: ${photos.length} (${scanned} newly scanned${scanFailed ? `, ${scanFailed} unreadable` : ""}).`,
      `Shots: ${all.length}.`,
      `Ready: ${count((s, k) => s.status === "ready" && !posted.has(k))}.`,
      `Needs review: ${count((s) => s.status === "needs_review")}.`,
      `Skipped: ${count((s) => s.status === "skipped" || s.skip)}.`,
      `Waiting for a draft: ${count((s, k) => (!s.status || s.status === "new") && !posted.has(k))}.`,
      `Posted: ${posted.size}.`,
      `iNaturalist matches: ${count((s) => s.inat?.via === "frame")} exact frame, ${count((s) => s.inat?.via === "moment")} same moment.`,
      `Planned: ${items.length}.`,
    ].join(" "),
  );
}

main().catch((e) => {
  console.error(redact(e?.stack ?? e));
  process.exit(1);
});
