/**
 * My birding life list and spark bird, read from iNaturalist's public API and
 * shaped for the page. The build calls this and writes both into the HTML (the
 * hourly build keeps them fresh). The browser only calls it when the build
 * couldn't reach iNaturalist. Nothing here touches the DOM.
 *
 * The list is /observations/species_counts, paged until total_results: every
 * species I've logged, with how many times. One page used to stop it at 200 of
 * 242 species, rarest bird included (the November 2026 review, TTT-19). A
 * second pass over my own bird observations, also paged to the end, gives each
 * species my most-faved photo of it and the day I last saw it.
 *
 * "Rarity" is the species' global iNaturalist record count (fewer records
 * worldwide = more unique), not a conservation status.
 */
import birdFamiliesRaw from "./bird-families.json";
import { coarsePlace } from "./inat-place";

export interface FamilyInfo {
  common: string;
  sci: string;
}
/** iNaturalist bird-family taxon id -> names (see scripts/fetch-bird-families.mjs). */
const BIRD_FAMILIES = birdFamiliesRaw as Record<string, FamilyInfo>;

const API = "https://api.inaturalist.org/v1";
const SPECIES_COUNTS = `${API}/observations/species_counts`;
const OBSERVATIONS = `${API}/observations`;
/** Asked for per page. iNaturalist may send fewer, so paging goes by what arrives. */
const SPECIES_PER_PAGE = 500;
const OBSERVATIONS_PER_PAGE = 200;
/** iNaturalist won't page past 10,000 results, so neither do we. */
const MAX_RESULTS = 10_000;
const TIMEOUT_MS = 15_000;
const PHOTO_HOSTS = [
  "https://inaturalist-open-data.s3.amazonaws.com/",
  "https://static.inaturalist.org/",
];

export type PhotoSize = "square" | "small" | "medium" | "large" | "original";

export interface FetchOptions {
  /** Stands in for fetch in tests. */
  fetchFn?: typeof fetch;
  /** Each request gives up after this long. */
  timeoutMs?: number;
  /** How many more times a failed request is tried. */
  retries?: number;
  headers?: Record<string, string>;
  /** Keep what the photo pass found when one of its pages fails, instead of failing. */
  partialOk?: boolean;
}

/** The build retries, and says who's asking, as the other iNaturalist scripts do. */
export const BUILD_FETCH: FetchOptions = {
  retries: 2,
  headers: {
    "User-Agent": "trumanbrown.com site build (+https://trumanbrown.com)",
  },
};

export interface Species {
  id: number;
  common: string;
  scientific: string;
  /** One of my photos once the photo pass has run, else iNaturalist's photo of the species. */
  photo: string | null;
  /** How many times I've logged it. */
  mine: number;
  /** Records of it on iNaturalist worldwide. */
  globalCount: number;
  wikipediaUrl: string | null;
  /** Its bird family's taxon id, a key of bird-families.json, or null. */
  familyId: string | null;
  /** The day I last logged it, YYYY-MM-DD. */
  lastObservedOn: string | null;
  /** The observation my photo of it comes from, which "My sighting" opens. */
  observationId: number | null;
}

export interface LifeList {
  /** Every species, in iNaturalist's order. */
  species: Species[];
  /** The rarest few, rarest first. */
  featured: Species[];
}

export interface SparkObservation {
  /** The observation's page on iNaturalist. */
  url: string;
  /** Its first photo, as iNaturalist sent it. */
  photo: string;
  /** A town or region at most. */
  place: string;
  observedOn: string | null;
}

interface INatPhoto {
  url?: string | null;
}
interface INatTaxon {
  id: number;
  name?: string;
  preferred_common_name?: string;
  default_photo?: INatPhoto | null;
  observations_count?: number;
  wikipedia_url?: string | null;
  ancestor_ids?: number[];
}
interface SpeciesCountsPage {
  total_results?: number;
  results?: { count: number; taxon?: INatTaxon | null }[];
}
interface ObservationsPage {
  total_results?: number;
  results?: {
    id: number;
    faves_count?: number;
    taxon?: { id?: number; ancestor_ids?: number[] } | null;
    photos?: INatPhoto[];
    observed_on?: string | null;
    place_guess?: string | null;
  }[];
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Called bare: a browser throws "Illegal invocation" when fetch runs as a
// method of some other object, such as the options.
const realFetch: typeof fetch = (input, init) => fetch(input, init);

async function getJson<T>(url: string, options: FetchOptions): Promise<T> {
  const fetchFn = options.fetchFn ?? realFetch;
  const { timeoutMs = TIMEOUT_MS, retries = 0, headers = {} } = options;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetchFn(url, {
        headers: { Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new HttpError(res.status);
      return (await res.json()) as T;
    } catch (error) {
      // A 4xx other than 429 will say the same thing next time.
      const final =
        error instanceof HttpError &&
        error.status < 500 &&
        error.status !== 429;
      if (final || attempt >= retries) throw error;
      await wait(1500 * (attempt + 1));
    }
  }
}

/** Whether a photo can be downloaded right now, asked without downloading it. */
export async function isReachable(
  url: string,
  options: FetchOptions = {},
): Promise<boolean> {
  const fetchFn = options.fetchFn ?? realFetch;
  const retries = options.retries ?? 0;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchFn(url, {
        method: "HEAD",
        headers: options.headers,
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      });
      if (res.ok) return true;
    } catch {
      // Tried again below.
    }
    if (attempt < retries) await wait(1500 * (attempt + 1));
  }
  return false;
}

/** An iNaturalist photo URL at another size, or null if it isn't on their photo hosts. */
export function inatPhoto(
  url: string | null | undefined,
  size: PhotoSize,
): string | null {
  if (!url) return null;
  const sized = url.replace("/square.", `/${size}.`);
  return PHOTO_HOSTS.some((host) => sized.startsWith(host)) ? sized : null;
}

/** iNaturalist's Wikipedia links, on https, and nothing else. */
function wikipediaLink(url: string | null | undefined): string | null {
  if (!url || !/^https?:\/\/([a-z0-9-]+\.)*wikipedia\.org\//i.test(url)) {
    return null;
  }
  return url.replace(/^http:/i, "https:");
}

/** The bird family a taxon belongs to, from the nearest ancestor that's a family. */
function familyIdOf(ancestorIds: number[]): string | null {
  for (let i = ancestorIds.length - 1; i >= 0; i -= 1) {
    const id = String(ancestorIds[i]);
    if (BIRD_FAMILIES[id]) return id;
  }
  return null;
}

export function familyInfo(id: string | null): FamilyInfo | null {
  return id ? (BIRD_FAMILIES[id] ?? null) : null;
}

/** Every species I've logged, paged until iNaturalist's total_results. */
export async function fetchSpeciesCounts(
  userId: string,
  iconic: string,
  options: FetchOptions = {},
): Promise<Species[]> {
  const species: Species[] = [];
  const seen = new Set<number>();
  let received = 0;
  for (let page = 1; received < MAX_RESULTS; page += 1) {
    const q = new URLSearchParams({
      user_id: userId,
      per_page: String(SPECIES_PER_PAGE),
      page: String(page),
      locale: "en",
    });
    if (iconic) q.set("iconic_taxa", iconic);
    const data = await getJson<SpeciesCountsPage>(
      `${SPECIES_COUNTS}?${q.toString()}`,
      options,
    );
    const results = data.results ?? [];
    received += results.length;
    for (const { count, taxon } of results) {
      if (!taxon || seen.has(taxon.id)) continue;
      seen.add(taxon.id);
      species.push({
        id: taxon.id,
        common: taxon.preferred_common_name || taxon.name || "Unknown species",
        scientific: taxon.name || "",
        photo: inatPhoto(taxon.default_photo?.url, "small"),
        mine: count,
        globalCount: taxon.observations_count ?? Number.MAX_SAFE_INTEGER,
        wikipediaUrl: wikipediaLink(taxon.wikipedia_url),
        familyId: familyIdOf(taxon.ancestor_ids ?? []),
        lastObservedOn: null,
        observationId: null,
      });
    }
    if (results.length === 0 || received >= (data.total_results ?? 0)) break;
  }
  return species;
}

/**
 * Walks every one of my observations with a photo, newest first, and gives
 * each species its most-faved photo of mine, the newest one on a tie. That
 * observation is the one its "My sighting" link opens. Keeps the latest date
 * seen for each species too. An observation of a subspecies counts for its
 * species.
 *
 * Pages go by id. Ordered by faves, where nearly all tie at none, iNaturalist's
 * pages overlapped and 14 of 467 observations never came back (2026-11-13).
 */
export async function addMyObservations(
  userId: string,
  iconic: string,
  species: Species[],
  options: FetchOptions = {},
): Promise<void> {
  const byId = new Map(species.map((s) => [s.id, s]));
  const bestFaves = new Map<number, number>();
  let received = 0;
  for (let page = 1; received < MAX_RESULTS; page += 1) {
    const q = new URLSearchParams({
      user_id: userId,
      photos: "true",
      per_page: String(OBSERVATIONS_PER_PAGE),
      page: String(page),
      order_by: "id",
      order: "desc",
      locale: "en",
    });
    if (iconic) q.set("iconic_taxa", iconic);
    let data: ObservationsPage;
    try {
      data = await getJson<ObservationsPage>(
        `${OBSERVATIONS}?${q.toString()}`,
        options,
      );
    } catch (error) {
      if (options.partialOk) return;
      throw error;
    }
    const results = data.results ?? [];
    received += results.length;
    for (const o of results) {
      const ids = [
        o.taxon?.id,
        ...[...(o.taxon?.ancestor_ids ?? [])].reverse(),
      ];
      const match = ids.find((id) => id != null && byId.has(id));
      const s = match == null ? undefined : byId.get(match);
      if (!s) continue;
      const photo = inatPhoto(o.photos?.[0]?.url, "small");
      const faves = o.faves_count ?? 0;
      if (photo && faves > (bestFaves.get(s.id) ?? -1)) {
        s.photo = photo;
        s.observationId = o.id;
        bestFaves.set(s.id, faves);
      }
      if (
        o.observed_on &&
        (!s.lastObservedOn || o.observed_on > s.lastObservedOn)
      ) {
        s.lastObservedOn = o.observed_on;
      }
    }
    if (results.length === 0 || received >= (data.total_results ?? 0)) break;
  }
}

export function rarest(species: Species[], count: number): Species[] {
  return [...species]
    .sort(
      (a, b) =>
        a.globalCount - b.globalCount || a.common.localeCompare(b.common, "en"),
    )
    .slice(0, count);
}

export async function loadLifeList(
  userId: string,
  iconic: string,
  featuredCount: number,
  options: FetchOptions = {},
): Promise<LifeList> {
  const species = await fetchSpeciesCounts(userId, iconic, options);
  if (species.length > 0) {
    await addMyObservations(userId, iconic, species, options);
  }
  return { species, featured: rarest(species, featuredCount) };
}

/** My most recent observation of the spark bird that has a photo. */
export async function fetchSparkObservation(
  userId: string,
  taxonId: number | string,
  options: FetchOptions = {},
): Promise<SparkObservation | null> {
  const q = new URLSearchParams({
    user_id: userId,
    taxon_id: String(taxonId),
    photos: "true",
    per_page: "1",
    order_by: "observed_on",
    order: "desc",
    locale: "en",
  });
  const data = await getJson<ObservationsPage>(
    `${OBSERVATIONS}?${q.toString()}`,
    options,
  );
  for (const o of data.results ?? []) {
    const photo = o.photos?.[0]?.url;
    if (!photo || !inatPhoto(photo, "square")) continue;
    return {
      url: `https://www.inaturalist.org/observations/${o.id}`,
      photo,
      place: coarsePlace(o.place_guess),
      observedOn: o.observed_on ?? null,
    };
  }
  return null;
}

const loaded = new Map<string, { at: number; value: Promise<unknown> }>();

/**
 * One fetch per key every ten minutes. The build renders the page once, but
 * the dev server renders it on every visit and would ask iNaturalist each time.
 */
export function loadOnce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = loaded.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value as Promise<T>;
  const value = load();
  loaded.set(key, { at: Date.now(), value });
  value.catch(() => loaded.delete(key));
  return value;
}

export interface FamilyGroup {
  key: string;
  common: string;
  sci: string | null;
  members: Species[];
}

/** Species by bird family, the biggest family first, names A to Z inside each. */
export function groupByFamily(species: Species[]): FamilyGroup[] {
  const groups = new Map<string, FamilyGroup>();
  for (const s of species) {
    const family = familyInfo(s.familyId);
    const key = family ? (s.familyId as string) : "other";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        common: family ? family.common : "Other birds",
        sci: family ? family.sci : null,
        members: [],
      };
      groups.set(key, group);
    }
    group.members.push(s);
  }
  for (const group of groups.values()) {
    group.members.sort((a, b) => a.common.localeCompare(b.common, "en"));
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.members.length - a.members.length ||
      a.common.localeCompare(b.common, "en"),
  );
}

export type SortMode = "family" | "recent" | "name" | "most-seen" | "rarest";

export function sortSpecies(species: Species[], mode: SortMode): Species[] {
  const list = [...species];
  const byName = (a: Species, b: Species) =>
    a.common.localeCompare(b.common, "en");
  switch (mode) {
    case "recent":
      // Species with no date go last.
      return list.sort(
        (a, b) =>
          (b.lastObservedOn ?? "").localeCompare(a.lastObservedOn ?? "") ||
          byName(a, b),
      );
    case "most-seen":
      return list.sort((a, b) => b.mine - a.mine || byName(a, b));
    case "rarest":
      return list.sort((a, b) => a.globalCount - b.globalCount || byName(a, b));
    default:
      return list.sort(byName);
  }
}

/** Lower case with accents dropped, so a search ignores both. */
export function normalizeQuery(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function matchesQuery(
  s: Pick<Species, "common" | "scientific">,
  query: string,
): boolean {
  if (!query) return true;
  return normalizeQuery(`${s.common} ${s.scientific}`).includes(query);
}

function utcDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Mar 2024" for a YYYY-MM-DD date, the same on the build and in the browser. */
export function monthYear(value: string | null): string {
  const date = utcDate(value);
  return date
    ? date.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
}

/** "February 7, 2026" for a YYYY-MM-DD date. */
export function longDate(value: string | null): string {
  const date = utcDate(value);
  return date
    ? date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
}

export function sparkCaption(
  obs: Pick<SparkObservation, "place" | "observedOn">,
): string {
  return (
    [obs.place, longDate(obs.observedOn)].filter(Boolean).join(" · ") ||
    "My observation on iNaturalist"
  );
}
