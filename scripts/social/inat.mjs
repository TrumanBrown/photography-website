/**
 * iNaturalist: which of your observations shows the exact animal in a photo.
 *
 * Tier 1, exact frame: every photo on your observations is fingerprinted once
 * (dHash of iNat's 240 px copy). A site photo whose fingerprint is within a few
 * bits of one of them IS that observation's photo, whatever the camera clock
 * said. This was checked by eye on real pairs before relying on it.
 *
 * Tier 2, same moment: observations made within a few minutes of the capture
 * (after correcting the session's camera-clock offset, learned from Tier 1
 * matches in that session). These are only candidates; the vision model has
 * to confirm the same animal is in both photos before one is used.
 *
 * Species names are only ever taken from research-grade observations at
 * species rank or finer. Everything else stays at group level.
 */
import { dhash, hamming } from "./hash.mjs";
import { clockMs } from "./shots.mjs";

const API = "https://api.inaturalist.org/v1";
const UA = "photo-site-social/1.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** iNat asks for at most ~1 request a second. */
let lastCall = 0;
async function inatGet(path, fetchImpl = fetch) {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetchImpl(`${API}${path}`, {
        headers: { "User-Agent": UA },
      });
    } catch {
      // Dropped connection; wait and try again like a 5xx.
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    throw new Error(`iNaturalist ${res.status} for ${path.split("?")[0]}`);
  }
  throw new Error(`iNaturalist kept failing for ${path.split("?")[0]}`);
}

/** "2026-09-04T19:20:33-06:00" -> "2026-09-04T19:20:33" (the clock reading, no zone). */
export function obsClock(o) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)/.exec(
    o?.time_observed_at ?? "",
  );
  return m ? m[1] : null;
}

function slimObservation(o) {
  return {
    taxon: o.taxon?.id ?? null,
    rank: o.taxon?.rank ?? null,
    quality: o.quality_grade ?? null,
    clock: obsClock(o),
    obscured: Boolean(
      o.obscured ||
      o.geoprivacy === "obscured" ||
      o.taxon_geoprivacy === "obscured",
    ),
    photos: Object.fromEntries(
      (o.photos ?? []).map((p) => [String(p.id), p.url]),
    ),
  };
}

/**
 * Bring the fingerprint index up to date. Observation details (quality grade,
 * identification) are refreshed every run because they change as people
 * weigh in; photos are only downloaded and fingerprinted once.
 */
export async function refreshIndex(
  index,
  user,
  { fetchImpl = fetch, onProgress } = {},
) {
  const next = {
    user,
    observations: {},
    // Hashes from an older, shorter fingerprint format are dropped and redone.
    hashes: Object.fromEntries(
      Object.entries(index?.user === user ? (index.hashes ?? {}) : {}).filter(
        ([, h]) => h?.length === 32,
      ),
    ),
    names: index?.user === user ? (index.names ?? []) : [],
    refreshedAt: new Date().toISOString(),
  };
  let idAbove = 0;
  for (;;) {
    const page = await inatGet(
      `/observations?user_login=${encodeURIComponent(user)}&per_page=200&order_by=id&order=asc&id_above=${idAbove}`,
      fetchImpl,
    );
    const results = page.results ?? [];
    for (const o of results)
      next.observations[String(o.id)] = slimObservation(o);
    if (results.length < 200) break;
    idAbove = results.at(-1).id;
  }

  try {
    next.names = await fetchSpeciesNames(user, { fetchImpl });
  } catch {
    // Keep the previous list; it's a safety check, not a dependency.
  }

  const pending = [];
  for (const o of Object.values(next.observations)) {
    for (const [photoId, url] of Object.entries(o.photos)) {
      if (!next.hashes[photoId]) pending.push({ photoId, url });
    }
  }
  let done = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (pending.length) {
      const { photoId, url } = pending.shift();
      try {
        const res = await fetchImpl(url.replace("/square.", "/small."), {
          headers: { "User-Agent": UA },
        });
        if (res.ok)
          next.hashes[photoId] = await dhash(
            Buffer.from(await res.arrayBuffer()),
          );
      } catch {
        // A missing photo is skipped and retried next run.
      }
      if (++done % 200 === 0) onProgress?.(done);
    }
  });
  await Promise.all(workers);
  return next;
}

/** Thresholds measured on this archive with 128-bit hashes: different shots
 * never came closer than 9 bits (and only same-day near-duplicates), while
 * true iNat copies sat at 0-16 bits, 288 of 290 within a day of capture. */
export const MATCH_DATED = 14;
export const MATCH_UNDATED = 6;

/**
 * Build a lookup over the index once per run. The returned function lists the
 * observation photos that plausibly ARE this shot: within MATCH_DATED bits and
 * observed within a day of the capture date, or within MATCH_UNDATED bits when
 * either date is unknown. Closest first.
 */
export function hashMatcher(index) {
  const entries = [];
  for (const [obsId, o] of Object.entries(index?.observations ?? {})) {
    for (const photoId of Object.keys(o.photos)) {
      const hash = index.hashes?.[photoId];
      if (hash)
        entries.push({
          obsId,
          photoId,
          hash,
          day: o.clock?.slice(0, 10) ?? null,
        });
    }
  }
  return (fileHashes, shotClock = null) => {
    const shotDay = shotClock?.slice(0, 10) ?? null;
    const hits = [];
    for (const e of entries) {
      for (const fileHash of fileHashes) {
        const distance = hamming(fileHash, e.hash);
        if (distance > MATCH_DATED) continue;
        const dated = shotDay && e.day;
        const sameDay =
          dated && Math.abs(Date.parse(shotDay) - Date.parse(e.day)) <= 864e5;
        if (dated ? sameDay : distance <= MATCH_UNDATED) {
          hits.push({ obsId: e.obsId, photoId: e.photoId, distance });
        }
      }
    }
    return hits.sort((a, b) => a.distance - b.distance);
  };
}

/**
 * The observation to credit: always the closest fingerprint. Only hits within
 * two bits of it (the same frame on two observations, say a frog and the plant
 * it's on) are tie-broken, animal first, then research grade. A species name is
 * then used only if that observation is research grade at species rank.
 */
export function pickObservation(hits, index, taxa = {}) {
  const ranked = hits
    .map((h) => ({ ...h, obs: index.observations[h.obsId] }))
    .filter((h) => h.obs?.taxon);
  if (!ranked.length) return null;
  const best = Math.min(...ranked.map((h) => h.distance));
  const kingdom = (h) => (taxa[h.obs.taxon]?.kingdom === "Animalia" ? 0 : 1);
  const grade = (h) => (h.obs.quality === "research" ? 0 : 1);
  return ranked
    .filter((h) => h.distance <= best + 2)
    .sort(
      (a, b) =>
        kingdom(a) - kingdom(b) ||
        grade(a) - grade(b) ||
        a.distance - b.distance,
    )[0];
}

/**
 * Every species-level name (common and scientific) you've recorded. Used to
 * catch a caption that names a species without a verified ID for that photo.
 */
export async function fetchSpeciesNames(user, { fetchImpl = fetch } = {}) {
  const names = new Set();
  for (let page = 1; page <= 10; page++) {
    const json = await inatGet(
      `/observations/species_counts?user_login=${encodeURIComponent(user)}&per_page=500&page=${page}`,
      fetchImpl,
    );
    const results = json.results ?? [];
    for (const r of results) {
      if (
        !["species", "subspecies", "variety", "form", "hybrid"].includes(
          r.taxon?.rank,
        )
      )
        continue;
      if (r.taxon.name) names.add(r.taxon.name);
      if (r.taxon.preferred_common_name)
        names.add(r.taxon.preferred_common_name);
    }
    if (results.length < 500) break;
  }
  return [...names];
}

/**
 * Minutes to add to a session's camera clock so it reads like iNat's, learned
 * from exact-frame matches. Needs two matches that agree within two minutes;
 * otherwise assumes the clocks already line up.
 */
export function learnOffset(pairs) {
  const deltas = pairs
    .map(({ shotClock, obsClock }) => {
      const a = clockMs(shotClock);
      const b = clockMs(obsClock);
      return a == null || b == null ? null : Math.round((b - a) / 60000);
    })
    .filter((d) => d != null)
    .sort((a, b) => a - b);
  let best = { value: 0, votes: 0 };
  for (const d of deltas) {
    const votes = deltas.filter((x) => Math.abs(x - d) <= 2).length;
    if (votes > best.votes) best = { value: d, votes };
  }
  return best.votes >= 2 ? best.value : 0;
}

/** Research-grade observations within `windowMinutes` of a capture, offset applied. */
export function timeCandidates(
  shotClock,
  index,
  offsetMinutes = 0,
  windowMinutes = 5,
) {
  const t = clockMs(shotClock);
  if (t == null) return [];
  const target = t + offsetMinutes * 60000;
  return Object.entries(index?.observations ?? {})
    .filter(([, o]) => o.quality === "research" && o.clock)
    .map(([obsId, o]) => ({
      obsId,
      obs: o,
      gap: Math.abs(clockMs(o.clock) - target) / 60000,
    }))
    .filter((c) => c.gap <= windowMinutes)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 4);
}

const IUCN = {
  LC: null,
  NT: "Near Threatened",
  VU: "Vulnerable",
  EN: "Endangered",
  CR: "Critically Endangered",
  EW: "Extinct in the Wild",
};

function plainText(html) {
  return String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Names, lineage, a Wikipedia summary and global IUCN status for one taxon. */
export async function fetchTaxon(taxonId, { fetchImpl = fetch } = {}) {
  const t = (await inatGet(`/taxa/${taxonId}`, fetchImpl)).results?.[0];
  if (!t) return null;
  const lineage = {};
  for (const a of t.ancestors ?? []) {
    if (
      [
        "kingdom",
        "phylum",
        "class",
        "order",
        "suborder",
        "family",
        "genus",
      ].includes(a.rank)
    ) {
      lineage[a.rank] = {
        name: a.name,
        common: a.preferred_common_name ?? null,
      };
    }
  }
  const iucn = (t.conservation_statuses ?? []).find(
    (s) => /iucn/i.test(s.authority ?? "") && !s.place,
  );
  const summary = plainText(t.wikipedia_summary);
  return {
    id: t.id,
    name: t.name,
    common: t.preferred_common_name ?? null,
    rank: t.rank,
    iconic: t.iconic_taxon_name ?? null,
    kingdom: lineage.kingdom?.name ?? null,
    lineage,
    // iNat returns "..." for taxa without a usable article; that's no summary.
    summary: summary.length >= 40 ? summary.slice(0, 1400) : "",
    iucn: iucn ? (IUCN[String(iucn.status).toUpperCase()] ?? null) : null,
    fetchedAt: new Date().toISOString(),
  };
}

/** True when a matched observation may lend its species name to a caption. */
export function speciesUsable(obs, taxon) {
  return (
    obs?.quality === "research" &&
    ["species", "subspecies", "variety", "form", "hybrid"].includes(
      taxon?.rank ?? obs?.rank,
    )
  );
}
