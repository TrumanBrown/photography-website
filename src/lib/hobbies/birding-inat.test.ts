import { describe, expect, it } from "vitest";
import { loadLifeList } from "./birding-inat";

const PHOTOS = "https://inaturalist-open-data.s3.amazonaws.com/photos";

interface FakeData {
  species: unknown[];
  observations: unknown[];
}

/** iNaturalist as the tests need it: at most 200 results a page, whatever is asked. */
function fakeINat(data: FakeData) {
  const calls: URL[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const perPage = Math.min(Number(url.searchParams.get("per_page")), 200);
    const all = url.pathname.endsWith("/species_counts")
      ? data.species
      : data.observations;
    const results = all.slice((page - 1) * perPage, page * perPage);
    return new Response(
      JSON.stringify({ total_results: all.length, per_page: perPage, results }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  const pagesOf = (path: string) =>
    calls
      .filter((url) => url.pathname.endsWith(path))
      .map((url) => url.searchParams.get("page"));
  return { fetchFn, pagesOf };
}

/** 242 species like my list in November 2026, the rarest one last, on page two. */
function lifeList() {
  return Array.from({ length: 242 }, (_, i) => {
    const id = i + 1;
    const babax = id === 242;
    return {
      count: babax ? 1 : 2,
      taxon: {
        id,
        name: babax ? "Pterorhinus waddelli" : `Avis ${id}`,
        preferred_common_name: babax ? "Giant babax" : `Bird ${id}`,
        observations_count: babax ? 35 : 1000 + id,
        default_photo: { url: `${PHOTOS}/${id}/square.jpg` },
        ancestor_ids: [],
      },
    };
  });
}

describe("loadLifeList", () => {
  it("pages species_counts past 200 to iNaturalist's total", async () => {
    const inat = fakeINat({ species: lifeList(), observations: [] });

    const life = await loadLifeList("me", "Aves", 6, {
      fetchFn: inat.fetchFn,
    });

    expect(inat.pagesOf("/species_counts")).toEqual(["1", "2"]);
    expect(life.species).toHaveLength(242);
    expect(life.featured[0].common).toBe("Giant babax");
  });

  it("walks every page of my own observations for photos and dates", async () => {
    const observations: {
      id: number;
      taxon: { id: number; ancestor_ids?: number[] };
      photos: { url: string }[];
      observed_on: string;
    }[] = Array.from({ length: 467 }, (_, i) => ({
      id: i,
      taxon: { id: (i % 241) + 1 },
      photos: [{ url: `${PHOTOS}/obs-${i}/square.jpg` }],
      observed_on: "2025-05-01",
    }));
    // The only babax observation, a subspecies, on the third page.
    observations[466] = {
      id: 466,
      taxon: { id: 9001, ancestor_ids: [3, 242, 9001] },
      photos: [{ url: `${PHOTOS}/mine/square.jpg` }],
      observed_on: "2026-03-02",
    };
    const inat = fakeINat({ species: lifeList(), observations });

    const life = await loadLifeList("me", "Aves", 6, {
      fetchFn: inat.fetchFn,
    });
    const babax = life.species.find((s) => s.common === "Giant babax");

    expect(inat.pagesOf("/observations")).toEqual(["1", "2", "3"]);
    expect(babax?.photo).toBe(`${PHOTOS}/mine/small.jpg`);
    expect(babax?.lastObservedOn).toBe("2026-03-02");
  });
});
