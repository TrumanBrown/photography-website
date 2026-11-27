import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  EXTRA_PER_DAY,
  bestPossible,
  coords,
  entryFraction,
  photoCredits,
  pickExtra,
  readDaily,
  readExtra,
  reachLine,
  scoreGuess,
  shareText,
  tidyFact,
  verdictFor,
  type Round,
} from "./day-list";
import { nameParts } from "./day-list-names";
import { speciesName } from "../species-name";
import puzzles from "./day-list.json";
import extras from "./day-list-extra.json";
import facts from "./day-list-facts.json";

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

  // Ordered by worldwide record count, the first four were Mallards and
  // House Sparrows that ruled nothing out (2026-11-24).
  it("run from the most widespread species to the most local", () => {
    const unordered = [...daily, ...extra].filter((round) =>
      round.clues.some(
        (c, i) =>
          typeof c.reach !== "number" ||
          (i > 0 && c.reach > (round.clues[i - 1].reach ?? 0)),
      ),
    );
    expect(unordered.map((r) => r.name)).toEqual([]);
  });

  // The page reads every photo's pixels for its ring colour, so each loads
  // with CORS, and static.inaturalist.org sends no CORS header: a photo from
  // there wouldn't load at all.
  it("take every photo from iNaturalist's open-data bucket", () => {
    const elsewhere = [...daily, ...extra].flatMap((round) =>
      round.clues
        .map((c) => c.photo)
        .filter(
          (src) =>
            !src.startsWith("https://inaturalist-open-data.s3.amazonaws.com/"),
        ),
    );
    expect(elsewhere).toEqual([]);
  });
});

// A quarter of the cards named a place: "American robin" on the free first
// card, "Yosemite toad" on Yosemite's last (2026-11-26).
describe("place names in species names", () => {
  const shown = (name: string) =>
    nameParts(name)
      .map((p) => (p.hidden ? "#" : p.text))
      .join("");

  it("hides the place and keeps the kind of animal", () => {
    expect(shown("Australian magpie")).toBe("# magpie");
    expect(shown("South American coati")).toBe("# coati");
    expect(shown("Death Valley pupfish")).toBe("# pupfish");
    expect(shown("Indo-Pacific bottlenose dolphin")).toBe(
      "# bottlenose dolphin",
    );
    expect(shown("Cape robin-chat")).toBe("# robin-chat");
    expect(shown("Western Australian magpie")).toBe("Western # magpie");
  });

  it("leaves people, compass words, habitats and the animal's own name", () => {
    for (const name of [
      "Steller's jay",
      "Eastern spot-billed duck",
      "Austral thrush",
      "Island canary",
      "Alpine coral-fern",
      "Blue-fronted Amazon",
      "Common Mormon swallowtail",
      "Gharial",
    ]) {
      expect(shown(name)).toBe(name);
    }
  });

  // A rebuild can bring in a species named for a place this list doesn't
  // know. Add the word to day-list-names.ts.
  it("leaves no place showing on any card in either list", () => {
    const left: string[] = [];
    for (const round of [...daily, ...extra]) {
      for (const clue of round.clues) {
        const words = nameParts(speciesName(clue.name, { midSentence: true }))
          .filter((p) => !p.hidden)
          .flatMap((p) => p.text.trim().split(" "));
        // Still capitalised mid-sentence and not someone's name: a place.
        for (const w of words) {
          if (/^\p{Lu}/u.test(w) && !/['\u2019]s?$/.test(w) && w !== "Mormon") {
            left.push(`${clue.name} (${round.name})`);
          }
        }
      }
    }
    expect(left).toEqual([]);
  });

  it("leaves no word of the list's own place showing", () => {
    // Words a place's name shares with species names without naming it: the
    // canary of the Canary Islands, a kangaroo on Kangaroo Island.
    const GENERIC = new Set(
      (
        "park national provincial united states forest island islands mount mountain " +
        "mountains valley lake delta point great northern southern western eastern " +
        "north south west east central territory canary kangaroo"
      ).split(" "),
    );
    const fold = (w: string) =>
      w
        .normalize("NFKD")
        .replace(/[^\p{L}]/gu, "")
        .toLowerCase();
    const left: string[] = [];
    for (const round of [...daily, ...extra]) {
      const own = new Set(
        `${round.name} ${round.region}`
          .split(/[\s,()/–-]+/)
          .map(fold)
          .filter((w) => w.length >= 4 && !GENERIC.has(w)),
      );
      for (const clue of round.clues) {
        const words = nameParts(speciesName(clue.name))
          .filter((p) => !p.hidden)
          .flatMap((p) => p.text.trim().split(/[\s-]+/))
          .map(fold);
        if (words.some((w) => own.has(w))) {
          left.push(`${clue.name} (${round.name})`);
        }
      }
    }
    expect(left).toEqual([]);
  });
});

describe("reachLine", () => {
  it("rounds up to two figures, so half its sightings really are within it", () => {
    expect(reachLine({ reach: 3229, global: 1 })).toBe(
      "Half its sightings within 3,300 km of the spot",
    );
    expect(reachLine({ reach: 747, global: 1 })).toContain("within 750 km");
    expect(reachLine({ reach: 25, global: 1 })).toContain("within 25 km");
  });

  it("falls back to the worldwide count for a species with no reach", () => {
    expect(reachLine({ reach: null, global: 971861 })).toBe(
      "971,861 sightings worldwide",
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

describe("shareText", () => {
  const text = shareText({
    list: 22,
    date: new Date(2026, 10, 12),
    km: 8024,
    off: 4,
    used: 4,
    total: 6,
    score: 371,
  });

  it("names the list on the first line and ends with where to play", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("Narrow nature list 22, November 12");
    expect(lines.at(-1)).toBe("trumanbrown.com/hobbies/narrow-nature");
  });

  it("keeps the grid and the numbers", () => {
    expect(text).toContain("\u{1F4D6}".repeat(4) + "\u2B1C".repeat(2));
    expect(text).toContain("8,024 km off \u00b7 4/6 species \u00b7 371");
  });
});

describe("verdictFor", () => {
  it("names the same bands as the share squares", () => {
    expect([0, 1, 399, 400, 1499, 1500, 4999, 5000].map(verdictFor)).toEqual([
      "Spot on",
      "Near enough",
      "Near enough",
      "Right part of the world",
      "Right part of the world",
      "Not quite",
      "Not quite",
      "Wrong side of the planet",
    ]);
  });
});

describe("coords", () => {
  it("labels a spot the way the hobby scene's finder box does", () => {
    expect(coords({ lat: 43.45, lon: 142.62 })).toBe("43.5° N · 142.6° E");
    expect(coords({ lat: -33.9, lon: -70.04 })).toBe("33.9° S · 70.0° W");
  });
});

describe("entryFraction", () => {
  const box = { w: 10, e: 20, s: 40, n: 50 };
  const middle = { lat: 45, lon: 15 };

  it("stops the line where it meets the boundary", () => {
    expect(entryFraction({ lat: 45, lon: 0 }, middle, box)).toBeCloseTo(2 / 3);
    expect(entryFraction({ lat: 65, lon: 15 }, middle, box)).toBeCloseTo(0.75);
  });

  it("draws no line from a pin inside the place", () => {
    expect(entryFraction({ lat: 42, lon: 12 }, middle, box)).toBe(0);
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

describe("the full list's facts", () => {
  const written = (
    facts as { facts: Record<string, { fact: string; why?: string }> }
  ).facts;
  const clues = [...daily, ...extra].flatMap((r) => r.clues);
  const offenders = (bad: (fact: string) => boolean) =>
    clues
      .filter((c) => c.fact && bad(c.fact))
      .map((c) => `${c.id} ${c.name}: ${c.fact}`);
  const words = (fact: string) => fact.split(/\s+/).filter(Boolean).length;

  it("give every species a fact, unless the facts file says why not", () => {
    expect(
      clues
        .filter((c) => !c.fact.trim() && !written[c.id]?.why)
        .map((c) => `${c.id} ${c.name}`),
    ).toEqual([]);
  });

  it("match the written facts the builder copies in", () => {
    expect(
      clues
        .filter((c) => written[c.id] && written[c.id].fact !== c.fact)
        .map((c) => `${c.id} ${c.name}`),
    ).toEqual([]);
  });

  it("keep their Wikipedia link, unless the facts file drops it", () => {
    const entries = written as Record<string, { fact: string; wiki?: string }>;
    expect(
      clues
        .filter((c) => {
          const entry = entries[c.id];
          if (entry && "wiki" in entry) return c.wiki !== entry.wiki;
          return Boolean(c.fact) && !c.wiki;
        })
        .map((c) => `${c.id} ${c.name}`),
    ).toEqual([]);
  });

  it("keep each to one sentence of 12 to 25 words", () => {
    expect(
      offenders(
        (f) =>
          words(f) < 12 ||
          words(f) > 25 ||
          !/\.['"]?$/.test(f) ||
          /[.?!]['"]? +[A-Z]/.test(f),
      ),
    ).toEqual([]);
  });

  it("leave out taxonomy", () => {
    expect(
      offenders((f) =>
        /\b(?:is|was|are) (?:a|an|the) (?:\w+ )?(?:species|genus|subspecies) of\b|\bdescribed by\b|\bfamily [A-Z]/.test(
          f,
        ),
      ),
    ).toEqual([]);
  });

  it("never stop at '...' or an abbreviation", () => {
    expect(
      offenders(
        (f) =>
          /(\.\.\.|\u2026)$/.test(f) ||
          /(?:^|[\s(])(?:[A-Za-z]|(?:[A-Za-z]\.)+[A-Za-z]|etc|sp|spp|var|ca|St|Mt)\.$/.test(
            f,
          ),
      ),
    ).toEqual([]);
  });

  it("never join clauses with a dash", () => {
    expect(offenders((f) => /[\u2013\u2014]| -- | - /.test(f))).toEqual([]);
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

  it("shows only the first sentence", () => {
    expect(
      tidyFact(
        "The Namaqua dove (Oena capensis) is a small pigeon. It is the only species in the genus Oena.",
        "Oena capensis",
      ),
    ).toBe("The Namaqua dove is a small pigeon.");
  });

  it("doesn't end a sentence at an initial or a short form", () => {
    expect(
      tidyFact(
        "It was once treated as a subspecies of P. aethiopicus, found across the U.S. and Mexico. It digs.",
        "Phacochoerus africanus",
      ),
    ).toBe(
      "It was once treated as a subspecies of P. aethiopicus, found across the U.S. and Mexico.",
    );
  });

  it("hides a stub or a sentence cut off with dots", () => {
    expect(tidyFact("...", "Trichostetha capensis")).toBe("");
    expect(tidyFact("A beetle.", "Trichostetha capensis")).toBe("");
    expect(
      tidyFact(
        "It has been introduced to New Zealand, Australia, Peru, Brazil...",
        "Anas platyrhynchos",
      ),
    ).toBe("");
  });

  it("leaves no stub or cut-off fact on either full list", () => {
    for (const round of [...daily, ...extra]) {
      for (const clue of round.clues) {
        const tidy = tidyFact(clue.fact, clue.sci);
        if (!tidy) continue;
        expect(tidy.length).toBeGreaterThanOrEqual(15);
        expect(tidy).not.toMatch(/(\.\.\.|\u2026)$/);
      }
    }
  });
});
