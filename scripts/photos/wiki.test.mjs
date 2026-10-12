import { describe, expect, it } from "vitest";
import { wikiClient } from "./wiki.mjs";

const long = (words) => `${words} `.repeat(400);

/** A fake fetch answering from a table of URL fragments. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([frag]) => url.includes(frag));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => hit[1] };
  };
  fn.calls = calls;
  return fn;
}
const page = (title, extract) => ({
  query: { pages: { 1: { title, extract } } },
});
const found = (title) => ({ query: { search: [{ title }] } });

describe("Wikipedia lookups", () => {
  it("follows iNaturalist's links up to a genus that has an article, skipping namesakes", async () => {
    const fetchImpl = fakeFetch({
      "taxa/7": {
        results: [
          {
            name: "Zelus lewisi",
            wikipedia_url: null,
            ancestors: [
              {
                rank: "order",
                name: "Hemiptera",
                wikipedia_url: "http://en.wikipedia.org/wiki/Hemiptera",
              },
              {
                rank: "family",
                name: "Reduviidae",
                preferred_common_name: "Assassin Bugs",
                wikipedia_url: "http://en.wikipedia.org/wiki/Reduviidae",
              },
              {
                rank: "genus",
                name: "Zelus",
                wikipedia_url: "http://en.wikipedia.org/wiki/Zelus_(bug)",
              },
            ],
          },
        ],
      },
      "titles=Zelus_(bug)": page(
        "Zelus (bug)",
        long("Zelus is a genus of Reduviidae assassin bugs."),
      ),
    });
    const wiki = wikiClient({ fetchImpl, spacingMs: 0 });
    const art = await wiki.taxonArticle(7);
    expect(art).toMatchObject({ title: "Zelus (bug)", about: "genus" });
    // The bare name was never searched: "Zelus" is also a Greek god.
    expect(fetchImpl.calls.some((u) => u.includes("titles=Zelus&"))).toBe(
      false,
    );
  });

  it("rejects a genus article that doesn't mention the family or order", async () => {
    const fetchImpl = fakeFetch({
      "taxa/8": {
        results: [
          {
            name: "Zelus lewisi",
            ancestors: [
              {
                rank: "family",
                name: "Reduviidae",
                wikipedia_url: "http://en.wikipedia.org/wiki/Reduviidae_page",
              },
              {
                rank: "genus",
                name: "Zelus",
                wikipedia_url: "http://en.wikipedia.org/wiki/Zelus",
              },
            ],
          },
        ],
      },
      "titles=Zelus": page(
        "Zelus",
        long("In Greek mythology, Zelus was the personification of rivalry."),
      ),
      "titles=Reduviidae_page": page(
        "Reduviidae",
        long("Reduviidae are the assassin bugs."),
      ),
    });
    const art = await wikiClient({ fetchImpl, spacingMs: 0 }).taxonArticle(8);
    expect(art).toMatchObject({ title: "Reduviidae", about: "family" });
  });

  it("matches a place whose article spells it with accents or spaces", async () => {
    const fetchImpl = fakeFetch({
      "srsearch=Napali%20Coast%20national%20park": found(
        "Nā Pali Coast State Wilderness Park",
      ),
      "srsearch=Napali%20Coast": found("Nā Pali Coast State Wilderness Park"),
      "titles=N%C4%81%20Pali%20Coast%20State%20Wilderness%20Park": page(
        "Nā Pali Coast State Wilderness Park",
        long("The Nā Pali Coast is on Kauai, Hawaii."),
      ),
    });
    const art = await wikiClient({ fetchImpl, spacingMs: 0 }).placeArticle({
      place: "Napali Coast",
      names: ["Napali Coast", "Kauai", "Hawaii"],
      context: ["Kauai", "Hawaii"],
    });
    expect(art.title).toBe("Nā Pali Coast State Wilderness Park");
  });

  it("picks the park over the town, and never a theme park", async () => {
    const fetchImpl = fakeFetch({
      "srsearch=Zhangjiajie%20national%20park": found(
        "Zhangjiajie National Forest Park",
      ),
      "srsearch=Zhangjiajie": found("Zhangjiajie"),
      "srsearch=Shanghai%20national%20park": found("Shanghai Disneyland"),
      "srsearch=Shanghai": found("Shanghai"),
      "titles=Zhangjiajie%20National%20Forest%20Park": page(
        "Zhangjiajie National Forest Park",
        long("Sandstone pillars."),
      ),
      "titles=Shanghai": page("Shanghai", long("Shanghai means on the sea.")),
    });
    const wiki = wikiClient({ fetchImpl, spacingMs: 0 });
    expect(
      (
        await wiki.placeArticle({
          place: "Zhangjiajie",
          names: ["Zhangjiajie", "Hunan"],
        })
      ).title,
    ).toBe("Zhangjiajie National Forest Park");
    expect(
      (
        await wiki.placeArticle({
          place: "Shanghai",
          names: ["Shanghai", "China"],
        })
      ).title,
    ).toBe("Shanghai");
  });

  it("skips an article that never mentions the wider place, like a band named after the town", async () => {
    const fetchImpl = fakeFetch({
      "srsearch=Guayac%C3%A1n%20national%20park": found("Orquesta Guayacán"),
      "srsearch=Guayac%C3%A1n": found("Orquesta Guayacán"),
      "srsearch=Costa%20Rica": found("Costa Rica"),
      "titles=Orquesta%20Guayac%C3%A1n": page(
        "Orquesta Guayacán",
        long("Orquesta Guayacán is a salsa band from Colombia."),
      ),
      "titles=Costa%20Rica": page(
        "Costa Rica",
        long("Costa Rica has volcanoes and cloud forests."),
      ),
    });
    const art = await wikiClient({ fetchImpl, spacingMs: 0 }).placeArticle({
      place: "Guayacán",
      names: ["Guayacán", "Costa Rica"],
      context: ["Limón Province", "Costa Rica"],
    });
    expect(art.title).toBe("Costa Rica");
  });

  it("takes a shorter article when it's the species' own", async () => {
    const fetchImpl = fakeFetch({
      "taxa/9": {
        results: [
          {
            name: "Cruziohyla sylviae",
            wikipedia_url: "http://en.wikipedia.org/wiki/Cruziohyla_sylviae",
            ancestors: [],
          },
        ],
      },
      "titles=Cruziohyla_sylviae": page(
        "Cruziohyla sylviae",
        "Sylvia's tree frog is named after Sylvia. ".repeat(30),
      ),
    });
    const art = await wikiClient({ fetchImpl, spacingMs: 0 }).taxonArticle(9);
    expect(art).toMatchObject({
      title: "Cruziohyla sylviae",
      about: "species",
    });
  });

  it("lists the species', genus' and family's articles, most specific first", async () => {
    const fetchImpl = fakeFetch({
      "taxa/10": {
        results: [
          {
            name: "Argynnis coronis",
            wikipedia_url: "http://en.wikipedia.org/wiki/Argynnis_coronis",
            ancestors: [
              {
                rank: "family",
                name: "Nymphalidae",
                preferred_common_name: "Brush-footed Butterflies",
                wikipedia_url: "http://en.wikipedia.org/wiki/Nymphalidae",
              },
              {
                rank: "genus",
                name: "Argynnis",
                preferred_common_name: "Greater Fritillaries",
                wikipedia_url: "http://en.wikipedia.org/wiki/Argynnis",
              },
            ],
          },
        ],
      },
      "titles=Argynnis_coronis": page(
        "Argynnis coronis",
        "The coronis fritillary flies in summer. ".repeat(40),
      ),
      "titles=Argynnis": page(
        "Argynnis",
        long("Argynnis is a genus in Nymphalidae."),
      ),
      "titles=Nymphalidae": page(
        "Nymphalidae",
        long("Nymphalidae stand on four legs."),
      ),
    });
    const arts = [];
    for await (const a of wikiClient({ fetchImpl, spacingMs: 0 }).taxonArticles(
      10,
    ))
      arts.push(a);
    expect(arts.map((a) => [a.title, a.about, a.group])).toEqual([
      ["Argynnis coronis", "species", "Argynnis coronis"],
      ["Argynnis", "genus", "Greater Fritillaries"],
      ["Nymphalidae", "family", "Brush-footed Butterflies"],
    ]);
  });

  it("waits when Wikipedia asks it to slow down", async () => {
    let n = 0;
    const fetchImpl = async () => {
      n++;
      if (n === 1)
        return {
          ok: false,
          status: 429,
          headers: { get: () => "0.01" },
          json: async () => ({}),
        };
      return { ok: true, status: 200, json: async () => found("Mount Baker") };
    };
    expect(
      await wikiClient({ fetchImpl, spacingMs: 0 }).search("Mount Baker"),
    ).toBe("Mount Baker");
    expect(n).toBe(2);
  });
});
