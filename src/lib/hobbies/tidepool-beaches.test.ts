import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPECIES } from "./tidepool-species";
import {
  ART_VERSION,
  BEACHES,
  CLUE_FACT,
  HABITAT,
  LABEL_SPECIES,
  OTHER_LIFE,
  beachesFor,
  clueFor,
  deal,
  landing,
  todaysBeach,
  todaysThree,
  type BeachData,
  type BeachId,
} from "./tidepool-beaches";

const dir = join(process.cwd(), "public", "tidepool", ART_VERSION);
const beaches = Object.fromEntries(
  BEACHES.map((b) => [
    b.id,
    JSON.parse(
      readFileSync(join(dir, b.id, "beach.json"), "utf8"),
    ) as BeachData,
  ]),
) as Record<BeachId, BeachData>;
const sizes = Object.fromEntries(SPECIES.map((s) => [s.id, 5]));

function inside(pts: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      hit = !hit;
  }
  return hit;
}

describe("the beaches", () => {
  it("has a built beach for each one, each with its own kind of ground", () => {
    for (const b of BEACHES) {
      expect(beaches[b.id].name).toBe(b.id);
      expect(Object.keys(beaches[b.id].slots).length).toBeGreaterThan(1);
    }
    const kinds = BEACHES.map((b) =>
      Object.keys(beaches[b.id].slots).sort().join(","),
    );
    expect(new Set(kinds).size).toBe(BEACHES.length);
  });

  it("has one boulder too heavy to turn in one go", () => {
    expect(beaches.boulder.rocks.some((r) => r.heavy > 1)).toBe(true);
  });

  it("names every label a tap can land on", () => {
    for (const b of BEACHES)
      for (const l of beaches[b.id].labels)
        expect(
          LABEL_SPECIES.has(l) ||
            !!OTHER_LIFE[l] ||
            [
              "rock",
              "gravel",
              "sand",
              "water",
              "sandstone",
              "cobble",
              "shells",
              "tracks",
            ].includes(l),
        ).toBe(true);
  });

  it("gives every animal at least one beach to live on", () => {
    for (const s of SPECIES) {
      if (LABEL_SPECIES.has(s.id) && !HABITAT[s.id]) continue;
      expect(beachesFor(s.id, beaches), s.id).not.toHaveLength(0);
    }
  });
});

describe("deal", () => {
  it("only puts an animal where it lives", () => {
    for (const b of BEACHES)
      for (const seed of [1, 2, 3]) {
        for (const p of deal(beaches[b.id], seed, sizes)) {
          const kind =
            p.rock === null
              ? p.on
              : beaches[b.id].rocks[p.rock].heavy > 1
                ? "under-big"
                : "under";
          const w =
            HABITAT[p.id]?.[kind] ??
            (kind === "under-big" ? HABITAT[p.id]?.under : 0);
          expect(w, `${p.id} on ${kind} at ${b.id}`).toBeGreaterThan(0);
        }
      }
  });

  it("hides animals under a rock inside its outline, and keeps the rest clear of where rocks land", () => {
    for (const b of BEACHES) {
      const beach = beaches[b.id];
      const placed = deal(beach, 7, sizes);
      for (const p of placed) {
        if (p.rock !== null)
          expect(inside(beach.rocks[p.rock].pts, p.x, p.y)).toBe(true);
        else
          for (const r of beach.rocks) {
            expect(
              inside(r.pts, p.x, p.y),
              `${p.id} under a resting rock at ${b.id}`,
            ).toBe(false);
            expect(
              inside(landing(r), p.x, p.y),
              `${p.id} where a rock lands at ${b.id}`,
            ).toBe(false);
          }
      }
    }
  });

  it("puts a crowd under the big boulder", () => {
    const i = beaches.boulder.rocks.findIndex((r) => r.heavy > 1);
    for (const seed of [1, 2, 3, 4]) {
      const n = deal(beaches.boulder, seed, sizes).filter(
        (p) => p.rock === i,
      ).length;
      expect(n).toBeGreaterThanOrEqual(2);
    }
  });

  it("deals the same beach for the same seed", () => {
    expect(deal(beaches.cobble, 42, sizes)).toEqual(
      deal(beaches.cobble, 42, sizes),
    );
  });
});

describe("today's three", () => {
  it("visits every beach in turn", () => {
    const days = Array.from({ length: BEACHES.length }, (_, i) =>
      todaysBeach(20000 + i),
    );
    expect(new Set(days).size).toBe(BEACHES.length);
  });

  it("are three different animals that today's deal always includes", () => {
    for (let day = 20400; day < 20412; day++) {
      const beach = beaches[todaysBeach(day)];
      const three = todaysThree(day, beach);
      expect(new Set(three).size).toBe(3);
      const placed = deal(beach, day, sizes, three).map((p) => p.id);
      for (const id of three)
        expect(placed, `${id} on ${beach.name}`).toContain(id);
    }
  });

  it("clues never give the animal's name", () => {
    for (const s of SPECIES) {
      if (CLUE_FACT[s.id] === undefined) continue;
      expect(clueFor(s).toLowerCase(), s.id).not.toContain(
        s.common.toLowerCase(),
      );
    }
  });
});
