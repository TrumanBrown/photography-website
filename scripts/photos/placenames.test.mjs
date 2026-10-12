import { describe, expect, it } from "vitest";
import { fixPlaceWord, fixSlug, slugTypos } from "./placenames.mjs";
import { allowedNames, slugPlace } from "./website.mjs";

describe("place names in folder names", () => {
  it("fixes two swapped letters in a state, country or island", () => {
    expect(fixPlaceWord("oreogn")).toBe("oregon");
    expect(fixPlaceWord("kauia")).toBe("kauai");
    expect(fixPlaceWord("Iclenad")).toBe(null);
    expect(fixPlaceWord("icelnad")).toBe("iceland");
  });

  it("leaves right spellings, real words and short words alone", () => {
    for (const w of [
      "oregon",
      "kauai",
      "crater",
      "lake",
      "tidepooling",
      "amine",
      "chiel",
      "mali",
      "blaskogabyggo",
    ])
      expect(fixPlaceWord(w)).toBe(null);
  });

  it("names the typo and the folder name it should be", () => {
    expect(slugTypos("crater-lake-oreogn-sep-2025")).toEqual([
      { word: "oreogn", fix: "oregon" },
    ]);
    expect(fixSlug("crater-lake-oreogn-sep-2025")).toBe(
      "crater-lake-oregon-sep-2025",
    );
    expect(fixSlug("southern-kauia-tidepooling-oct-2025")).toBe(
      "southern-kauai-tidepooling-oct-2025",
    );
    expect(slugTypos("smith-rock-oregon-sep-2025")).toEqual([]);
  });

  it("reads a misspelled folder name right in captions", () => {
    expect(slugPlace("crater-lake-oreogn-sep-2025")).toBe("Crater Lake Oregon");
    expect(
      allowedNames({ slug: "crater-lake-oreogn-sep-2025", location: "" }),
    ).toContain("Crater Lake Oregon");
    expect(slugPlace("mt-baker-fall-2026")).toBe("Mount Baker");
  });
});
