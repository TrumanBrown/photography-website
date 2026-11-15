import { describe, expect, it } from "vitest";
import { speciesName } from "../species-name";
import { SPECIES as TANK } from "./aquarium-species";
import { FISH } from "./fishing-species";
import { SPECIES as HERPS } from "./herping-species";
import { SPECIES as CRITTERS } from "./tidepool-species";

/**
 * The parts of "Species facts and data blurbs" and "Do not write" in
 * .github/instructions/site-copy.instructions.md that a test can check, over
 * the facts on the tide pool and herping reveal cards and the fishing map
 * notes. A failure lists every offending fact with its species id.
 */
interface Deck {
  name: string;
  species: { id: string; facts: string[] }[];
  /** How many facts each species gets. */
  count: [min: number, max: number];
  /** The fishing notes were rewritten without semicolons (November 2026). */
  noSemicolons?: boolean;
}

const decks: Deck[] = [
  { name: "herping", species: HERPS, count: [2, 3] },
  { name: "tide pooling", species: CRITTERS, count: [2, 3] },
  {
    name: "fishing",
    species: FISH.map((f) => ({ id: f.id, facts: [f.note] })),
    count: [1, 1],
    noSemicolons: true,
  },
];

const STOCK_OPENER = /^(did you know|fun fact|interestingly|believe it or not)\b/i;
const BANNED_WORD =
  /\b(discover|explore|dive in|embark|unleash|elevate|immerse|journey through|unlock|stunning|breathtaking|vibrant|captivating|seamless|robust|rich|powerful|moreover|furthermore|additionally|in conclusion|ultimately|not just|isn't just|more than just)\b/i;

const wordCount = (fact: string) => fact.split(/\s+/).filter(Boolean).length;

describe.each(decks)("$name species facts", ({ species, count, noSemicolons }) => {
  const offenders = (bad: (fact: string) => boolean) =>
    species.flatMap((s) =>
      s.facts.filter((fact) => bad(fact)).map((fact) => `${s.id}: ${fact}`),
    );

  it("gives every species the right number of facts", () => {
    expect(
      species
        .filter((s) => s.facts.length < count[0] || s.facts.length > count[1])
        .map((s) => s.id),
    ).toEqual([]);
  });

  it("never joins clauses with a dash", () => {
    expect(offenders((f) => /[\u2013\u2014]| -- /.test(f))).toEqual([]);
  });

  it("keeps each fact to one sentence with no exclamation", () => {
    expect(
      offenders(
        (f) =>
          !/\.['"]?$/.test(f) || /[.?]['"]? +[A-Z]/.test(f) || f.includes("!"),
      ),
    ).toEqual([]);
  });

  it("keeps each fact roughly 12 to 25 words", () => {
    expect(offenders((f) => wordCount(f) < 8 || wordCount(f) > 28)).toEqual(
      [],
    );
  });

  it("skips stock openers and the banned words", () => {
    expect(
      offenders((f) => STOCK_OPENER.test(f) || BANNED_WORD.test(f)),
    ).toEqual([]);
  });

  it("uses straight quotes", () => {
    expect(offenders((f) => /[\u2018\u2019\u201C\u201D]/.test(f))).toEqual([]);
  });

  it.runIf(noSemicolons)("never joins clauses with a semicolon", () => {
    expect(offenders((f) => f.includes(";"))).toEqual([]);
  });
});

describe("species names", () => {
  it("are sentence case, keeping proper nouns", () => {
    const names = [
      ...HERPS.map((s) => s.common),
      ...CRITTERS.map((s) => s.common),
      ...FISH.map((f) => f.common),
      ...TANK.map((s) => s.name),
    ];
    expect(names.filter((n) => n !== speciesName(n))).toEqual([]);
  });
});
