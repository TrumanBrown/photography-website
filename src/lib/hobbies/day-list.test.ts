import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  EXTRA_PER_DAY,
  bestPossible,
  photoCredits,
  photoSrcset,
  pickExtra,
  readDaily,
  readExtra,
  scoreGuess,
  tidyFact,
  type Round,
} from "./day-list";
import puzzles from "./day-list.json";
import extras from "./day-list-extra.json";

const daily = puzzles.rounds as Round[];
const extra = extras.rounds as Round[];

describe("the two puzzle sets", () => {
  it("never share a place, so an extra list can't spoil a daily one", () => {
    const ids = new Set(daily.map((r) => r.placeId));
    expect(extra.filter((r) => ids.has(r.placeId))).toEqual([]);
  });

  it("have six species and a real boundary in every round", () => {
    for (const round of [...daily, ...extra]) {
      expect(round.clues).toHaveLength(6);
      expect(round.bbox.w).toBeLessThanOrEqual(round.bbox.e);
      expect(round.bbox.s).toBeLessThanOrEqual(round.bbox.n);
      expect(round.month).toBeGreaterThanOrEqual(1);
      expect(round.month).toBeLessThanOrEqual(12);
    }
  });

  it("hold enough extra places for a week of ten a day", () => {
    expect(new Set(extra.map((r) => r.placeId)).size).toBeGreaterThanOrEqual(
      EXTRA_PER_DAY * 6,
    );
  });
});

describe("scoreGuess", () => {
  const round = { bbox: { w: 10, e: 12, s: 40, n: 42 }, month: 6 };

  it("pays everything for a pin inside the place in the right month", () => {
    const hit = scoreGuess(round, { lat: 41, lon: 11, month: 5, lines: 1 });
    expect(hit).toMatchObject({ km: 0, off: 0, score: 6000 });
    const late = scoreGuess(round, { lat: 41, lon: 11, month: 5, lines: 6 });
    expect(late.score).toBe(bestPossible(6));
  });

  it("measures to the nearest edge and wraps months round the year", () => {
    const miss = scoreGuess(round, { lat: 41, lon: 13, month: 11, lines: 1 });
    expect(miss.km).toBeGreaterThan(80);
    expect(miss.km).toBeLessThan(90);
    expect(miss.off).toBe(6);
    expect(miss.monthPoints).toBe(0);
  });
});

describe("readDaily", () => {
  const day = 20738;

  it("treats a save from before rounds were remembered as locked in", () => {
    const old = { day, lines: 3, lat: 45, lon: 29, month: 4 };
    expect(readDaily(old, day)).toMatchObject({ lines: 3, done: true });
  });

  it("restores a round in progress without locking it in", () => {
    const half = { day, lines: 2, lat: 45, lon: 29, done: false };
    expect(readDaily(half, day)).toMatchObject({ lines: 2, done: false });
    expect(readDaily({ day, lines: 4 }, day)).toMatchObject({ done: false });
  });

  it("ignores another day's save and junk", () => {
    expect(readDaily({ day: day - 1, lines: 6 }, day)).toBeNull();
    expect(readDaily("nonsense", day)).toBeNull();
  });
});

describe("readExtra", () => {
  const day = 20738;

  it("keeps today's count and scores", () => {
    const saved = {
      day,
      played: [1, 2],
      scores: { "1": 900 },
      seen: [1, 2],
      current: { placeId: 2, lines: 1, done: false },
    };
    expect(readExtra(saved, day)).toEqual(saved);
  });

  it("starts a new day at zero but remembers every place seen", () => {
    const yesterday = {
      day: day - 1,
      played: [1, 2, 3],
      scores: { "1": 900, "2": 10, "3": 4000 },
      seen: [1, 2, 3],
      current: { placeId: 3, lines: 6, done: true },
    };
    expect(readExtra(yesterday, day)).toEqual({
      day,
      played: [],
      scores: {},
      seen: [1, 2, 3],
      current: null,
    });
  });

  it("carries a list left half-played into the new day", () => {
    const yesterday = {
      day: day - 1,
      played: [4],
      scores: {},
      seen: [4],
      current: { placeId: 4, lines: 2, done: false },
    };
    const today = readExtra(yesterday, day);
    expect(today.played).toEqual([4]);
    expect(today.current).toMatchObject({ placeId: 4, lines: 2 });
  });
});

describe("pickExtra", () => {
  it("deals a place this browser hasn't started", () => {
    expect(pickExtra([1, 2, 3], [1, 3], () => 0.99)).toBe(2);
  });

  it("goes back to the one started longest ago once all are seen", () => {
    expect(pickExtra([1, 2, 3], [2, 3, 1])).toBe(2);
  });
});

describe("photoCredits", () => {
  const clues = daily[0].clues.map((clue, i) => ({
    ...clue,
    by: `Photographer ${i + 1}`,
  }));

  it("credits only the photos on the board, since a name can give the place away", () => {
    const two = photoCredits(clues, 2);
    expect(two.match(/<li>/g)).toHaveLength(2);
    expect(two).toContain("Photographer 2");
    expect(two).not.toContain("Photographer 3");
    expect(photoCredits(clues, 6).match(/<li>/g)).toHaveLength(6);
  });

  it("escapes the photographer's name", () => {
    const html = photoCredits([{ ...clues[0], by: "<b>A&B</b>" }], 1);
    expect(html).toContain("&lt;b&gt;A&amp;B&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
});

describe("photoSrcset", () => {
  it("offers iNaturalist's large size beside medium", () => {
    expect(photoSrcset("https://x/photos/1/medium.jpeg")).toBe(
      "https://x/photos/1/medium.jpeg 375w, https://x/photos/1/large.jpeg 768w",
    );
    expect(photoSrcset("https://x/photos/2/medium.")).toContain(
      "/photos/2/large. 768w",
    );
  });

  it("leaves a photo that isn't the medium size alone", () => {
    expect(photoSrcset("https://x/photos/3/square.jpg")).toBe("");
  });

  it("covers every photo in both puzzle sets", () => {
    const photos = [...daily, ...extra].flatMap((r) =>
      r.clues.map((c) => c.photo),
    );
    expect(photos.filter((p) => !photoSrcset(p))).toEqual([]);
  });
});

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
