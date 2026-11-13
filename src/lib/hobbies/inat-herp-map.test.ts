import { describe, expect, it } from "vitest";
import {
  HEAT_BANDS,
  heatBands,
  nameClusters,
  type Place,
  type Pt,
} from "./inat-herp-map";

/** The heaviest ink, and how far from (60, 80) any ink reaches. */
function heat(finds: Pt[], sigma = 5) {
  const b = heatBands(finds, sigma, { x: 0, y: 0, w: 200, h: 200 })!;
  let most = 0;
  let reach = 0;
  for (let j = 0; j < b.h; j++) {
    for (let i = 0; i < b.w; i++) {
      const ink = b.ink[j * b.w + i];
      if (!ink) continue;
      most = Math.max(most, ink);
      reach = Math.max(
        reach,
        Math.hypot(b.x + i + 0.5 - 60, b.y + j + 0.5 - 80),
      );
    }
  }
  return { most, reach };
}

describe("herp map heat", () => {
  it("inks only close round a find, never where nothing was seen", () => {
    const one = heat([{ x: 60, y: 80 }]);
    expect(one.most).toBeGreaterThan(0);
    // The palest band starts at a density of 0.12, about 2.1 sigma out.
    expect(one.reach).toBeLessThan(5 * 2.2);
  });

  it("goes darker where more finds stack up", () => {
    const one = heat([{ x: 60, y: 80 }]);
    const five = heat(Array.from({ length: 5 }, () => ({ x: 60, y: 80 })));
    expect(one.most).toBeLessThan(HEAT_BANDS[2][1]);
    expect(five.most).toBeGreaterThan(one.most);
  });
});

describe("herp map labels", () => {
  const place = (
    name: string,
    n: number,
    x: number,
    y: number,
    country = "US",
  ): Place => ({
    name,
    country,
    n,
    x,
    y,
  });
  const names = (places: Place[]) =>
    nameClusters(places, 20, (iso) =>
      iso === "US" ? "United States" : iso,
    ).map((c) => c.name);

  it("names a clump after the places that hold most of its finds", () => {
    expect(
      names([
        place("Washington", 45, 50, 40),
        place("Oregon", 15, 52, 48),
        place("Arizona", 7, 70, 90),
        place("California", 3, 64, 86),
        place("Colorado", 2, 76, 84),
        place("Costa Rica", 106, 150, 160, "CR"),
      ]),
    ).toEqual([
      "Costa Rica",
      "Washington and Oregon",
      "Arizona and California",
    ]);
  });

  it("takes the country's name when three places in it share a clump", () => {
    expect(
      names([
        place("Washington", 10, 50, 40),
        place("Oregon", 9, 52, 48),
        place("Idaho", 8, 58, 44),
      ]),
    ).toEqual(["United States"]);
  });
});
