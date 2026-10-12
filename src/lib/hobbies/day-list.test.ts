import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { bestPossible, tidyFact } from "./day-list";
import puzzles from "./day-list.json";

describe("bestPossible", () => {
  it("drops with every species shown", () => {
    const ceilings = [1, 2, 3, 4, 5, 6].map(bestPossible);
    expect(ceilings).toEqual([6000, 5400, 4800, 4250, 3750, 3300]);
  });

  it("matches the ceiling the page renders before the script runs", () => {
    const markup = readFileSync(
      new URL("../../components/hobbies/DayList.astro", import.meta.url),
      "utf8",
    );
    expect(markup).toContain(
      `>${bestPossible(1).toLocaleString("en-US")}</span>`,
    );
  });

  it("clamps out-of-range counts from old saved games", () => {
    expect(bestPossible(0)).toBe(bestPossible(1));
    expect(bestPossible(9)).toBe(bestPossible(6));
  });
});

describe("tidyFact", () => {
  it("drops a bracketed pronunciation and the repeated Latin name", () => {
    expect(
      tidyFact(
        "The mallard (/ˈmælɑːrd/ or /ˈmælərd/) (Anas platyrhynchos) is a dabbling duck.",
        "Anas platyrhynchos",
      ),
    ).toBe("The mallard is a dabbling duck.");
  });

  it("drops a bare pronunciation", () => {
    expect(
      tidyFact(
        "Achillea millefolium, commonly known as yarrow /ˈjæroʊ/ or common yarrow, is a flowering plant.",
        "Achillea millefolium",
      ),
    ).toBe(
      "Achillea millefolium, commonly known as yarrow or common yarrow, is a flowering plant.",
    );
  });

  it("keeps brackets that aren't a pronunciation or the Latin name", () => {
    expect(
      tidyFact(
        "The hooded crow (Corvus cornix) (also called hoodie) flies at 40 km/h (25 mi/h).",
        "Corvus cornix",
      ),
    ).toBe("The hooded crow (also called hoodie) flies at 40 km/h (25 mi/h).");
  });

  it("drops an audio link nested in the pronunciation", () => {
    expect(
      tidyFact(
        "The Carolina anole (Anolis carolinensis) (US: /əˈnoʊ.li/ ( listen)) is an arboreal lizard.",
        "Anolis carolinensis",
      ),
    ).toBe("The Carolina anole is an arboreal lizard.");
  });

  it("drops a Latin name with stray spaces in its bracket", () => {
    expect(
      tidyFact(
        "The crevice spiny lizard (Sceloporus poinsettii ) is a species of small lizard.",
        "Sceloporus poinsettii",
      ),
    ).toBe("The crevice spiny lizard is a species of small lizard.");
  });

  it("leaves no pronunciation or repeated Latin name in the puzzle set", () => {
    for (const round of puzzles.rounds) {
      for (const clue of round.clues) {
        const tidy = tidyFact(clue.fact, clue.sci);
        expect(tidy).not.toMatch(/\/[^/\s]*[ˈˌːə][^/\s]*\//);
        expect(tidy).not.toMatch(/\(\s*listen\s*\)/i);
        expect(tidy).not.toMatch(/\(\s*\)/);
        // A bracket holding only the Latin name. "(Anaxyrus boreas,
        // formerly Bufo boreas)" says something new, so it stays.
        expect(tidy).not.toMatch(new RegExp(`\\(\\s*${clue.sci}\\s*\\)`));
      }
    }
  });
});
