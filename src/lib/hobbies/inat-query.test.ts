import { describe, expect, it } from "vitest";
import { inatApiUrl, inatExploreUrl, inatFilterQuery } from "./inat-query";

const filter = {
  userId: "someone",
  taxa: [
    { id: 47115, name: "Molluscs" },
    { id: 47549, name: "Echinoderms" },
  ],
  withoutTaxa: [{ id: 47485, name: "Land snails and slugs" }],
  withoutPlaces: [{ id: 29310, name: "La Cruz" }],
  maxRank: "order",
  wildOnly: true,
};

describe("inatFilterQuery", () => {
  it("gives the grid and its View all link the same filter and order", () => {
    const query = inatFilterQuery(filter);
    const api = new URL(inatApiUrl(query, 12)).searchParams;
    const explore = new URL(inatExploreUrl(query)).searchParams;
    for (const [key, value] of new URLSearchParams(query)) {
      expect(api.get(key)).toBe(value);
      expect(explore.get(key)).toBe(value);
    }
    expect(api.get("order_by")).toBe("observed_on");
    expect(api.get("without_taxon_id")).toBe("47485");
    expect(api.get("not_in_place")).toBe("29310");
    expect(api.get("hrank")).toBe("order");
    expect(api.get("captive")).toBe("false");
  });

  it("sends several taxa as taxon_ids, since Explore reads taxon_id as one", () => {
    const params = new URLSearchParams(inatFilterQuery(filter));
    expect(params.get("taxon_ids")).toBe("47115,47549");
    expect(params.has("taxon_id")).toBe(false);
  });

  it("turns off Explore's own defaults, which the API doesn't apply", () => {
    const explore = new URL(inatExploreUrl(inatFilterQuery(filter)));
    expect(explore.origin).toBe("https://www.inaturalist.org");
    expect(explore.searchParams.get("verifiable")).toBe("any");
    expect(explore.searchParams.get("place_id")).toBe("any");
  });
});
