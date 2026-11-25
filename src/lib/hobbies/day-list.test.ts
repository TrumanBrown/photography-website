import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  EXTRA_PER_DAY,
  STAMP_CLEAR,
  bestPossible,
  photoCredits,
  photoSrcset,
  pickExtra,
  placeVerdict,
  readDaily,
  readExtra,
  reachLine,
  scoreGuess,
  shareText,
  tidyFact,
  type Round,
} from "./day-list";
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
    const unordered = daily.filter((round) =>
      round.clues.some(
        (c, i) =>
          typeof c.reach !== "number" ||
          (i > 0 && c.reach > (round.clues[i - 1].reach ?? 0)),
      ),
    );
    expect(unordered.map((r) => r.name)).toEqual([]);
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

describe("placeVerdict", () => {
  // The map, the stamp's tilted footprint for the longest verdict ("Wrong
  // side of the planet", with its distance), and the controls, as measured
  // on the page at 390x844 and 1440x900.
  const screens = {
    phone: {
      size: { width: 390, height: 193 },
      stamp: { w: 179, h: 56 },
      controls: { zoomLeft: 354, footer: 36 },
    },
    desktop: {
      size: { width: 778, height: 388 },
      stamp: { w: 227, h: 65 },
      controls: { zoomLeft: 739, footer: 39 },
    },
  };
  const near = (r: Round) => ({
    lat: Math.min(85, r.bbox.n + 1.5),
    lon: Math.min(180, r.bbox.e + 2),
  });
  // A guess in each quarter of the world, and one just off the place.
  const guesses = (r: Round) => [
    { lat: 45, lon: -100 },
    { lat: 50, lon: 30 },
    { lat: -15, lon: -55 },
    { lat: -25, lon: 135 },
    near(r),
  ];

  it.each(Object.entries(screens))(
    "keeps the stamp off the pin, the line and the place on a %s",
    (_, screen) => {
      const covered: string[] = [];
      for (const round of [...daily, ...extra]) {
        for (const pin of guesses(round)) {
          const b = round.bbox;
          const frame = {
            w: Math.min(b.w, pin.lon),
            e: Math.max(b.e, pin.lon),
            s: Math.min(b.s, pin.lat),
            n: Math.max(b.n, pin.lat),
          };
          // The map's labels are 11px, about 6.5px a letter.
          const labels = { name: round.name.length * 6.5, km: 52 };
          const { clear } = placeVerdict({
            bbox: b,
            pin,
            frame,
            labels,
            ...screen,
          });
          if (clear < STAMP_CLEAR) {
            covered.push(`${round.name} from ${pin.lat},${pin.lon}: ${clear}`);
          }
        }
      }
      expect(covered).toEqual([]);
    },
  );
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
