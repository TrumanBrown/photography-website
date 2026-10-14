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
 *                next two weeks, and write the posts that plan needs
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
import { loadSettings } from "../social/settings.mjs";
import { blobStore, localStore, updateJson } from "./store.mjs";
import {
  loadSessionsFromIndex,
  loadSessionsLocal,
  readPhoto,
} from "./sessions.mjs";
import { gearLine, orientedSize, readFacts } from "./exif.mjs";
import { dhash, hamming } from "./hash.mjs";
import {
  burstGroups,
  cameraFacts,
  chooseVersion,
  originalFor,
  padFraction,
  shotKey,
} from "./shots.mjs";
import {
  fetchTaxon,
  hashMatcher,
  learnOffset,
  pickObservation,
  refreshIndex,
  timeCandidates,
  unseenCandidates,
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
  backdropIn,
  captionFor,
  descriptionProblems,
  descriptionPrompt,
  hasRealTitle,
  humanize,
  openerOf,
  placeLabel,
  sessionDigest,
  speciesSubject,
  telling,
  withoutBackdrop,
} from "./website.mjs";
import { blobSidecars, mergeWebsiteText } from "./sidecars.mjs";
import {
  compileLexicon,
  displayName,
  lint,
  loadVoiceRules,
  tidy,
} from "./text.mjs";
import {
  LINE_VERSION,
  linesPrompt,
  mockLines,
  normaliseLine,
} from "./lines.mjs";
import {
  HIS_EMOJI,
  HIS_STORIES,
  VOICE_VERSION,
  fillName,
  loadVoiceGuide,
  mockVoice,
  normaliseVoice,
  voicePrompt,
} from "./voice.mjs";
import {
  FACTS_VERSION,
  checkFacts,
  factKey,
  factsPrompt,
  groupName,
  mockFacts,
  pickFact,
} from "./facts.mjs";
import { wikiClient } from "./wiki.mjs";
import { fixSlug, slugTypos } from "./placenames.mjs";
import {
  POST_VERSION,
  assembleCaption,
  placeLine,
  sessionNames,
} from "../social/compose.mjs";
import { buildHashtags } from "../social/hashtags.mjs";
import { SCENES, planQueue } from "../social/plan.mjs";
import { resolveToken } from "../social/token.mjs";
import { createClient } from "../social/instagram.mjs";
import { info, redact, warn } from "./redact.mjs";

/** Bump when the description prompt changes enough that every session should be redone. */
const DESCRIPTION_VERSION = 2;

/** Bump to read converted photos' originals again (those still without a capture time). */
const CAPTURE_VERSION = 2;

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
  // Captions spell a misspelled state or country right (slugPlace), but the
  // web address keeps the typo until the folder is renamed.
  for (const s of sessions)
    for (const t of slugTypos(s.slug))
      warn(
        `The folder ${s.slug} looks misspelled: "${t.word}" is read as "${t.fix}". Rename it to ${fixSlug(s.slug)} to fix its web address.`,
      );
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

  // 1b. A HEIC, TIFF or RAW photo is shown from a JPEG the build makes, which
  // carries no camera data, so its capture time, camera and lens are read
  // from the original instead, once. Without a capture time a photo can't be
  // matched to the iNaturalist observation of the same moment, or even to its
  // own copy there unless the fingerprints are nearly identical. Where it was
  // taken is never kept.
  const noCapture = Object.values(catalog.files).filter(
    (f) =>
      !f.facts?.clock &&
      !f.capture?.clock &&
      f.captureV !== CAPTURE_VERSION &&
      /\/derivatives\//.test(f.url ?? ""),
  );
  let captured = 0;
  if (noCapture.length && remote?.listOther) {
    try {
      const originals = await remote.listOther("originals");
      await pool(noCapture, 4, async (f) => {
        const prefix = sessionsBySlug.get(f.session)?.prefix ?? f.session;
        const name = originalFor(prefix, f.file, originals);
        try {
          const facts = name
            ? await readFacts(await remote.readOtherBytes("originals", name))
            : null;
          const camera = { ...(facts ?? {}) };
          delete camera.lat;
          delete camera.lon;
          f.capture = camera.clock || camera.model ? camera : null;
          f.captureV = CAPTURE_VERSION;
          if (f.capture) captured++;
        } catch {
          // Unreadable for now; tried again next run.
        }
      });
    } catch (e) {
      warn(
        `Couldn't read the originals of converted photos; tried again next run. ${redact(e)}`,
      );
    }
  }

  // 2. group into shots (by the file's own facts; see cameraFacts in shots.mjs)
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
      clock: cameraFacts(pick)?.clock ?? null,
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
        ...(best.slipped ? { slipped: true } : {}),
      };
      // A time-zone slip says nothing about this camera's clock.
      if (s.clock && best.obs.clock && !best.slipped) {
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
  // The same-moment check (tier 2) only happens while a photo is analysed, so
  // an organism photo without an identification gets another look when an
  // observation of the same moment appears that its last look can't have
  // seen: put on iNaturalist since, or the photo had no capture time then.
  const momentDue = (s) => {
    if (s.inat || !s.clock || !s.analysis || !index) return false;
    if (SCENES.has(s.analysis.group) || s.analysis.group === "people")
      return false;
    const hadClock =
      "clock" in s.analysis
        ? Boolean(s.analysis.clock)
        : Boolean(catalog.files[s.pick]?.facts?.clock);
    return (
      unseenCandidates(
        timeCandidates(s.clock, index, catalog.offsets[s.session] ?? 0),
        { analysedAt: s.analysis.at, hadClock },
      ).length > 0
    );
  };
  const needsAnalysis = (s) =>
    !gaveUp(s) &&
    (!s.analysis ||
      s.analysis.v !== ANALYSIS_VERSION ||
      (s.analysis.taxon ?? null) !== (s.inat?.taxon ?? null) ||
      (s.redo && s.redo > (s.analysis.at ?? "")) ||
      momentDue(s));
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
      // What the same-moment check could go on, so a later run can tell
      // whether an observation is new to this photo.
      clock: s.clock ?? null,
      model,
      at: new Date().toISOString(),
      ...(problems.length ? { problems } : {}),
    };
  }

  // 4b. first lines: the caption's opening, said plainly (lines.mjs). Text
  // only, from the notes above, in batches; redone when a photo is.
  const levelOf = (s) =>
    s.analysis?.idCheck === "conflict" ? null : idLevel(taxonOf(s));
  // `npm run social -- redraft` asks for a new first line and a different fact.
  const redrafting = (s, since) =>
    Boolean(s.redraft && s.redraft > (since ?? ""));
  const needsLine = (s) =>
    s.analysis &&
    (s.line?.v !== LINE_VERSION ||
      s.line?.at !== s.analysis.at ||
      redrafting(s, s.line?.written));
  // The name the model writes after, for an identified organism; "" otherwise.
  const namedFor = (s) => {
    const taxon = taxonOf(s);
    const level = levelOf(s);
    if (level === "species")
      return (s.analysis.count ?? 1) > 1
        ? speciesSubject(taxon, s.analysis.count)
        : displayName(taxon.common) || taxon.name;
    if (level === "group") return `${s.analysis.subject} (${taxon.name})`;
    return "";
  };
  const notesFor = (s) => ({
    named: namedFor(s),
    subject: s.analysis.subject,
    scene: s.analysis.scene,
    conditions: s.analysis.conditions,
    landmark: s.analysis.landmark,
    description: s.analysis.description,
    place: allowedNames(sessionOf(s.session)).join(", "),
  });
  const lineQueue = Object.values(shots).filter(
    (s) => inScope(s.session) && needsLine(s),
  );
  let linesWritten = 0;
  if (lineQueue.length && provider) {
    // One outing per batch, same subjects side by side, so the model can
    // tell eleven photos of one peak apart instead of writing one line eleven times.
    const bySession = new Map();
    for (const s of lineQueue) {
      if (!bySession.has(s.session)) bySession.set(s.session, []);
      bySession.get(s.session).push(s);
    }
    const subjectOf = (s) =>
      `${s.inat?.taxon ?? ""}|${s.analysis.landmark || s.analysis.subject || ""}`;
    const batches = [];
    for (const list of bySession.values()) {
      list.sort(
        (a, b) =>
          subjectOf(a).localeCompare(subjectOf(b)) ||
          String(a.clock ?? "").localeCompare(String(b.clock ?? "")),
      );
      for (let i = 0; i < list.length; i += 40)
        batches.push(list.slice(i, i + 40));
    }
    await pool(batches, 2, async (batch) => {
      const items = batch.map((s, i) => ({
        id: String(i + 1),
        ...notesFor(s),
      }));
      try {
        const reply = await askJson({
          provider,
          model,
          prompt: linesPrompt(items),
          mock: () => mockLines(items),
        });
        const byId = new Map((reply.items ?? []).map((x) => [String(x.id), x]));
        batch.forEach((s, i) => {
          const got = normaliseLine(byId.get(String(i + 1)), {
            named: Boolean(items[i].named),
            plural: (s.analysis.count ?? 1) > 1,
          });
          // A line that failed its checks falls back to the notes; it isn't retried.
          s.line = {
            v: LINE_VERSION,
            at: s.analysis.at,
            written: new Date().toISOString(),
            ...(got ?? { failed: true }),
          };
          if (got) linesWritten++;
        });
      } catch (e) {
        warn(
          `A batch of first lines failed and will be retried next run. ${redact(e)}`,
        );
      }
    });
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
          line: s.line,
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
    // A description is rewritten when what's known about its photos changes
    // (a photo added or looked at again, an identification changed), not when
    // the way captions are worded does.
    const facts = complete
      ? sha({
          v: DESCRIPTION_VERSION,
          shots: list
            .map((s) => [
              s.pick,
              s.analysis?.at ?? null,
              s.inat?.taxon ?? null,
              s.analysis?.idCheck ?? null,
            ])
            .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
        })
      : null;
    // Descriptions written before this was recorded were written for today's facts.
    if (facts && !rec.facts && rec.description && rec.inputs) rec.facts = facts;
    const current = session.description ?? "";
    const yours =
      current &&
      current !== rec.written?.description &&
      current !== rec.description &&
      !args.overwrite;
    // One written before a rule existed is rewritten once it breaks it
    // (yours never are).
    const broken = Boolean(backdropIn(rec.description ?? current));
    const redo =
      digest &&
      provider &&
      !yours &&
      (rec.facts !== facts ||
        !rec.description ||
        broken ||
        (rec.redescribe ?? "") > (rec.at ?? ""));
    plans.push({
      session,
      rec,
      captions,
      digest,
      facts,
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
      rec.facts = plan.facts;
      delete rec.inputs;
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
  const ig = { rendered: 0, voiced: 0, facts: 0, review: 0, planned: 0 };
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

    const pointer =
      config.linkLine ??
      (settings.domain
        ? `Full resolution and the rest of this session are on ${settings.domain}, link in bio`
        : "");

    // What Truman has said about a trip or a photo (`npm run social --
    // note`). The only source the opening may use for what he was doing.
    const notesFile = (await social.readJson("notes.json"))?.data ?? {};
    const notesOf = (s, key) =>
      [notesFile.trips?.[s.session], notesFile.photos?.[key]]
        .filter(Boolean)
        .join(" ");
    const tripName = (slug) => {
      const session = sessionOf(slug);
      return hasRealTitle(session) ? session.title : humanize(slug);
    };
    // Everything the opening's "what he was doing" may lean on besides his notes.
    const groundingFor = (s) => {
      const session = sessionOf(s.session);
      return [
        session.title,
        session.location,
        s.session.replace(/-/g, " "),
        s.analysis.subject,
        s.analysis.scene,
        s.analysis.setting,
        s.analysis.conditions,
        s.analysis.landmark,
        s.analysis.description,
      ]
        .filter(Boolean)
        .join(" ");
    };
    // What {name} becomes mid-sentence: "groove-billed ani (Crotophaga
    // sulcirostris)", "two harbor seals (Phoca vitulina)".
    const lowerFirst = (t) =>
      t && !/^\p{Lu}{2}/u.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
    const storyNameFor = (s) => {
      const taxon = taxonOf(s);
      const level = levelOf(s);
      const count = s.analysis.count ?? 1;
      if (level === "species") {
        if (count > 1)
          return lowerFirst(speciesSubject(taxon, count, s.analysis.subject));
        const common =
          displayName(taxon.common, { midSentence: true }) ||
          lowerFirst(s.analysis.subject ?? "");
        return common ? `${common} (${taxon.name})` : taxon.name;
      }
      if (level === "group")
        return `${lowerFirst(s.analysis.subject)} (${taxon.name})`;
      return "";
    };
    const voicedFor = (s) =>
      s.voice?.v === VOICE_VERSION &&
      s.voice.text &&
      Boolean(s.voice.named) === Boolean(namedFor(s))
        ? s.voice
        : null;

    // Everything in a post besides its fact; all of it decided by code, around
    // the opening written in Truman's voice (voice.mjs). A post without one
    // waits for it rather than going out sounding like a machine.
    const partsFor = (s) => {
      const file = catalog.files[s.pick];
      const session = sessionOf(s.session);
      const taxon = taxonOf(s);
      const level = levelOf(s);
      const voiced = voicedFor(s);
      const hashtags = buildHashtags({
        taxon,
        speciesOk: level === "species",
        group: s.analysis.group,
        facts: cameraFacts(file),
        session: { ...session, description: sessionNames(session) },
        proposedPlace: s.analysis.placeTag,
        landmark: s.analysis.landmark,
        hubTags: config.hubHashtags ?? {},
      });
      return {
        session,
        taxon,
        level,
        story: voiced ? fillName(voiced.text, storyNameFor(s)) : "",
        emoji: voiced?.emoji ?? "",
        place: placeLine(session, placeLabel(session)),
        hashtags,
        gear: gearLine(cameraFacts(file)),
        iucn: level === "species" ? (taxon.iucn ?? null) : null,
      };
    };

    // Where each shot stands for Instagram.
    for (const s of Object.values(shots)) {
      const file = catalog.files[s.pick];
      s.speciesOk = levelOf(s) === "species";
      delete s.skipReason;
      if (!s.analysis) {
        s.status = s.unreadable ? "skipped" : undefined;
        if (s.unreadable) s.skipReason = "refused-by-the-model";
      } else if (s.analysis.skip) {
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
      } else s.status = s.post?.caption ? "ready" : "new";
    }

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
      // Two weeks of posts written ahead, so posting carries on even if
      // GitHub skips this workflow's scheduled runs for days.
      count: settings.postsPerDay * 14,
      postsPerDay: settings.postsPerDay,
      sceneEvery: settings.landscapeEvery,
    });

    // Facts for the species and places the plan needs (facts.mjs), written
    // once from Wikipedia and kept privately. A species with nothing usable
    // falls back to its place; a lookup that found nothing waits 30 days.
    const factsFile = (await store.readJson("facts.json"))?.data ?? {};
    const factStore = factsFile.items ?? {};
    const wiki = wikiClient({ domain: settings.domain });
    // Facts don't use the first-person voice rules, since they aren't the
    // photographer's own; they keep the list of words never to write.
    const factVoice = loadVoiceRules(["Do not write"]);
    const RETRY_MS = 30 * 24 * 3600 * 1000;
    const keysFor = (s) => {
      const level = levelOf(s);
      return [
        ...(level
          ? [factKey({ taxon: taxonOf(s), level, slug: s.session })]
          : []),
        ...(s.analysis.landmark
          ? [factKey({ landmark: s.analysis.landmark, slug: s.session })]
          : []),
        factKey({ slug: s.session }),
      ];
    };
    const usable = (key) => {
      const rec = factStore[key];
      return rec?.v === FACTS_VERSION && rec.facts?.length ? rec.facts : null;
    };
    const tried = (key) => {
      const rec = factStore[key];
      return (
        rec?.v === FACTS_VERSION &&
        !rec.facts?.length &&
        Date.now() - new Date(rec.at) < RETRY_MS
      );
    };
    let factsWritten = 0;
    // Species that fall back to the same genus or family article (two
    // katydids, say) share its facts, so they rotate instead of repeating.
    const byArticle = new Map();
    for (const rec of Object.values(factStore))
      if (
        rec?.v === FACTS_VERSION &&
        rec.facts?.length &&
        rec.source?.title &&
        rec.source.about !== "species"
      )
        byArticle.set(rec.source.title, Promise.resolve(rec.facts));
    async function writeFacts(key, s) {
      const session = sessionOf(s.session);
      const [kind, id] = [
        key.slice(0, key.indexOf(":")),
        key.slice(key.indexOf(":") + 1),
      ];
      // Most specific first: the species' own article, then its genus's and
      // family's, until one has something worth saying. A failed lookup
      // throws, and the key is tried again next run.
      const candidates =
        kind === "taxon"
          ? wiki.taxonArticles(id)
          : (async function* () {
              const a = await wiki.placeArticle({
                place:
                  kind === "landmark"
                    ? s.analysis.landmark
                    : placeLabel(session),
                names: allowedNames(session),
                landmark: kind === "landmark" ? s.analysis.landmark : "",
                context: String(session.location ?? "")
                  .split(",")
                  .map((p) => p.trim())
                  .filter(Boolean),
              });
              if (a) yield a;
            })();
      const taxon = kind === "taxon" ? taxa[id] : null;
      const ask = async (art) => {
        const name =
          kind !== "taxon"
            ? art.title
            : art.about === "species"
              ? displayName(taxon?.common) || taxon?.name || art.title
              : groupName(art);
        const raw = await askJson({
          provider,
          model,
          prompt: factsPrompt({
            name,
            kind: kind === "taxon" ? "species" : "place",
            art,
            species:
              kind === "taxon" && art.about !== "species"
                ? displayName(taxon?.common, { midSentence: true }) ||
                  taxon?.name ||
                  ""
                : "",
            voiceRules: factVoice,
          }),
          mock: () => mockFacts(art),
        });
        return checkFacts(raw, art, { lexicon });
      };
      let facts = [];
      let used = null;
      for await (const art of candidates) {
        used = art;
        if (art.about !== "species") {
          if (!byArticle.has(art.title)) {
            const asking = ask(art);
            byArticle.set(art.title, asking);
            asking.catch(() => byArticle.delete(art.title));
          }
          facts = await byArticle.get(art.title);
        } else facts = await ask(art);
        if (facts.length) break;
      }
      factStore[key] = {
        v: FACTS_VERSION,
        at: new Date().toISOString(),
        facts,
        ...(used ? { source: { title: used.title, about: used.about } } : {}),
      };
      if (facts.length) factsWritten++;
    }
    // A species with nothing usable falls through to its place in the same
    // run, so a post isn't left without a fact for a day.
    for (let round = 0; round < 3 && provider; round++) {
      const wanted = new Map();
      for (const key of items) {
        const s = shots[key];
        for (const k of keysFor(s)) {
          if (usable(k)) break;
          if (tried(k)) continue;
          if (!wanted.has(k)) wanted.set(k, s);
          break;
        }
      }
      if (!wanted.size) break;
      await pool([...wanted.entries()], 3, async ([k, s]) => {
        try {
          await writeFacts(k, s);
        } catch (e) {
          warn(
            `Facts for a post failed and will be retried next run. ${redact(e)}`,
          );
        }
      });
      await store.writeJson("facts.json", { items: factStore });
    }

    // Each planned post's fact: a post keeps its fact while that fact still
    // exists; a new post takes the fact used least by any post so far.
    const used = [];
    for (const s of Object.values(shots))
      if (s.post?.fact && s.post.factKey) used.push(s.post.fact);
    const planned = new Set(items);
    const drafts = items.map((key) => {
      const s = shots[key];
      const factKeyUsed = keysFor(s).find((k) => usable(k)) ?? null;
      const facts = factKeyUsed ? usable(factKeyUsed) : [];
      const redraft = redrafting(s, s.post?.draftedAt);
      const keep =
        !redraft &&
        s.post?.factKey === factKeyUsed &&
        facts.includes(s.post?.fact)
          ? s.post.fact
          : "";
      // A redraft takes another fact when there is one.
      const choices =
        redraft && facts.length > 1
          ? facts.filter((f) => f !== s.post?.fact)
          : facts;
      const fact = keep || pickFact(choices, used);
      if (!keep && fact && factKeyUsed) used.push(fact);
      return { key, s, fact, factKeyUsed };
    });

    // The opening in Truman's voice (voice.mjs), written once per planned
    // post, ten to a call, in the order they'll go out, and again on a
    // redraft or when his notes for the trip change.
    const needsVoice = (d) =>
      d.s.voice?.v !== VOICE_VERSION ||
      d.s.voice?.at !== d.s.analysis.at ||
      d.s.voice?.notes !== sha(notesOf(d.s, d.key)) ||
      Boolean(d.s.voice?.named) !== Boolean(namedFor(d.s)) ||
      (!d.s.voice?.text && (d.s.voice?.tries ?? 0) < 4) ||
      redrafting(d.s, d.s.voice?.written);
    const voiceQueue = drafts.filter(needsVoice);
    if (provider && voiceQueue.length) {
      const guide = loadVoiceGuide();
      // The posts already out, oldest first: his own rewrites of the first
      // ones, then every post this voice wrote. New openings mustn't echo them.
      const postedOrder = Object.entries(ledger.posted ?? {})
        .sort((a, b) => String(a[1].at).localeCompare(String(b[1].at)))
        .map(([k]) => shots[k]?.post)
        .filter((p) => p?.story);
      const outStories = [...HIS_STORIES, ...postedOrder.map((p) => p.story)];
      const outEmoji = [
        ...HIS_EMOJI,
        ...postedOrder.map((p) => p.emoji).filter(Boolean),
      ];
      const storyOf = (d) => {
        const voiced = voicedFor(d.s);
        return voiced ? fillName(voiced.text, storyNameFor(d.s)) : "";
      };
      const position = new Map(drafts.map((d, i) => [d, i]));
      // What goes out before this post: those already out, then the planned
      // posts ahead of it, including ones written moments ago in this run.
      const before = (d) => {
        const ahead = drafts.slice(0, position.get(d)).filter(storyOf);
        return {
          stories: [...outStories, ...ahead.map(storyOf)],
          emoji: [
            ...outEmoji,
            ...ahead.map((a) => voicedFor(a.s).emoji).filter(Boolean),
          ],
        };
      };
      // One batch at a time, in posting order. A post whose options all fail
      // their checks gets one more go in the same run, and up to two more runs.
      const writeVoices = async (list) => {
        const batches = [];
        for (let i = 0; i < list.length; i += 10)
          batches.push(list.slice(i, i + 10));
        await pool(batches, 1, async (batch) => {
          const notes = batch.map((d, i) => ({
            id: String(i + 1),
            named: namedFor(d.s),
            count: d.s.analysis.count ?? 1,
            subject: d.s.analysis.subject,
            scene: d.s.analysis.scene,
            setting: d.s.analysis.setting,
            conditions: telling(d.s.analysis.conditions)
              ? d.s.analysis.conditions
              : "",
            landmark: d.s.analysis.landmark,
            description: withoutBackdrop(d.s.analysis.description),
            place: allowedNames(sessionOf(d.s.session)).join(", "),
            trip: tripName(d.s.session),
            notes: notesOf(d.s, d.key),
            fact: d.fact,
          }));
          try {
            const reply = await askJson({
              provider,
              model,
              prompt: voicePrompt(notes, guide, {
                recent: before(batch[0]).stories.slice(-12),
              }),
              mock: () => mockVoice(notes),
            });
            const byId = new Map(
              (reply.items ?? []).map((x) => [String(x.id), x]),
            );
            batch.forEach((d, i) => {
              const taxon = levelOf(d.s) ? taxonOf(d.s) : null;
              const prior = before(d);
              const got = normaliseVoice(byId.get(String(i + 1)), {
                named: Boolean(notes[i].named),
                name: storyNameFor(d.s),
                fact: d.fact,
                lexicon,
                allowed: allowedNames(sessionOf(d.s.session)).join(" "),
                taxonText: taxon
                  ? `${taxon.name} ${taxon.common ?? ""} ${notes[i].named}`
                  : "",
                grounding: groundingFor(d.s),
                notes: notes[i].notes,
                recent: prior.stories,
                recentEmoji: prior.emoji,
                avoid: HIS_STORIES,
                group: d.s.analysis.group,
              });
              const failedBefore =
                d.s.voice?.v === VOICE_VERSION && !d.s.voice.text
                  ? (d.s.voice.tries ?? 0)
                  : 0;
              d.s.voice = {
                v: VOICE_VERSION,
                at: d.s.analysis.at,
                written: new Date().toISOString(),
                notes: sha(notes[i].notes),
                named: Boolean(notes[i].named),
                ...(got.text ? got : { tries: failedBefore + 1 }),
              };
              if (got.text) ig.voiced++;
            });
          } catch (e) {
            warn(
              `A batch of post openings failed and will be retried next run. ${redact(e)}`,
            );
          }
        });
      };
      await writeVoices(voiceQueue);
      await writeVoices(voiceQueue.filter((d) => !voicedFor(d.s)));
    }

    // Put each planned post together, or bring it up to date.
    for (const { s, fact, factKeyUsed } of drafts) {
      const parts = partsFor(s);
      if (!parts.story) {
        delete s.post;
        s.status = "new";
        s.problem = "waiting for its opening";
        continue;
      }
      const basis = sha({
        v: POST_VERSION,
        story: parts.story,
        emoji: parts.emoji,
        place: parts.place,
        hashtags: parts.hashtags,
        gear: parts.gear,
        pointer,
        iucn: parts.iucn,
        fact,
      });
      if (s.post?.basis === basis) continue;
      const caption = assembleCaption({
        story: parts.story,
        emoji: parts.emoji,
        place: parts.place,
        body: fact,
        iucn: parts.iucn,
        gear: parts.gear,
        pointer,
        hashtags: parts.hashtags,
      });
      // The written parts are checked, not the "Fun fact:" label code adds.
      const problems = lint([parts.story, fact, pointer].join("\n"));
      if (problems.length) {
        s.status = "needs_review";
        s.problem = problems.join(", ");
        ig.review++;
        continue;
      }
      s.post = {
        caption,
        alt: tidy(s.analysis.description).slice(0, 1000),
        story: parts.story,
        emoji: parts.emoji,
        place: parts.place,
        fact,
        factKey: factKeyUsed,
        v: POST_VERSION,
        hashtags: parts.hashtags,
        group: s.analysis.group,
        appeal: s.analysis.appeal,
        taxon: parts.level ? parts.taxon.id : null,
        analysedAt: s.analysis.at,
        basis,
        draftedAt: new Date().toISOString(),
      };
      s.status = "ready";
      delete s.problem;
      ig.rendered++;
    }
    // Out-of-date posts outside the plan are dropped, and written again when
    // they're planned. Posts already published stay as the record of them.
    for (const [key, s] of Object.entries(shots)) {
      if (planned.has(key) || posted.has(key) || !s.post) continue;
      if (s.post.v !== POST_VERSION || s.post.analysedAt !== s.analysis?.at) {
        delete s.post;
        if (s.status === "ready") s.status = "new";
      }
    }
    const ready = items.filter((k) => shots[k].status === "ready");
    ig.planned = ready.length;
    ig.facts = factsWritten;
    await social.writeJson("queue.json", {
      plannedAt: new Date().toISOString(),
      items: ready,
    });
  }

  await saveCatalog(store, catalog);
  await store.writeJson("taxa.json", taxa);

  const all = Object.values(shots);
  const count = (fn) => all.filter(fn).length;
  info(
    [
      `Photos: ${photos.length} (${scanned} newly scanned${scanFailed ? `, ${scanFailed} unreadable` : ""}${captured ? `, ${captured} capture times read from originals` : ""}).`,
      `Shots: ${all.length}, analysed: ${count((s) => s.analysis)} (${analysed} this run${analyseFailed ? `, ${analyseFailed} failed` : ""}).`,
      `iNaturalist matches: ${count((s) => s.inat?.via === "frame")} exact frame, ${count((s) => s.inat?.via === "moment")} same moment; ${count((s) => s.analysis?.idCheck === "conflict")} flagged as not matching.`,
      `Website: ${site.captions} captions (${linesWritten} first lines written), ${site.described} descriptions written${site.describeFailed ? `, ${site.describeFailed} failed checks` : ""}, ${site.waiting} sessions still being analysed, ${site.written} session files updated${site.kept ? `, ${site.kept} of your edits left alone` : ""}${sidecars ? "" : " (not written: dry run)"}.`,
      process.env.SOCIAL_ENABLED === "true" && args.instagram
        ? `Instagram: ${ig.rendered} posts written (${ig.voiced} new openings), facts for ${ig.facts} new species or places, ${ig.review} need review, ${ig.planned} planned.`
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
