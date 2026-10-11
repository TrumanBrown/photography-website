import { burstGroups, chooseVersion, padFraction, shotKey } from "./shots.mjs";
import { countsToward, decide, localParts, previousDay } from "./schedule.mjs";
import { planQueue } from "./plan.mjs";
import {
  hashMatcher,
  learnOffset,
  obsClock,
  pickObservation,
  speciesUsable,
  timeCandidates,
} from "./inat.mjs";
import { hamming } from "./hash.mjs";
import { loadSettings } from "./settings.mjs";

describe("shots", () => {
  it("keys a shot by camera and capture clock, falling back to the image hash", () => {
    expect(
      shotKey(
        { model: "ILCE-6700", clock: "2026-09-04T17:22:40", subsec: "12" },
        "ab",
      ),
    ).toBe("ILCE-6700|2026-09-04T17:22:40|12");
    expect(shotKey({ clock: null }, "abcd")).toBe("hash:abcd");
  });

  it("posts the version that needs no border, then the biggest", () => {
    const crop = { id: "s/DSC08826.JPEG", width: 2907, height: 4128 };
    const full = { id: "s/DSC08826-1.JPEG", width: 6192, height: 4128 };
    expect(padFraction(crop.width, crop.height)).toBeGreaterThan(0);
    expect(chooseVersion([crop, full]).id).toBe(full.id);
    expect(
      chooseVersion([
        { id: "a", width: 1000, height: 800 },
        { id: "b", width: 3000, height: 2000 },
      ]).id,
    ).toBe("b");
  });

  it("groups frames shot seconds apart into one burst", () => {
    const g = burstGroups([
      { key: "a", session: "s", clock: "2026-01-01T10:00:00" },
      { key: "b", session: "s", clock: "2026-01-01T10:00:30" },
      { key: "c", session: "s", clock: "2026-01-01T10:05:00" },
    ]);
    expect(g.get("a")).toBe(g.get("b"));
    expect(g.get("c")).not.toBe(g.get("a"));
  });
});

describe("schedule", () => {
  const settings = { ...loadSettings({}), live: true };
  // 2026-10-14 is a Wednesday; Los Angeles is UTC-7 in October.
  const at = (hhmm) => new Date(`2026-10-14T${hhmm}:00-07:00`);
  const day = (...states) => ({
    attempts: states.map(([state, time]) => ({
      state,
      claimedAt: at(time).toISOString(),
      publishedAt: at(time).toISOString(),
    })),
  });

  it("reads the local day and time in the configured zone", () => {
    expect(
      localParts(new Date("2026-10-15T05:30:00Z"), "America/Los_Angeles"),
    ).toEqual({ day: "2026-10-14", minutes: 22 * 60 + 30 });
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
  });

  it("makes each post due at its slot and keeps it due until done", () => {
    expect(decide({ now: at("08:00"), settings, day: day() }).due).toBe(false);
    expect(decide({ now: at("08:31"), settings, day: day() })).toEqual({
      due: true,
      slot: 0,
    });
    expect(decide({ now: at("11:59"), settings, day: day() }).due).toBe(true);
    expect(
      decide({ now: at("12:40"), settings, day: day(["published", "08:45"]) }),
    ).toEqual({ due: true, slot: 1 });
  });

  it("respects the minimum gap, the daily quota and the end of the day", () => {
    expect(
      decide({ now: at("12:40"), settings, day: day(["published", "11:00"]) })
        .reason,
    ).toMatch(/too soon/);
    expect(
      decide({
        now: at("20:00"),
        settings,
        day: day(
          ["published", "08:40"],
          ["published", "12:40"],
          ["published", "18:05"],
        ),
      }).due,
    ).toBe(false);
    expect(decide({ now: at("23:10"), settings, day: day() }).reason).toMatch(
      /over/,
    );
  });

  it("holds off while paused after a failure", () => {
    const paused = { attempts: [], pausedUntil: at("10:00").toISOString() };
    expect(decide({ now: at("09:00"), settings, day: paused }).reason).toMatch(
      /paused/,
    );
    expect(decide({ now: at("10:01"), settings, day: paused }).due).toBe(true);
  });

  it("counts dry runs toward the quota only while not live", () => {
    expect(countsToward({ state: "dry-run" }, false)).toBe(true);
    expect(countsToward({ state: "dry-run" }, true)).toBe(false);
    expect(countsToward({ state: "failed" }, true)).toBe(false);
  });
});

describe("planQueue", () => {
  const shot = (session, appeal, extra = {}) => ({
    status: "ready",
    session,
    post: { appeal, group: extra.group ?? "frog" },
    ...extra,
  });

  it("puts the best photos first without repeating a session back to back", () => {
    const shots = {
      a1: shot("a", 9),
      a2: shot("a", 8),
      b1: shot("b", 7),
      c1: shot("c", 6),
    };
    const order = planQueue({
      shots,
      posted: new Set(),
      count: 4,
      postsPerDay: 1,
    });
    expect(order[0]).toBe("a1");
    expect(order[1]).not.toBe("a2");
    expect(order).toHaveLength(4);
  });

  it("rotates places when several sessions share one location", () => {
    const shots = {
      r1: shot("a", 8, { location: "Limón Province, Costa Rica" }),
      r2: shot("b", 8, { location: "Limón Province, Costa Rica" }),
      r3: shot("c", 8, { location: "Limón Province, Costa Rica" }),
      w1: shot("d", 8, { location: "North Cascades, Washington" }),
      w2: shot("e", 8, { location: "Tibet, China" }),
    };
    const order = planQueue({
      shots,
      posted: new Set(),
      count: 5,
      postsPerDay: 1,
    });
    const places = order.map((k) => shots[k].location);
    for (let i = 1; i < 4; i++) expect(places[i]).not.toBe(places[i - 1]);
  });

  it("spaces the same species and skips posted, skipped and blocked shots", () => {
    const shots = {
      x: shot("a", 9, { speciesOk: true, inat: { taxon: 5 } }),
      y: shot("b", 8, { speciesOk: true, inat: { taxon: 5 } }),
      z: shot("c", 5),
      p: shot("d", 10),
      s: shot("e", 10, { skip: true }),
      k: shot("f", 10, { blocked: "already-on-account" }),
    };
    const order = planQueue({
      shots,
      posted: new Set(["p"]),
      count: 3,
      postsPerDay: 1,
    });
    expect(order).toEqual(["x", "z", "y"]);
  });
});

describe("iNaturalist matching", () => {
  const H = (hex8) => hex8.repeat(4);
  const flip = (hash, nibbles) =>
    hash
      .split("")
      .map((c, i) => (i < nibbles ? (parseInt(c, 16) ^ 0xf).toString(16) : c))
      .join("");
  const frame = H("ffff0000");
  const index = {
    observations: {
      1: {
        taxon: 10,
        rank: "species",
        quality: "research",
        clock: "2026-09-04T19:20:00",
        photos: { 100: "u" },
      },
      2: {
        taxon: 20,
        rank: "species",
        quality: "research",
        clock: "2026-09-04T19:21:00",
        photos: { 200: "u" },
      },
      3: {
        taxon: 30,
        rank: "genus",
        quality: "needs_id",
        clock: "2026-09-04T19:22:00",
        photos: { 300: "u" },
      },
      4: {
        taxon: 40,
        rank: "species",
        quality: "research",
        clock: "2026-05-01T10:00:00",
        photos: { 400: "u" },
      },
      5: {
        taxon: 50,
        rank: "species",
        quality: "research",
        clock: null,
        photos: { 500: "u" },
      },
    },
    hashes: {
      100: frame,
      200: flip(frame, 0),
      300: flip(frame, 2),
      400: frame,
      500: flip(frame, 2),
    },
  };
  const taxa = {
    10: { kingdom: "Plantae" },
    20: { kingdom: "Animalia" },
    30: { kingdom: "Animalia" },
  };
  const match = hashMatcher(index);

  it("only accepts copies observed within a day of the capture", () => {
    const hits = match([frame], "2026-09-04T19:20:10");
    expect(hits.map((h) => h.obsId).sort()).toEqual(["1", "2", "3"]);
    expect(hits.some((h) => h.obsId === "4")).toBe(false);
  });

  it("needs a near-exact hash when a date is missing", () => {
    expect(
      match([frame], null)
        .map((h) => h.obsId)
        .sort(),
    ).toEqual(["1", "2", "4"]);
  });

  it("always credits the closest frame, tie-breaking animal over plant", () => {
    const hits = match([frame], "2026-09-04T19:20:10");
    expect(pickObservation(hits, index, taxa).obsId).toBe("2");
    const farResearch = [
      { obsId: "3", photoId: "300", distance: 0 },
      { obsId: "1", photoId: "100", distance: 7 },
    ];
    expect(pickObservation(farResearch, index, taxa).obsId).toBe("3");
    expect(hamming(H("ffff0000"), H("0000ffff"))).toBe(128);
    expect(hamming("ab", "abcd")).toBe(Infinity);
  });

  it("learns a camera clock offset only when two matches agree", () => {
    expect(
      learnOffset([
        { shotClock: "2026-05-01T08:00:00", obsClock: "2026-04-30T14:00:00" },
      ]),
    ).toBe(0);
    expect(
      learnOffset([
        { shotClock: "2026-05-01T08:00:00", obsClock: "2026-04-30T14:00:00" },
        { shotClock: "2026-05-01T09:10:00", obsClock: "2026-04-30T15:11:00" },
      ]),
    ).toBe(-18 * 60);
  });

  it("offers only research-grade observations from the same moment", () => {
    const c = timeCandidates("2026-09-04T17:21:00", index, 120, 5);
    expect(c.map((x) => x.obsId)).toEqual(["2", "1"]);
  });

  it("lends a species name only from research-grade, species-level IDs", () => {
    expect(speciesUsable(index.observations[1], { rank: "species" })).toBe(
      true,
    );
    expect(speciesUsable(index.observations[3], { rank: "genus" })).toBe(false);
    expect(obsClock({ time_observed_at: "2026-09-04T19:20:33-06:00" })).toBe(
      "2026-09-04T19:20:33",
    );
  });
});
