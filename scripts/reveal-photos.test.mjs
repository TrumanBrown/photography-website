import { describe, expect, it } from "vitest";
import { creditFrom, parseSpecies } from "./reveal-photos.mjs";

describe("reveal photo picker", () => {
  it("drops an 'uploaded by' that repeats the photographer", () => {
    expect(
      creditFrom(
        "(c) Max Olson, some rights reserved (CC BY-NC), uploaded by Max Olson",
      ),
    ).toBe("(c) Max Olson, some rights reserved (CC BY-NC) via iNaturalist");
    expect(
      creditFrom(
        "(c) Jane Doe, some rights reserved (CC BY), uploaded by John Roe",
      ),
    ).toBe(
      "(c) Jane Doe, some rights reserved (CC BY), uploaded by John Roe via iNaturalist",
    );
  });

  it("reads species from either quote style, apostrophes included", () => {
    expect(
      parseSpecies(`
        { id: "dunns-salamander", common: "Dunn's salamander", scientific: "Plethodon dunni" },
        { id: 'ochre-star', common: 'Ochre sea star', scientific: 'Pisaster ochraceus' },
      `),
    ).toEqual([
      {
        id: "dunns-salamander",
        common: "Dunn's salamander",
        scientific: "Plethodon dunni",
      },
      {
        id: "ochre-star",
        common: "Ochre sea star",
        scientific: "Pisaster ochraceus",
      },
    ]);
  });
});
