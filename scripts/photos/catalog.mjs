#!/usr/bin/env node
/**
 * The photo pipeline: look at every photograph once, then write everything
 * public from that one record.
 *
 *   1. scan      fingerprint new photos and read their camera facts
 *   2. group     files into shots (one shutter press, however many files it became)
 *   3. iNat      refresh your observation index and match shots to it
 *   4. analyse   one vision call per shot that hasn't had one (analyse.mjs)
 *   5. website   per-photo captions (code) and session descriptions (one
 *                text-only call per session), written into each _session.json
 *   6. instagram only with SOCIAL_ENABLED=true: check the account, plan the
 *                next week, and write the posts that plan needs
 *
 * Usage:
 *   node scripts/photos/catalog.mjs [options]
 *     --limit <n>      most photos to analyse this run (default 300)
 *     --only <slug>    just this session (repeatable)
 *     --no-write       render everything but leave _session.json files alone
 *     --overwrite      replace descriptions and captions even where they
 *                      differ from what this pipeline last wrote
 *     --no-instagram   skip stage 6
 *     --provider mock  run without a model
 *     --local          read src/content/sessions, keep state in .cache/
 *     --local-state    real sessions, but keep state in .cache/ (for trials)
 *
 * Output is counts only: captions, account details and URLs are never
 * printed, because this runs in a public repository's Actions logs.
 */
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./settings.mjs";
import { loadSettings, siteOwner } from "../social/settings.mjs";
import { blobStore, localStore, updateJson } from "./store.mjs";
import {
  loadSessionsFromIndex,
  loadSessionsLocal,
  readPhoto,
} from "./sessions.mjs";
import { gearLine, orientedSize, readFacts } from "./exif.mjs";
import { dhash, hamming } from "./hash.mjs";
import { burstGroups, chooseVersion, padFraction, shotKey } from "./shots.mjs";
import {
  fetchTaxon,
  hashMatcher,
  learnOffset,
  pickObservation,
  refreshIndex,
  timeCandidates,
} from "./inat.mjs";
import { askJson, encodeForModel, modelFor, providerFor } from "./model.mjs";
import {
  ANALYSIS_VERSION,
  analysisPrompt,
  comparePrompt,
  idLevel,
  mockAnalysis,
  normaliseAnalysis,
} from "./analyse.mjs";
import {
  allowedNames,
  captionFor,
  descriptionProblems,
  descriptionPrompt,
  hasRealTitle,
  openerOf,
  placeLabel,
  sessionDigest,
} from "./website.mjs";
import { blobSidecars, mergeWebsiteText } from "./sidecars.mjs";
import { compileLexicon, loadVoiceRules } from "./text.mjs";
import {
  bodyPrompt,
  finishPost,
  mockBody,
  placeLine,
  sessionNames,
} from "../social/compose.mjs";
import { buildHashtags } from "../social/hashtags.mjs";
import { planQueue } from "../social/plan.mjs";
import { resolveToken } from "../social/token.mjs";
import { createClient } from "../social/instagram.mjs";
import { info, redact, warn } from "./redact.mjs";

/** Bump when the description prompt changes enough that every session should be redone. */
const DESCRIPTION_VERSION = 2;

function parseArgs(argv) {
  const out = {
    local: false,
    localState: false,
    limit: 300,
    provider: null,
    instagram: true,
    write: true,
    overwrite: false,
    only: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--local") out.local = true;
    else if (a === "--local-state") out.localState = true;
    else if (a === "--limit") out.limit = Math.max(0, Number(argv[++i]) || 0);
    else if (a === "--provider") out.provider = argv[++i];
    else if (a === "--only") out.only.push(argv[++i]);
    else if (a === "--no-write") out.write = false;
    else if (a === "--overwrite") out.overwrite = true;
    else if (a === "--no-instagram") out.instagram = false;
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
  version: 2,
  files: {},
  shots: {},
  sessions: {},
  offsets: {},
  fingerprinted: {},
});

/** Fields only a person sets (npm run photos / npm run social); the stored copy always wins. */
const USER_FIELDS = ["skip", "note", "approved", "redraft", "redo"];

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
      for (const [slug, mine] of Object.entries(catalog.sessions ?? {})) {
        const theirs = stored.sessions?.[slug]?.redescribe;
        if (theirs) mine.redescribe = theirs;
      }
      return catalog;
    },
    { fallback: emptyCatalog() },
  );
}

const sha = (value) =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settings = loadSettings();
  const onDisk = args.local || args.localState;
  const remote = args.local
    ? null
    : await blobStore({ account: settings.storageAccount, prefix: "photos/" });
  const store = onDisk ? localStore(join(ROOT, ".cache/photos/state")) : remote;
  const social = onDisk
    ? localStore(join(ROOT, ".cache/social/state"))
    : await blobStore({ account: settings.storageAccount, prefix: "social/" });
  const sessions = args.local
    ? await loadSessionsLocal(ROOT)
    : await loadSessionsFromIndex(remote);
  const sessionsBySlug = new Map(sessions.map((s) => [s.slug, s]));
  const only = new Set(args.only);
  const inScope = (slug) => !only.size || only.has(slug);
  const photos = sessions.flatMap((s) => s.photos);
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const catalog =
    (await store.readJson("catalog.json"))?.data ?? emptyCatalog();
  catalog.sessions ??= {};

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
  for (const [id, f] of Object.entries(catalog.files)) {
    const p = photoById.get(id);
    if (p?.url) f.url = p.url;
  }

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
      ...(catalog.shots[key] ?? {}),
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
    // A same-moment match follows its observation's current identification.
    for (const s of Object.values(shots)) {
      if (s.inat?.via === "moment") {
        const obs = index.observations[s.inat.obs];
        if (!obs || obs.quality !== "research") delete s.inat;
        else {
          s.inat.taxon = obs.taxon;
          s.inat.quality = obs.quality;
        }
      }
    }
  }
  for (const s of Object.values(shots))
    if (s.inat) await taxonFor(s.inat.taxon);
  const taxonOf = (s) => (s.inat ? (taxa[s.inat.taxon] ?? null) : null);

  // 4. analyse
  const provider = args.provider ?? providerFor(process.env);
  const model = modelFor(provider);
  const lexicon = compileLexicon(index?.names ?? []);
  const sessionOf = (slug) =>
    sessionsBySlug.get(slug) ?? {
      slug,
      title: slug,
      location: "",
      description: "",
    };
  // A photo the model refuses (its content filter) or that failed three runs
  // in a row isn't tried again until someone asks (npm run photos -- redo).
  const gaveUp = (s) =>
    (s.unreadable || (s.failures ?? 0) >= 3) &&
    !(s.redo && s.redo > (s.failedAt ?? ""));
  const needsAnalysis = (s) =>
    !gaveUp(s) &&
    (!s.analysis ||
      s.analysis.v !== ANALYSIS_VERSION ||
      (s.analysis.taxon ?? null) !== (s.inat?.taxon ?? null) ||
      (s.redo && s.redo > (s.analysis.at ?? "")));
  const pending = Object.values(shots)
    .filter((s) => inScope(s.session) && needsAnalysis(s))
    .sort(
      (a, b) =>
        (b.sessionDate ?? "").localeCompare(a.sessionDate ?? "") ||
        a.pick.localeCompare(b.pick),
    )
    .slice(0, args.limit);
  let analysed = 0;
  let analyseFailed = 0;
  if (pending.length && !provider) {
    warn(
      `${pending.length} photos are waiting to be analysed, but no model is configured (docs/photos.md).`,
    );
  } else if (pending.length) {
    info(
      `Analysing ${pending.length} photos with ${provider === "mock" ? "the offline mock" : "the vision model"}...`,
    );
    await pool(pending, 4, async (s) => {
      try {
        await analyseShot(s);
        analysed++;
        delete s.failures;
        delete s.failedAt;
        delete s.unreadable;
      } catch (e) {
        analyseFailed++;
        s.failures = (s.failures ?? 0) + 1;
        s.failedAt = new Date().toISOString();
        if (/content_policy_violation|content_filter/i.test(String(e?.message)))
          s.unreadable = "content-filter";
        warn(
          s.unreadable
            ? "The model's content filter refused a photo, so it won't be tried again. It keeps any caption its iNaturalist ID gives it."
            : `An analysis failed and will be retried next run. ${redact(e)}`,
        );
      }
      if ((analysed + analyseFailed) % 20 === 0) {
        await saveCatalog(store, catalog);
        await store.writeJson("taxa.json", taxa);
        info(`Analysed ${analysed + analyseFailed} of ${pending.length}...`);
      }
    });
  }

  async function analyseShot(s) {
    const file = catalog.files[s.pick];
    const session = sessionOf(s.session);
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

    const taxon = s.inat ? await taxonFor(s.inat.taxon) : null;
    const raw = await askJson({
      provider,
      model,
      prompt: analysisPrompt({
        session,
        clock: s.clock,
        taxon,
        quality: s.inat?.quality ?? null,
        allowedNames: allowedNames(session),
      }),
      images: [photo64],
      mock: mockAnalysis,
    });
    const { analysis, problems } = normaliseAnalysis(raw, { taxon });
    s.analysis = {
      v: ANALYSIS_VERSION,
      ...analysis,
      taxon: s.inat?.taxon ?? null,
      model,
      at: new Date().toISOString(),
      ...(problems.length ? { problems } : {}),
    };
  }

  // 5. website
  const fileShot = new Map();
  for (const [key, s] of Object.entries(shots))
    for (const id of s.files) fileShot.set(id, key);
  const voiceRules = loadVoiceRules();
  const sidecars =
    args.write && !onDisk
      ? await blobSidecars({ account: settings.storageAccount })
      : null;
  const site = {
    captions: 0,
    described: 0,
    describeFailed: 0,
    written: 0,
    kept: 0,
    waiting: 0,
  };

  const plans = [];
  for (const session of sessions) {
    if (!inScope(session.slug)) continue;
    const rec = (catalog.sessions[session.slug] ??= {});
    const captions = new Map();
    const sessionShots = new Map();
    for (const p of session.photos) {
      const key = fileShot.get(p.id);
      const s = key ? shots[key] : null;
      if (!s) continue;
      sessionShots.set(key, s);
      const taxon = taxonOf(s);
      if (!s.analysis && !(gaveUp(s) && idLevel(taxon) === "species")) continue;
      captions.set(
        p.file,
        captionFor({
          // A photo the model never saw can still be named by its iNaturalist ID.
          analysis: s.analysis ?? { group: "other", count: 1, idCheck: "fits" },
          taxon,
          session,
          lexicon,
        }),
      );
    }
    site.captions += captions.size;
    const list = [...sessionShots.values()];
    const complete =
      list.some((s) => s.analysis) &&
      list.every((s) => s.analysis || gaveUp(s));
    if (!complete) site.waiting++;
    const digest = complete
      ? sessionDigest({
          session,
          shots: list,
          taxa,
          captions: session.photos
            .map((p) => captions.get(p.file))
            .filter(Boolean),
        })
      : null;
    const needTitle = !hasRealTitle(session);
    const needLocation = !session.location;
    const inputs = digest
      ? sha({
          v: DESCRIPTION_VERSION,
          digest,
          needTitle,
          needLocation,
        })
      : null;
    const current = session.description ?? "";
    const yours =
      current &&
      current !== rec.written?.description &&
      current !== rec.description &&
      !args.overwrite;
    const redo =
      digest &&
      provider &&
      !yours &&
      (rec.inputs !== inputs ||
        !rec.description ||
        (rec.redescribe ?? "") > (rec.at ?? ""));
    plans.push({
      session,
      rec,
      captions,
      digest,
      inputs,
      redo,
      needTitle,
      needLocation,
    });
  }

  // Openers already in use by descriptions that are staying put.
  const openerCounts = new Map();
  const countOpener = (text, delta = 1) => {
    const w = openerOf(text);
    if (w) openerCounts.set(w, (openerCounts.get(w) ?? 0) + delta);
  };
  for (const s of sessions) {
    const plan = plans.find((p) => p.session.slug === s.slug);
    if (plan?.redo) continue;
    countOpener(plan?.rec.description ?? s.description);
  }

  // What every other session's description says right now, so a new one
  // doesn't reuse its phrasing (sessions often share photos).
  const descriptionsInUse = (slug) =>
    sessions
      .filter((s) => s.slug !== slug)
      .map((s) => {
        const plan = plans.find((p) => p.session.slug === s.slug);
        if (plan?.redo) return plan.accepted ?? "";
        return plan?.rec.description ?? s.description ?? "";
      })
      .filter(Boolean);

  for (const plan of plans.filter((p) => p.redo)) {
    const { session, rec, digest, needTitle, needLocation } = plan;
    let feedback = null;
    let accepted = null;
    for (let attempt = 0; attempt < 3 && !accepted; attempt++) {
      try {
        const draft = await askJson({
          provider,
          model,
          prompt: descriptionPrompt({
            session,
            digest,
            voiceRules,
            avoidOpeners: [...openerCounts.keys()],
            needTitle,
            needLocation,
            feedback,
          }),
          mock: () => ({
            description:
              "Mock description written without a model, long enough to pass the length check for a session.",
            title: needTitle
              ? `${placeLabel(session) || "Somewhere"}, Nowhere, January 2026`
              : undefined,
          }),
        });
        const text = {
          description: String(draft.description ?? "").trim(),
          title: needTitle ? String(draft.title ?? "").trim() : "",
          location: needLocation ? String(draft.location ?? "").trim() : "",
        };
        const problems = descriptionProblems(text, {
          session,
          digest,
          lexicon,
          openerCounts,
          needTitle,
          others: descriptionsInUse(session.slug),
        });
        if (problems.length) feedback = problems.join(" ");
        else accepted = text;
      } catch (e) {
        feedback = null;
        warn(`A description draft failed. ${redact(e)}`);
      }
    }
    if (accepted) {
      plan.accepted = accepted.description;
      rec.description = accepted.description;
      if (accepted.title) rec.title = accepted.title;
      if (accepted.location) rec.location = accepted.location;
      rec.inputs = plan.inputs;
      rec.at = new Date().toISOString();
      delete rec.problem;
      countOpener(accepted.description);
      site.described++;
    } else {
      rec.problem = feedback ?? "the model didn't reply";
      site.describeFailed++;
    }
  }

  for (const plan of plans) {
    const { session, rec, captions } = plan;
    rec.captions = Object.fromEntries(captions);
    if (!sidecars) continue;
    const text = {
      description: rec.description,
      title: plan.needTitle ? rec.title : undefined,
      location: plan.needLocation ? rec.location : undefined,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data, etag } = await sidecars.read(session.prefix);
        const merged = mergeWebsiteText({
          sidecar: data,
          slug: session.slug,
          order: session.photos.map((p) => p.file),
          captions,
          text,
          written: rec.written,
          overwrite: args.overwrite,
        });
        site.kept += merged.kept;
        if (merged.changed) {
          await sidecars.write(session.prefix, merged.sidecar, etag);
          site.written++;
        }
        rec.written = merged.written;
        break;
      } catch (e) {
        const conflict = e?.statusCode === 412 || e?.statusCode === 409;
        if (!conflict || attempt === 2) {
          warn(`Couldn't update a session file. ${redact(e)}`);
          break;
        }
      }
    }
  }

  // The website's results are saved before Instagram gets a turn, so nothing
  // that goes wrong over there can cost a run's analyses or copy.
  await saveCatalog(store, catalog);
  await store.writeJson("taxa.json", taxa);

  // 6. instagram
  const ig = { rendered: 0, review: 0, planned: 0 };
  if (args.instagram && process.env.SOCIAL_ENABLED === "true") {
    try {
      await instagramStage();
    } catch (e) {
      warn(
        `The Instagram stage failed; the website copy is unaffected. ${redact(e)}`,
      );
      process.exitCode = 1;
    }
  }

  async function instagramStage() {
    const config = (await social.readJson("config.json"))?.data ?? {};
    const ledger = (await social.readJson("ledger.json"))?.data ?? {
      posted: {},
      failed: {},
    };
    const posted = new Set(Object.keys(ledger.posted ?? {}));

    // What's already on the account (posted by hand, or before this existed).
    if (!onDisk && process.env.IG_ACCESS_TOKEN) {
      try {
        const makeClient = (token) =>
          createClient({
            mode: settings.loginMode,
            token,
            apiVersion: settings.apiVersion,
            userId: process.env.IG_USER_ID,
          });
        const token = await resolveToken({
          settings,
          store: social,
          makeClient,
        });
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

    // Where each shot stands for Instagram.
    for (const s of Object.values(shots)) {
      const file = catalog.files[s.pick];
      const level =
        s.analysis?.idCheck === "conflict" ? null : idLevel(taxonOf(s));
      s.speciesOk = level === "species";
      const stale =
        s.post &&
        (s.post.analysedAt !== s.analysis?.at ||
          (s.redraft && s.redraft > (s.post.draftedAt ?? "")));
      if (stale) {
        delete s.post;
        if (s.status === "ready" || s.status === "needs_review")
          s.status = "new";
      }
      delete s.skipReason;
      if (!s.analysis) s.status = undefined;
      else if (s.analysis.skip) {
        s.status = "skipped";
        s.skipReason = s.analysis.skip;
      } else if (s.analysis.idCheck === "conflict") {
        s.status = "skipped";
        s.skipReason = "identification-conflict";
      } else if (file.width < settings.minWidth) {
        s.status = "skipped";
        s.skipReason = "low-resolution";
      } else if (
        settings.tallImages === "skip" &&
        padFraction(file.width, file.height) > 0
      ) {
        s.status = "skipped";
        s.skipReason = "outside-instagram-shape";
      } else if (s.post?.caption) s.status = "ready";
      else if (s.status !== "needs_review") s.status = "new";
    }

    const failedForGood = Object.entries(ledger.failed ?? {})
      .filter(([, f]) => f.count >= 2)
      .map(([k]) => k);
    const recent = Object.entries(ledger.posted ?? {})
      .sort((a, b) => String(a[1].at).localeCompare(String(b[1].at)))
      .slice(-60)
      .map(([k]) => k);
    const plan = () =>
      planQueue({
        shots,
        posted: new Set([...posted, ...failedForGood]),
        recent,
        count: settings.postsPerDay * 7,
        postsPerDay: settings.postsPerDay,
      });

    // Write the posts the next week needs, then plan again around any that failed.
    const owner = siteOwner();
    const pointer =
      config.linkLine ??
      (settings.domain
        ? `The rest of this set is on ${settings.domain}, link in bio`
        : "");
    let items = plan();
    for (let round = 0; round < 2; round++) {
      const missing = items.filter((k) => !shots[k].post?.caption);
      if (!missing.length || !provider) break;
      await pool(missing, 3, async (key) => {
        try {
          await writePost(shots[key]);
        } catch (e) {
          warn(
            `A post draft failed and will be retried next run. ${redact(e)}`,
          );
        }
      });
      items = plan();
    }
    items = items.filter((k) => shots[k].status === "ready");
    ig.planned = items.length;
    await social.writeJson("queue.json", {
      plannedAt: new Date().toISOString(),
      items,
    });

    async function writePost(s) {
      const file = catalog.files[s.pick];
      const session = sessionOf(s.session);
      const taxon = taxonOf(s);
      const level = s.analysis.idCheck === "conflict" ? null : idLevel(taxon);
      const headline = captionFor({
        analysis: s.analysis,
        taxon,
        session,
        lexicon,
        place: placeLine(session, placeLabel(session)),
        max: 220,
      });
      const hashtags = buildHashtags({
        taxon,
        speciesOk: level === "species",
        group: s.analysis.group,
        facts: file.facts,
        session: { ...session, description: sessionNames(session) },
        proposedPlace: s.analysis.placeTag,
        landmark: s.analysis.landmark,
        hubTags: config.hubHashtags ?? {},
      });
      const gear = gearLine(file.facts);
      let feedback = null;
      let finished = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const draft = await askJson({
          provider,
          model,
          prompt: bodyPrompt({
            owner,
            session,
            analysis: s.analysis,
            headline,
            clock: s.clock,
            taxon,
            voiceRules,
            feedback,
          }),
          mock: mockBody,
        });
        finished = finishPost({
          headline,
          body: draft.body,
          alt: s.analysis.description,
          session,
          taxon,
          level,
          gear,
          hashtags,
          pointer,
          lexicon,
        });
        if (!finished.problem) {
          s.post = {
            caption: finished.caption,
            alt: finished.alt,
            hashtags,
            group: s.analysis.group,
            appeal: s.analysis.appeal,
            taxon: level ? taxon.id : null,
            analysedAt: s.analysis.at,
            model,
            draftedAt: new Date().toISOString(),
          };
          s.status = "ready";
          delete s.problem;
          ig.rendered++;
          return;
        }
        feedback = finished.problem;
      }
      s.status = "needs_review";
      s.problem = finished?.problem ?? "draft failed";
      ig.review++;
    }
  }

  await saveCatalog(store, catalog);
  await store.writeJson("taxa.json", taxa);

  const all = Object.values(shots);
  const count = (fn) => all.filter(fn).length;
  info(
    [
      `Photos: ${photos.length} (${scanned} newly scanned${scanFailed ? `, ${scanFailed} unreadable` : ""}).`,
      `Shots: ${all.length}, analysed: ${count((s) => s.analysis)} (${analysed} this run${analyseFailed ? `, ${analyseFailed} failed` : ""}).`,
      `iNaturalist matches: ${count((s) => s.inat?.via === "frame")} exact frame, ${count((s) => s.inat?.via === "moment")} same moment; ${count((s) => s.analysis?.idCheck === "conflict")} flagged as not matching.`,
      `Website: ${site.captions} captions, ${site.described} descriptions written${site.describeFailed ? `, ${site.describeFailed} failed checks` : ""}, ${site.waiting} sessions still being analysed, ${site.written} session files updated${site.kept ? `, ${site.kept} of your edits left alone` : ""}${sidecars ? "" : " (not written: dry run)"}.`,
      process.env.SOCIAL_ENABLED === "true" && args.instagram
        ? `Instagram: ${ig.rendered} posts written, ${ig.review} need review, ${ig.planned} planned.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `sessions_updated=${site.written}\n`,
    );
}

main().catch((e) => {
  console.error(redact(e?.stack ?? e));
  process.exit(1);
});
