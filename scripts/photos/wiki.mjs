/**
 * Wikipedia articles for post facts: a species (or its genus or family), or a
 * place. Read through the public APIs, one request at a time, with an agent
 * string that says who's asking, as Wikimedia's API etiquette asks.
 *
 * Taxa are looked up by the links iNaturalist keeps for them, never by name:
 * names collide ("Zelus" is a Greek god as well as an assassin bug genus).
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sections that are lists of links, not text worth quoting. */
const TAIL =
  /\n==+ (See also|References|External links|Further reading|Notes|Bibliography|Sources|Gallery|Citations|Footnotes) ==+[\s\S]*$/;

/** Long enough to have something to say; shorter articles are stubs. */
export const MIN_ARTICLE = 2500;
/** A species' own article can be shorter: everything in it is about the animal in the photo. */
export const MIN_SPECIES_ARTICLE = 1000;
const MAX_ARTICLE = 14000;

const fold = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function wikiClient({
  domain = "",
  fetchImpl = fetch,
  spacingMs = 1200,
} = {}) {
  const agent = `photo-captions/1.0 (${domain ? `https://${domain}` : "personal photography site"}; facts for photo captions)`;
  const cache = new Map();
  let last = 0;
  let queue = Promise.resolve();

  // One request at a time, even when several lookups run together.
  function getJson(url) {
    if (cache.has(url)) return Promise.resolve(cache.get(url));
    const run = queue.then(() => fetchJson(url));
    queue = run.catch(() => {});
    return run;
  }

  async function fetchJson(url) {
    if (cache.has(url)) return cache.get(url);
    for (let attempt = 0; ; attempt++) {
      const wait = last + spacingMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetchImpl(url, {
        headers: { "User-Agent": agent, "Api-User-Agent": agent },
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const asked = Number(res.headers?.get?.("retry-after"));
        await sleep((asked > 0 ? asked : 15 * (attempt + 1)) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`lookup failed (${res.status})`);
      const json = await res.json();
      cache.set(url, json);
      return json;
    }
  }

  async function article(title) {
    if (!title) return null;
    const j = await getJson(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`,
    );
    const page = Object.values(j.query?.pages ?? {})[0];
    if (!page?.extract) return null;
    return {
      title: page.title,
      text: page.extract.replace(TAIL, "").slice(0, MAX_ARTICLE),
    };
  }

  async function search(query) {
    const j = await getJson(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=1&srsearch=${encodeURIComponent(query)}`,
    );
    return j.query?.search?.[0]?.title ?? null;
  }

  const titleOf = (url) =>
    url ? decodeURIComponent(String(url).split("/wiki/")[1] ?? "") : "";

  /**
   * The species' own article, then its genus's, then its family's: each one
   * with enough to say, most specific first, fetched only when asked for. A
   * genus or family article has to mention the family or order, so a
   * namesake can't slip in.
   */
  async function* taxonArticles(taxonId) {
    const t = (await getJson(`https://api.inaturalist.org/v1/taxa/${taxonId}`))
      .results?.[0];
    if (!t) return;
    const anc = (rank) => (t.ancestors ?? []).find((a) => a.rank === rank);
    const anchors = ["family", "order"]
      .map((r) => anc(r)?.name)
      .filter(Boolean);
    const chain = [
      {
        about: "species",
        url: t.wikipedia_url,
        group: t.preferred_common_name || t.name,
      },
      ...["genus", "family"].map((rank) => {
        const a = anc(rank);
        return (
          a && {
            about: rank,
            url: a.wikipedia_url,
            group: a.preferred_common_name || a.name,
          }
        );
      }),
    ].filter((c) => c?.url);
    for (const c of chain) {
      const a = await article(titleOf(c.url));
      const min = c.about === "species" ? MIN_SPECIES_ARTICLE : MIN_ARTICLE;
      if (!a || a.text.length < min) continue;
      if (c.about !== "species" && !anchors.some((n) => a.text.includes(n)))
        continue;
      yield { ...a, about: c.about, group: c.group };
    }
  }

  /** The most specific article for a taxon, or null. */
  async function taxonArticle(taxonId) {
    for await (const a of taxonArticles(taxonId)) return a;
    return null;
  }

  /**
   * The article for a place: a landmark in the photo if there is one (Mount
   * Baker), otherwise the one whose title best matches the session's place,
   * preferring the park over the town that shares its name. With `context`
   * (the wider place, "Limón Province", "Costa Rica"), the article has to
   * mention one of them, so a band named after a town doesn't slip in.
   */
  async function placeArticle({
    place,
    names = [],
    landmark = "",
    context = [],
  }) {
    const fits = (a) =>
      a &&
      a.text.length >= MIN_ARTICLE &&
      (!context.length || context.some((c) => fold(a.text).includes(fold(c))));
    if (landmark) {
      const title = await search(landmark).catch(() => null);
      const last = landmark.toLowerCase().split(/\s+/).at(-1);
      if (title && title.toLowerCase().includes(last)) {
        const a = await article(title);
        if (fits(a)) return { ...a, about: "place" };
      }
    }
    const lower = String(place ?? "").toLowerCase();
    const main = lower
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 2);
    // "Napali Coast" is "Nā Pali Coast" to Wikipedia: compare without
    // accents, spaces or punctuation.
    const squash = (s) => fold(s).replace(/[^a-z0-9]+/g, "");
    const queries = [
      `${place} national park`,
      place,
      ...names.filter((n) => n !== place),
    ];
    const seen = new Set();
    const scored = [];
    for (const q of queries) {
      if (!q) continue;
      // One failed search shouldn't sink the others.
      const title = await search(q).catch(() => null);
      if (!title || seen.has(title)) continue;
      seen.add(title);
      const tl = title.toLowerCase();
      const ts = squash(title);
      let score;
      if (ts === squash(lower)) score = 7;
      else if (main.length && main.every((w) => ts.includes(squash(w))))
        score = 6;
      else if (main.some((w) => ts.includes(squash(w)))) score = 3;
      else if (names.some((n) => ts === squash(n))) score = 1;
      else continue;
      if (/national park|forest park|reserve|national monument/.test(tl))
        score += 3;
      if (
        /disney|airport|station|university|stadium|district|metro|railway/.test(
          tl,
        )
      )
        score -= 8;
      scored.push({ title, score });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const { title } of scored) {
      const a = await article(title).catch(() => null);
      if (fits(a)) return { ...a, about: "place" };
    }
    return null;
  }

  return { article, search, taxonArticle, taxonArticles, placeArticle };
}
