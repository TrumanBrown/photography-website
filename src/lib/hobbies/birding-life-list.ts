/**
 * Renders a live "life list" from a user's iNaturalist species_counts — the
 * richer, personal counterpart to the selfie-to-bird game. Lazy: only calls the
 * public iNat API when the section nears the viewport. No dependencies; safe
 * under the site's strict CSP (the API host + iNat photo CDNs are allow-listed
 * in staticwebapp.config.json).
 *
 * Three passes:
 *   1. /observations/species_counts — every distinct species the user has
 *      logged, with how many times they logged it (the life list itself).
 *   2. /observations — the user's own photos, so each species shows one of
 *      their best (most-faved) shots rather than a generic representative one.
 *   3. /taxa/<ids> — for the handful of globally-rarest species, pull the
 *      Wikipedia summary to use as a fun-fact/range blurb on the featured cards.
 *
 * "Rarity" here is the global iNaturalist observation count for the species
 * (fewer records worldwide = more unique), not a formal conservation status.
 *
 * Mounted by src/components/hobbies/BirdingLifeList.astro via [data-life] hooks.
 */
import birdFamiliesRaw from "./bird-families.json";

interface FamilyInfo {
  common: string;
  sci: string;
}
/** iNaturalist bird-family taxon id -> names (see scripts/fetch-bird-families.mjs). */
const BIRD_FAMILIES = birdFamiliesRaw as Record<string, FamilyInfo>;

const SPECIES_COUNTS =
  "https://api.inaturalist.org/v1/observations/species_counts";
const OBSERVATIONS = "https://api.inaturalist.org/v1/observations";
const TAXA = "https://api.inaturalist.org/v1/taxa";
const PHOTO_HOSTS = [
  "https://inaturalist-open-data.s3.amazonaws.com/",
  "https://static.inaturalist.org/",
];

interface INatPhoto {
  url?: string;
}
interface INatTaxon {
  id: number;
  name?: string;
  preferred_common_name?: string;
  default_photo?: INatPhoto | null;
  observations_count?: number;
  wikipedia_url?: string;
  ancestor_ids?: number[];
}
interface SpeciesCount {
  count: number;
  taxon?: INatTaxon | null;
}
interface TaxonDetail extends INatTaxon {
  wikipedia_summary?: string;
}

interface Species {
  id: number;
  common: string;
  scientific: string;
  photo: string | null;
  mine: number;
  globalCount: number;
  wikipediaUrl: string | null;
  ancestorIds: number[];
}

/** The bird family a species belongs to, resolved from its ancestor chain. */
function familyOf(s: Species): FamilyInfo | null {
  for (let i = s.ancestorIds.length - 1; i >= 0; i -= 1) {
    const fam = BIRD_FAMILIES[String(s.ancestorIds[i])];
    if (fam) return fam;
  }
  return null;
}

/** square (75px) -> small (240px) for a crisper tile. */
function upgrade(url: string): string {
  return url.replace("/square.", "/small.");
}
function allowedHost(url: string): boolean {
  return PHOTO_HOSTS.some((h) => url.startsWith(h));
}
function safePhoto(url: string | undefined | null): string | null {
  if (!url) return null;
  const up = upgrade(url);
  return allowedHost(up) ? up : null;
}

/** iNat wikipedia summaries are HTML; flatten to a trimmed plain-text sentence-ish blurb. */
function plainSummary(html: string | undefined, max = 240): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 0 ? lastSpace : max).trimEnd()}…`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function observationsUrl(userId: string, taxonId: number): string {
  return `https://www.inaturalist.org/observations?user_id=${encodeURIComponent(userId)}&taxon_id=${taxonId}`;
}

async function fetchSpecies(
  userId: string,
  iconic: string,
): Promise<Species[]> {
  const q = new URLSearchParams({
    user_id: userId,
    per_page: "200",
    locale: "en",
  });
  if (iconic) q.set("iconic_taxa", iconic);
  const res = await fetch(`${SPECIES_COUNTS}?${q.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { results?: SpeciesCount[] };
  const out: Species[] = [];
  for (const r of data.results ?? []) {
    const t = r.taxon;
    if (!t) continue;
    out.push({
      id: t.id,
      common: t.preferred_common_name || t.name || "Unknown species",
      scientific: t.name || "",
      photo: safePhoto(t.default_photo?.url),
      mine: r.count,
      globalCount: t.observations_count ?? Number.MAX_SAFE_INTEGER,
      wikipediaUrl: t.wikipedia_url || null,
      ancestorIds: t.ancestor_ids ?? [],
    });
  }
  return out;
}

async function fetchSummaries(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.length === 0) return map;
  const res = await fetch(`${TAXA}/${ids.join(",")}?locale=en`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return map;
  const data = (await res.json()) as { results?: TaxonDetail[] };
  for (const t of data.results ?? []) {
    const blurb = plainSummary(t.wikipedia_summary);
    if (blurb) map.set(t.id, blurb);
  }
  return map;
}

interface INatObservation {
  taxon?: { id?: number; ancestor_ids?: number[] } | null;
  photos?: INatPhoto[];
}

/** Which life-list species an observation belongs to (its taxon may be a subspecies). */
function speciesIdFor(
  taxon: INatObservation["taxon"],
  speciesIds: Set<number>,
): number | null {
  if (!taxon) return null;
  if (taxon.id != null && speciesIds.has(taxon.id)) return taxon.id;
  for (const a of taxon.ancestor_ids ?? []) if (speciesIds.has(a)) return a;
  return null;
}

/**
 * Map each species id to one of the user's OWN observation photos. Observations
 * are paged most-faved first, so the first photo seen for a species is their
 * best one. Caps at 5 pages (1000 observations) as a safety bound.
 */
async function fetchMyPhotos(
  userId: string,
  iconic: string,
  speciesIds: Set<number>,
): Promise<Map<number, string>> {
  const mine = new Map<number, string>();
  for (let page = 1; page <= 5; page += 1) {
    const q = new URLSearchParams({
      user_id: userId,
      photos: "true",
      per_page: "200",
      page: String(page),
      order_by: "votes",
      order: "desc",
      locale: "en",
    });
    if (iconic) q.set("iconic_taxa", iconic);
    const res = await fetch(`${OBSERVATIONS}?${q.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) break;
    const data = (await res.json()) as {
      total_results?: number;
      results?: INatObservation[];
    };
    for (const o of data.results ?? []) {
      const photo = safePhoto(o.photos?.[0]?.url);
      if (!photo) continue;
      const sid = speciesIdFor(o.taxon, speciesIds);
      if (sid != null && !mine.has(sid)) mine.set(sid, photo);
    }
    const total = data.total_results ?? 0;
    if (page * 200 >= total) break;
  }
  return mine;
}

function renderFeaturedCard(
  s: Species,
  userId: string,
  blurb: string,
): HTMLElement {
  const card = el(
    "div",
    "flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/40",
  );

  if (s.photo) {
    const figure = el(
      "div",
      "aspect-[4/3] w-full overflow-hidden bg-neutral-100 dark:bg-neutral-900",
    );
    const img = el("img", "h-full w-full object-cover");
    img.src = s.photo;
    img.alt = s.common;
    img.loading = "lazy";
    img.decoding = "async";
    figure.appendChild(img);
    card.appendChild(figure);
  }

  const body = el("div", "flex flex-1 flex-col gap-2 p-4");
  const head = el("div", "flex items-start justify-between gap-2");
  const names = el("div");
  names.appendChild(el("h3", "text-sm font-semibold leading-tight", s.common));
  if (s.scientific)
    names.appendChild(
      el(
        "p",
        "text-xs italic text-neutral-500 dark:text-neutral-400",
        s.scientific,
      ),
    );
  head.appendChild(names);
  const badge = el(
    "span",
    "shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
    s.mine === 1 ? "Seen once" : `Seen ${s.mine}×`,
  );
  head.appendChild(badge);
  body.appendChild(head);

  body.appendChild(
    el(
      "p",
      "text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400",
      `Globally uncommon · ~${s.globalCount.toLocaleString()} records on iNaturalist`,
    ),
  );

  if (blurb)
    body.appendChild(
      el(
        "p",
        "text-xs leading-relaxed text-neutral-600 dark:text-neutral-300",
        blurb,
      ),
    );

  const links = el("div", "mt-auto flex flex-wrap gap-3 pt-1 text-xs");
  const obs = el(
    "a",
    "font-medium text-sky-700 no-underline hover:underline dark:text-sky-400",
    "My sighting →",
  );
  obs.href = observationsUrl(userId, s.id);
  obs.target = "_blank";
  obs.rel = "noopener noreferrer";
  links.appendChild(obs);
  if (s.wikipediaUrl) {
    const wiki = el(
      "a",
      "text-neutral-500 no-underline hover:underline dark:text-neutral-400",
      "Wikipedia",
    );
    wiki.href = s.wikipediaUrl;
    wiki.target = "_blank";
    wiki.rel = "noopener noreferrer";
    links.appendChild(wiki);
  }
  body.appendChild(links);

  card.appendChild(body);
  return card;
}

function renderListRow(s: Species, userId: string): HTMLElement {
  const a = el(
    "a",
    "group flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-2 no-underline transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40 dark:hover:border-neutral-700 dark:hover:bg-neutral-800/60",
  );
  a.href = observationsUrl(userId, s.id);
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.setAttribute("role", "listitem");

  const thumb = el(
    "div",
    "h-11 w-11 shrink-0 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-900",
  );
  if (s.photo) {
    const img = el("img", "h-full w-full object-cover");
    img.src = s.photo;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    thumb.appendChild(img);
  }
  a.appendChild(thumb);

  const text = el("div", "min-w-0 flex-1");
  text.appendChild(el("p", "truncate text-sm font-medium", s.common));
  if (s.scientific)
    text.appendChild(
      el(
        "p",
        "truncate text-xs italic text-neutral-500 dark:text-neutral-400",
        s.scientific,
      ),
    );
  a.appendChild(text);

  a.appendChild(
    el(
      "span",
      "shrink-0 text-xs text-neutral-400 dark:text-neutral-500",
      s.mine === 1 ? "×1" : `×${s.mine}`,
    ),
  );
  return a;
}

interface FamilyGroup {
  key: string;
  common: string;
  sci: string | null;
  members: Species[];
}

/** Bucket species by bird family, ordered by group size (largest first). */
function groupByFamily(species: Species[]): FamilyGroup[] {
  const groups = new Map<string, FamilyGroup>();
  for (const s of species) {
    const fam = familyOf(s);
    const key = fam ? fam.sci : "__other__";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        common: fam ? fam.common : "Other birds",
        sci: fam ? fam.sci : null,
        members: [],
      };
      groups.set(key, group);
    }
    group.members.push(s);
  }
  for (const group of groups.values()) {
    group.members.sort((a, b) => a.common.localeCompare(b.common));
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.members.length - a.members.length || a.common.localeCompare(b.common),
  );
}

function renderFamilyGroup(group: FamilyGroup, userId: string): HTMLElement {
  const section = el("section", "space-y-2");

  const header = el("div", "flex items-baseline gap-2");
  header.appendChild(el("h4", "text-sm font-semibold", group.common));
  if (group.sci)
    header.appendChild(
      el(
        "span",
        "text-xs italic text-neutral-500 dark:text-neutral-400",
        group.sci,
      ),
    );
  header.appendChild(
    el(
      "span",
      "ml-auto text-xs text-neutral-400 dark:text-neutral-500",
      group.members.length === 1
        ? "1 species"
        : `${group.members.length} species`,
    ),
  );
  section.appendChild(header);

  const grid = el(
    "div",
    "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3",
  );
  grid.setAttribute("role", "list");
  for (const s of group.members) grid.appendChild(renderListRow(s, userId));
  section.appendChild(grid);

  return section;
}

export function initBirdingLifeList(root: HTMLElement): void {
  const featuredWrap = root.querySelector<HTMLElement>("[data-life-featured]");
  const listWrap = root.querySelector<HTMLElement>("[data-life-list]");
  const status = root.querySelector<HTMLElement>("[data-life-status]");
  const countEl = root.querySelector<HTMLElement>("[data-life-count]");
  const userId = root.dataset.lifeUser;
  const iconic = root.dataset.lifeIconic || "";
  const featuredN = Math.max(
    1,
    Math.min(12, Number(root.dataset.lifeFeatured) || 6),
  );
  if (!featuredWrap || !listWrap || !userId) return;

  let started = false;
  const load = async (): Promise<void> => {
    if (started) return;
    started = true;
    try {
      const species = await fetchSpecies(userId, iconic);
      if (species.length === 0) {
        featuredWrap.replaceChildren();
        listWrap.replaceChildren();
        if (status) status.textContent = "No species logged yet.";
        return;
      }

      if (countEl) countEl.textContent = `${species.length} species`;

      const myPhotos = await fetchMyPhotos(
        userId,
        iconic,
        new Set(species.map((s) => s.id)),
      );
      for (const s of species) {
        const mine = myPhotos.get(s.id);
        if (mine) s.photo = mine;
      }

      const byRarity = [...species].sort(
        (a, b) => a.globalCount - b.globalCount,
      );
      const featured = byRarity.slice(0, featuredN);
      const summaries = await fetchSummaries(featured.map((s) => s.id));

      featuredWrap.replaceChildren(
        ...featured.map((s) =>
          renderFeaturedCard(s, userId, summaries.get(s.id) ?? ""),
        ),
      );

      const groups = groupByFamily(species);
      listWrap.replaceChildren(
        ...groups.map((group) => renderFamilyGroup(group, userId)),
      );

      if (status) status.textContent = "";
    } catch {
      featuredWrap.replaceChildren();
      listWrap.replaceChildren();
      if (status) {
        status.textContent =
          "Could not load the life list right now. See it on iNaturalist.";
      }
    }
  };

  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          obs.disconnect();
          void load();
        }
      }
    },
    { rootMargin: "200px" },
  );
  io.observe(root);
}
